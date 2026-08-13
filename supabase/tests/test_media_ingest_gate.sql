-- ===========================================================================
-- PHASE 9-B — ingest gate invariants, proven by PostgreSQL
-- ===========================================================================
-- The application tests cover what the gate DECIDES. These cover what the
-- database refuses no matter what any worker decides: release without checks,
-- verification without facts, and a duplicate link across a tenant boundary.
-- ===========================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PROOF B1 — quarantine cannot be released without the full check set
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text := 'user_b1_' || gen_random_uuid()::text; v_id uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/b1/original.png')
  RETURNING id INTO v_id;

  -- No ingest, no mime, no checksum, no moderation.
  BEGIN
    UPDATE media_assets SET quarantine_status = 'released' WHERE id = v_id;
    RAISE EXCEPTION 'PROOF B1 FAILED: released with nothing verified';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Verified, hashed — but moderation has still not spoken.
  PERFORM record_media_ingest(v_id, 'verified', 'image/png', repeat('a', 64));
  BEGIN
    UPDATE media_assets SET quarantine_status = 'released' WHERE id = v_id;
    RAISE EXCEPTION 'PROOF B1 FAILED: released while moderation was not_evaluated';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PROOF B1 PASS: release requires verified ingest + mime + checksum + moderation';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF B2 — verified requires the facts that make it meaningful
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text := 'user_b2_' || gen_random_uuid()::text; v_id uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'browser_upload', 'original', 'image', 'cinefield-media',
          'quarantine/input/' || v_user || '/b2/original.png')
  RETURNING id INTO v_id;

  BEGIN
    PERFORM record_media_ingest(v_id, 'verified', NULL, NULL);
    RAISE EXCEPTION 'PROOF B2 FAILED: verified without mime or checksum';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    UPDATE media_assets SET ingest_status = 'verified' WHERE id = v_id;
    RAISE EXCEPTION 'PROOF B2 FAILED: a direct UPDATE bypassed the consistency check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PROOF B2 PASS: verified is impossible without mime and checksum';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF B3 — a duplicate link may not cross a tenant boundary
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a text := 'user_b3a_' || gen_random_uuid()::text;
  v_b text := 'user_b3b_' || gen_random_uuid()::text;
  v_asset_a uuid; v_asset_b uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_a), (v_b);

  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_a, 'browser_upload', 'original', 'image', 'cinefield-media',
          'quarantine/input/' || v_a || '/b3/original.png')
  RETURNING id INTO v_asset_a;

  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_b, 'browser_upload', 'original', 'image', 'cinefield-media',
          'quarantine/input/' || v_b || '/b3/original.png')
  RETURNING id INTO v_asset_b;

  -- Identical bytes across two tenants must never be linked: the link itself
  -- would disclose one tenant's media to the other.
  BEGIN
    UPDATE media_assets SET duplicate_of_asset_id = v_asset_a WHERE id = v_asset_b;
    RAISE EXCEPTION 'PROOF B3 FAILED: a cross-tenant duplicate link was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Within one owner it is allowed, as evidence.
  DECLARE v_asset_a2 uuid;
  BEGIN
    INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
    VALUES (v_a, 'browser_upload', 'original', 'image', 'cinefield-media',
            'quarantine/input/' || v_a || '/b3b/original.png')
    RETURNING id INTO v_asset_a2;

    UPDATE media_assets SET duplicate_of_asset_id = v_asset_a WHERE id = v_asset_a2;
  END;

  RAISE NOTICE 'PROOF B3 PASS: duplicates are owner-scoped; cross-tenant links are refused';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF B4 — record_media_ingest is idempotent and refuses a checksum change
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_b4_' || gen_random_uuid()::text;
  v_id uuid; v_first jsonb; v_second jsonb;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/b4/original.png')
  RETURNING id INTO v_id;

  v_first := record_media_ingest(v_id, 'verified', 'image/png', repeat('b', 64));
  IF (v_first ->> 'recorded')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'PROOF B4 FAILED: first ingest did not record';
  END IF;

  v_second := record_media_ingest(v_id, 'rejected', NULL, NULL, 'unsupported_format');
  IF (v_second ->> 'recorded')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'PROOF B4 FAILED: an ingested asset was re-ingested';
  END IF;

  PERFORM 1 FROM media_assets WHERE id = v_id AND ingest_status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROOF B4 FAILED: replay overwrote the recorded verdict';
  END IF;

  RAISE NOTICE 'PROOF B4 PASS: ingest is recorded once; replay cannot rewrite the verdict';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF B5 — a failure reason is a short code, never free text
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text := 'user_b5_' || gen_random_uuid()::text; v_id uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/b5/original.png')
  RETURNING id INTO v_id;

  BEGIN
    -- A path, a stack or a filename must be impossible to store here.
    PERFORM record_media_ingest(v_id, 'rejected', NULL, NULL,
                                'C:\Users\secret\evil.png failed at line 42');
    RAISE EXCEPTION 'PROOF B5 FAILED: free text was accepted as a failure reason';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  RAISE NOTICE 'PROOF B5 PASS: failure reasons are constrained to short codes';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF B6 — a checksum must look like one
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text := 'user_b6_' || gen_random_uuid()::text; v_id uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/b6/original.png')
  RETURNING id INTO v_id;

  BEGIN
    UPDATE media_assets SET checksum_sha256 = 'not-a-hash' WHERE id = v_id;
    RAISE EXCEPTION 'PROOF B6 FAILED: a malformed checksum was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PROOF B6 PASS: checksum shape is enforced';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF B7 — earlier invariants intact
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM 1 FROM pg_indexes WHERE indexname = 'media_assets_generation_original_uniq';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF B7 FAILED: 9-A canonical index missing'; END IF;

  PERFORM 1 FROM pg_indexes WHERE indexname = 'media_assets_owner_checksum_idx';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF B7 FAILED: tenant-scoped checksum index missing'; END IF;

  PERFORM 1 FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'workflow_start_outbox';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROOF B7 FAILED: M6 table disappeared'; END IF;

  RAISE NOTICE 'PROOF B7 PASS: Phase 9-B is additive; earlier invariants intact';
END $$;
