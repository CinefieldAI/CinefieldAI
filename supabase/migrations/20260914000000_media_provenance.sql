-- Phase 27-A/27-C: generated-media content provenance evidence.
--
-- GENERATED-MEDIA PROVENANCE, NOT SOFTWARE BUILD PROVENANCE. Phase 24 attests
-- the SBOM of the software; this table attests the media that software
-- produced. They share no table, no signer and no identity — the roadmap's own
-- Phase 27 handoff says "artifact provenance ile karıştırılmaz".
--
-- One row per media asset (UNIQUE on media_asset_id). Written exclusively by
-- src/lib/provenance/provenance-service.ts, which binds every claim to
-- media_assets.checksum_sha256 — the SHA-256 Phase 9-B's sandboxed inspector
-- already computed over the canonical bytes. This table never stores an
-- object key, a bucket, a signed URL, a prompt, a provider payload, a token,
-- or any private key material: `signature` is a detached ES256 signature
-- (public-verifiable output, not a secret) and `signer_key_id` is a bounded
-- identifier, never key material.
--
-- NO clerk_user_id COLUMN, DELIBERATELY. Ownership is reachable by joining
-- media_assets. Duplicating a personal identifier here would put one more
-- copy of it inside Phase 23's deletion blast radius for no gain.
--
-- PRIVACY (Phase 23): ON DELETE CASCADE from media_assets. Phase 23's account
-- deletion TOMBSTONES media_assets rows rather than deleting them, so
-- provenance evidence survives a normal erasure — which is correct, because
-- it contains no personal data and is AI Act Article 50(2) compliance
-- evidence. Should a row ever be hard-deleted, the cascade removes the
-- evidence with it rather than leaving an orphan.

CREATE TABLE IF NOT EXISTS "public"."media_provenance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  "media_asset_id" uuid NOT NULL
    REFERENCES "public"."media_assets"("id") ON DELETE CASCADE,
  "generation_id" uuid
    REFERENCES "public"."generations"("id") ON DELETE SET NULL,
  "attempt_id" uuid
    REFERENCES "public"."generation_attempts"("id") ON DELETE SET NULL,

  -- EMBEDDED_C2PA is a legal value with no producer in this codebase: the
  -- roadmap places the embed step at "FFmpeg sonrası, R2 öncesi" and Phase
  -- 9-C (FFmpeg / derived variants) is unbuilt. It exists here so that step
  -- has a state to write when it is built, not because anything writes it.
  "marking_state" text NOT NULL,
  "digital_source_type" text NOT NULL,
  "claim_generator" text NOT NULL,
  "software_agent" text NOT NULL,

  -- The Phase 9-B digest. Never recomputed by Phase 27.
  "content_digest_sha256" text NOT NULL,
  "verified_mime" text NOT NULL,
  "format_support" text NOT NULL,
  "manifest_version" text NOT NULL,

  -- Detached ES256 signature (base64) and the bounded id of the key that
  -- produced it. NEVER a private key, never a certificate private part.
  "signature" text,
  "signer_key_id" text,

  "disclosure_requirement" text NOT NULL DEFAULT 'NOT_ASSESSED',

  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "media_provenance_asset_unique" UNIQUE ("media_asset_id"),

  CONSTRAINT "media_provenance_marking_state_check" CHECK (
    "marking_state" IN ('NOT_MARKED', 'EVIDENCE_RECORDED', 'SIGNED_DETACHED', 'EMBEDDED_C2PA')
  ),
  CONSTRAINT "media_provenance_digital_source_type_check" CHECK (
    "digital_source_type" IN ('trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia', 'algorithmicMedia')
  ),
  CONSTRAINT "media_provenance_format_support_check" CHECK (
    "format_support" IN ('EMBED_CAPABLE', 'SIDECAR_ONLY')
  ),
  CONSTRAINT "media_provenance_disclosure_check" CHECK (
    "disclosure_requirement" IN ('NONE_REQUIRED', 'VISIBLE_LABEL_REQUIRED', 'NOT_ASSESSED')
  ),
  -- A SHA-256 hex digest, exactly. Refuses an ETag, an object key, or a
  -- provider job id masquerading as a content digest.
  CONSTRAINT "media_provenance_digest_shape" CHECK ("content_digest_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "media_provenance_claim_generator_length" CHECK (char_length("claim_generator") BETWEEN 1 AND 100),
  CONSTRAINT "media_provenance_software_agent_length" CHECK (char_length("software_agent") BETWEEN 1 AND 121),
  CONSTRAINT "media_provenance_manifest_version_length" CHECK (char_length("manifest_version") BETWEEN 1 AND 64),
  CONSTRAINT "media_provenance_verified_mime_length" CHECK (char_length("verified_mime") BETWEEN 1 AND 100),
  CONSTRAINT "media_provenance_signature_length" CHECK ("signature" IS NULL OR char_length("signature") <= 512),
  CONSTRAINT "media_provenance_signer_key_id_shape" CHECK (
    "signer_key_id" IS NULL OR "signer_key_id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  -- A signature without a key id (or the reverse) is unverifiable evidence
  -- wearing the shape of real evidence. Refused at the storage layer.
  CONSTRAINT "media_provenance_signature_pairing" CHECK (
    ("signature" IS NULL AND "signer_key_id" IS NULL)
    OR ("signature" IS NOT NULL AND "signer_key_id" IS NOT NULL)
  ),
  -- SIGNED_DETACHED must actually carry a signature.
  CONSTRAINT "media_provenance_signed_state_requires_signature" CHECK (
    "marking_state" <> 'SIGNED_DETACHED' OR "signature" IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS "media_provenance_generation_id_idx"
  ON "public"."media_provenance" ("generation_id");

CREATE INDEX IF NOT EXISTS "media_provenance_marking_state_idx"
  ON "public"."media_provenance" ("marking_state");

CREATE INDEX IF NOT EXISTS "media_provenance_digest_idx"
  ON "public"."media_provenance" ("content_digest_sha256");

ALTER TABLE "public"."media_provenance" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."media_provenance" FROM "anon", "authenticated";
GRANT SELECT, INSERT ON TABLE "public"."media_provenance" TO "service_role";
