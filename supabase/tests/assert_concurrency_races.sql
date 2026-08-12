-- Cinefield Phase 6R-G — invariant assertions after the real parallel races.
--
-- Every assertion here follows genuine multi-connection contention driven by
-- run_pg_tests.sh. Nothing is asserted about ORDERING, because ordering under
-- contention is not deterministic and pretending otherwise would produce a
-- flaky test that teaches nothing. What is asserted is the invariant: how
-- many winners, how much money moved, which state survived.

\set ON_ERROR_STOP on

-- ===========================================================================
-- G4 — PROVIDER ATTEMPT CLAIM RACE
-- ===========================================================================

DO $$
DECLARE
  v_workers integer;
  v_won     integer;
  v_status  text;
BEGIN
  SELECT count(*) INTO v_workers FROM race_results WHERE race = 'attempt_claim';
  ASSERT v_workers >= 4,
    'G4: expected several racing connections, got ' || v_workers;

  SELECT count(*) INTO v_won FROM race_results WHERE race = 'attempt_claim' AND outcome = 'won';
  ASSERT v_won = 1,
    'G4: exactly one worker may win the claim, got ' || v_won || ' of ' || v_workers;

  -- Every loser got a deterministic answer, not an error.
  ASSERT NOT EXISTS (
    SELECT 1 FROM race_results WHERE race = 'attempt_claim' AND outcome NOT IN ('won', 'lost')
  ), 'G4: a loser must receive a deterministic outcome, never an exception';

  SELECT status INTO v_status FROM generation_attempts
   WHERE id = '55555555-5555-4555-8555-555555555555';
  ASSERT v_status = 'claimed', 'G4: the attempt is claimed exactly once, got ' || v_status;

  RAISE NOTICE 'PROOF P PASS: attempt claim race — one winner, % losers', v_workers - 1;
END $$;

-- ===========================================================================
-- G4b — THE DATABASE BACKSTOP BEHIND THE CLAIM
--
-- Even if the application predicate were wrong, the partial unique index
-- refuses a second ACTIVE attempt for one generation.
-- ===========================================================================

DO $$
DECLARE v_raised boolean := false;
BEGIN
  BEGIN
    INSERT INTO generation_attempts (generation_id, attempt_no, provider, provider_model, status)
    VALUES ('44444444-4444-4444-8444-444444444444', 2, 'mock', 'mock-image-v1', 'pending');
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  ASSERT v_raised,
    'G4b: generation_attempts_one_active_uniq must refuse a second active attempt';
  RAISE NOTICE 'PROOF Q PASS: one-active-attempt index holds under a real insert';
END $$;

-- ===========================================================================
-- G9-A — DUPLICATE CREDIT RESERVE UNDER CONTENTION
-- ===========================================================================

DO $$
DECLARE
  v_workers  integer;
  v_created  integer;
  v_rows     integer;
  v_ledger   integer;
  v_wallet   credit_wallets%ROWTYPE;
  v_distinct integer;
BEGIN
  SELECT count(*) INTO v_workers FROM race_results WHERE race = 'reserve';
  ASSERT v_workers >= 4, 'G9-A: expected several racing reserves, got ' || v_workers;

  -- Nothing may be rejected: every caller either created the reservation or
  -- was told it already existed.
  ASSERT NOT EXISTS (
    SELECT 1 FROM race_results WHERE race = 'reserve' AND outcome = 'rejected'
  ), 'G9-A: a concurrent duplicate must replay, never surface a constraint error';

  SELECT count(*) INTO v_created FROM race_results WHERE race = 'reserve' AND outcome = 'created';
  ASSERT v_created = 1, 'G9-A: exactly one reservation may be created, got ' || v_created;

  -- And every caller was handed the SAME reservation id.
  SELECT count(DISTINCT detail) INTO v_distinct FROM race_results WHERE race = 'reserve';
  ASSERT v_distinct = 1,
    'G9-A: all callers must receive one reservation id, got ' || v_distinct;

  SELECT count(*) INTO v_rows FROM credit_reservations WHERE clerk_user_id = 'user_race';
  ASSERT v_rows = 1, 'G9-A: one reservation row, got ' || v_rows;

  -- THE MONEY. Exactly one hold was taken, so exactly one debit happened.
  --
  -- Only the DEBIT is asserted here. The `reserved` counter is deliberately
  -- not: these assertions run after every race, and the settle race that
  -- follows legitimately releases the hold. G9-B asserts reserved = 0 at that
  -- point. Asserting a mid-flight value from the end of the run would be
  -- asserting a moment that no longer exists.
  SELECT * INTO v_wallet FROM credit_wallets WHERE clerk_user_id = 'user_race';
  ASSERT v_wallet.balance = 900,
    'G9-A: the balance must be debited exactly once (1000-100), got ' || v_wallet.balance;

  SELECT count(*) INTO v_ledger
    FROM credit_ledger WHERE clerk_user_id = 'user_race' AND entry_type = 'reserve';
  ASSERT v_ledger = 1, 'G9-A: one ledger entry, got ' || v_ledger;

  RAISE NOTICE 'PROOF R PASS: % concurrent reserves produced ONE hold and ONE debit', v_workers;
END $$;

-- ===========================================================================
-- G9-B/C — DUPLICATE SETTLE UNDER CONTENTION
--
-- The release-blocking invariant: max ONE billable settlement.
-- ===========================================================================

DO $$
DECLARE
  v_workers  integer;
  v_settled  integer;
  v_ledger   integer;
  v_wallet   credit_wallets%ROWTYPE;
  v_status   text;
BEGIN
  SELECT count(*) INTO v_workers FROM race_results WHERE race = 'settle';
  ASSERT v_workers >= 4, 'G9-B: expected several racing settles, got ' || v_workers;

  ASSERT NOT EXISTS (
    SELECT 1 FROM race_results WHERE race = 'settle' AND outcome = 'rejected'
  ), 'G9-B: a concurrent duplicate settle must be a no-op, never an error';

  SELECT count(*) INTO v_settled FROM race_results WHERE race = 'settle' AND outcome = 'settled';
  ASSERT v_settled = 1,
    'G9-B: MAX ONE BILLABLE SETTLEMENT — got ' || v_settled || ' effective settlements';

  SELECT count(*) INTO v_ledger
    FROM credit_ledger WHERE clerk_user_id = 'user_race' AND entry_type = 'settle';
  ASSERT v_ledger = 1, 'G9-C: exactly one settle ledger entry, got ' || v_ledger;

  SELECT status INTO v_status FROM credit_reservations WHERE clerk_user_id = 'user_race';
  ASSERT v_status = 'settled', 'G9-B: the reservation is settled, got ' || v_status;

  -- Settling releases the hold without touching the balance: the credits
  -- left at reserve time and do not come back.
  SELECT * INTO v_wallet FROM credit_wallets WHERE clerk_user_id = 'user_race';
  ASSERT v_wallet.balance = 900, 'G9-B: settle must not move the balance, got ' || v_wallet.balance;
  ASSERT v_wallet.reserved = 0, 'G9-B: the hold is released, got ' || v_wallet.reserved;

  RAISE NOTICE 'PROOF S PASS: % concurrent settles produced ONE billable settlement', v_workers;
END $$;

-- ===========================================================================
-- G9-E — SETTLE vs REFUND RACE
--
-- Both are economically meaningful and opposite. Exactly one may take effect.
-- ===========================================================================

DO $$
DECLARE
  v_effective integer;
  v_settle    integer;
  v_refund    integer;
  v_wallet    credit_wallets%ROWTYPE;
BEGIN
  SELECT count(*) INTO v_effective
    FROM race_results
   WHERE race = 'settle_vs_refund' AND detail = 'false' AND outcome NOT LIKE '%rejected%';
  ASSERT v_effective = 1,
    'G9-E: exactly one of settle/refund may take effect, got ' || v_effective;

  SELECT count(*) INTO v_settle
    FROM credit_ledger WHERE clerk_user_id = 'user_race2' AND entry_type = 'settle';
  SELECT count(*) INTO v_refund
    FROM credit_ledger WHERE clerk_user_id = 'user_race2' AND entry_type = 'refund';
  ASSERT v_settle + v_refund = 1,
    'G9-E: one financial outcome only, got settle=' || v_settle || ' refund=' || v_refund;

  -- The wallet must be internally consistent whichever way it went: a refund
  -- returns the credits, a settlement keeps them spent. Never both.
  SELECT * INTO v_wallet FROM credit_wallets WHERE clerk_user_id = 'user_race2';
  ASSERT v_wallet.reserved = 0, 'G9-E: the hold is resolved either way';
  ASSERT (v_refund = 1 AND v_wallet.balance = 1000) OR (v_settle = 1 AND v_wallet.balance = 900),
    'G9-E: the balance must match the outcome that won, got ' || v_wallet.balance;

  RAISE NOTICE 'PROOF T PASS: settle vs refund — exactly one economic effect';
END $$;

-- ===========================================================================
-- G9-F — INSUFFICIENT FUNDS UNDER CONTENTION (TOCTOU)
--
-- A wallet holding 100 with four concurrent reserves of 80. Without the
-- FOR UPDATE lock each could read "100 available" and all four would pass
-- affordability, overdrawing the wallet. Exactly one may succeed.
-- ===========================================================================

DO $$
DECLARE
  v_workers integer;
  v_created integer;
  v_wallet  credit_wallets%ROWTYPE;
BEGIN
  SELECT count(*) INTO v_workers FROM race_results WHERE race = 'overdraw';
  ASSERT v_workers >= 4, 'G9-F: expected several racing reserves, got ' || v_workers;

  SELECT count(*) INTO v_created FROM race_results WHERE race = 'overdraw' AND outcome = 'created';
  ASSERT v_created = 1,
    'G9-F: only one 80-credit hold fits in a 100-credit wallet, got ' || v_created;

  SELECT * INTO v_wallet FROM credit_wallets WHERE clerk_user_id = 'user_overdraw';
  ASSERT v_wallet.balance = 20,
    'G9-F: the wallet must not be overdrawn, got ' || v_wallet.balance;
  ASSERT v_wallet.balance >= 0, 'G9-F: the balance CHECK must never be violated';

  RAISE NOTICE 'PROOF U PASS: no TOCTOU overdraw across % concurrent reserves', v_workers;
END $$;

-- ===========================================================================
-- G11 — TERMINAL TRANSITION RACE, WITH THE EVENT
-- ===========================================================================

DO $$
DECLARE
  v_workers integer;
  v_applied integer;
  v_events  integer;
  v_status  text;
  v_kind    text;
BEGIN
  SELECT count(*) INTO v_workers FROM race_results WHERE race = 'terminal';
  ASSERT v_workers >= 3, 'G11: expected complete/fail/cancel racing, got ' || v_workers;

  SELECT count(*) INTO v_applied
    FROM race_results WHERE race = 'terminal' AND detail = 'applied';
  ASSERT v_applied = 1,
    'G11: exactly one terminal transition may apply, got ' || v_applied;

  ASSERT NOT EXISTS (
    SELECT 1 FROM race_results WHERE race = 'terminal' AND detail LIKE 'error:%'
  ), 'G11: a losing contender must be refused deterministically, never error';

  -- One terminal state, one event, and they agree.
  SELECT status INTO v_status FROM generations WHERE id = '66666666-6666-4666-8666-666666666666';
  ASSERT v_status IN ('completed', 'failed', 'cancelled'),
    'G11: the row must be terminal, got ' || v_status;

  SELECT count(*) INTO v_events
    FROM outbox_events WHERE aggregate_id = '66666666-6666-4666-8666-666666666666';
  ASSERT v_events = 1, 'G11: one terminal state means one event, got ' || v_events;

  SELECT event_type INTO v_kind
    FROM outbox_events WHERE aggregate_id = '66666666-6666-4666-8666-666666666666';
  ASSERT v_kind = 'generation.' || v_status,
    'G11: the surviving event must describe the surviving state — state=' || v_status
      || ' event=' || v_kind;

  RAISE NOTICE 'PROOF V PASS: terminal race — one state (%), one agreeing event', v_status;
END $$;

-- ===========================================================================
-- Y — the jsonb_set nesting fix (corrective migration 20260815000000)
--
-- Regression for a defect a concurrency test found: a two-level jsonb_set
-- path does not create intermediate objects, so cancelling a generation
-- whose metadata was still the '{}' default silently dropped the stage
-- marker. metadata = '{}' is the column DEFAULT, so this was the common case
-- for a generation cancelled before it ever started.
-- ===========================================================================

DO $$
DECLARE
  v_gen uuid;
  v_row generations%ROWTYPE;
BEGIN
  INSERT INTO generations
    (project_id, clerk_user_id, generation_type, provider, model, prompt, status, metadata)
  VALUES
    ('33333333-3333-4333-8333-333333333333', 'user_race', 'image', 'mock',
     'mock-image', 'empty metadata cancel', 'queued', '{}'::jsonb)
  RETURNING id INTO v_gen;

  PERFORM cancel_generation_tx(v_gen, 'user_requested');

  SELECT * INTO v_row FROM generations WHERE id = v_gen;
  ASSERT v_row.status = 'cancelled', 'Y: the cancellation applies';
  ASSERT v_row.metadata #>> '{orchestration,stage}' = 'cancelled',
    'Y: the stage marker must survive an empty starting metadata';

  -- And an EXISTING orchestration object is still merged, not replaced.
  INSERT INTO generations
    (project_id, clerk_user_id, generation_type, provider, model, prompt, status, metadata)
  VALUES
    ('33333333-3333-4333-8333-333333333333', 'user_race', 'image', 'mock',
     'mock-image', 'existing metadata cancel', 'processing',
     '{"orchestration":{"providerJob":{"id":"job-y"}}}'::jsonb)
  RETURNING id INTO v_gen;

  PERFORM cancel_generation_tx(v_gen, 'user_requested');

  SELECT * INTO v_row FROM generations WHERE id = v_gen;
  ASSERT v_row.metadata #>> '{orchestration,providerJob,id}' = 'job-y',
    'Y: existing provider job evidence must survive the cancellation';
  ASSERT v_row.metadata #>> '{orchestration,stage}' = 'cancelled', 'Y: and the marker applies';

  RAISE NOTICE 'PROOF Y PASS: cancel metadata merges at one level, creating and preserving';
END $$;

SELECT 'CONCURRENCY RACE PROOFS PASSED' AS result;

-- ===========================================================================
-- A8 — ENDPOINT-LEVEL DUPLICATE REQUEST (Phase 5)
--
-- Closes the gap 6R-G reported as blocked: concurrent duplicate requests for
-- one logical generation must not produce a second generation or a second
-- active attempt.
-- ===========================================================================

DO $$
DECLARE
  v_workers   integer;
  v_created   integer;
  v_distinct  integer;
  v_attempts  integer;
  v_gens      integer;
BEGIN
  SELECT count(*) INTO v_workers FROM race_results WHERE race = 'ensure_attempt';
  ASSERT v_workers >= 4, 'A8: expected several concurrent requests, got ' || v_workers;

  SELECT count(*) INTO v_created
    FROM race_results WHERE race = 'ensure_attempt' AND outcome = 'created';
  ASSERT v_created = 1,
    'A8: exactly one attempt may be opened for one logical request, got ' || v_created;

  SELECT count(DISTINCT detail) INTO v_distinct FROM race_results WHERE race = 'ensure_attempt';
  ASSERT v_distinct = 1,
    'A8: every concurrent request must converge on ONE attempt, got ' || v_distinct;

  SELECT count(*) INTO v_attempts
    FROM generation_attempts WHERE generation_id = '77777777-7777-4777-8777-777777777777';
  ASSERT v_attempts = 1, 'A8: one attempt row, got ' || v_attempts;

  -- And the generation itself was never duplicated.
  SELECT count(*) INTO v_gens
    FROM generations WHERE id = '77777777-7777-4777-8777-777777777777';
  ASSERT v_gens = 1, 'A8: SECOND_GENERATION_CREATED must be false';

  RAISE NOTICE 'PROOF W PASS: % concurrent requests -> ONE generation, ONE attempt', v_workers;
END $$;

-- ===========================================================================
-- C7 — CONCURRENT DUPLICATE CANCEL
-- ===========================================================================

DO $$
DECLARE
  v_workers  integer;
  v_recorded integer;
  v_status   text;
BEGIN
  SELECT count(*) INTO v_workers FROM race_results WHERE race = 'cancel_intent';
  ASSERT v_workers >= 4, 'C7: expected several concurrent cancels, got ' || v_workers;

  SELECT count(*) INTO v_recorded
    FROM race_results WHERE race = 'cancel_intent' AND outcome = 'recorded';
  ASSERT v_recorded = 1,
    'C7: exactly one cancel intent may be recorded, got ' || v_recorded;

  -- The intent exists exactly once, and the generation was NOT transitioned
  -- by the intent alone — Temporal decides when that is safe.
  ASSERT (SELECT metadata #>> '{orchestration,cancelRequested,requestedAt}'
            FROM generations WHERE id = '88888888-8888-4888-8888-888888888888') IS NOT NULL,
    'C7: the intent must be durable';

  SELECT status INTO v_status FROM generations WHERE id = '88888888-8888-4888-8888-888888888888';
  ASSERT v_status = 'processing',
    'C7: recording intent must not transition the generation, got ' || v_status;

  RAISE NOTICE 'PROOF X PASS: % concurrent cancels -> ONE durable intent', v_workers;
END $$;
