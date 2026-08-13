-- ===========================================================================
-- PHASE 9-A — media_assets: the durable record behind every stored object
-- ===========================================================================
-- Until now a generation's output existed as a single `output_url` string on
-- the generations row. That could not answer: who owns these bytes, which
-- attempt produced them, how large are they, are they the original or a
-- derivative, have they been verified, are they safe to serve. Phase 9-A
-- needs all of those and 9-B/9-C/9-D need somewhere to put their answers.
--
-- WHAT THIS TABLE IS THE TRUTH FOR
-- Where an object lives (backend + bucket + key) and what we know about it.
-- The BYTES live in R2 — this row is a pointer with provenance, never a copy.
--
-- WHAT IT DELIBERATELY DOES NOT ASSERT
-- Verification. `verified_mime`, `checksum_sha256`, `moderation_status` and
-- `quarantine_status` exist as HOOKS, defaulted to "not done yet" rather than
-- to a passing value. A column that defaults to `clean` before any moderation
-- ran is worse than no column: it is a lie the schema tells on every row.
-- Filling them in is Phase 9-B.
--
-- Retention (`data_class`, `retention_policy`, `legal_hold`, tombstones) is
-- likewise hooks only. The roadmap is explicit: "Politika sahibi Phase 23;
-- uygulama noktası bu Phase'dir." Columns here, engine there.
-- ===========================================================================


CREATE TABLE IF NOT EXISTS "public"."media_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,

    -- Tenant boundary. Every key this row points at starts with this value,
    -- so ownership is enforced in the storage layout as well as in RLS.
    "clerk_user_id" "text" NOT NULL,
    "project_id" "uuid" REFERENCES "public"."projects"("id") ON DELETE SET NULL,

    -- Provenance. Nullable because a browser upload has neither, and an
    -- internal asset has neither; ON DELETE SET NULL because deleting a
    -- generation must not erase the record of bytes that were really stored.
    "generation_id" "uuid" REFERENCES "public"."generations"("id") ON DELETE SET NULL,
    "generation_attempt_id" "uuid"
      REFERENCES "public"."generation_attempts"("id") ON DELETE SET NULL,

    "source" "text" NOT NULL,
    "role" "text" DEFAULT 'original'::"text" NOT NULL,
    -- A derived variant points at the original it came from. Self-referencing
    -- so one asset id addresses a family; 9-C fills this in.
    "parent_asset_id" "uuid" REFERENCES "public"."media_assets"("id") ON DELETE CASCADE,
    "variant" "text",

    "media_type" "text" NOT NULL,

    -- ---- Storage location -------------------------------------------------
    -- `r2` today. `supabase` exists only so the legacy path can be recorded
    -- during migration; `s3` is reserved for the 9-D DR copy and is NOT a
    -- delivery backend.
    "storage_backend" "text" DEFAULT 'r2'::"text" NOT NULL,
    "bucket" "text" NOT NULL,
    "object_key" "text" NOT NULL,

    -- ---- What the provider or the browser CLAIMED -------------------------
    -- Untrusted. Named `declared_` so no reader mistakes it for a fact.
    "declared_content_type" "text",
    "byte_size" bigint,
    "original_filename" "text",

    -- ---- Phase 9-B hooks: unknown until something verifies them -----------
    "verified_mime" "text",
    "checksum_sha256" "text",
    "moderation_status" "text" DEFAULT 'not_evaluated'::"text" NOT NULL,
    "quarantine_status" "text" DEFAULT 'quarantined'::"text" NOT NULL,

    -- ---- Phase 9-D hook ---------------------------------------------------
    "backup_status" "text" DEFAULT 'not_backed_up'::"text" NOT NULL,

    -- ---- Phase 23 hooks: columns now, policy engine later -----------------
    "data_class" "text",
    "retention_policy" "text",
    "legal_hold" boolean DEFAULT false NOT NULL,
    "tombstoned_at" timestamp with time zone,

    -- ---- Lifecycle --------------------------------------------------------
    -- `pending` = a key was reserved, nothing is known to be there.
    -- `stored`  = bytes are in the backend.
    -- `finalized` = stored AND recorded; the only state a generation may
    --               complete on.
    -- `failed`  = the attempt to store it did not succeed.
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stored_at" timestamp with time zone,
    "finalized_at" timestamp with time zone,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "media_assets_source_check" CHECK (("source" = ANY (ARRAY[
      'provider_output'::"text", 'browser_upload'::"text", 'internal'::"text"
    ]))),
    CONSTRAINT "media_assets_role_check" CHECK (("role" = ANY (ARRAY[
      'original'::"text", 'derived'::"text"
    ]))),
    CONSTRAINT "media_assets_media_type_check" CHECK (("media_type" = ANY (ARRAY[
      'image'::"text", 'video'::"text", 'audio'::"text", 'other'::"text"
    ]))),
    CONSTRAINT "media_assets_backend_check" CHECK (("storage_backend" = ANY (ARRAY[
      'r2'::"text", 'supabase'::"text", 's3'::"text"
    ]))),
    CONSTRAINT "media_assets_status_check" CHECK (("status" = ANY (ARRAY[
      'pending'::"text", 'stored'::"text", 'finalized'::"text", 'failed'::"text"
    ]))),
    CONSTRAINT "media_assets_moderation_check" CHECK (("moderation_status" = ANY (ARRAY[
      'not_evaluated'::"text", 'pending'::"text", 'approved'::"text", 'rejected'::"text"
    ]))),
    -- Default is `quarantined`, and `released` is reachable only by whatever
    -- 9-E builds. Nothing in 9-A may set it.
    CONSTRAINT "media_assets_quarantine_check" CHECK (("quarantine_status" = ANY (ARRAY[
      'quarantined'::"text", 'released'::"text"
    ]))),
    CONSTRAINT "media_assets_backup_check" CHECK (("backup_status" = ANY (ARRAY[
      'not_backed_up'::"text", 'pending'::"text", 'backed_up'::"text"
    ]))),
    CONSTRAINT "media_assets_byte_size_check" CHECK (("byte_size" IS NULL) OR ("byte_size" >= 0)),
    CONSTRAINT "media_assets_object_key_check" CHECK (
      ("char_length"("object_key") > 0) AND ("char_length"("object_key") <= 1024)
    ),
    -- A finalized asset must know where its bytes are and how big they are.
    -- This is the constraint that stops a generation completing on a row that
    -- only claims success.
    CONSTRAINT "media_assets_finalized_consistency_check" CHECK (
      ("status" <> 'finalized'::"text")
      OR (("finalized_at" IS NOT NULL) AND ("stored_at" IS NOT NULL) AND ("byte_size" IS NOT NULL))
    ),
    -- A derived asset has a parent; an original does not.
    CONSTRAINT "media_assets_parent_consistency_check" CHECK (
      (("role" = 'derived'::"text") AND ("parent_asset_id" IS NOT NULL))
      OR (("role" = 'original'::"text") AND ("parent_asset_id" IS NULL))
    )
);

ALTER TABLE "public"."media_assets" OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- One object key per bucket, ever. Two rows pointing at the same bytes is how
-- a replay produces a duplicate asset that nothing can tell apart.
CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_bucket_key_uniq"
  ON "public"."media_assets" ("bucket", "object_key");

-- ONE canonical original per generation. This is the constraint that makes
-- retry converge instead of accumulating: a second attempt to store the same
-- generation's output finds this row rather than creating a rival.
CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_generation_original_uniq"
  ON "public"."media_assets" ("generation_id")
  WHERE (("generation_id" IS NOT NULL) AND ("role" = 'original'::"text"));

CREATE INDEX IF NOT EXISTS "media_assets_owner_idx"
  ON "public"."media_assets" ("clerk_user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "media_assets_parent_idx"
  ON "public"."media_assets" ("parent_asset_id")
  WHERE ("parent_asset_id" IS NOT NULL);


-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------
-- The owner may READ their own assets. They may not write: an asset row is a
-- statement about what the server stored, and a client that could edit it
-- could claim an object it never uploaded, point a row at someone else's key,
-- or mark its own upload finalized and skip 9-B entirely.
ALTER TABLE "public"."media_assets" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media_assets_select_own" ON "public"."media_assets";
CREATE POLICY "media_assets_select_own" ON "public"."media_assets"
  FOR SELECT TO "authenticated"
  USING (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));

REVOKE ALL ON TABLE "public"."media_assets" FROM "anon";
REVOKE ALL ON TABLE "public"."media_assets" FROM "authenticated";
GRANT SELECT ON TABLE "public"."media_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."media_assets" TO "service_role";


-- ---------------------------------------------------------------------------
-- finalize_media_asset()
-- ---------------------------------------------------------------------------
-- The server's only way to say "these bytes are really there". Guarded so a
-- replay is inert and so an asset cannot be finalized without the facts the
-- constraint above demands.
--
-- Returns {finalized, asset_id, status}. `finalized=false` with a terminal
-- status means somebody else already did it — not an error.
CREATE OR REPLACE FUNCTION "public"."finalize_media_asset"(
    "p_asset_id" "uuid",
    "p_byte_size" bigint,
    "p_declared_content_type" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row media_assets%ROWTYPE;
  v_current text;
BEGIN
  IF p_byte_size IS NULL OR p_byte_size < 0 THEN
    RAISE EXCEPTION 'invalid_byte_size' USING ERRCODE = '22023';
  END IF;

  UPDATE media_assets
     SET status = 'finalized',
         byte_size = p_byte_size,
         declared_content_type = COALESCE(p_declared_content_type, declared_content_type),
         stored_at = COALESCE(stored_at, now()),
         finalized_at = now()
   WHERE id = p_asset_id
     AND status IN ('pending', 'stored')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT status INTO v_current FROM media_assets WHERE id = p_asset_id;
    RETURN jsonb_build_object('finalized', false, 'asset_id', p_asset_id, 'status', v_current);
  END IF;

  RETURN jsonb_build_object('finalized', true, 'asset_id', v_row.id, 'status', v_row.status);
END;
$$;

ALTER FUNCTION "public"."finalize_media_asset"("uuid", bigint, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."finalize_media_asset"("uuid", bigint, "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."finalize_media_asset"("uuid", bigint, "text") TO "service_role";


COMMENT ON TABLE "public"."media_assets" IS
  'Phase 9-A. Durable record for every stored media object: location (r2/bucket/key), provenance, and lifecycle. verified_mime / checksum_sha256 / moderation_status / quarantine_status are HOOKS defaulted to not-yet-done — filling them is Phase 9-B. backup_status is Phase 9-D. data_class / retention_policy / legal_hold / tombstoned_at are Phase 23 hooks. Owner may read; only service_role may write.';
