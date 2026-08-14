-- ===========================================================================
-- PHASE 9-D — R2 hot → S3 DR backup, recorded
-- ===========================================================================
-- 9-A left `backup_status` on media_assets defaulting to `not_backed_up`.
-- This migration gives that column the rest of its facts and a durable
-- intent, so a backup that has not happened yet is visible work rather than
-- something nobody is tracking.
--
-- THE OWNERSHIP RULE THIS ENCODES: R2 is canonical, S3 is a copy. Nothing
-- here can make S3 a delivery path — the columns record WHERE a copy went,
-- and no read path in the application consults them. A DR failure is a
-- durability problem, never a media problem, so none of this blocks a
-- generation.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Backup facts on the asset
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "backup_backend" "text";

ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "backup_bucket" "text";

ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "backup_key" "text";

-- S3's own object version, when versioning is on. Recorded for audit and for
-- a future restore to name an exact copy.
ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "backup_version_id" "text";

-- S3's ETag, VERBATIM. Deliberately NOT called a checksum: for multipart or
-- SSE-KMS objects it is not an MD5 of the content, and treating it as content
-- identity would be wrong in exactly the cases that matter. Content identity
-- is `checksum_sha256`, computed by the Phase 9-B ingest gate over the
-- canonical bytes.
ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "backup_etag" "text";

ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "backup_completed_at" timestamp with time zone;

ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "backup_failure_reason" "text";

ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "backup_attempts" integer DEFAULT 0 NOT NULL;

DO $$
BEGIN
  -- 9-A shipped not_backed_up/pending/backed_up. `backing_up` and `failed`
  -- complete the machine: a claimed job and an attempt that did not work are
  -- different from "nobody has started".
  ALTER TABLE "public"."media_assets" DROP CONSTRAINT IF EXISTS "media_assets_backup_check";
  ALTER TABLE "public"."media_assets"
    ADD CONSTRAINT "media_assets_backup_check" CHECK (("backup_status" = ANY (ARRAY[
      'not_backed_up'::"text",
      'pending'::"text",
      'backing_up'::"text",
      'backed_up'::"text",
      'failed'::"text"
    ])));

  -- A backup that claims to be done must say where it is. Without this a row
  -- could report `backed_up` while pointing nowhere, which is worse than
  -- reporting nothing.
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'media_assets_backup_consistency') THEN
    ALTER TABLE "public"."media_assets"
      ADD CONSTRAINT "media_assets_backup_consistency" CHECK (
        ("backup_status" <> 'backed_up'::"text")
        OR (("backup_backend" IS NOT NULL)
            AND ("backup_bucket" IS NOT NULL)
            AND ("backup_key" IS NOT NULL)
            AND ("backup_completed_at" IS NOT NULL))
      );
  END IF;

  -- s3 today. `r2` is listed only so a future cross-region R2 copy has a name;
  -- it is not a delivery backend either.
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'media_assets_backup_backend_check') THEN
    ALTER TABLE "public"."media_assets"
      ADD CONSTRAINT "media_assets_backup_backend_check" CHECK (
        ("backup_backend" IS NULL) OR ("backup_backend" = ANY (ARRAY['s3'::"text", 'r2'::"text"]))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'media_assets_backup_attempts_check') THEN
    ALTER TABLE "public"."media_assets"
      ADD CONSTRAINT "media_assets_backup_attempts_check" CHECK (("backup_attempts" >= 0));
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- The work queue
-- ---------------------------------------------------------------------------
-- Only assets that are finished, verified, and not yet copied. Partial, so it
-- does not grow with the backed-up history — which is eventually every row.
CREATE INDEX IF NOT EXISTS "media_assets_backup_due_idx"
  ON "public"."media_assets" ("created_at")
  WHERE ("backup_status" = ANY (ARRAY['not_backed_up'::"text", 'pending'::"text", 'failed'::"text"]));


-- ---------------------------------------------------------------------------
-- claim_media_backups()
-- ---------------------------------------------------------------------------
-- Same claim discipline as the workflow-start relay and the event outbox:
-- SKIP LOCKED, a lease, an attempt counter. Two backup workers take disjoint
-- sets; one that dies mid-batch leaves rows that become claimable again.
--
-- ELIGIBILITY IS THE INTERESTING PART. Only `status = 'finalized'` AND
-- `ingest_status = 'verified'` are offered. Backing up bytes the ingest gate
-- rejected would spend durability on media Cinefield has already refused, and
-- backing up an unfinalized asset would copy something that may still change.
CREATE OR REPLACE FUNCTION "public"."claim_media_backups"(
    "p_limit" integer DEFAULT 20,
    "p_lease_seconds" integer DEFAULT 300
) RETURNS TABLE (
    "asset_id" "uuid",
    "clerk_user_id" "text",
    "bucket" "text",
    "object_key" "text",
    "declared_content_type" "text",
    "byte_size" bigint,
    "backup_attempts" integer
)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cutoff timestamp with time zone := now() - make_interval(secs => p_lease_seconds);
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT a.id
    FROM media_assets a
    WHERE a.status = 'finalized'
      AND a.ingest_status = 'verified'
      AND (
        a.backup_status IN ('not_backed_up', 'pending', 'failed')
        OR (a.backup_status = 'backing_up' AND a.created_at < v_cutoff)
      )
    ORDER BY a.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE media_assets m
  SET backup_status = 'backing_up',
      backup_attempts = m.backup_attempts + 1
  FROM claimed c
  WHERE m.id = c.id
  RETURNING m.id, m.clerk_user_id, m.bucket, m.object_key,
            m.declared_content_type, m.byte_size, m.backup_attempts;
END;
$$;

ALTER FUNCTION "public"."claim_media_backups"(integer, integer) OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- record_media_backup()
-- ---------------------------------------------------------------------------
-- Records the outcome. `backed_up` demands the location facts the constraint
-- above requires; a failure returns the row to `failed`, which the claim
-- picks up again — a DR copy that has not happened stays owed, exactly like a
-- workflow-start intent.
CREATE OR REPLACE FUNCTION "public"."record_media_backup"(
    "p_asset_id" "uuid",
    "p_backup_status" "text",
    "p_backup_backend" "text" DEFAULT NULL,
    "p_backup_bucket" "text" DEFAULT NULL,
    "p_backup_key" "text" DEFAULT NULL,
    "p_backup_version_id" "text" DEFAULT NULL,
    "p_backup_etag" "text" DEFAULT NULL,
    "p_failure_reason" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row media_assets%ROWTYPE;
BEGIN
  IF p_backup_status NOT IN ('backed_up', 'failed') THEN
    RAISE EXCEPTION 'invalid_backup_status' USING ERRCODE = '22023';
  END IF;

  IF p_backup_status = 'backed_up'
     AND (p_backup_backend IS NULL OR p_backup_bucket IS NULL OR p_backup_key IS NULL) THEN
    RAISE EXCEPTION 'backed_up_requires_location' USING ERRCODE = '22023';
  END IF;

  -- Short codes only: this value is retained and read by operators, and must
  -- never carry a bucket ARN, an account id, or an SDK message.
  IF p_failure_reason IS NOT NULL AND p_failure_reason !~ '^[a-z][a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_failure_reason' USING ERRCODE = '22023';
  END IF;

  UPDATE media_assets
     SET backup_status = p_backup_status,
         backup_backend = COALESCE(p_backup_backend, backup_backend),
         backup_bucket = COALESCE(p_backup_bucket, backup_bucket),
         backup_key = COALESCE(p_backup_key, backup_key),
         backup_version_id = COALESCE(p_backup_version_id, backup_version_id),
         backup_etag = COALESCE(p_backup_etag, backup_etag),
         backup_failure_reason = p_failure_reason,
         backup_completed_at = CASE WHEN p_backup_status = 'backed_up' THEN now() ELSE backup_completed_at END
   WHERE id = p_asset_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'recorded', true,
    'asset_id', v_row.id,
    'backup_status', v_row.backup_status,
    'backup_attempts', v_row.backup_attempts
  );
END;
$$;

ALTER FUNCTION "public"."record_media_backup"("uuid", "text", "text", "text", "text", "text", "text", "text") OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------
-- A browser may already only SELECT media_assets, and both functions are
-- service_role only. Restated explicitly because "backup_status = backed_up"
-- is a durability claim, and a client that could write it could hide the fact
-- that no copy exists.
REVOKE ALL ON FUNCTION "public"."claim_media_backups"(integer, integer) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."record_media_backup"("uuid", "text", "text", "text", "text", "text", "text", "text") FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."claim_media_backups"(integer, integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."record_media_backup"("uuid", "text", "text", "text", "text", "text", "text", "text") TO "service_role";


COMMENT ON COLUMN "public"."media_assets"."backup_etag" IS
  'Phase 9-D. S3''s ETag verbatim. NOT a content checksum — for multipart or SSE-KMS objects it is not an MD5 of the content. Content identity is checksum_sha256 from the Phase 9-B ingest gate.';
COMMENT ON COLUMN "public"."media_assets"."backup_key" IS
  'Phase 9-D. Where the DR copy lives in S3. Recorded for audit and restore; NO application read path consults it. S3 is disaster recovery, never a delivery source.';
