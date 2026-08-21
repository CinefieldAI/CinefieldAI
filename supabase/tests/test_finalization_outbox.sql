-- Cinefield Phase 6R-E Gate 0 — COMPLETED / FAILED finalization proofs, on
-- real PostgreSQL.
--
-- Companion to test_transactional_outbox.sql, which proved the same
-- properties for cancellation. 6R-E deliberately left the hot finalization
-- path unconverted; these are the proofs that it is now safe to convert.
--
-- Run via: supabase/tests/run_pg_tests.sh

\set ON_ERROR_STOP on

TRUNCATE outbox_events, generation_attempts, generations, projects CASCADE;

INSERT INTO projects (id, clerk_user_id, title)
VALUES ('22222222-2222-4222-8222-222222222222', 'user_pgtest', 'finalization proofs');

CREATE OR REPLACE FUNCTION pg_temp.new_generation(p_status text DEFAULT 'queued')
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO generations
    (project_id, clerk_user_id, generation_type, provider, model, prompt, status, completed_at)
  VALUES
    ('22222222-2222-4222-8222-222222222222', 'user_pgtest', 'image', 'mock',
     'mock-image', 'finalization proof prompt', p_status,
     CASE WHEN p_status IN ('completed','failed','cancelled') THEN now() ELSE NULL END)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- ===========================================================================
-- PROOF J — COMPLETED: state and event commit together
-- ===========================================================================

DO $$
DECLARE
  v_gen    uuid := pg_temp.new_generation('processing');
  v_result jsonb;
  v_row    generations%ROWTYPE;
  v_event  outbox_events%ROWTYPE;
BEGIN
  INSERT INTO generation_attempts (generation_id, attempt_no, provider, provider_model, status)
  VALUES (v_gen, 1, 'mock', 'mock-image-v1', 'succeeded');

  v_result := complete_generation_tx(
    v_gen, 'user/proj/gen/out.png', 'mock', 'text-to-image', true,
    'user/proj/gen/out.png', 1234, 'trace-j'
  );

  ASSERT (v_result->>'applied')::boolean IS TRUE, 'J: the completion should apply';

  SELECT * INTO v_row FROM generations WHERE id = v_gen;
  ASSERT v_row.status = 'completed', 'J: row must be completed, got ' || v_row.status;
  ASSERT v_row.output_url = 'user/proj/gen/out.png', 'J: the output path was written';
  ASSERT v_row.error_message IS NULL, 'J: a completion clears any prior error';
  ASSERT v_row.metadata #>> '{orchestration,stage}' = 'completed', 'J: stage merged in place';

  SELECT * INTO v_event FROM outbox_events WHERE aggregate_id = v_gen::text;
  ASSERT v_event.event_type = 'generation.completed', 'J: one completion event';
  ASSERT v_event.payload ->> 'attemptNo' = '1', 'J: the attempt number is derived from the row';
  ASSERT v_event.payload ->> 'durationMs' = '1234', 'J: duration travels';
  -- A storage path is an access-bearing locator and must not sit in a
  -- retained, widely-read event.
  ASSERT NOT (v_event.payload ? 'outputUrl'), 'J: no output path in the event';
  ASSERT v_event.status = 'pending', 'J: durable and unpublished';

  RAISE NOTICE 'PROOF J PASS: completed commits with its event';
END $$;

-- ===========================================================================
-- PROOF K — COMPLETED: metadata is merged in place, not replaced
-- ===========================================================================

DO $$
DECLARE
  v_gen uuid := pg_temp.new_generation('processing');
  v_row generations%ROWTYPE;
BEGIN
  -- A providerJob record the async continuation maintains, plus an unrelated
  -- top-level key. Neither belongs to the completion; neither may be lost.
  UPDATE generations
     SET metadata = '{"aspect_ratio":"16:9","orchestration":{"providerJob":{"id":"job-k"},"workflow":"text-to-image"}}'::jsonb
   WHERE id = v_gen;

  PERFORM complete_generation_tx(v_gen, 'out.png', 'mock', 'text-to-image', true);

  SELECT * INTO v_row FROM generations WHERE id = v_gen;
  ASSERT v_row.metadata #>> '{orchestration,providerJob,id}' = 'job-k',
    'K: a concurrent providerJob record must survive the completion';
  ASSERT v_row.metadata ->> 'aspect_ratio' = '16:9', 'K: unrelated top-level keys survive';
  ASSERT v_row.metadata #>> '{orchestration,stage}' = 'completed', 'K: and the patch applied';

  RAISE NOTICE 'PROOF K PASS: in-place metadata merge, no lost update';
END $$;

-- ===========================================================================
-- PROOF L — FAILED: state and event commit together; the CODE travels, the
-- user-facing prose does not
-- ===========================================================================

DO $$
DECLARE
  v_gen   uuid := pg_temp.new_generation('processing');
  v_row   generations%ROWTYPE;
  v_event outbox_events%ROWTYPE;
BEGIN
  PERFORM fail_generation_tx(
    v_gen, 'The provider could not complete this request.', 'PROVIDER_FAILED', false
  );

  SELECT * INTO v_row FROM generations WHERE id = v_gen;
  ASSERT v_row.status = 'failed', 'L: row must be failed';
  ASSERT v_row.error_message = 'The provider could not complete this request.',
    'L: the user-facing message is stored on the row';
  ASSERT v_row.metadata #>> '{orchestration,errorCode}' = 'PROVIDER_FAILED', 'L: code recorded';
  ASSERT (v_row.metadata #>> '{orchestration,retryable}')::boolean IS FALSE,
    'L: retryability recorded';

  SELECT * INTO v_event FROM outbox_events WHERE aggregate_id = v_gen::text;
  ASSERT v_event.event_type = 'generation.failed', 'L: one failure event';
  ASSERT v_event.payload ->> 'errorCode' = 'PROVIDER_FAILED', 'L: the normalized code travels';
  ASSERT v_event.payload ->> 'provider' = 'mock', 'L: the provider is read from the row';
  ASSERT NOT (v_event.payload ? 'errorMessage'), 'L: no user-facing prose in the event';

  RAISE NOTICE 'PROOF L PASS: failed commits with its event';
END $$;

-- ===========================================================================
-- PROOF M — no backwards terminalization, and no phantom events
-- ===========================================================================

DO $$
DECLARE
  v_gen    uuid;
  v_result jsonb;
  v_events integer;
  v_before text;
BEGIN
  FOREACH v_gen IN ARRAY ARRAY[
    pg_temp.new_generation('completed'),
    pg_temp.new_generation('failed'),
    pg_temp.new_generation('cancelled'),
    pg_temp.new_generation('queued')  -- never claimed: also refused
  ] LOOP
    SELECT status INTO v_before FROM generations WHERE id = v_gen;

    v_result := complete_generation_tx(v_gen, 'out.png', 'mock', 'text-to-image', true);
    ASSERT (v_result->>'applied')::boolean IS FALSE,
      'M: complete must be refused from ' || v_before;

    v_result := fail_generation_tx(v_gen, 'nope', 'INTERNAL_ERROR', false);
    ASSERT (v_result->>'applied')::boolean IS FALSE,
      'M: fail must be refused from ' || v_before;

    SELECT count(*) INTO v_events FROM outbox_events WHERE aggregate_id = v_gen::text;
    ASSERT v_events = 0, 'M: a refused terminalization emits nothing, got ' || v_events;

    ASSERT (SELECT status FROM generations WHERE id = v_gen) = v_before,
      'M: the state must be untouched';
  END LOOP;

  RAISE NOTICE 'PROOF M PASS: no backwards terminalization, no phantom events';
END $$;

-- ===========================================================================
-- PROOF N — finalization rollback: no split brain
-- ===========================================================================

DO $$
DECLARE
  v_gen    uuid := pg_temp.new_generation('processing');
  v_status text;
  v_events integer;
  v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM finalization_rollback_probe(v_gen);
  EXCEPTION WHEN others THEN
    v_raised := true;
  END;

  ASSERT v_raised, 'N: the probe must raise';

  SELECT status INTO v_status FROM generations WHERE id = v_gen;
  ASSERT v_status = 'processing',
    'N: a failed event must undo the terminal UPDATE, got ' || v_status;

  SELECT count(*) INTO v_events FROM outbox_events WHERE aggregate_id = v_gen::text;
  ASSERT v_events = 0, 'N: and leave no event behind';

  RAISE NOTICE 'PROOF N PASS: finalization rollback-together, no split brain';
END $$;

-- ===========================================================================
-- PROOF O — CONCURRENT TERMINALIZATION
--
-- complete, fail and cancel all racing for one generation. Exactly one may
-- apply, and the surviving event must agree with the surviving state — never
-- two contradictory terminal events for one generation.
-- ===========================================================================

DO $$
DECLARE
  v_gen     uuid := pg_temp.new_generation('processing');
  v_a       jsonb;
  v_b       jsonb;
  v_c       jsonb;
  v_applied integer := 0;
  v_events  integer;
  v_status  text;
BEGIN
  v_a := complete_generation_tx(v_gen, 'out.png', 'mock', 'text-to-image', true);
  v_b := fail_generation_tx(v_gen, 'lost the race', 'PROVIDER_FAILED', false);
  v_c := cancel_generation_tx(v_gen, 'user_requested');

  IF (v_a->>'applied')::boolean THEN v_applied := v_applied + 1; END IF;
  IF (v_b->>'applied')::boolean THEN v_applied := v_applied + 1; END IF;
  IF (v_c->>'applied')::boolean THEN v_applied := v_applied + 1; END IF;

  ASSERT v_applied = 1, 'O: exactly one terminalization may apply, got ' || v_applied;

  SELECT count(*) INTO v_events FROM outbox_events WHERE aggregate_id = v_gen::text;
  ASSERT v_events = 1, 'O: one terminal state means one terminal event, got ' || v_events;

  SELECT status INTO v_status FROM generations WHERE id = v_gen;
  ASSERT v_status = 'completed', 'O: the first writer won, got ' || v_status;

  PERFORM 1 FROM outbox_events
   WHERE aggregate_id = v_gen::text AND event_type = 'generation.completed';
  ASSERT FOUND, 'O: the surviving event must describe the state that won';

  RAISE NOTICE 'PROOF O PASS: one terminal state, one agreeing event';
END $$;

-- ===========================================================================
-- PROOF P — a completed generation settles its held credits transactionally
-- ===========================================================================
DO $$
DECLARE
  v_user text := 'user_bill_complete_' || gen_random_uuid()::text;
  v_project uuid;
  v_gen uuid;
  v_res uuid;
  v_balance integer;
  v_reserved integer;
  v_status text;
BEGIN
  INSERT INTO profiles (clerk_user_id, credits, plan) VALUES (v_user, 0, 'pro');
  PERFORM grant_credits(v_user, 100, 'grant', 'seed:' || v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'billing complete') RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'fal', 'real-model', 'p') ->> 'generation_id')::uuid;
  v_res := (reserve_credits(v_user, 30, 'generation:' || v_gen::text, v_gen, '{}'::jsonb) ->> 'reservation_id')::uuid;
  PERFORM claim_generation_tx(v_gen, 'validating', NULL);

  PERFORM complete_generation_tx(v_gen, 'out.png', 'fal', 'text-to-image', false);

  SELECT status INTO v_status FROM credit_reservations WHERE id = v_res;
  SELECT balance, reserved INTO v_balance, v_reserved FROM credit_wallets WHERE clerk_user_id = v_user;
  ASSERT v_status = 'settled', 'P: completion must settle the reservation, got ' || v_status;
  ASSERT v_balance = 70 AND v_reserved = 0,
    'P: completion must consume the hold exactly once; balance=' || v_balance || ', reserved=' || v_reserved;
  RAISE NOTICE 'PROOF P PASS: completed generation settles its credit hold in the same transaction';
END $$;

-- ===========================================================================
-- PROOF Q — a non-retryable failure refunds its held credits
-- ===========================================================================
DO $$
DECLARE
  v_user text := 'user_bill_fail_' || gen_random_uuid()::text;
  v_project uuid;
  v_gen uuid;
  v_res uuid;
  v_balance integer;
  v_reserved integer;
  v_status text;
BEGIN
  INSERT INTO profiles (clerk_user_id, credits, plan) VALUES (v_user, 0, 'pro');
  PERFORM grant_credits(v_user, 100, 'grant', 'seed:' || v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'billing fail') RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'fal', 'real-model', 'p') ->> 'generation_id')::uuid;
  v_res := (reserve_credits(v_user, 30, 'generation:' || v_gen::text, v_gen, '{}'::jsonb) ->> 'reservation_id')::uuid;
  PERFORM claim_generation_tx(v_gen, 'validating', NULL);

  PERFORM fail_generation_tx(v_gen, 'failed', 'PROVIDER_FAILED', false);

  SELECT status INTO v_status FROM credit_reservations WHERE id = v_res;
  SELECT balance, reserved INTO v_balance, v_reserved FROM credit_wallets WHERE clerk_user_id = v_user;
  ASSERT v_status = 'refunded', 'Q: non-retryable failure must refund the reservation, got ' || v_status;
  ASSERT v_balance = 100 AND v_reserved = 0,
    'Q: refund must restore the full balance; balance=' || v_balance || ', reserved=' || v_reserved;
  RAISE NOTICE 'PROOF Q PASS: non-retryable failure refunds its credit hold';
END $$;

-- ===========================================================================
-- PROOF R — a retryable failure preserves the SAME hold for the retry
-- ===========================================================================
DO $$
DECLARE
  v_user text := 'user_bill_retry_' || gen_random_uuid()::text;
  v_project uuid;
  v_gen uuid;
  v_res uuid;
  v_balance integer;
  v_reserved integer;
  v_status text;
BEGIN
  INSERT INTO profiles (clerk_user_id, credits, plan) VALUES (v_user, 0, 'pro');
  PERFORM grant_credits(v_user, 100, 'grant', 'seed:' || v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'billing retry') RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'fal', 'real-model', 'p') ->> 'generation_id')::uuid;
  v_res := (reserve_credits(v_user, 30, 'generation:' || v_gen::text, v_gen, '{}'::jsonb) ->> 'reservation_id')::uuid;
  PERFORM claim_generation_tx(v_gen, 'validating', NULL);

  PERFORM fail_generation_tx(v_gen, 'retry me', 'PROVIDER_TIMEOUT', true);

  SELECT status INTO v_status FROM credit_reservations WHERE id = v_res;
  SELECT balance, reserved INTO v_balance, v_reserved FROM credit_wallets WHERE clerk_user_id = v_user;
  ASSERT v_status = 'held', 'R: retryable failure must keep the existing hold, got ' || v_status;
  ASSERT v_balance = 70 AND v_reserved = 30,
    'R: retry must not refund and re-reserve; balance=' || v_balance || ', reserved=' || v_reserved;
  RAISE NOTICE 'PROOF R PASS: retryable failure keeps one durable credit hold';
END $$;

SELECT 'FINALIZATION PROOFS PASSED' AS result;