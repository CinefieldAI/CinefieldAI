-- Cinefield Phase 6R-E — TRANSACTIONAL OUTBOX PROOFS, ON REAL POSTGRESQL.
--
-- These run against a throwaway PostgreSQL container, never Supabase. They
-- exist because every previous phase reported the outbox's transactional
-- guarantee as designed-but-unverified: a PL/pgSQL body is one transaction,
-- which is true, but "true by reading" is not the same as "true when run".
-- Everything below is a real BEGIN/COMMIT against a real engine, with the
-- real migrations applied verbatim.
--
-- Run via: supabase/tests/run_pg_tests.sh
--
-- Each proof RAISES on failure, so a non-zero psql exit is the test result.
-- Nothing here is skipped silently.

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

TRUNCATE outbox_events, generation_attempts, generations, projects CASCADE;

INSERT INTO projects (id, clerk_user_id, title)
VALUES ('11111111-1111-4111-8111-111111111111', 'user_pgtest', 'pg proof project');

CREATE OR REPLACE FUNCTION pg_temp.new_generation(p_status text DEFAULT 'queued')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO generations
    (project_id, clerk_user_id, generation_type, provider, model, prompt, status,
     completed_at)
  VALUES
    ('11111111-1111-4111-8111-111111111111', 'user_pgtest', 'image', 'mock',
     'mock-image', 'pg proof prompt', p_status,
     CASE WHEN p_status IN ('completed','failed','cancelled') THEN now() ELSE NULL END)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ===========================================================================
-- PROOF A — business mutation and outbox row COMMIT TOGETHER
-- ===========================================================================

DO $$
DECLARE
  v_gen    uuid := pg_temp.new_generation('processing');
  v_result jsonb;
  v_events integer;
  v_status text;
BEGIN
  v_result := cancel_generation_tx(v_gen, 'user_requested', 'trace-a');

  ASSERT (v_result->>'applied')::boolean IS TRUE, 'A: the transition should apply';
  ASSERT v_result->>'status' = 'cancelled', 'A: reported status should be cancelled';
  ASSERT v_result->>'event_id' IS NOT NULL, 'A: an event id should be returned';

  SELECT status INTO v_status FROM generations WHERE id = v_gen;
  ASSERT v_status = 'cancelled', 'A: the row must actually be cancelled, got ' || v_status;

  SELECT count(*) INTO v_events
    FROM outbox_events
   WHERE aggregate_id = v_gen::text AND event_type = 'generation.cancelled';
  ASSERT v_events = 1, 'A: exactly one event, got ' || v_events;

  -- The event carries identifiers and nothing else.
  PERFORM 1 FROM outbox_events
   WHERE aggregate_id = v_gen::text
     AND payload ? 'generationId'
     AND NOT (payload ? 'prompt')
     AND NOT (payload ? 'clerkUserId')
     AND trace_id = 'trace-a';
  ASSERT FOUND, 'A: event payload must carry ids only, plus the trace id';

  RAISE NOTICE 'PROOF A PASS: commit-together';
END $$;

-- ===========================================================================
-- PROOF B — outbox failure ROLLS BACK the business mutation
--
-- The half that cannot be inferred by reading. outbox_tx_rollback_probe
-- performs a real UPDATE and then makes emit_outbox_event fail inside the
-- same transaction.
-- ===========================================================================

DO $$
DECLARE
  v_gen    uuid := pg_temp.new_generation('processing');
  v_status text;
  v_events integer;
  v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM outbox_tx_rollback_probe(v_gen);
  EXCEPTION WHEN others THEN
    v_raised := true;
  END;

  ASSERT v_raised, 'B: the probe must raise';

  SELECT status INTO v_status FROM generations WHERE id = v_gen;
  ASSERT v_status = 'processing',
    'B: the UPDATE must be undone with the failed event, got ' || v_status;

  SELECT count(*) INTO v_events FROM outbox_events WHERE aggregate_id = v_gen::text;
  ASSERT v_events = 0, 'B: no event may survive, got ' || v_events;

  RAISE NOTICE 'PROOF B PASS: rollback-together';
END $$;

-- ===========================================================================
-- PROOF C — a refused business mutation emits NO event
-- ===========================================================================

DO $$
DECLARE
  v_result jsonb;
  v_events integer;
  v_gen    uuid;
BEGIN
  FOREACH v_gen IN ARRAY ARRAY[
    pg_temp.new_generation('completed'),
    pg_temp.new_generation('failed'),
    pg_temp.new_generation('cancelled')
  ] LOOP
    v_result := cancel_generation_tx(v_gen, 'user_requested');

    ASSERT (v_result->>'applied')::boolean IS FALSE,
      'C: a terminal generation must not be re-cancelled';

    SELECT count(*) INTO v_events FROM outbox_events WHERE aggregate_id = v_gen::text;
    ASSERT v_events = 0,
      'C: a refused transition must emit nothing, got ' || v_events;
  END LOOP;

  -- A generation that does not exist at all.
  v_result := cancel_generation_tx('99999999-9999-4999-8999-999999999999');
  ASSERT (v_result->>'applied')::boolean IS FALSE, 'C: unknown generation must not apply';
  ASSERT v_result->>'status' IS NULL, 'C: unknown generation reports no status';

  RAISE NOTICE 'PROOF C PASS: refused transition emits nothing';
END $$;

-- ===========================================================================
-- PROOF D — the event survives with NO Kafka anywhere
--
-- Nothing in this file connects to Kafka; that IS the point. The durability
-- boundary is PostgreSQL, and an unpublished event stays claimable forever.
-- ===========================================================================

DO $$
DECLARE
  v_gen uuid := pg_temp.new_generation('processing');
  v_row outbox_events%ROWTYPE;
BEGIN
  PERFORM cancel_generation_tx(v_gen, 'user_requested');

  SELECT * INTO v_row FROM outbox_events WHERE aggregate_id = v_gen::text;
  ASSERT v_row.status = 'pending', 'D: event should be pending, got ' || v_row.status;
  ASSERT v_row.published_at IS NULL, 'D: nothing was published';
  ASSERT v_row.publish_attempts = 0, 'D: no publish was attempted';
  ASSERT v_row.claim_token IS NULL, 'D: nothing has claimed it';

  RAISE NOTICE 'PROOF D PASS: durable without Kafka';
END $$;

-- ===========================================================================
-- PROOF E1 — stable event identity across an application-level retry
-- ===========================================================================

DO $$
DECLARE
  v_gen      uuid := pg_temp.new_generation('processing');
  v_event_id uuid := gen_random_uuid();
  v_result   jsonb;
  v_raised   boolean := false;
BEGIN
  v_result := cancel_generation_tx(v_gen, 'user_requested', NULL, v_event_id);
  ASSERT (v_result->>'event_id')::uuid = v_event_id,
    'E1: the supplied event id must be preserved, not replaced';

  -- Re-emitting the SAME identity is refused by the unique index rather than
  -- silently duplicating the fact.
  BEGIN
    PERFORM emit_outbox_event('generation.cancelled', 1, 'generation',
                              v_gen::text, '{}'::jsonb, NULL, v_event_id);
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  ASSERT v_raised, 'E1: a duplicate event id must violate outbox_events_event_id_uniq';

  RAISE NOTICE 'PROOF E1 PASS: event identity stable and unique';
END $$;

-- ===========================================================================
-- PROOF E2 — a published event can never be un-published
-- ===========================================================================

DO $$
DECLARE
  v_gen    uuid := pg_temp.new_generation('processing');
  v_eid    uuid;
  v_raised boolean := false;
BEGIN
  v_eid := (cancel_generation_tx(v_gen, 'user_requested')->>'event_id')::uuid;
  UPDATE outbox_events
     SET status = 'published', published_at = now()
   WHERE event_id = v_eid;

  BEGIN
    UPDATE outbox_events SET status = 'pending' WHERE event_id = v_eid;
  EXCEPTION WHEN others THEN
    v_raised := true;
  END;

  ASSERT v_raised, 'E2: the no-unpublish trigger must refuse the regression';
  RAISE NOTICE 'PROOF E2 PASS: published is terminal';
END $$;

-- ===========================================================================
-- PROOF F — generation_attempts constraints hold on real PostgreSQL
--
-- These are the DB-level guards the in-memory test double structurally
-- CANNOT exercise, and every previous phase said so. Here they are, run.
-- ===========================================================================

DO $$
DECLARE
  v_gen    uuid := pg_temp.new_generation('processing');
  v_raised boolean;
BEGIN
  INSERT INTO generation_attempts (generation_id, attempt_no, provider, provider_model, status)
  VALUES (v_gen, 1, 'mock', 'mock-image-v1', 'pending');

  -- ONE ACTIVE ATTEMPT PER GENERATION. This is the database backstop behind
  -- the application's claim: even if two workers raced past it, the index
  -- refuses the second active attempt.
  v_raised := false;
  BEGIN
    INSERT INTO generation_attempts (generation_id, attempt_no, provider, provider_model, status)
    VALUES (v_gen, 2, 'mock', 'mock-image-v1', 'pending');
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  ASSERT v_raised, 'F: generation_attempts_one_active_uniq must refuse a second active attempt';

  -- Once the first is terminal, a NEW attempt is permitted — which is what
  -- makes Phase 7 retry possible without weakening the guard above.
  UPDATE generation_attempts SET status = 'failed', completed_at = now()
   WHERE generation_id = v_gen AND attempt_no = 1;
  INSERT INTO generation_attempts (generation_id, attempt_no, provider, provider_model, status)
  VALUES (v_gen, 2, 'mock', 'mock-image-v1', 'pending');

  -- EVIDENCE AND JOB ID MUST AGREE.
  v_raised := false;
  BEGIN
    UPDATE generation_attempts SET submission_evidence = 'job'
     WHERE generation_id = v_gen AND attempt_no = 2;
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
  END;
  ASSERT v_raised, 'F: job evidence without a job id must be refused';

  -- ONE EXTERNAL PROVIDER JOB CLAIMED BY AT MOST ONE ATTEMPT.
  UPDATE generation_attempts
     SET provider_job_id = 'shared-job-1', submission_evidence = 'job', status = 'submitted'
   WHERE generation_id = v_gen AND attempt_no = 2;

  v_raised := false;
  BEGIN
    INSERT INTO generation_attempts
      (generation_id, attempt_no, provider, provider_model, status,
       provider_job_id, submission_evidence)
    VALUES (pg_temp.new_generation('processing'), 1, 'mock', 'mock-image-v1',
            'submitted', 'shared-job-1', 'job');
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  ASSERT v_raised, 'F: two attempts must not claim the same provider job';

  RAISE NOTICE 'PROOF F PASS: attempt constraints enforced by PostgreSQL';
END $$;

-- ===========================================================================
-- PROOF G — ONE generation id survives many attempts
--
-- The v1.6 global invariant, at the schema level: attempts multiply, the
-- generation does not.
-- ===========================================================================

DO $$
DECLARE
  v_gen   uuid := pg_temp.new_generation('processing');
  v_count integer;
  v_gens  integer;
BEGIN
  -- Three sequential attempts, each closed before the next opens.
  FOR i IN 1..3 LOOP
    INSERT INTO generation_attempts (generation_id, attempt_no, provider, provider_model, status)
    VALUES (v_gen, i, 'mock', 'mock-image-v1', 'pending');
    UPDATE generation_attempts SET status = 'failed', completed_at = now()
     WHERE generation_id = v_gen AND attempt_no = i;
  END LOOP;

  SELECT count(*) INTO v_count FROM generation_attempts WHERE generation_id = v_gen;
  ASSERT v_count = 3, 'G: three attempts should exist, got ' || v_count;

  SELECT count(DISTINCT generation_id) INTO v_gens
    FROM generation_attempts WHERE generation_id = v_gen;
  ASSERT v_gens = 1, 'G: all attempts must belong to ONE generation id';

  RAISE NOTICE 'PROOF G PASS: one generation id across many attempts';
END $$;

SELECT 'ALL SQL PROOFS PASSED' AS result;
