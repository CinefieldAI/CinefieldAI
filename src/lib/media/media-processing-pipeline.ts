import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { transformToFinalMedia } from "./media-transform";
import { embedC2paProvenance, readEmbeddedProvenance } from "@/lib/provenance/c2pa-embedder";
import { recordMediaProvenance } from "@/lib/provenance/provenance-service";
import type { DigitalSourceType } from "@/lib/provenance/provenance-contract";
import type { ProvenanceEvidence } from "@/lib/provenance/provenance-contract";

/**
 * Phase 9-C media processing pipeline — the roadmap's own ordering, executed.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER IS THE CORRECTNESS PROPERTY
 * ---------------------------------------------------------------------------
 *   validated bytes
 *     -> transform                (media-transform.ts, fixed profiles)
 *     -> FINAL BYTES              nothing re-encodes after this point
 *     -> SHA-256 over FINAL bytes the C2PA subject digest
 *     -> embed C2PA               (c2pa-embedder.ts, official library)
 *     -> official verify          embedded manifest read back as valid
 *     -> persist derived asset    Phase 9's own storage seam
 *     -> record provenance        Phase 27's own evidence store
 *
 * Signing before re-encoding would be the classic mistake: the roadmap warns
 * that a re-encode strips the manifest, and this pipeline is empirically
 * confirmed to strip it. So the manifest is applied to bytes that will never
 * be touched again, and the digest it binds to is computed from those same
 * final bytes — never from the pre-transform source.
 *
 * ---------------------------------------------------------------------------
 * TWO DIGESTS, NAMED APART, NEVER CONFLATED
 * ---------------------------------------------------------------------------
 *   SOURCE digest       Phase 9-B's `checksum_sha256` on the ORIGINAL asset,
 *                       over the bytes as downloaded. Unchanged, still owned
 *                       by the ingest gate.
 *   FINAL MEDIA digest  computed here, over post-transform bytes, and stored
 *                       as the DERIVED asset's own `checksum_sha256`.
 *
 * The provenance row binds to the derived asset, so its
 * `content_digest_sha256` is always the final-media digest. Reusing the source
 * digest after a transform would produce evidence that verifies against bytes
 * nobody was ever served — the silent-stale-digest failure this separation
 * exists to prevent.
 *
 * The derived asset uses Phase 9's OWN lineage design: `role = 'derived'` with
 * `parent_asset_id` pointing at the original. `media_assets.sql` says of that
 * column, verbatim, "9-C fills this in" — this is 9-C filling it in. No second
 * media table, no second storage owner, no new migration.
 */

export type MediaProcessingOutcome =
  | { readonly outcome: "SOURCE_ASSET_NOT_FOUND" }
  | { readonly outcome: "UNSUPPORTED_FORMAT"; readonly reasonCode: string }
  | { readonly outcome: "TRANSFORM_FAILED"; readonly reasonCode: string }
  | { readonly outcome: "SIGNER_NOT_CONFIGURED" }
  | { readonly outcome: "C2PA_EMBED_FAILED"; readonly reasonCode: string }
  | { readonly outcome: "C2PA_VERIFY_FAILED"; readonly validationCodes: readonly string[] }
  | { readonly outcome: "STORAGE_FAILED"; readonly reasonCode: string }
  | { readonly outcome: "PROVENANCE_FAILED"; readonly reasonCode: string }
  | {
      readonly outcome: "COMPLETED";
      readonly derivedAssetId: string;
      readonly finalMime: string;
      /**
       * The exact stored bytes. Returned so the user-delivery lane can serve
       * THESE bytes rather than re-signing — a second sign produces a
       * different manifest instance and therefore a different digest, which
       * would break the "delivered bytes == canonical bytes" invariant.
       */
      readonly finalBytes: Uint8Array;
      readonly finalDigestSha256: string;
      readonly finalByteLength: number;
      readonly signerIssuer: string;
      readonly evidence: ProvenanceEvidence;
    };

/**
 * How the pipeline persists final bytes. Injected so the pipeline can be
 * proven end to end without a live R2 — and so Phase 9 keeps owning storage:
 * the real implementation is `putAssetObject`, which this module never calls
 * directly.
 */
export interface FinalMediaStore {
  put(params: {
    objectKey: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ ok: boolean; reasonCode?: string }>;
}

/**
 * Where the final signed artifact is persisted.
 *
 *   `derived`   a NEW media_assets row pointing at `sourceAssetId` via
 *               parent_asset_id. Used by the standalone media worker, where
 *               the source object already exists in R2 on its own.
 *   `in_place`  the ALREADY-RESERVED row is finalised with the signed bytes.
 *               Used by the canonical generation path, where the raw provider
 *               output is never stored at all — so there is exactly one R2
 *               object, one media_assets row, and no unmarked artifact
 *               anywhere for anyone to serve.
 *
 * One engine, two persistence targets — not two media-processing paths.
 */
export type FinalMediaTarget =
  | { readonly kind: "derived"; readonly derivedAssetId: string }
  | { readonly kind: "in_place" };

export interface ProcessFinalMediaParams {
  readonly sourceAssetId: string;
  readonly bytes: Uint8Array;
  readonly verifiedMime: string;
  readonly digitalSourceType: DigitalSourceType;
  readonly softwareAgent: string;
  readonly store: FinalMediaStore;
  readonly now: Date;
  readonly target: FinalMediaTarget;
  /**
   * PHASE 28 → PHASE 27. What the safety classification implies for the
   * Article 50(4) disclosure field, forwarded to `recordMediaProvenance`.
   *
   * FORWARDED, NOT DECIDED. This pipeline classifies nothing; it carries a
   * value the Phase 28 gate already produced, and Phase 27's recorder remains
   * the only writer of `media_provenance`. Omitted, the recorder's own
   * `NOT_ASSESSED` default applies — unchanged from before Phase 28.
   *
   * Note what this CANNOT carry: `NONE_REQUIRED`. A content-safety verdict is
   * not evidence that a visible label is unnecessary, so the permissive value
   * is absent from the type rather than merely unused.
   */
  readonly disclosureRequirement?: "VISIBLE_LABEL_REQUIRED" | "NOT_ASSESSED";
}

interface SourceAssetRow {
  id: string;
  clerk_user_id: string | null;
  generation_id: string | null;
  attempt_id: string | null;
  bucket: string | null;
  object_key: string | null;
  quarantine_status: string | null;
}

/** Derives the final object key from the SOURCE key — never from user input. */
function derivedObjectKey(sourceKey: string, derivedAssetId: string, extension: string): string {
  const base = sourceKey.replace(/\/[^/]*$/, "");
  return `${base}/derived/${derivedAssetId}/final.${extension}`;
}

const EXTENSION_FOR_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "video/mp4": "mp4",
  "audio/wav": "wav",
};

export async function processFinalMedia(
  admin: SupabaseClient,
  params: ProcessFinalMediaParams
): Promise<MediaProcessingOutcome> {
  // ---- 1. The source asset must exist ------------------------------------
  let source: SourceAssetRow | null;
  try {
    const { data, error } = await admin
      .from("media_assets")
      .select("id, clerk_user_id, generation_id, attempt_id, bucket, object_key, quarantine_status")
      .eq("id", params.sourceAssetId)
      .maybeSingle();
    if (error) return { outcome: "STORAGE_FAILED", reasonCode: "media_assets_read_failed" };
    source = (data as SourceAssetRow | null) ?? null;
  } catch {
    return { outcome: "STORAGE_FAILED", reasonCode: "media_assets_read_failed" };
  }
  if (!source) return { outcome: "SOURCE_ASSET_NOT_FOUND" };

  // ---- 2. Transform to FINAL bytes ---------------------------------------
  const transformed = await transformToFinalMedia({ bytes: params.bytes, verifiedMime: params.verifiedMime });
  if (!transformed.ok) {
    if (transformed.reasonCode === "unsupported_format") {
      return { outcome: "UNSUPPORTED_FORMAT", reasonCode: transformed.reasonCode };
    }
    return { outcome: "TRANSFORM_FAILED", reasonCode: transformed.reasonCode };
  }

  // ---- 3. Embed C2PA into the FINAL bytes, then verify officially --------
  const embedded = await embedC2paProvenance({
    bytes: transformed.bytes,
    mime: transformed.outputMime,
    digitalSourceType: params.digitalSourceType,
    softwareAgent: params.softwareAgent,
  });

  if (!embedded.ok) {
    if (embedded.reasonCode === "signer_not_configured") return { outcome: "SIGNER_NOT_CONFIGURED" };
    if (embedded.reasonCode === "unsupported_format") {
      return { outcome: "UNSUPPORTED_FORMAT", reasonCode: embedded.reasonCode };
    }
    if (embedded.reasonCode === "verify_failed") {
      return { outcome: "C2PA_VERIFY_FAILED", validationCodes: embedded.validationCodes ?? [] };
    }
    return { outcome: "C2PA_EMBED_FAILED", reasonCode: embedded.reasonCode };
  }

  // ---- 4. FINAL MEDIA DIGEST — over the signed bytes actually delivered ---
  // Computed AFTER embedding, because embedding changes the bytes. This is
  // the digest a downstream verifier recomputes over what it received.
  const finalBytes = embedded.bytes;
  const finalDigest = createHash("sha256").update(finalBytes).digest("hex");

  // ---- 5. Persist — exactly ONE R2 write, exactly ONE media_assets row ---
  const extension = EXTENSION_FOR_MIME[transformed.outputMime] ?? "bin";
  const inPlace = params.target.kind === "in_place";
  const finalAssetId = inPlace ? source.id : params.target.derivedAssetId;

  // in_place reuses the key already reserved for this asset, so the signed
  // artifact IS the canonical object. Nothing unmarked was ever written to it.
  const objectKey = inPlace
    ? (source.object_key ?? `asset/${finalAssetId}/final.${extension}`)
    : source.object_key
      ? derivedObjectKey(source.object_key, finalAssetId, extension)
      : `derived/${finalAssetId}/final.${extension}`;

  const stored = await params.store.put({
    objectKey,
    bytes: finalBytes,
    contentType: transformed.outputMime,
  });
  if (!stored.ok) return { outcome: "STORAGE_FAILED", reasonCode: stored.reasonCode ?? "store_failed" };

  try {
    if (inPlace) {
      // Finalise the reserved row onto the SIGNED bytes. `checksum_sha256`
      // becomes the FINAL MEDIA digest, replacing whatever the ingest gate
      // recorded for the raw provider bytes — those bytes were never stored,
      // so a digest describing them would describe an object nobody holds.
      const { error } = await admin
        .from("media_assets")
        .update({
          object_key: objectKey,
          verified_mime: transformed.outputMime,
          checksum_sha256: finalDigest,
          byte_size: finalBytes.byteLength,
          status: "finalized",
          stored_at: params.now.toISOString(),
          finalized_at: params.now.toISOString(),
        })
        .eq("id", finalAssetId);
      if (error) return { outcome: "STORAGE_FAILED", reasonCode: "canonical_asset_update_failed" };
    } else {
      const { error } = await admin.from("media_assets").insert({
        id: finalAssetId,
        clerk_user_id: source.clerk_user_id,
        generation_id: source.generation_id,
        attempt_id: source.attempt_id,
        source: "internal",
        role: "derived",
        parent_asset_id: source.id,
        variant: "final",
        media_type: transformed.outputMime.split("/")[0],
        storage_backend: "r2",
        bucket: source.bucket,
        object_key: objectKey,
        verified_mime: transformed.outputMime,
        checksum_sha256: finalDigest,
        byte_size: finalBytes.byteLength,
        // Quarantine posture is INHERITED from the parent, never relaxed.
        // Phase 9-E remains the only authority that may release anything.
        quarantine_status: source.quarantine_status ?? "quarantined",
        status: "finalized",
        stored_at: params.now.toISOString(),
        finalized_at: params.now.toISOString(),
      });
      if (error) return { outcome: "STORAGE_FAILED", reasonCode: "derived_asset_insert_failed" };
    }
  } catch {
    return { outcome: "STORAGE_FAILED", reasonCode: "asset_persist_failed" };
  }

  // ---- 6. Record provenance — the REAL production caller -----------------
  const recorded = await recordMediaProvenance(admin, {
    mediaAssetId: finalAssetId,
    digitalSourceType: params.digitalSourceType,
    softwareAgent: params.softwareAgent,
    embedded: { officiallyVerified: true, signerIssuer: embedded.signerIssuer },
    // Phase 28's classification, when there was one. Absent, the recorder's
    // own NOT_ASSESSED default applies — the pre-Phase-28 behaviour, unchanged.
    ...(params.disclosureRequirement ? { disclosureRequirement: params.disclosureRequirement } : {}),
    now: params.now,
  });

  if (recorded.outcome !== "RECORDED") {
    return { outcome: "PROVENANCE_FAILED", reasonCode: recorded.outcome };
  }

  return {
    outcome: "COMPLETED",
    derivedAssetId: finalAssetId,
    finalMime: transformed.outputMime,
    finalBytes,
    finalDigestSha256: finalDigest,
    finalByteLength: finalBytes.byteLength,
    signerIssuer: embedded.signerIssuer,
    evidence: recorded.evidence,
  };
}

export { readEmbeddedProvenance };


/**
 * Signs one output for DELIVERY only — no asset row, no provenance row.
 *
 * A generation may resolve more than one output. Phase 9 records exactly one
 * canonical `media_assets` row (the primary), but AI Act Article 50(2) applies
 * to every delivered artifact, not just the one the database tracks. So every
 * secondary output is transformed and C2PA-embedded through the same engine
 * before it can be served; it simply has no row of its own to attach evidence
 * to, which is Phase 9's model to change, not this function's.
 *
 * Fails closed exactly like the canonical path: an unmarkable secondary output
 * returns an error and the caller refuses the generation.
 */
export type SignForDeliveryOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly mime: string }
  | { readonly ok: false; readonly outcome: string; readonly reasonCode: string };

export async function signMediaForDelivery(params: {
  readonly bytes: Uint8Array;
  readonly verifiedMime: string;
  readonly digitalSourceType: DigitalSourceType;
  readonly softwareAgent: string;
}): Promise<SignForDeliveryOutcome> {
  const transformed = await transformToFinalMedia({
    bytes: params.bytes,
    verifiedMime: params.verifiedMime,
  });
  if (!transformed.ok) {
    return {
      ok: false,
      outcome: transformed.reasonCode === "unsupported_format" ? "UNSUPPORTED_FORMAT" : "TRANSFORM_FAILED",
      reasonCode: transformed.reasonCode,
    };
  }

  const embedded = await embedC2paProvenance({
    bytes: transformed.bytes,
    mime: transformed.outputMime,
    digitalSourceType: params.digitalSourceType,
    softwareAgent: params.softwareAgent,
  });
  if (!embedded.ok) {
    return {
      ok: false,
      outcome: embedded.reasonCode === "signer_not_configured" ? "SIGNER_NOT_CONFIGURED" : "C2PA_EMBED_FAILED",
      reasonCode: embedded.reasonCode,
    };
  }

  return { ok: true, bytes: embedded.bytes, mime: transformed.outputMime };
}
