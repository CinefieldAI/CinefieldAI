-- ===========================================================================
-- PHASE 9-A — media_assets invariants, proven by PostgreSQL
-- ===========================================================================
-- The application tests cover the ordering of the completion boundary. These
-- cover what the database refuses no matter what any worker believes:
-- duplicate canonical originals, finalization without facts, and verification
-- hooks that default to a passing value.
-- ===========================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PROOF A1 — one canonical original per generation
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_a1_' || gen_random_uuid()::text;
  v_project uuid; v_gen uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'a1') RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image', 'p') ->> 'generation_id')::uuid;

  INSERT INTO media_assets (clerk_user_id, generation_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, v_gen, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/a/original.png');

  BEGIN
    INSERT INTO media_assets (clerk_user_id, generation_id, source, role, media_type, bucket, object_key)
    VALUES (v_user, v_gen, 'provider_output', 'original', 'image', 'cinefield-media',
            'quarantine/output/' || v_user || '/b/original.png');
    RAISE EXCEPTION 'PROOF A1 FAILED: a second canonical original was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PROOF A1 PASS: one canonical original per generation; retry converges';
  END;
END $$;


-- ---------------------------------------------------------------------------
-- PROOF A2 — one row per stored object
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text := 'user_a2_' || gen_random_uuid()::text; v_key text;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  v_key := 'quarantine/input/' || v_user || '/x/original.png';

  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'browser_upload', 'original', 'image', 'cinefield-media', v_key);

  BEGIN
    INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
    VALUES (v_user, 'browser_upload', 'original', 'image', 'cinefield-media', v_key);
    RAISE EXCEPTION 'PROOF A2 FAILED: two rows claimed the same object';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PROOF A2 PASS: one asset row per stored object';
  END;
END $$;


-- ---------------------------------------------------------------------------
-- PROOF A3 — an asset cannot be finalized without the facts
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text := 'user_a3_' || gen_random_uuid()::text; v_id uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'browser_upload', 'original', 'image', 'cinefield-media',
          'quarantine/input/' || v_user || '/y/original.png')
  RETURNING id INTO v_id;

  BEGIN
    UPDATE media_assets SET status = 'finalized' WHERE id = v_id;
    RAISE EXCEPTION 'PROOF A3 FAILED: finalized without stored_at/byte_size';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROOF A3 PASS: finalized requires stored_at, finalized_at and byte_size';
  END;
END $$;


-- ---------------------------------------------------------------------------
-- PROOF A4 — finalize_media_asset is idempotent and does not rewrite facts
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_a4_' || gen_random_uuid()::text;
  v_id uuid; v_first jsonb; v_second jsonb;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/z/original.png')
  RETURNING id INTO v_id;

  v_first := finalize_media_asset(v_id, 308258, 'image/png');
  IF (v_first ->> 'finalized')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'PROOF A4 FAILED: first finalize did not apply';
  END IF;

  v_second := finalize_media_asset(v_id, 999, 'image/png');
  IF (v_second ->> 'finalized')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'PROOF A4 FAILED: a finalized asset was finalized twice';
  END IF;

  PERFORM 1 FROM media_assets WHERE id = v_id AND byte_size = 308258;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROOF A4 FAILED: replay overwrote the recorded size';
  END IF;

  RAISE NOTICE 'PROOF A4 PASS: finalization is idempotent and does not rewrite facts';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF A5 — verification hooks default to NOT DONE, never to a passing value
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text := 'user_a5_' || gen_random_uuid()::text; v_row media_assets%ROWTYPE;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/w/original.png')
  RETURNING * INTO v_row;

  IF v_row.verified_mime IS NOT NULL THEN
    RAISE EXCEPTION 'PROOF A5 FAILED: verified_mime defaulted to a claim nothing verified';
  END IF;
  IF v_row.checksum_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'PROOF A5 FAILED: checksum defaulted to a value nothing computed';
  END IF;
  IF v_row.moderation_status <> 'not_evaluated' THEN
    RAISE EXCEPTION 'PROOF A5 FAILED: moderation defaulted to %', v_row.moderation_status;
  END IF;
  IF v_row.quarantine_status <> 'quarantined' THEN
    RAISE EXCEPTION 'PROOF A5 FAILED: new media defaulted to % instead of quarantined', v_row.quarantine_status;
  END IF;
  IF v_row.backup_status <> 'not_backed_up' THEN
    RAISE EXCEPTION 'PROOF A5 FAILED: backup defaulted to %', v_row.backup_status;
  END IF;

  RAISE NOTICE 'PROOF A5 PASS: 9-B/9-D/23 hooks default to not-yet-done, not to passing';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF A6 — a derived asset must name its parent
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text := 'user_a6_' || gen_random_uuid()::text;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);

  BEGIN
    INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
    VALUES (v_user, 'provider_output', 'derived', 'image', 'cinefield-media',
            'quarantine/output/' || v_user || '/d/derived/thumb.png');
    RAISE EXCEPTION 'PROOF A6 FAILED: an orphan derived asset was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PROOF A6 PASS: derived assets must name the original they came from';
  END;
END $$;


-- ---------------------------------------------------------------------------
-- PROOF A7 — Phase 9-A is additive; earlier invariants intact
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM 1 FROM pg_indexes WHERE indexname = 'media_assets_generation_original_uniq';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF A7 FAILED: canonical-original index missing'; END IF;

  PERFORM 1 FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'workflow_start_outbox';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF A7 FAILED: M6 table disappeared'; END IF;

  PERFORM 1 FROM pg_indexes WHERE indexname = 'credit_ledger_external_ref_type_uniq';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF A7 FAILED: credit idempotency backstop disappeared'; END IF;

  PERFORM 1 FROM pg_indexes WHERE indexname = 'generations_user_idempotency_uniq';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF A7 FAILED: generation idempotency index disappeared'; END IF;

  RAISE NOTICE 'PROOF A7 PASS: Phase 9-A is additive; earlier invariants intact';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF A8 — service-role style writes cannot cross tenant/project ownership
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_owner_a text := 'user_a8_a_' || gen_random_uuid()::text;
  v_owner_b text := 'user_a8_b_' || gen_random_uuid()::text;
  v_project_b uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_owner_a), (v_owner_b);
  INSERT INTO projects (clerk_user_id, title)
  VALUES (v_owner_b, 'tenant-b-project')
  RETURNING id INTO v_project_b;

  BEGIN
    INSERT INTO media_assets
      (clerk_user_id, project_id, source, role, media_type, bucket, object_key)
    VALUES
      (v_owner_a, v_project_b, 'browser_upload', 'original', 'image', 'cinefield-media',
       'quarantine/input/' || v_owner_a || '/cross-tenant/original.png');
    RAISE EXCEPTION 'PROOF A8 FAILED: cross-tenant project binding was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PROOF A8 PASS: cross-tenant media/project binding is rejected at DB boundary';
  END;
END $$;


-- ---------------------------------------------------------------------------
-- PROOF A9 — same-tenant project binding remains legitimate
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_owner text := 'user_a9_' || gen_random_uuid()::text;
  v_project uuid;
  v_asset uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_owner);
  INSERT INTO projects (clerk_user_id, title)
  VALUES (v_owner, 'same-tenant-project')
  RETURNING id INTO v_project;

  INSERT INTO media_assets
    (clerk_user_id, project_id, source, role, media_type, bucket, object_key)
  VALUES
    (v_owner, v_project, 'browser_upload', 'original', 'image', 'cinefield-media',
     'quarantine/input/' || v_owner || '/same-tenant/original.png')
  RETURNING id INTO v_asset;

  IF v_asset IS NULL THEN
    RAISE EXCEPTION 'PROOF A9 FAILED: legitimate same-tenant binding was not created';
  END IF;

  RAISE NOTICE 'PROOF A9 PASS: legitimate same-tenant media/project binding still works';
END $$;
