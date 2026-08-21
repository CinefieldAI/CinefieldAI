import "server-only";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildC2paManifest } from "./manifest-builder";
import { CLAIM_GENERATOR, type DigitalSourceType } from "./provenance-contract";

/**
 * C2PA embedding + official verification (Phase 27-A's missing consumer).
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE PIECE THAT WAS MISSING
 * ---------------------------------------------------------------------------
 * Phase 27 built the manifest template, the canonical claim, the signer seam
 * and a detached verifier — everything except a consumer that actually writes
 * a manifest INTO the delivered bytes, because the pipeline position for it
 * (post-FFmpeg, pre-R2) did not exist. `media-transform.ts` created that
 * position; this module fills it.
 *
 * Nothing here re-implements the manifest: `buildC2paManifest()` (unchanged)
 * remains the single source of the assertion shape, and this module hands its
 * output to the official ContentAuth binding.
 *
 * ---------------------------------------------------------------------------
 * OFFICIAL TOOLING, LAZILY LOADED
 * ---------------------------------------------------------------------------
 * `c2pa-node` is ContentAuth's own Node binding — the roadmap names c2patool,
 * and this is the same c2pa-rs engine exposed to Node rather than a
 * third-party wrapper. It is a NATIVE module, so it is imported lazily: a
 * Next.js route that never signs must not pay for loading it, and an
 * environment where the binary cannot load reports `c2pa_unavailable` instead
 * of crashing the process at import time.
 *
 * ---------------------------------------------------------------------------
 * VERIFICATION IS NOT OPTIONAL, AND IT IS THE OFFICIAL READER
 * ---------------------------------------------------------------------------
 * After embedding, the bytes are read back with the same official library and
 * its `validation_status` is inspected. A non-empty `validation_status` means
 * the C2PA engine itself found a problem, and this function reports failure —
 * it never returns success on the strength of "sign() did not throw".
 */

export type EmbedOutcome =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      /** Issuer string the official reader reports. Identity only, never key material. */
      readonly signerIssuer: string;
      readonly officiallyVerified: true;
    }
  | {
      readonly ok: false;
      readonly reasonCode:
        | "c2pa_unavailable"
        | "signer_not_configured"
        | "unsupported_format"
        | "embed_failed"
        | "verify_failed"
        | "manifest_invalid";
      /** Bounded verifier codes when the official reader rejected the result. */
      readonly validationCodes?: readonly string[];
    };

/** Formats the official tooling can carry an embedded manifest in. */
const EMBEDDABLE_MIMES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "video/mp4", "audio/wav"]);

export function isEmbeddableMime(mime: string): boolean {
  return EMBEDDABLE_MIMES.has(mime);
}

const EXTENSION_FOR_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "video/mp4": "mp4",
  "audio/wav": "wav",
};

/**
 * How the embedder obtains a C2PA signer.
 *
 * `"test"` uses the official library's own `createTestSigner()` — a
 * development certificate the C2PA ecosystem does NOT trust in production.
 * `"none"` is the production default until a real trust-list certificate
 * exists: it refuses rather than silently signing with a test identity, which
 * is the difference between "unsigned, and we said so" and a credential that
 * looks real and is not.
 */
export type C2paSignerMode = "none" | "test";

let signerMode: C2paSignerMode = "none";

export function currentC2paSignerMode(): C2paSignerMode {
  return signerMode;
}

/** Installing a signer is deliberate. Production has no trusted signer yet. */
export function setC2paSignerMode(mode: C2paSignerMode): void {
  signerMode = mode;
}

export function resetC2paSignerMode(): void {
  signerMode = "none";
}

export interface EmbedParams {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly digitalSourceType: DigitalSourceType;
  readonly softwareAgent: string;
}

export async function embedC2paProvenance(params: EmbedParams): Promise<EmbedOutcome> {
  if (!isEmbeddableMime(params.mime)) return { ok: false, reasonCode: "unsupported_format" };
  if (signerMode === "none") return { ok: false, reasonCode: "signer_not_configured" };

  const built = buildC2paManifest({
    digitalSourceType: params.digitalSourceType,
    softwareAgent: params.softwareAgent,
  });
  if (!built.ok) return { ok: false, reasonCode: "manifest_invalid" };

  let lib: typeof import("c2pa-node");
  try {
    lib = await import("c2pa-node");
  } catch {
    return { ok: false, reasonCode: "c2pa_unavailable" };
  }

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "cinefield-c2pa-"));
    const ext = EXTENSION_FOR_MIME[params.mime];
    const inputPath = join(dir, `${randomUUID()}.${ext}`);
    const outputPath = join(dir, `${randomUUID()}.signed.${ext}`);
    await writeFile(inputPath, params.bytes);

    const signer = await lib.createTestSigner();
    const c2pa = lib.createC2pa({ signer });

    const manifest = new lib.ManifestBuilder({
      claim_generator: CLAIM_GENERATOR,
      format: params.mime,
      // The assertion comes from Phase 27's own builder, unmodified.
      assertions: built.manifest.assertions as unknown as ConstructorParameters<
        typeof lib.ManifestBuilder
      >[0]["assertions"],
    });

    try {
      await c2pa.sign({
        asset: { path: inputPath, mimeType: params.mime },
        manifest,
        // The library derives a thumbnail by default and cannot do so for
        // every container (video fails outright). A thumbnail is decoration,
        // not provenance — disabled so the assertion, which is the point,
        // works uniformly across all four formats.
        thumbnail: false,
        options: { outputPath },
      });
    } catch {
      return { ok: false, reasonCode: "embed_failed" };
    }

    const signedBytes = new Uint8Array(await readFile(outputPath));

    // ---- Official verification, with a fresh reader (no signer installed) --
    const reader = lib.createC2pa();
    const result = await reader.read({ path: outputPath, mimeType: params.mime });
    if (!result) return { ok: false, reasonCode: "verify_failed" };

    const status = (result.validation_status ?? []) as { code?: string }[];
    if (status.length > 0) {
      return {
        ok: false,
        reasonCode: "verify_failed",
        validationCodes: status.map((s) => String(s.code ?? "unknown")).slice(0, 10),
      };
    }

    const issuer = result.active_manifest?.signature_info?.issuer ?? "unknown";

    return { ok: true, bytes: signedBytes, signerIssuer: String(issuer).slice(0, 200), officiallyVerified: true };
  } catch {
    return { ok: false, reasonCode: "embed_failed" };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Reads provenance back out of arbitrary bytes with the official library.
 *
 * Used to prove tamper detection and to inspect provider-native credentials
 * on input. Returns bounded facts only — never the raw manifest blob.
 */
export type ReadOutcome =
  | { readonly present: false; readonly reasonCode: "no_manifest" | "c2pa_unavailable" | "read_failed" }
  | {
      readonly present: true;
      readonly valid: boolean;
      readonly validationCodes: readonly string[];
      readonly claimGenerator: string;
      readonly signerIssuer: string;
      readonly digitalSourceType: string | null;
    };

export async function readEmbeddedProvenance(params: { bytes: Uint8Array; mime: string }): Promise<ReadOutcome> {
  let lib: typeof import("c2pa-node");
  try {
    lib = await import("c2pa-node");
  } catch {
    return { present: false, reasonCode: "c2pa_unavailable" };
  }

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "cinefield-c2pa-read-"));
    const ext = EXTENSION_FOR_MIME[params.mime] ?? "bin";
    const path = join(dir, `${randomUUID()}.${ext}`);
    await writeFile(path, params.bytes);

    const result = await lib.createC2pa().read({ path, mimeType: params.mime });
    if (!result) return { present: false, reasonCode: "no_manifest" };

    const status = (result.validation_status ?? []) as { code?: string }[];
    const active = result.active_manifest;
    const actions = active?.assertions?.find((a: { label?: string }) => a.label === "c2pa.actions") as
      | { data?: { actions?: { digitalSourceType?: string }[] } }
      | undefined;

    return {
      present: true,
      valid: status.length === 0,
      validationCodes: status.map((s) => String(s.code ?? "unknown")).slice(0, 10),
      claimGenerator: String(active?.claim_generator ?? "unknown").slice(0, 200),
      signerIssuer: String(active?.signature_info?.issuer ?? "unknown").slice(0, 200),
      digitalSourceType: actions?.data?.actions?.[0]?.digitalSourceType ?? null,
    };
  } catch {
    return { present: false, reasonCode: "read_failed" };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
