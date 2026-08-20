import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildC2paManifest, canonicalClaim } from "./manifest-builder";
import { currentProvenanceSigner } from "./content-signer";
import {
  CLAIM_GENERATOR,
  MANIFEST_VERSION,
  formatSupport,
  type DigitalSourceType,
  type DisclosureRequirement,
  type ProvenanceEvidence,
  type ProvenanceMarkingState,
} from "./provenance-contract";

/**
 * Provenance recording service (Phase 27-A/27-C).
 *
 * ---------------------------------------------------------------------------
 * ATTACHES TO PHASE 9-B'S SEAM. NEVER READS OR WRITES MEDIA.
 * ---------------------------------------------------------------------------
 * The content digest is `media_assets.checksum_sha256` — the SHA-256 Phase
 * 9-B's sandboxed inspector already computed over the canonical bytes
 * (`ingest-gate.ts`). This service reads it and refuses to proceed without
 * it. It never opens R2, never re-hashes, never touches an object key, and
 * never mutates `media_assets`. Phase 9 remains the storage owner; this
 * package owns exactly one table of bounded metadata.
 *
 * Section 12's warning is honoured literally: an ETag, an object key, or a
 * provider job id is NOT a content digest, and none of them can reach this
 * function — the only digest it will accept is the column Phase 9-B fills
 * from real bytes.
 *
 * ---------------------------------------------------------------------------
 * QUARANTINE IS NOT BYPASSED
 * ---------------------------------------------------------------------------
 * Recording provenance says nothing about whether an asset may be delivered.
 * `quarantine_status` stays exactly where Phase 9-E put it; this service
 * neither reads it as permission nor writes it. A verified provenance record
 * is evidence, never a release authority (section 35).
 */

export type RecordProvenanceOutcome =
  | { readonly outcome: "ASSET_NOT_FOUND" }
  | { readonly outcome: "DIGEST_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "UNSUPPORTED_FORMAT"; readonly reasonCode: string }
  | { readonly outcome: "INVALID_INPUT"; readonly reasonCode: string }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "RECORDED"; readonly evidence: ProvenanceEvidence };

export interface RecordProvenanceParams {
  readonly mediaAssetId: string;
  readonly digitalSourceType: DigitalSourceType;
  /** e.g. "Cinefield (model via provider)". Bounded — see manifest-builder. */
  readonly softwareAgent: string;
  /**
   * Deepfake disclosure requirement. Defaults to `NOT_ASSESSED`, never to
   * `NONE_REQUIRED`: no deepfake classifier exists in this repository
   * (`MODERATION_ENGINE` is null, Phase 9-B; Phase 28 owns T&S
   * classification), so claiming "no label needed" would be a legal-shaped
   * assertion made from no evidence at all.
   */
  readonly disclosureRequirement?: DisclosureRequirement;
  readonly now: Date;
}

interface MediaAssetRow {
  id: string;
  generation_id: string | null;
  attempt_id: string | null;
  checksum_sha256: string | null;
  verified_mime: string | null;
}

export async function recordMediaProvenance(
  admin: SupabaseClient,
  params: RecordProvenanceParams
): Promise<RecordProvenanceOutcome> {
  let asset: MediaAssetRow | null;
  try {
    const { data, error } = await admin
      .from("media_assets")
      .select("id, generation_id, attempt_id, checksum_sha256, verified_mime")
      .eq("id", params.mediaAssetId)
      .maybeSingle();
    if (error) return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "media_assets_read_failed" };
    asset = (data as MediaAssetRow | null) ?? null;
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "media_assets_read_failed" };
  }

  if (!asset) return { outcome: "ASSET_NOT_FOUND" };

  // Fail closed: without Phase 9-B's verified digest there is nothing to bind
  // a claim to, and a provenance record that binds to nothing is worse than
  // none — it looks like evidence.
  if (!asset.checksum_sha256) {
    return { outcome: "DIGEST_UNAVAILABLE", reasonCode: "asset_not_verified_by_ingest_gate" };
  }
  if (!asset.verified_mime) {
    return { outcome: "DIGEST_UNAVAILABLE", reasonCode: "asset_mime_not_verified" };
  }

  const support = formatSupport(asset.verified_mime);
  if (support === null) {
    return { outcome: "UNSUPPORTED_FORMAT", reasonCode: "format_not_recognised" };
  }

  const built = buildC2paManifest({
    digitalSourceType: params.digitalSourceType,
    softwareAgent: params.softwareAgent,
  });
  if (!built.ok) return { outcome: "INVALID_INPUT", reasonCode: built.reasonCode };

  const claim = canonicalClaim({
    manifestVersion: MANIFEST_VERSION,
    mediaAssetId: asset.id,
    contentDigestSha256: asset.checksum_sha256,
    verifiedMime: asset.verified_mime,
    digitalSourceType: params.digitalSourceType,
    softwareAgent: params.softwareAgent,
    claimGenerator: CLAIM_GENERATOR,
  });

  const signed = currentProvenanceSigner().sign(claim);
  // An unconfigured or failing signer yields UNSIGNED evidence, recorded
  // honestly — never a skipped record and never a fabricated signature.
  const markingState: ProvenanceMarkingState = signed.ok ? "SIGNED_DETACHED" : "EVIDENCE_RECORDED";

  const evidence: ProvenanceEvidence = {
    mediaAssetId: asset.id,
    generationId: asset.generation_id,
    attemptId: asset.attempt_id,
    markingState,
    digitalSourceType: params.digitalSourceType,
    claimGenerator: CLAIM_GENERATOR,
    softwareAgent: params.softwareAgent,
    contentDigestSha256: asset.checksum_sha256,
    verifiedMime: asset.verified_mime,
    formatSupport: support,
    manifestVersion: MANIFEST_VERSION,
    signature: signed.ok ? signed.result.signature : null,
    signerKeyId: signed.ok ? signed.result.keyId : null,
    disclosureRequirement: params.disclosureRequirement ?? "NOT_ASSESSED",
    createdAt: params.now.toISOString(),
  };

  try {
    const { error } = await admin.from("media_provenance").insert({
      media_asset_id: evidence.mediaAssetId,
      generation_id: evidence.generationId,
      attempt_id: evidence.attemptId,
      marking_state: evidence.markingState,
      digital_source_type: evidence.digitalSourceType,
      claim_generator: evidence.claimGenerator,
      software_agent: evidence.softwareAgent,
      content_digest_sha256: evidence.contentDigestSha256,
      verified_mime: evidence.verifiedMime,
      format_support: evidence.formatSupport,
      manifest_version: evidence.manifestVersion,
      signature: evidence.signature,
      signer_key_id: evidence.signerKeyId,
      disclosure_requirement: evidence.disclosureRequirement,
      created_at: evidence.createdAt,
    });
    if (error) return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "media_provenance_write_failed" };
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "media_provenance_write_failed" };
  }

  return { outcome: "RECORDED", evidence };
}

/** Reads the evidence row for one asset, or `null`. Never throws. */
export async function provenanceFor(
  admin: SupabaseClient,
  mediaAssetId: string
): Promise<ProvenanceEvidence | null> {
  try {
    const { data, error } = await admin
      .from("media_provenance")
      .select(
        "media_asset_id, generation_id, attempt_id, marking_state, digital_source_type, claim_generator, software_agent, content_digest_sha256, verified_mime, format_support, manifest_version, signature, signer_key_id, disclosure_requirement, created_at"
      )
      .eq("media_asset_id", mediaAssetId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      mediaAssetId: row.media_asset_id as string,
      generationId: (row.generation_id as string | null) ?? null,
      attemptId: (row.attempt_id as string | null) ?? null,
      markingState: row.marking_state as ProvenanceEvidence["markingState"],
      digitalSourceType: row.digital_source_type as DigitalSourceType,
      claimGenerator: row.claim_generator as string,
      softwareAgent: row.software_agent as string,
      contentDigestSha256: row.content_digest_sha256 as string,
      verifiedMime: row.verified_mime as string,
      formatSupport: row.format_support as ProvenanceEvidence["formatSupport"],
      manifestVersion: row.manifest_version as string,
      signature: (row.signature as string | null) ?? null,
      signerKeyId: (row.signer_key_id as string | null) ?? null,
      disclosureRequirement: row.disclosure_requirement as DisclosureRequirement,
      createdAt: row.created_at as string,
    };
  } catch {
    return null;
  }
}
