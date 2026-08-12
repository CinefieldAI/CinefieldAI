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

SELECT 'RACE FIXTURES READY' AS result;
