import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectUntrustedMedia } from "./sandbox/media-inspector";
import { ALLOWED_VERIFIED_MIMES, declarationMatches, type VerifiedMime } from "./mime-detect";
import { getModerationEngine } from "./moderation-contract";
import { evaluateOutputSafety } from "@/lib/safety/output-safety";
import { recordSafetyDecision } from "@/lib/safety/safety-decision-store";
import { reportMandatoryCase } from "@/lib/safety/mandatory-reporting";
import { permitsDelivery } from "@/lib/safety/safety-contract";

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
      /**
       * What the Phase 28 output gate concluded, in the Phase 9-E column's own
       * vocabulary. `not_evaluated` remains the honest value when no engine is
       * configured — it is no longer the ONLY reachable value.
       */
      moderationStatus: string;
      /**
       * Whether the Phase 28 gate cleared these bytes for user delivery.
       *
       * NOT the same as `status: "verified"`. Verified means the bytes are what
       * they claim to be; this means a classifier raised no objection to what
       * they depict. An asset can be perfectly well-formed and still refused.
       */
      safetyCleared: boolean;
    }
  | { status: "rejected"; reason: IngestRejection; checksumSha256?: string }
  | { status: "failed"; reason: IngestFailure };

/**
 * Which moderation engine is installed, if any.
 *
 * DERIVED IN PHASE 28, NOT HARDCODED. In 9-B this was a literal `null` with a
 * comment explaining that no engine existed and none could be invented. That
 * was true then, and the value is still `null` today because the registry in
 * `moderation-contract.ts` is still empty — but it is now READ from the
 * registry rather than asserted, so configuring an engine can no longer leave
 * this constant lying about it.
 *
 * The fail-closed property is unchanged and still enforced by the database:
 * `media_assets_release_requires_checks` demands `passed`, and only a real
 * classifier verdict produces that.
 */
export const MODERATION_ENGINE: string | null = getModerationEngine()?.name ?? null;

export interface IngestParams {
  assetId: string;
  ownerId: string;
  bytes: Uint8Array;
  declaredContentType?: string | null;
  maxBytes?: number;
  timeoutMs?: number;
  /**
   * Phase 28 context for the output safety decision.
   *
   * Optional because a browser upload has no generation behind it. The gate
   * still runs without it — the bytes are what is being judged — and the
   * decision is simply recorded without a generation to attribute it to.
   */
  safetyContext?: {
    generationId?: string | null;
    outputIndex?: number | null;
    /** The provider output's own metadata, carrying any native safety flag. */
    outputMetadata?: unknown;
  };
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

  // ---- PHASE 28 GATE C: the output safety evaluation ----------------------
  //
  // THE REAL CALLER Phase 9-E's moderation contract never had. It runs here,
  // inside the ingest gate, for one structural reason: the verdict is written
  // in the SAME `record_media_ingest` call as the verification facts. That RPC
  // is guarded on `ingest_status IN ('pending','inspecting')`, so it may only
  // fire once — an asset therefore cannot exist in a state where ingest
  // succeeded but moderation was never attempted. Evaluating afterwards would
  // leave exactly that window, and a crash inside it would strand the asset
  // as verified-but-unjudged forever.
  //
  // The evaluation itself never throws; every failure resolves to a
  // non-permissive verdict inside `evaluateOutputSafety`.
  const assessment = await evaluateOutputSafety({
    assetId: params.assetId,
    bytes: params.bytes,
    verifiedMime: detection.mime,
    contentDigestSha256: checksum,
    outputMetadata: params.safetyContext?.outputMetadata,
  });

  // A positive known-hash match creates a reporting obligation. The seam is
  // honest about having no reporter installed: this records that a report is
  // OWED, and cannot record one as filed.
  const reportOutcome = assessment.mandatoryReportRequired
    ? await reportMandatoryCase({
        mediaAssetId: params.assetId,
        category: "csam",
        listId: assessment.hashOutcome.outcome === "POSITIVE_MATCH" ? assessment.hashOutcome.listId : null,
      })
    : null;

  const moderationStatus = assessment.moderationStatus ?? "not_evaluated";

  await record(admin, params.assetId, {
    ingestStatus: "verified",
    verifiedMime: detection.mime,
    checksum,
    duplicateOf: duplicateOfAssetId,
    // Recorded explicitly rather than left at its default, so the row says
    // "we looked and this is what came back" instead of "nobody got round to
    // it". `not_evaluated` still means exactly that, and still cannot release.
    moderationStatus,
    moderationEngine: assessment.decision.classifierVersion ?? MODERATION_ENGINE,
  });

  // Durable evidence, per output. Written AFTER the status so a reader of the
  // decision log never sees a decision for a row that does not yet carry it.
  const recorded = await recordSafetyDecision(admin, {
    clerkUserId: params.ownerId,
    decision: assessment.decision,
    generationId: params.safetyContext?.generationId ?? null,
    mediaAssetId: params.assetId,
    outputIndex: params.safetyContext?.outputIndex ?? null,
    providerSignal: assessment.providerSignal,
    hashOutcome: assessment.hashOutcome,
    reportOutcome,
  });

  return {
    status: "verified",
    verifiedMime: detection.mime,
    checksumSha256: checksum,
    byteLength: inspection.byteLength ?? params.bytes.byteLength,
    duplicateOfAssetId,
    moderationStatus,
    // An unrecorded decision is not a clearance. 28-B's done-criterion is that
    // an incident record EXISTS; if the write failed we cannot prove the
    // evaluation happened, so the asset is not cleared for delivery.
    safetyCleared: recorded && permitsDelivery(assessment.decision),
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
  // EVERY output, not "the" output. A generation may resolve to several
  // outputs, each with its own asset row, and completion means all of them
  // passed the gate. `maybeSingle()` would now throw on a multi-output
  // generation, and taking the first row would let one rejected output ride
  // in on another's verification.
  const { data, error } = await admin
    .from("media_assets")
    .select("status,ingest_status")
    .eq("generation_id", generationId)
    .eq("role", "original");

  if (error) return false;
  const rows = (data ?? []) as { status?: string; ingest_status?: string }[];

  // No rows is not "nothing to refuse" — it means nothing was stored.
  if (rows.length === 0) return false;

  return rows.every((row) => row.status === "finalized" && row.ingest_status === "verified");
}
