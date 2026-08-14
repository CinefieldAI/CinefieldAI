-- ===========================================================================
-- PHASE 11-A — race invariants
-- ===========================================================================
-- Driven by run_pg_tests.sh from genuinely parallel psql PROCESSES, so the
-- outcomes were decided by PostgreSQL's row locks and unique indexes, not by
-- any ordering this file arranges. Nothing asserts an ORDER — only that a
-- logical transition can produce at most one notification-bearing event, no
-- matter how many callers raced for it.
-- ===========================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- RACE NR1 — six connections claiming one queued generation
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_gen uuid; v_user text; v_claimed integer; v_errors integer;
        v_events integer; v_status text; v_tenant text;
BEGIN
  SELECT generation_id, clerk_user_id INTO v_gen, v_user
    FROM notification_race_fixtures WHERE tag = 'nr1';

  SELECT count(*) FILTER (WHERE outcome = 'claimed'),
         count(*) FILTER (WHERE outcome = 'error')
    INTO v_claimed, v_errors
    FROM notification_race_results WHERE race = 'claim';

  ASSERT v_errors = 0,
    'NR1: a racer errored: ' || (SELECT string_agg(detail, ' | ')
                                   FROM notification_race_results
                                  WHERE race = 'claim' AND outcome = 'error');
  ASSERT v_claimed = 1, 'NR1: expected exactly one winning claim, got ' || v_claimed;

  ASSERT (SELECT count(*) FROM notification_race_results
           WHERE race = 'claim' AND outcome NOT IN ('claimed', 'not_queued')) = 0,
    'NR1: a racer neither won nor saw not_queued: '
      || (SELECT string_agg(outcome, ',') FROM notification_race_results WHERE race = 'claim');

  SELECT status INTO v_status FROM generations WHERE id = v_gen;
  ASSERT v_status = 'processing', 'NR1: final status is ' || v_status;

  -- THE POINT: one transition, one notification-bearing event.
  SELECT count(*), max(tenant_id) INTO v_events, v_tenant FROM outbox_events
   WHERE event_type = 'generation.processing' AND aggregate_id = v_gen::text;
  ASSERT v_events = 1, 'NR1: expected one processing event, got ' || v_events;
  ASSERT v_tenant = v_user, 'NR1: tenant is ' || COALESCE(v_tenant, 'NULL');

  RAISE NOTICE 'PROOF NR1 PASS: six simultaneous claims produce one transition and one event';
END $$;


-- ---------------------------------------------------------------------------
-- RACE NR2 — six connections creating under one idempotency key
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_created integer; v_errors integer; v_gens integer; v_events integer;
        v_gen text; v_tenant text; v_user text;
BEGIN
  SELECT clerk_user_id INTO v_user FROM notification_race_fixtures WHERE tag = 'nr2';

  SELECT count(*) FILTER (WHERE outcome = 'created'),
         count(*) FILTER (WHERE outcome = 'error')
    INTO v_created, v_errors
    FROM notification_race_results WHERE race = 'create';

  ASSERT v_errors = 0,
    'NR2: a racer errored: ' || (SELECT string_agg(detail, ' | ')
                                   FROM notification_race_results
                                  WHERE race = 'create' AND outcome = 'error');
  ASSERT v_created = 1, 'NR2: expected exactly one creation, got ' || v_created;

  -- Every racer, winner and replayer alike, must report the SAME generation.
  SELECT count(DISTINCT detail), max(detail) INTO v_gens, v_gen
    FROM notification_race_results WHERE race = 'create';
  ASSERT v_gens = 1, 'NR2: racers saw ' || v_gens || ' different generations';

  SELECT count(*), max(tenant_id) INTO v_events, v_tenant FROM outbox_events
   WHERE event_type = 'generation.created' AND aggregate_id = v_gen;
  ASSERT v_events = 1, 'NR2: expected one queued event, got ' || v_events;
  ASSERT v_tenant = v_user, 'NR2: tenant is ' || COALESCE(v_tenant, 'NULL');

  RAISE NOTICE 'PROOF NR2 PASS: six simultaneous creations produce one generation and one queued event';
END $$;


-- ---------------------------------------------------------------------------
-- RACE NR3 — no event anywhere in the run escaped tenant capture
-- ---------------------------------------------------------------------------
-- A sweep rather than a targeted check: after every proof and every race in
-- this file has run, any event produced by an 11-A-era producer must carry a
-- tenant. A future emitter that forgets is caught here even if nobody wrote a
-- test for it specifically.
DO $$
DECLARE v_orphans text;
BEGIN
  SELECT string_agg(DISTINCT event_type || '@' || aggregate_type, ', ') INTO v_orphans
    FROM outbox_events
   WHERE tenant_id IS NULL
     AND aggregate_type IN ('generation', 'media_asset');

  ASSERT v_orphans IS NULL,
    'NR3: events on a known aggregate with no captured tenant: ' || v_orphans;

  RAISE NOTICE 'PROOF NR3 PASS: every event on a known aggregate carries its tenant';
END $$;


-- ---------------------------------------------------------------------------
-- RACE NR4 — cross-tenant separation survived the whole run
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad text;
BEGIN
  -- Every generation event's captured tenant must equal the generation's own
  -- owner. Not one row may disagree.
  SELECT string_agg(o.event_id::text, ', ') INTO v_bad
    FROM outbox_events o
    JOIN generations g ON g.id::text = o.aggregate_id
   WHERE o.aggregate_type = 'generation'
     AND o.tenant_id IS DISTINCT FROM g.clerk_user_id;
  ASSERT v_bad IS NULL, 'NR4: generation events routed to the wrong tenant: ' || v_bad;

  SELECT string_agg(o.event_id::text, ', ') INTO v_bad
    FROM outbox_events o
    JOIN media_assets m ON m.id::text = o.aggregate_id
   WHERE o.aggregate_type = 'media_asset'
     AND o.tenant_id IS DISTINCT FROM m.clerk_user_id;
  ASSERT v_bad IS NULL, 'NR4: asset events routed to the wrong tenant: ' || v_bad;

  RAISE NOTICE 'PROOF NR4 PASS: no event carries a tenant other than its aggregate owner';
END $$;

SELECT 'PHASE 11-A RACE PROOFS PASSED' AS result;
