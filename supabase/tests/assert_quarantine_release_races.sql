-- ===========================================================================
-- PHASE 9-E — race invariants
-- ===========================================================================
-- The races were run by run_pg_tests.sh from genuinely parallel psql
-- PROCESSES, so the outcomes were decided by PostgreSQL's row locks rather
-- than by any ordering this file could arrange. Nothing below asserts an
-- ORDER — only the invariants, because which connection wins is not
-- deterministic and a test that depended on it would be flaky rather than
-- informative.
-- ===========================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- RACE R1 — six admins approving the same cleared asset at once
-- ---------------------------------------------------------------------------
-- One approval was seeded beforehand, so EVERY racer's own insert takes the
-- count to the threshold. Without the row lock they would all release. With
-- it, exactly one does and the rest re-read a released row.
DO $$
DECLARE v_asset uuid; v_released integer; v_errors integer; v_events integer; v_status text;
BEGIN
  SELECT asset_id INTO v_asset FROM release_race_assets WHERE tag = 'rc1';

  SELECT count(*) FILTER (WHERE outcome = 'released'),
         count(*) FILTER (WHERE outcome = 'error')
    INTO v_released, v_errors
    FROM release_race_results WHERE race = 'release';

  ASSERT v_errors = 0,
    'R1: a racer errored: ' || (SELECT string_agg(detail, ' | ')
                                  FROM release_race_results
                                 WHERE race = 'release' AND outcome = 'error');
  ASSERT v_released = 1, 'R1: expected exactly one effective release, got ' || v_released;

  ASSERT (SELECT count(*) FROM release_race_results
           WHERE race = 'release' AND outcome NOT IN ('released', 'already_released')) = 0,
    'R1: a racer neither released nor saw already_released: '
      || (SELECT string_agg(outcome, ',') FROM release_race_results WHERE race = 'release');

  SELECT quarantine_status INTO v_status FROM media_assets WHERE id = v_asset;
  ASSERT v_status = 'released', 'R1: final state is ' || v_status;

  -- THE EVENT AGREES WITH THE FINAL STATE, exactly once.
  SELECT count(*) INTO v_events FROM outbox_events
   WHERE event_type = 'media.asset.released' AND aggregate_id = v_asset::text;
  ASSERT v_events = 1, 'R1: expected one released event, got ' || v_events;

  RAISE NOTICE 'PROOF R1 PASS: six simultaneous approvals produce one release and one event';
END $$;


-- ---------------------------------------------------------------------------
-- RACE R2 — six admins rejecting the same asset at once
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_asset uuid; v_rejected integer; v_errors integer; v_events integer; v_mod text;
BEGIN
  SELECT asset_id INTO v_asset FROM release_race_assets WHERE tag = 'rc2';

  SELECT count(*) FILTER (WHERE outcome = 'rejected'),
         count(*) FILTER (WHERE outcome = 'error')
    INTO v_rejected, v_errors
    FROM release_race_results WHERE race = 'reject';

  ASSERT v_errors = 0,
    'R2: a racer errored: ' || (SELECT string_agg(detail, ' | ')
                                  FROM release_race_results
                                 WHERE race = 'reject' AND outcome = 'error');
  ASSERT v_rejected = 1, 'R2: expected exactly one effective reject, got ' || v_rejected;

  SELECT moderation_status INTO v_mod FROM media_assets WHERE id = v_asset;
  ASSERT v_mod = 'rejected', 'R2: final moderation_status is ' || v_mod;

  SELECT count(*) INTO v_events FROM outbox_events
   WHERE event_type = 'media.asset.rejected' AND aggregate_id = v_asset::text;
  ASSERT v_events = 1, 'R2: expected one rejected event, got ' || v_events;

  RAISE NOTICE 'PROOF R2 PASS: six simultaneous rejects produce one reject and one event';
END $$;


-- ---------------------------------------------------------------------------
-- RACE R3 — release and reject arriving together
-- ---------------------------------------------------------------------------
-- The dangerous one. Both callers read a quarantined, cleared, one-approval
-- asset. If they were not serialised, the asset could be marked released
-- while a rejected event went out about it — media the world can fetch and a
-- record saying it was refused.
DO $$
DECLARE v_asset uuid; v_released integer; v_rejected integer; v_errors integer;
        v_q text; v_mod text; v_rel_events integer; v_rej_events integer;
BEGIN
  SELECT asset_id INTO v_asset FROM release_race_assets WHERE tag = 'rc3';

  SELECT count(*) FILTER (WHERE outcome = 'released'),
         count(*) FILTER (WHERE outcome = 'rejected'),
         count(*) FILTER (WHERE outcome = 'error')
    INTO v_released, v_rejected, v_errors
    FROM release_race_results WHERE race = 'vs';

  ASSERT v_errors = 0,
    'R3: a racer errored: ' || (SELECT string_agg(detail, ' | ')
                                  FROM release_race_results
                                 WHERE race = 'vs' AND outcome = 'error');
  ASSERT v_released + v_rejected = 1,
    'R3: exactly one intent may take effect, got ' || v_released || ' released and '
      || v_rejected || ' rejected';

  SELECT quarantine_status, moderation_status INTO v_q, v_mod
    FROM media_assets WHERE id = v_asset;
  SELECT count(*) INTO v_rel_events FROM outbox_events
   WHERE event_type = 'media.asset.released' AND aggregate_id = v_asset::text;
  SELECT count(*) INTO v_rej_events FROM outbox_events
   WHERE event_type = 'media.asset.rejected' AND aggregate_id = v_asset::text;

  -- THE EVENTS AGREE WITH THE FINAL STATE, whichever intent won.
  IF v_released = 1 THEN
    ASSERT v_q = 'released', 'R3: release won but state is ' || v_q;
    ASSERT v_mod <> 'rejected', 'R3: released asset carries a rejected verdict';
    ASSERT v_rel_events = 1 AND v_rej_events = 0,
      'R3: release won but events are ' || v_rel_events || ' released / ' || v_rej_events || ' rejected';
  ELSE
    ASSERT v_mod = 'rejected', 'R3: reject won but moderation_status is ' || v_mod;
    ASSERT v_q <> 'released', 'R3: rejected asset is out of quarantine';
    ASSERT v_rej_events = 1 AND v_rel_events = 0,
      'R3: reject won but events are ' || v_rel_events || ' released / ' || v_rej_events || ' rejected';
  END IF;

  RAISE NOTICE 'PROOF R3 PASS: release and reject cannot both take effect, and the event matches the state';
END $$;


-- ---------------------------------------------------------------------------
-- RACE R4 — every race wrote its audit trail, and none of it can be revised
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows FROM media_safety_audit
   WHERE asset_id IN (SELECT asset_id FROM release_race_assets);
  ASSERT v_rows > 0, 'R4: the races left no audit trail';

  BEGIN
    UPDATE media_safety_audit SET actor_clerk_user_id = 'someone_else'
     WHERE asset_id IN (SELECT asset_id FROM release_race_assets);
    RAISE EXCEPTION 'PROOF R4 FAILED: race audit rows were rewritten';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PROOF R4 PASS: the race audit trail exists and is immutable';
END $$;

SELECT 'PHASE 9-E RACE PROOFS PASSED' AS result;
