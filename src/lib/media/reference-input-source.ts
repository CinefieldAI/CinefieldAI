import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reference-media byte acquisition (Phase 28-A).
 *
 * ---------------------------------------------------------------------------
 * THE ONE PLACE THE SAFETY GATE READS A USER'S UPLOADED REFERENCE
 * ---------------------------------------------------------------------------
 * REFERANS M.1 is blunt about which feature carries the most risk: "referans
 * görsel yükleme EN RİSKLİ özelliktir (kullanıcı gerçek bir insanın
 * fotoğrafını yükleyebilir) — orayı en sıkı tut." Evaluating that upload
 * means reading it, and reading user media in the admission path is exactly
 * the kind of thing that grows a second, laxer copy if it is left to each
 * caller. So there is one function, and it is bounded.
 *
 * ---------------------------------------------------------------------------
 * A PATH, NOT A URL — SO THERE IS NO FETCH TO ATTACK
 * ---------------------------------------------------------------------------
 * `inputUrl` is misleadingly named: it is a PATH inside one private Supabase
 * Storage bucket, produced by `buildInputStoragePath` as
 * `{clerkUserId}/{projectId}/{timestamp}-{random}.{ext}`. There is no scheme,
 * no host and no port anywhere in it, and the bucket name is a constant in
 * this file rather than a parameter.
 *
 * That is what makes SSRF structurally inapplicable here rather than merely
 * mitigated: this module performs no outbound request to any caller-influenced
 * destination. If a future change ever accepts a real URL, it must go through
 * Phase 12-C's outbound-fetch gateway, and this comment is where that decision
 * should be argued.
 *
 * ---------------------------------------------------------------------------
 * OWNERSHIP IS ENFORCED, NOT ASSUMED
 * ---------------------------------------------------------------------------
 * The server reads with the service role, which bypasses RLS — so the bucket's
 * own policies protect nothing here. The path's FIRST SEGMENT is the uploader's
 * Clerk id by construction, and this module refuses any path whose first
 * segment is not the authenticated caller. Without that check, one user could
 * name another user's uploaded face and have it fetched on their behalf.
 */

/** Constant, never a parameter. A caller cannot redirect this at another bucket. */
const REFERENCE_INPUT_BUCKET = "generation-inputs";

/**
 * What this gate is willing to evaluate.
 *
 * Images only, and the same three the one real consumer of reference input
 * (`gemini-provider.ts`'s `loadInputImage`) already accepts. The roadmap's
 * requirement is about a FACE upload; a format this gate cannot evaluate is
 * refused rather than waved through, which is what "unsupported content type
 * → fail closed" means.
 */
export const REFERENCE_INPUT_MIMES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/**
 * Byte ceiling for a reference read.
 *
 * Deliberately BELOW `MAX_UPLOAD_BYTES` (64 MB, r2-client). That value is the
 * ceiling for storing an arbitrary asset; this one bounds a synchronous read
 * inside the admission path, on an image-only lane, where a classifier gains
 * nothing from a larger file. A technical bound, not a policy threshold —
 * there is no roadmap number to defer to and none is being invented.
 */
export const MAX_REFERENCE_INPUT_BYTES = 16 * 1024 * 1024;

/** How long a read may take before it is abandoned as unusable. */
export const REFERENCE_READ_TIMEOUT_MS = 10_000;

export type ReferenceFetchFailure =
  /** Shape refused: traversal, absolute, scheme-like, or illegal characters. */
  | "invalid_reference_path"
  /** The path belongs to a different Clerk user. */
  | "reference_not_owned"
  /** Not an evaluable image type, or no type declared at all. */
  | "unsupported_reference_mime"
  | "reference_too_large"
  | "reference_not_found"
  | "reference_read_failed"
  | "reference_read_timeout";

export type ReferenceFetchOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly byteLength: number }
  | { readonly ok: false; readonly reason: ReferenceFetchFailure };

/**
 * A storage path, and nothing that could be anything else.
 *
 * Rejects traversal, absolute paths, backslashes, and anything scheme-shaped.
 * The allow-list is positive — characters not named here cannot appear — so a
 * form nobody anticipated is refused rather than passed along.
 */
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9_.\-/]{0,511}$/;

export function isSafeReferencePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("..")) return false;
  if (path.includes("\\")) return false;
  if (path.includes("://")) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("//")) return false;
  return SAFE_PATH.test(path);
}

/** Whether this path was uploaded by this caller. See the header. */
export function referencePathBelongsTo(path: string, clerkUserId: string): boolean {
  const first = path.split("/")[0];
  return first.length > 0 && first === clerkUserId;
}

/**
 * Reads one reference upload for evaluation.
 *
 * Never throws: every failure is a bounded reason code, because the caller is
 * a safety gate and an exception there would have to be caught into a decision
 * anyway. Every reason it can return is treated as fail-closed by the gate —
 * this function's job is to say WHICH kind of not-knowing occurred, so an
 * operator can tell a missing file from a refused path.
 *
 * The bytes are returned to the caller and never persisted, logged, hashed
 * into evidence, or copied anywhere by this module.
 */
export async function readReferenceInputBytes(
  admin: SupabaseClient,
  params: {
    readonly storagePath: string;
    readonly declaredMime: string | null | undefined;
    readonly clerkUserId: string;
  }
): Promise<ReferenceFetchOutcome> {
  if (!isSafeReferencePath(params.storagePath)) {
    return { ok: false, reason: "invalid_reference_path" };
  }
  if (!referencePathBelongsTo(params.storagePath, params.clerkUserId)) {
    return { ok: false, reason: "reference_not_owned" };
  }
  // A reference with no declared type is UNEVALUABLE, not harmless. Refusing
  // here also closes an obvious bypass: attach a face, omit `mime_type`, and
  // hope the gate skips a reference it cannot classify.
  if (typeof params.declaredMime !== "string" || !REFERENCE_INPUT_MIMES.includes(params.declaredMime)) {
    return { ok: false, reason: "unsupported_reference_mime" };
  }

  let downloaded: { data: Blob | null; error: unknown } | "timeout";
  try {
    downloaded = await Promise.race([
      admin.storage.from(REFERENCE_INPUT_BUCKET).download(params.storagePath),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), REFERENCE_READ_TIMEOUT_MS)),
    ]);
  } catch {
    // The underlying error is discarded rather than propagated: a storage
    // error can carry a path, a token or a signed URL, and nothing in the
    // safety package may persist or log any of them.
    return { ok: false, reason: "reference_read_failed" };
  }

  if (downloaded === "timeout") return { ok: false, reason: "reference_read_timeout" };
  if (downloaded.error) return { ok: false, reason: "reference_read_failed" };
  if (!downloaded.data) return { ok: false, reason: "reference_not_found" };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  } catch {
    return { ok: false, reason: "reference_read_failed" };
  }

  if (bytes.byteLength === 0) return { ok: false, reason: "reference_not_found" };
  // Checked AFTER the read because Supabase Storage's client returns a body
  // rather than a streamed handle. The ceiling still bounds what reaches the
  // evaluator, which is what the classifier lane actually needs protecting.
  if (bytes.byteLength > MAX_REFERENCE_INPUT_BYTES) {
    return { ok: false, reason: "reference_too_large" };
  }

  return { ok: true, bytes, byteLength: bytes.byteLength };
}
