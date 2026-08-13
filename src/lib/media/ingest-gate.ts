import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectUntrustedMedia } from "./sandbox/media-inspector";
import { ALLOWED_VERIFIED_MIMES, declarationMatches, type VerifiedMime } from "./mime-detect";

/**
 * THE ingest gate (Phase 9-B).
 *
 * One gate, one contract, for every source. A browser upload and a provider
 * result arrive in different lanes and keep different provenance, but they
 * are validated by exactly this function — because two validation paths mean
 * two security postures, and the weaker one is the one that gets used.
 *
 * WHAT IT DECIDES
 *   what the bytes actually are      (sandboxed detection, never the header)
 *   what they hash to                (sandboxed SHA-256 over real content)
 *   whether an identical copy exists (within ONE owner, evidence only)
 *   whether moderation has spoken    (it has not; see below)
 *   whether the asset may leave quarantine
 *
 * FAIL-CLOSED, EVERYWHERE. Unsupported format, mismatched declaration,
 * sandbox timeout, sandbox crash, moderation unavailable — every one of them
 * leaves the asset quarantined. There is no branch in this file that reaches
 * `released`, and the database refuses it independently
 * (`media_assets_release_requires_checks`).
 *
 * PROVIDER SUCCESS IS STILL NOT COMPLETION. 9-A made completion require
 * storage and a record; this makes it require verification too. A provider
 * that did its job perfectly can still produce media Cinefield will not serve.
 */

/** Non-secret rejection codes. They are persisted and read by operators. */
export type IngestRejection =
  | "empty_media"
  | "unsupported_format"
  | "hostile_format"
  | "declared_mime_mismatch"
  | "too_large";

export type IngestFailure = "sandbox_timeout" | "sandbox_crashed" | "inspection_failed";

export type IngestOutcome =
  | {
      status: "verified";
      verifiedMime: VerifiedMime;
      checksumSha256: string;
      byteLength: number;
      duplicateOfAssetId: string | null;
      /** Always quarantined in 9-B — no moderation engine exists to release it. */
      moderationStatus: "not_evaluated" | "pending";
    }
  | { status: "rejected"; reason: IngestRejection; checksumSha256?: string }
  | { status: "failed"; reason: IngestFailure };

/**
 * Moderation, as it honestly stands.
 *
 * The repository has ONE classifier: `content-moderation.ts`, Llama Guard via
 * Cloudflare — text only, gated behind `CLOUDFLARE_AI_ENABLED` (currently
 * false), and documented as "never called by the generation pipeline". There
 * is no image, video or audio moderation engine, and this batch does not
 * invent one or sign up for a paid service.
 *
 * So moderation is a CONTRACT here, not a verdict. `not_evaluated` is the
 * truth and it is fail-closed by construction: the release constraint demands
 * `passed`, which nothing can currently produce. An asset therefore stays
 * quarantined no matter how clean it is — which is the correct posture for a
 * private beta, and is stated in docs/security-gates.md rather than papered
 * over with a default that reads like approval.
 */
export const MODERATION_ENGINE: string | null = null;

export interface IngestParams {
  assetId: string;
  ownerId: string;
  bytes: Uint8Array;
  declaredContentType?: string | null;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Runs the gate and records the result. Returns the outcome; never throws for
 * a media reason, because "this file is hostile" is data, not an exception.
 */
export async function ingestMediaAsset(
  admin: SupabaseClient,
  params: IngestParams
): Promise<IngestOutcome> {
  const inspection = await inspectUntrustedMedia(params.bytes, {
    maxBytes: params.maxBytes,
    timeoutMs: params.timeoutMs,
  });

  // ---- The sandbox could not finish -------------------------------------
  // Distinct from a rejection: nothing is known about these bytes, so the
  // asset stays recoverable and a later attempt may try again. Silently
  // treating "we could not look" as "it is fine" is the failure mode this
  // whole phase exists to prevent.
  if (!inspection.ok) {
    const failure: IngestFailure =
      inspection.failure === "timeout"
        ? "sandbox_timeout"
        : inspection.failure === "crashed" || inspection.failure === "unreadable_result"
          ? "sandbox_crashed"
          : "inspection_failed";

    if (inspection.failure === "too_large") {
      await record(admin, params.assetId, { ingestStatus: "rejected", failureReason: "too_large" });
      return { status: "rejected", reason: "too_large" };
    }

    await record(admin, params.assetId, { ingestStatus: "failed", failureReason: failure });
    return { status: "failed", reason: failure };
  }

  const detection = inspection.detection!;
  const checksum = inspection.sha256!;

  if (detection.outcome === "empty") {
    await record(admin, params.assetId, { ingestStatus: "rejected", failureReason: "empty_media", checksum });
    return { status: "rejected", reason: "empty_media", checksumSha256: checksum };
  }

  // Named separately from "unsupported" so an operator can tell a corrupt
  // upload from an attempt to store an executable.
  if (detection.outcome === "hostile") {
    await record(admin, params.assetId, {
      ingestStatus: "rejected",
      failureReason: `hostile_${detection.kind}`.slice(0, 64),
      checksum,
    });
    return { status: "rejected", reason: "hostile_format", checksumSha256: checksum };
  }

  if (detection.outcome === "unknown" || !ALLOWED_VERIFIED_MIMES.has(detection.mime)) {
    await record(admin, params.assetId, {
      ingestStatus: "rejected",
      failureReason: "unsupported_format",
      checksum,
    });
    return { status: "rejected", reason: "unsupported_format", checksumSha256: checksum };
  }

  // A declaration that disagrees with the bytes is refused rather than
  // corrected. Storing an MP4 that everything downstream believes is a PNG is
  // how a mismatch becomes a delivery bug, or worse.
  if (!declarationMatches(params.declaredContentType, detection.mime)) {
    await record(admin, params.assetId, {
      ingestStatus: "rejected",
      failureReason: "declared_mime_mismatch",
      checksum,
    });
    return { status: "rejected", reason: "declared_mime_mismatch", checksumSha256: checksum };
  }

  const duplicateOfAssetId = await findOwnerDuplicate(admin, params.ownerId, checksum, params.assetId);

  await record(admin, params.assetId, {
    ingestStatus: "verified",
    verifiedMime: detection.mime,
    checksum,
    duplicateOf: duplicateOfAssetId,
    // Recorded explicitly rather than left at its default, so the row says
    // "we looked and there is no engine" instead of "nobody got round to it".
    moderationStatus: MODERATION_ENGINE ? "pending" : "not_evaluated",
    moderationEngine: MODERATION_ENGINE,
  });

  return {
    status: "verified",
    verifiedMime: detection.mime,
    checksumSha256: checksum,
    byteLength: inspection.byteLength ?? params.bytes.byteLength,
    duplicateOfAssetId,
    moderationStatus: MODERATION_ENGINE ? "pending" : "not_evaluated",
  };
}

/**
 * Finds an earlier asset of the SAME OWNER with identical bytes.
 *
 * Scoped by `clerk_user_id` in the query, matching the tenant-leading index.
 * This is deliberately not a global lookup: answering "does anyone hold these
 * bytes" is a disclosure even when the row is never returned, and nothing in
 * the roadmap authorises reuse across assets, so detection is all this does.
 */
async function findOwnerDuplicate(
  admin: SupabaseClient,
  ownerId: string,
  checksum: string,
  selfAssetId: string
): Promise<string | null> {
  const { data } = await admin
    .from("media_assets")
    .select("id")
    .eq("clerk_user_id", ownerId)
    .eq("checksum_sha256", checksum)
    .neq("id", selfAssetId)
    .limit(1)
    .maybeSingle();

  return (data as { id?: string } | null)?.id ?? null;
}

async function record(
  admin: SupabaseClient,
  assetId: string,
  fields: {
    ingestStatus: "verified" | "rejected" | "failed";
    verifiedMime?: string;
    checksum?: string;
    failureReason?: string;
    duplicateOf?: string | null;
    moderationStatus?: string;
    moderationEngine?: string | null;
  }
): Promise<void> {
  await admin.rpc("record_media_ingest", {
    p_asset_id: assetId,
    p_ingest_status: fields.ingestStatus,
    p_verified_mime: fields.verifiedMime ?? null,
    p_checksum_sha256: fields.checksum ?? null,
    p_failure_reason: fields.failureReason ?? null,
    p_duplicate_of: fields.duplicateOf ?? null,
    p_moderation_status: fields.moderationStatus ?? null,
    p_moderation_engine: fields.moderationEngine ?? null,
  });
}

/**
 * The completion gate, extended for 9-B.
 *
 * 9-A required a finalized asset. That is no longer enough: a finalized asset
 * is one whose bytes are in R2, which says nothing about what those bytes
 * are. Completion now also requires that the gate read them and allow them.
 */
export async function hasVerifiedOriginal(
  admin: SupabaseClient,
  generationId: string
): Promise<boolean> {
  const { data } = await admin
    .from("media_assets")
    .select("status,ingest_status")
    .eq("generation_id", generationId)
    .eq("role", "original")
    .maybeSingle();

  const row = data as { status?: string; ingest_status?: string } | null;
  return row?.status === "finalized" && row?.ingest_status === "verified";
}
