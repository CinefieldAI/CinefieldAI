-- Cinefield Phase 6R-G — CONCURRENCY RACES, ON REAL POSTGRESQL.
--
-- Setup and invariant assertions for the races driven by run_pg_tests.sh.
-- The races themselves need multiple simultaneous CONNECTIONS, which SQL
-- cannot spawn; the runner launches them and this file asserts what must be
-- true afterwards.
--
-- WHY THE SPLIT MATTERS. A sequential test that calls a function twice
-- proves the function is idempotent when nothing is contending. It says
-- nothing about two workers hitting the same row at the same instant, which
-- is the only situation the locks and unique indexes exist for. Everything
-- below is asserted after genuine parallel contention.
--
-- Run via: supabase/tests/run_pg_tests.sh

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

TRUNCATE credit_ledger, credit_reservations, credit_wallets,
         outbox_events, generation_attempts, generations, projects, profiles CASCADE;

INSERT INTO profiles (clerk_user_id, plan, credits) VALUES ('user_race', 'pro', 1000);
INSERT INTO plan_limits (plan, max_concurrent_generations, monthly_credit_grant)
VALUES ('pro', 50, 0)
ON CONFLICT (plan) DO UPDATE SET max_concurrent_generations = 50;

INSERT INTO credit_wallets (clerk_user_id, balance, reserved) VALUES ('user_race', 1000, 0);

INSERT INTO projects (id, clerk_user_id, title)
VALUES ('33333333-3333-4333-8333-333333333333', 'user_race', 'race project');

-- A fixed generation id so parallel shell processes can all name the same one.
INSERT INTO generations (id, project_id, clerk_user_id, generation_type, provider, model, prompt, status)
VALUES ('44444444-4444-4444-8444-444444444444',
        '33333333-3333-4333-8333-333333333333', 'user_race',
        'image', 'mock', 'mock-image', 'race prompt', 'processing');

-- One pending attempt every racing worker will try to claim.
INSERT INTO generation_attempts (id, generation_id, attempt_no, provider, provider_model, status)
VALUES ('55555555-5555-4555-8555-555555555555',
        '44444444-4444-4444-8444-444444444444', 1, 'mock', 'mock-image-v1', 'pending');

-- Where each racing connection records what it observed.
DROP TABLE IF EXISTS race_results;
CREATE TABLE race_results (
  race     text    NOT NULL,
  worker   integer NOT NULL,
  outcome  text,
  detail   text,
  recorded timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- claim_attempt_race() — the application's B3 gate, as one atomic statement
-- ---------------------------------------------------------------------------
-- Mirrors claimAttemptForSubmission()'s predicate exactly: pending, no
-- evidence, no job id. Wrapped as a function purely so a shell-launched
-- connection can call it in one round trip; the UPDATE is the same one the
-- application issues.
CREATE OR REPLACE FUNCTION public.claim_attempt_race(p_attempt_id uuid, p_worker integer)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_claimed uuid;
BEGIN
  UPDATE generation_attempts
     SET status = 'claimed'
   WHERE id = p_attempt_id
     AND status = 'pending'
     AND submission_evidence = 'none'
     AND provider_job_id IS NULL
  RETURNING id INTO v_claimed;

  INSERT INTO race_results (race, worker, outcome)
  VALUES ('attempt_claim', p_worker, CASE WHEN v_claimed IS NULL THEN 'lost' ELSE 'won' END);

  RETURN CASE WHEN v_claimed IS NULL THEN 'lost' ELSE 'won' END;
END;
$$;

-- Records a credit call's outcome without letting an expected business
-- failure (insufficient funds, concurrency limit) abort the racing session.
CREATE OR REPLACE FUNCTION public.reserve_race(
  p_worker integer, p_key text, p_amount integer, p_generation uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  v := reserve_credits('user_race', p_amount, p_key, p_generation, '{}'::jsonb);
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('reserve', p_worker,
          CASE WHEN (v->>'replayed')::boolean THEN 'replayed' ELSE 'created' END,
          v->>'reservation_id');
EXCEPTION WHEN others THEN
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('reserve', p_worker, 'rejected', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_race(p_worker integer, p_reservation uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  v := settle_reservation(p_reservation, NULL);
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('settle', p_worker,
          CASE WHEN (v->>'replayed')::boolean THEN 'replayed' ELSE 'settled' END,
          v->>'status');
EXCEPTION WHEN others THEN
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('settle', p_worker, 'rejected', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_or_refund_race(
  p_worker integer, p_reservation uuid, p_mode text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  IF p_mode = 'settle' THEN
    v := settle_reservation(p_reservation, NULL);
  ELSE
    v := refund_reservation(p_reservation, 'generation_failed');
  END IF;
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('settle_vs_refund', p_worker, p_mode || ':' || COALESCE(v->>'status', '?'),
          COALESCE(v->>'replayed', 'false'));
EXCEPTION WHEN others THEN
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('settle_vs_refund', p_worker, p_mode || ':rejected', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.terminal_race(p_worker integer, p_generation uuid, p_mode text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  IF p_mode = 'complete' THEN
    v := complete_generation_tx(p_generation, 'race/out.png', 'mock', 'text-to-image', true);
  ELSIF p_mode = 'fail' THEN
    v := fail_generation_tx(p_generation, 'race', 'PROVIDER_FAILED', false);
  ELSE
    v := cancel_generation_tx(p_generation, 'user_requested');
  END IF;
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('terminal', p_worker, p_mode,
          CASE WHEN (v->>'applied')::boolean THEN 'applied' ELSE 'refused' END);
EXCEPTION WHEN others THEN
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('terminal', p_worker, p_mode, 'error:' || SQLERRM);
END;
$$;

/**
 * The CREATION side of a duplicate endpoint request (Phase 5 convergence).
 *
 * Calls the real create_generation_tx, which is what POST /api/generate now
 * uses. Six concurrent callers with the same idempotency key must produce ONE
 * generation — decided by generations_user_idempotency_uniq, not by ordering.
 */
CREATE OR REPLACE FUNCTION public.create_generation_race(
  p_worker integer, p_key text, p_prompt text DEFAULT 'canonical race prompt'
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  v := create_generation_tx(
    'user_race',
    '33333333-3333-4333-8333-333333333333',
    'image', 'mock', 'mock-image',
    p_prompt,
    '{}'::jsonb, NULL, NULL,
    p_key,
    md5(p_prompt)
  );
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('create_generation', p_worker,
          CASE WHEN (v->>'created')::boolean THEN 'created' ELSE 'replayed' END,
          v->>'generation_id');
EXCEPTION WHEN others THEN
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('create_generation', p_worker, 'rejected', SQLERRM);
END;
$$;

SELECT 'RACE FIXTURES READY' AS result;

-- ---------------------------------------------------------------------------
-- Phase 5 / 6R-H closure races
-- ---------------------------------------------------------------------------

-- A generation the endpoint race will contend over.
INSERT INTO generations (id, project_id, clerk_user_id, generation_type, provider, model, prompt, status)
VALUES ('77777777-7777-4777-8777-777777777777',
        '33333333-3333-4333-8333-333333333333', 'user_race',
        'image', 'mock', 'mock-image', 'endpoint race', 'queued');

-- And one for the duplicate-cancel race.
INSERT INTO generations (id, project_id, clerk_user_id, generation_type, provider, model, prompt, status)
VALUES ('88888888-8888-4888-8888-888888888888',
        '33333333-3333-4333-8333-333333333333', 'user_race',
        'image', 'mock', 'mock-image', 'cancel race', 'processing');

/**
 * The ATTEMPT side of a duplicate endpoint request.
 *
 * Two concurrent POSTs for the same generation both reach ensureAttempt,
 * whose insert is guarded by generation_attempts_one_active_uniq. Only one
 * may open an attempt; the other must find the existing one. This is the
 * database half of "one logical request, one generation" — the Temporal half
 * is the deterministic workflow id, which cannot be raced from SQL.
 */
CREATE OR REPLACE FUNCTION public.ensure_attempt_race(p_worker integer, p_generation uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM generation_attempts
   WHERE generation_id = p_generation
     AND status IN ('pending','claimed','submitting','submitted','processing');

  IF FOUND THEN
    INSERT INTO race_results (race, worker, outcome, detail)
    VALUES ('ensure_attempt', p_worker, 'reused', v_id::text);
    RETURN;
  END IF;

  INSERT INTO generation_attempts (generation_id, attempt_no, provider, provider_model, status)
  VALUES (p_generation, 1, 'mock', 'mock-image-v1', 'pending')
  RETURNING id INTO v_id;

  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('ensure_attempt', p_worker, 'created', v_id::text);
EXCEPTION WHEN unique_violation THEN
  -- The index decided the race. Report the attempt that actually exists.
  SELECT id INTO v_id FROM generation_attempts
   WHERE generation_id = p_generation
     AND status IN ('pending','claimed','submitting','submitted','processing');
  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('ensure_attempt', p_worker, 'reused', v_id::text);
END;
$$;

/**
 * Duplicate cancel intent, mirroring recordCancelIntent's compare-and-set:
 * write the intent only from a non-terminal state, and never restamp one
 * that already exists.
 */
CREATE OR REPLACE FUNCTION public.cancel_intent_race(p_worker integer, p_generation uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_applied uuid; v_existing text;
BEGIN
  SELECT metadata #>> '{orchestration,cancelRequested,requestedAt}' INTO v_existing
    FROM generations WHERE id = p_generation;

  IF v_existing IS NOT NULL THEN
    INSERT INTO race_results (race, worker, outcome, detail)
    VALUES ('cancel_intent', p_worker, 'already', v_existing);
    RETURN;
  END IF;

  -- One-level path plus a merge. A two-level jsonb_set path does NOT create
  -- the intermediate object, so on a generation with empty metadata the
  -- write silently did nothing and every racer's guard kept passing.
  UPDATE generations
     SET metadata = jsonb_set(
                      COALESCE(metadata, '{}'::jsonb),
                      '{orchestration}',
                      COALESCE(metadata -> 'orchestration', '{}'::jsonb)
                        || jsonb_build_object(
                             'cancelRequested',
                             jsonb_build_object(
                               'requestedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                               'reason', 'user_requested',
                               'worker', p_worker
                             )
                           ),
                      true
                    )
   WHERE id = p_generation
     AND status IN ('queued','processing')
     AND metadata #>> '{orchestration,cancelRequested,requestedAt}' IS NULL
  RETURNING id INTO v_applied;

  INSERT INTO race_results (race, worker, outcome, detail)
  VALUES ('cancel_intent', p_worker,
          CASE WHEN v_applied IS NULL THEN 'already' ELSE 'recorded' END, NULL);
END;
$$;
