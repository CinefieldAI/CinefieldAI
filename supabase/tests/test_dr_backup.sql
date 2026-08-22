-- ===========================================================================
-- PHASE 9-D — DR backup invariants, proven by PostgreSQL
-- ===========================================================================
\set ON_ERROR_STOP on

-- Shared fixture helper: a finalized, verified asset is the only kind the
-- backup claim is allowed to offer.
CREATE OR REPLACE FUNCTION pg_temp.make_backupable_asset(p_user text, p_slug text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (p_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || p_user || '/' || p_slug || '/original.png')
  RETURNING id INTO v_id;

  PERFORM record_media_ingest(v_id, 'verified', 'image/png', repeat('c', 64));
  PERFORM finalize_media_asset(v_id, 1024, 'image/png');
  RETURN v_id;
END $$;


-- ---------------------------------------------------------------------------
-- PROOF D1 — only finalized AND verified assets are offered for backup
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_d1_' || gen_random_uuid()::text;
  v_ready uuid; v_unverified uuid; v_claimed integer;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);

  v_ready := pg_temp.make_backupable_asset(v_user, 'ready');

  -- Stored, but the ingest gate never read it.
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/unverified/original.png')
  RETURNING id INTO v_unverified;
  PERFORM finalize_media_asset(v_unverified, 512, 'image/png');

  SELECT count(*) INTO v_claimed FROM claim_media_backups(50, 300) WHERE asset_id = v_ready;
  IF v_claimed <> 1 THEN
    RAISE EXCEPTION 'PROOF D1 FAILED: a ready asset was not offered';
  END IF;

  SELECT count(*) INTO v_claimed FROM claim_media_backups(50, 300) WHERE asset_id = v_unverified;
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'PROOF D1 FAILED: an unverified asset was offered for backup';
  END IF;

  RAISE NOTICE 'PROOF D1 PASS: only finalized+verified media is ever backed up';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF D2 — claim is single-winner and leases expire
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_d2_' || gen_random_uuid()::text;
  v_id uuid; v_second integer; v_reclaimed integer;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  v_id := pg_temp.make_backupable_asset(v_user, 'claim');

  PERFORM claim_media_backups(50, 300);

  SELECT count(*) INTO v_second FROM claim_media_backups(50, 300) WHERE asset_id = v_id;
  IF v_second <> 0 THEN
    RAISE EXCEPTION 'PROOF D2 FAILED: a leased asset was claimed twice';
  END IF;

  -- The worker died. Age the row past the lease.
  UPDATE media_assets SET created_at = now() - interval '1 hour' WHERE id = v_id;

  SELECT count(*) INTO v_reclaimed FROM claim_media_backups(50, 60) WHERE asset_id = v_id;
  IF v_reclaimed <> 1 THEN
    RAISE EXCEPTION 'PROOF D2 FAILED: an expired lease was not reclaimable';
  END IF;

  RAISE NOTICE 'PROOF D2 PASS: one winner per claim; a dead worker''s lease expires';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF D3 — backed_up demands the location facts
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_d3_' || gen_random_uuid()::text; v_id uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  v_id := pg_temp.make_backupable_asset(v_user, 'facts');

  BEGIN
    PERFORM record_media_backup(v_id, 'backed_up');
    RAISE EXCEPTION 'PROOF D3 FAILED: backed_up recorded with no location';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    UPDATE media_assets SET backup_status = 'backed_up' WHERE id = v_id;
    RAISE EXCEPTION 'PROOF D3 FAILED: a direct UPDATE bypassed the consistency check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PROOF D3 PASS: a backup that claims to exist must say where';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF D4 — a failed backup stays owed and is retried
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_d4_' || gen_random_uuid()::text;
  v_id uuid; v_status text; v_attempts integer; v_reclaimed integer;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  v_id := pg_temp.make_backupable_asset(v_user, 'retry');

  PERFORM claim_media_backups(50, 300);
  PERFORM record_media_backup(v_id, 'failed', NULL, NULL, NULL, NULL, NULL, 's3_write_failed');

  SELECT backup_status, backup_attempts INTO v_status, v_attempts
    FROM media_assets WHERE id = v_id;

  IF v_status <> 'failed' THEN
    RAISE EXCEPTION 'PROOF D4 FAILED: expected failed, got %', v_status;
  END IF;
  IF v_attempts < 1 THEN
    RAISE EXCEPTION 'PROOF D4 FAILED: the attempt was not counted';
  END IF;

  -- Still owed: the next pass picks it up again.
  SELECT count(*) INTO v_reclaimed FROM claim_media_backups(50, 300) WHERE asset_id = v_id;
  IF v_reclaimed <> 1 THEN
    RAISE EXCEPTION 'PROOF D4 FAILED: a failed backup was abandoned';
  END IF;

  RAISE NOTICE 'PROOF D4 PASS: an undelivered DR copy stays owed';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF D5 — a failure reason is a short code, never an ARN or a message
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text := 'user_d5_' || gen_random_uuid()::text; v_id uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  v_id := pg_temp.make_backupable_asset(v_user, 'reason');

  BEGIN
    PERFORM record_media_backup(v_id, 'failed', NULL, NULL, NULL, NULL, NULL,
                                'arn:aws:s3:::secret-bucket AccessDenied for user X');
    RAISE EXCEPTION 'PROOF D5 FAILED: free text accepted as a failure reason';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  RAISE NOTICE 'PROOF D5 PASS: failure reasons cannot carry an ARN or a message';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF D6 — a DR failure cannot alter the canonical asset
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_d6_' || gen_random_uuid()::text;
  v_id uuid; v_status text; v_ingest text; v_key text; v_size bigint;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  v_id := pg_temp.make_backupable_asset(v_user, 'isolation');

  PERFORM claim_media_backups(50, 300);
  PERFORM record_media_backup(v_id, 'failed', NULL, NULL, NULL, NULL, NULL, 's3_write_failed');

  SELECT status, ingest_status, object_key, byte_size
    INTO v_status, v_ingest, v_key, v_size
    FROM media_assets WHERE id = v_id;

  IF v_status <> 'finalized' OR v_ingest <> 'verified' OR v_size <> 1024 THEN
    RAISE EXCEPTION 'PROOF D6 FAILED: a DR failure changed the canonical asset (% / % / %)',
      v_status, v_ingest, v_size;
  END IF;
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'PROOF D6 FAILED: the canonical object key was disturbed';
  END IF;

  RAISE NOTICE 'PROOF D6 PASS: a DR failure is a durability problem, not a media problem';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF D7 — earlier/current invariants intact
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Phase 27 superseded the single-original index with a multi-output-safe
  -- canonical identity. DR must preserve the current invariant.
  PERFORM 1 FROM pg_indexes WHERE indexname = 'media_assets_generation_output_uniq';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF D7 FAILED: generation/output canonical index missing'; END IF;

  PERFORM 1 FROM pg_indexes WHERE indexname = 'media_assets_owner_checksum_idx';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF D7 FAILED: 9-B tenant checksum index missing'; END IF;

  PERFORM 1 FROM pg_constraint WHERE conname = 'media_assets_release_requires_checks';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF D7 FAILED: 9-B fail-closed release constraint missing'; END IF;

  PERFORM 1 FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'workflow_start_outbox';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF D7 FAILED: M6 table disappeared'; END IF;

  RAISE NOTICE 'PROOF D7 PASS: Phase 9-D and current media identity invariants intact';
END $$;