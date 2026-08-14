-- ===========================================================================
-- PHASE 11 CLOSURE — dispatcher race invariants
-- ===========================================================================
-- Driven by run_pg_tests.sh from genuinely parallel psql PROCESSES. The one
-- property that matters: no outbox row is ever handed to two dispatchers at
-- the same time, because both would publish it and both would try to resolve
-- it.
-- ===========================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE v_total integer; v_distinct integer; v_errors integer; v_workers integer;
BEGIN
  SELECT count(*), count(DISTINCT detail), count(*) FILTER (WHERE outcome = 'error')
    INTO v_total, v_distinct, v_errors
    FROM dispatch_race_results WHERE race = 'claim';

  ASSERT v_errors = 0,
    'DR1: a dispatcher errored: ' || (SELECT string_agg(detail, ' | ')
                                        FROM dispatch_race_results
                                       WHERE race = 'claim' AND outcome = 'error');

  ASSERT v_total > 0, 'DR1: the race claimed nothing — the fixture did not seed';

  -- THE POINT. Same count of claims as distinct events means no event was
  -- handed out twice.
  ASSERT v_total = v_distinct,
    'DR1: ' || v_total || ' claims for only ' || v_distinct || ' events — a row was double-claimed';

  SELECT count(DISTINCT worker) INTO v_workers
    FROM dispatch_race_results WHERE race = 'claim' AND outcome = 'claimed';
  ASSERT v_workers >= 1, 'DR1: no worker recorded a claim';

  RAISE NOTICE 'PROOF DR1 PASS: % events claimed exactly once across % concurrent dispatchers',
    v_distinct, v_workers;
END $$;


DO $$
DECLARE v_bad integer;
BEGIN
  -- Every claimed row must hold exactly one live token, and a row that is
  -- 'dispatching' must have one.
  SELECT count(*) INTO v_bad FROM outbox_events
   WHERE realtime_status = 'dispatching' AND realtime_claim_token IS NULL;
  ASSERT v_bad = 0, 'DR2: a dispatching row holds no claim token';

  SELECT count(*) INTO v_bad FROM outbox_events
   WHERE realtime_status = 'done' AND realtime_claim_token IS NOT NULL;
  ASSERT v_bad = 0, 'DR2: a finished row still holds a claim';

  -- And the kafka lane was never touched by any of this.
  SELECT count(*) INTO v_bad FROM outbox_events
   WHERE realtime_status = 'dispatching' AND status = 'published';
  ASSERT v_bad = 0, 'DR2: the realtime race published the kafka lane';

  RAISE NOTICE 'PROOF DR2 PASS: claim state is consistent and the kafka lane is untouched';
END $$;

SELECT 'PHASE 11 DISPATCH RACE PROOFS PASSED' AS result;
