-- ===========================================================================
-- PHASE 9-B — the single ingest gate, recorded
-- ===========================================================================
-- 9-A gave every stored object a row and left the verification columns empty
-- on purpose. This migration adds the state machine that fills them, and the
-- constraints that stop anything skipping it.
--
-- THE RULE THIS ENCODES: bytes are not media until something has read them.
-- `verified_mime` and `checksum_sha256` may only be written by the ingest
-- function, `duplicate_of_asset_id` may only point inside one owner, and no
-- asset reaches `released` while moderation says `not_evaluated`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Ingest state
-- ---------------------------------------------------------------------------
-- Separate from `status` (which is about the OBJECT: pending → stored →
-- finalized) because they answer different questions. An asset can be
-- finalized in R2 and still be `rejected` by ingest; conflating them would
-- make "stored" and "safe" the same word.
ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "ingest_status" "text" DEFAULT 'pending'::"text" NOT NULL;

ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "ingest_failure_reason" "text";

ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "ingested_at" timestamp with time zone;

-- Recorded, never acted on in 9-B. The roadmap does not authorise reusing one
-- asset's bytes for another request, so this is EVIDENCE of a duplicate and
-- nothing more. Scoped to one owner by the trigger below.
ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "duplicate_of_asset_id" "uuid"
    REFERENCES "public"."media_assets"("id") ON DELETE SET NULL;

ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "moderation_engine" "text";

ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "moderated_at" timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'media_assets_ingest_status_check') THEN
    ALTER TABLE "public"."media_assets"
      ADD CONSTRAINT "media_assets_ingest_status_check" CHECK (("ingest_status" = ANY (ARRAY[
        'pending'::"text",      -- nothing has looked at the bytes
        'inspecting'::"text",   -- claimed by a worker
        'verified'::"text",     -- bytes identified, hashed, format allowed
        'rejected'::"text",     -- refused; the reason says why
        'failed'::"text"        -- inspection itself could not complete
      ])));
  END IF;

  -- Moderation gains the states the roadmap's contract needs. `passed` is
  -- reachable only from a real evaluation; `not_evaluated` is the default and
  -- means exactly that.
  ALTER TABLE "public"."media_assets" DROP CONSTRAINT IF EXISTS "media_assets_moderation_check";
  ALTER TABLE "public"."media_assets"
    ADD CONSTRAINT "media_assets_moderation_check" CHECK (("moderation_status" = ANY (ARRAY[
      'not_evaluated'::"text",
      'pending'::"text",
      'passed'::"text",
      'approved'::"text",       -- retained: 9-A rows may already carry it
      'rejected'::"text",
      'manual_review'::"text",
      'error'::"text"
    ])));

  -- THE FAIL-CLOSED CONSTRAINT. Nothing may leave quarantine while ingest has
  -- not verified it or moderation has not evaluated it. This is enforced in
  -- the database precisely so a future code path cannot "release" an asset by
  -- forgetting a check.
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'media_assets_release_requires_checks') THEN
    ALTER TABLE "public"."media_assets"
      ADD CONSTRAINT "media_assets_release_requires_checks" CHECK (
        ("quarantine_status" <> 'released'::"text")
        OR (("ingest_status" = 'verified'::"text")
            AND ("verified_mime" IS NOT NULL)
            AND ("checksum_sha256" IS NOT NULL)
            AND ("moderation_status" IN ('passed'::"text", 'approved'::"text")))
      );
  END IF;

  -- A verified asset knows what it is and what it hashes to. Without this a
  -- row could claim verification while carrying nothing.
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'media_assets_verified_consistency') THEN
    ALTER TABLE "public"."media_assets"
      ADD CONSTRAINT "media_assets_verified_consistency" CHECK (
        ("ingest_status" <> 'verified'::"text")
        OR (("verified_mime" IS NOT NULL) AND ("checksum_sha256" IS NOT NULL))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'media_assets_checksum_shape') THEN
    ALTER TABLE "public"."media_assets"
      ADD CONSTRAINT "media_assets_checksum_shape" CHECK (
        ("checksum_sha256" IS NULL) OR ("checksum_sha256" ~ '^[0-9a-f]{64}$')
      );
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- Duplicate lookup — TENANT SCOPED, and that is the whole point
-- ---------------------------------------------------------------------------
-- The index leads with clerk_user_id so a checksum query is only ever
-- answerable within one owner. A global index on the hash alone would let
-- anyone who can influence a query learn that some other tenant holds
-- identical bytes, which is a disclosure even without returning the row.
CREATE INDEX IF NOT EXISTS "media_assets_owner_checksum_idx"
  ON "public"."media_assets" ("clerk_user_id", "checksum_sha256")
  WHERE ("checksum_sha256" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "media_assets_ingest_pending_idx"
  ON "public"."media_assets" ("created_at")
  WHERE ("ingest_status" = ANY (ARRAY['pending'::"text", 'inspecting'::"text"]));


-- ---------------------------------------------------------------------------
-- A duplicate link may never cross an owner boundary
-- ---------------------------------------------------------------------------
-- Enforced by trigger rather than by convention: a cross-tenant link would be
-- a permanent, queryable statement that two tenants hold the same bytes.
CREATE OR REPLACE FUNCTION "public"."media_assets_duplicate_same_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_owner text;
BEGIN
  IF NEW.duplicate_of_asset_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.duplicate_of_asset_id = NEW.id THEN
    RAISE EXCEPTION 'duplicate_self_reference' USING ERRCODE = '23514';
  END IF;

  SELECT clerk_user_id INTO v_owner FROM media_assets WHERE id = NEW.duplicate_of_asset_id;
  IF NOT FOUND OR v_owner IS DISTINCT FROM NEW.clerk_user_id THEN
    RAISE EXCEPTION 'duplicate_cross_tenant' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."media_assets_duplicate_same_owner"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "media_assets_duplicate_same_owner_trg" ON "public"."media_assets";
CREATE TRIGGER "media_assets_duplicate_same_owner_trg"
  BEFORE INSERT OR UPDATE OF "duplicate_of_asset_id" ON "public"."media_assets"
  FOR EACH ROW EXECUTE FUNCTION "public"."media_assets_duplicate_same_owner"();


-- ---------------------------------------------------------------------------
-- record_media_ingest() — the ONLY way verification facts enter the database
-- ---------------------------------------------------------------------------
-- Guarded on pending/inspecting so a replay is inert, and it refuses to change
-- a checksum that is already recorded: the same bytes always hash the same, so
-- a different value means something is wrong and overwriting it would erase
-- the evidence.
CREATE OR REPLACE FUNCTION "public"."record_media_ingest"(
    "p_asset_id" "uuid",
    "p_ingest_status" "text",
    "p_verified_mime" "text" DEFAULT NULL,
    "p_checksum_sha256" "text" DEFAULT NULL,
    "p_failure_reason" "text" DEFAULT NULL,
    "p_duplicate_of" "uuid" DEFAULT NULL,
    "p_moderation_status" "text" DEFAULT NULL,
    "p_moderation_engine" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row media_assets%ROWTYPE;
  v_current text;
BEGIN
  IF p_ingest_status NOT IN ('verified', 'rejected', 'failed') THEN
    RAISE EXCEPTION 'invalid_ingest_status' USING ERRCODE = '22023';
  END IF;

  IF p_ingest_status = 'verified'
     AND (p_verified_mime IS NULL OR p_checksum_sha256 IS NULL) THEN
    RAISE EXCEPTION 'verified_requires_mime_and_checksum' USING ERRCODE = '22023';
  END IF;

  -- Short codes only. This value is retained and read by operators; it must
  -- never carry a filename, a stack, or any byte of the media itself.
  IF p_failure_reason IS NOT NULL AND p_failure_reason !~ '^[a-z][a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_failure_reason' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM media_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'not_found');
  END IF;

  IF v_row.ingest_status NOT IN ('pending', 'inspecting') THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'already_ingested',
                              'ingest_status', v_row.ingest_status);
  END IF;

  IF v_row.checksum_sha256 IS NOT NULL
     AND p_checksum_sha256 IS NOT NULL
     AND v_row.checksum_sha256 <> p_checksum_sha256 THEN
    RAISE EXCEPTION 'checksum_conflict' USING ERRCODE = '23514';
  END IF;

  UPDATE media_assets
     SET ingest_status = p_ingest_status,
         verified_mime = COALESCE(p_verified_mime, verified_mime),
         checksum_sha256 = COALESCE(p_checksum_sha256, checksum_sha256),
         ingest_failure_reason = p_failure_reason,
         duplicate_of_asset_id = COALESCE(p_duplicate_of, duplicate_of_asset_id),
         moderation_status = COALESCE(p_moderation_status, moderation_status),
         moderation_engine = COALESCE(p_moderation_engine, moderation_engine),
         moderated_at = CASE WHEN p_moderation_status IS NULL THEN moderated_at ELSE now() END,
         ingested_at = now()
   WHERE id = p_asset_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'recorded', true,
    'asset_id', v_row.id,
    'ingest_status', v_row.ingest_status,
    'moderation_status', v_row.moderation_status,
    'quarantine_status', v_row.quarantine_status
  );
END;
$$;

ALTER FUNCTION "public"."record_media_ingest"("uuid", "text", "text", "text", "text", "uuid", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."record_media_ingest"("uuid", "text", "text", "text", "text", "uuid", "text", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."record_media_ingest"("uuid", "text", "text", "text", "text", "uuid", "text", "text") TO "service_role";


-- ---------------------------------------------------------------------------
-- Column-level write authority
-- ---------------------------------------------------------------------------
-- `authenticated` already had SELECT only and no write policy, so a browser
-- cannot set any of these. Restated as an explicit REVOKE so the intent
-- survives a future grant made without reading this file.
REVOKE UPDATE ON TABLE "public"."media_assets" FROM "authenticated";
REVOKE INSERT ON TABLE "public"."media_assets" FROM "authenticated";


COMMENT ON COLUMN "public"."media_assets"."ingest_status" IS
  'Phase 9-B. Whether anything has READ these bytes: pending → inspecting → verified/rejected/failed. Distinct from status, which describes the OBJECT. Only record_media_ingest() may advance it.';
COMMENT ON COLUMN "public"."media_assets"."duplicate_of_asset_id" IS
  'Phase 9-B. EVIDENCE of identical bytes within the SAME owner, enforced by trigger. Nothing reuses the referenced object — the roadmap does not authorise cross-asset reuse, and a cross-tenant link would disclose one tenant''s media to another.';
