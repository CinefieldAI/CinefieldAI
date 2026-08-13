-- ===========================================================================
-- M6 — workflow-start reliability, proven by PostgreSQL rather than asserted
-- ===========================================================================
-- The application tests cover what the relay DOES with each Temporal outcome.
-- These cover what the database guarantees no matter how many relays run:
-- atomicity of intent creation, single-winner claims, lease recovery, and the
-- impossibility of a second intent.
-- ===========================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PROOF W1 — the generation and its start intent are ONE write
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_m6_' || gen_random_uuid()::text;
  v_project uuid;
  v_result jsonb;
  v_gen uuid;
  v_intents integer;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'm6') RETURNING id INTO v_project;

  v_result := create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image', 'p');
  v_gen := (v_result ->> 'generation_id')::uuid;

  SELECT count(*) INTO v_intents FROM workflow_start_outbox WHERE generation_id = v_gen;
  IF v_intents <> 1 THEN
    RAISE EXCEPTION 'PROOF W1 FAILED: expected exactly one start intent, found %', v_intents;
  END IF;

  PERFORM 1 FROM workflow_start_outbox
   WHERE generation_id = v_gen
     AND workflow_id = 'gen:' || v_gen::text
     AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROOF W1 FAILED: intent is not a pending, correctly-addressed row';
  END IF;

  RAISE NOTICE 'PROOF W1 PASS: generation + start intent committed together';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF W2 — a rolled-back creation leaves NEITHER
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_m6_rb_' || gen_random_uuid()::text;
  v_project uuid;
  v_before integer;
  v_after integer;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'm6rb') RETURNING id INTO v_project;

  SELECT count(*) INTO v_before FROM workflow_start_outbox;

  BEGIN
    -- A project that is not the caller's raises, aborting the whole function.
    PERFORM create_generation_tx(v_user, gen_random_uuid(), 'image', 'mock', 'mock-image', 'p');
    RAISE EXCEPTION 'PROOF W2 FAILED: creation should have been refused';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  SELECT count(*) INTO v_after FROM workflow_start_outbox;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'PROOF W2 FAILED: a refused creation left % orphan intent(s)', v_after - v_before;
  END IF;

  RAISE NOTICE 'PROOF W2 PASS: refused creation leaves no generation and no intent';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF W3 — an idempotent replay cannot produce a second intent
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_m6_idem_' || gen_random_uuid()::text;
  v_project uuid;
  v_first jsonb;
  v_second jsonb;
  v_gen uuid;
  v_intents integer;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'm6idem') RETURNING id INTO v_project;

  v_first  := create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image', 'p',
                                   '{}'::jsonb, NULL, NULL, 'idem-key-m6', 'hash');
  v_second := create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image', 'p',
                                   '{}'::jsonb, NULL, NULL, 'idem-key-m6', 'hash');

  v_gen := (v_first ->> 'generation_id')::uuid;

  IF (v_second ->> 'generation_id')::uuid <> v_gen THEN
    RAISE EXCEPTION 'PROOF W3 FAILED: replay produced a second generation';
  END IF;

  SELECT count(*) INTO v_intents FROM workflow_start_outbox WHERE generation_id = v_gen;
  IF v_intents <> 1 THEN
    RAISE EXCEPTION 'PROOF W3 FAILED: replay produced % intents', v_intents;
  END IF;

  RAISE NOTICE 'PROOF W3 PASS: one logical request -> one generation -> one start intent';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF W4 — claim is single-winner, and a claim-token mismatch cannot resolve
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_m6_claim_' || gen_random_uuid()::text;
  v_project uuid;
  v_gen uuid;
  v_token uuid;
  v_second_claim integer;
  v_ok boolean;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'm6claim') RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image', 'p')
            ->> 'generation_id')::uuid;

  SELECT claim_token INTO v_token
    FROM claim_workflow_start_intents(50, 300)
   WHERE generation_id = v_gen;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'PROOF W4 FAILED: first claim did not take the intent';
  END IF;

  -- A second relay, immediately: the lease has not elapsed, so it gets nothing.
  SELECT count(*) INTO v_second_claim
    FROM claim_workflow_start_intents(50, 300)
   WHERE generation_id = v_gen;
  IF v_second_claim <> 0 THEN
    RAISE EXCEPTION 'PROOF W4 FAILED: a leased intent was claimed twice';
  END IF;

  -- A stale relay holding the wrong token cannot resolve the row.
  v_ok := mark_workflow_start_delivered(v_gen, gen_random_uuid());
  IF v_ok THEN
    RAISE EXCEPTION 'PROOF W4 FAILED: a foreign claim token resolved the intent';
  END IF;

  -- The real holder can.
  v_ok := mark_workflow_start_delivered(v_gen, v_token);
  IF NOT v_ok THEN
    RAISE EXCEPTION 'PROOF W4 FAILED: the lease holder could not resolve its own row';
  END IF;

  PERFORM 1 FROM workflow_start_outbox
   WHERE generation_id = v_gen AND status = 'delivered' AND claim_token IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROOF W4 FAILED: delivered row did not release its claim';
  END IF;

  RAISE NOTICE 'PROOF W4 PASS: one winner per claim; only the lease holder resolves';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF W5 — a crashed relay's intent is recoverable, never stranded
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_m6_lease_' || gen_random_uuid()::text;
  v_project uuid;
  v_gen uuid;
  v_reclaimed integer;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'm6lease') RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image', 'p')
            ->> 'generation_id')::uuid;

  PERFORM claim_workflow_start_intents(50, 300);

  -- The relay dies here: the row stays 'starting' with a claim nobody holds.
  UPDATE workflow_start_outbox
     SET claimed_at = now() - interval '1 hour'
   WHERE generation_id = v_gen;

  SELECT count(*) INTO v_reclaimed
    FROM claim_workflow_start_intents(50, 120)
   WHERE generation_id = v_gen;

  IF v_reclaimed <> 1 THEN
    RAISE EXCEPTION 'PROOF W5 FAILED: an expired lease was not reclaimable';
  END IF;

  RAISE NOTICE 'PROOF W5 PASS: a crashed relay leaves recoverable work, not a stranded generation';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF W6 — a failed delivery returns to pending with backoff, never terminal
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_m6_fail_' || gen_random_uuid()::text;
  v_project uuid;
  v_gen uuid;
  v_token uuid;
  v_status text;
  v_available timestamptz;
  v_attempts integer;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'm6fail') RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image', 'p')
            ->> 'generation_id')::uuid;

  SELECT claim_token INTO v_token
    FROM claim_workflow_start_intents(50, 300) WHERE generation_id = v_gen;

  PERFORM mark_workflow_start_failed(v_gen, v_token, 'TransportError', 60);

  SELECT status, available_at, attempts INTO v_status, v_available, v_attempts
    FROM workflow_start_outbox WHERE generation_id = v_gen;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'PROOF W6 FAILED: a failed start became %, abandoning the generation', v_status;
  END IF;
  IF v_available <= now() THEN
    RAISE EXCEPTION 'PROOF W6 FAILED: no backoff was applied';
  END IF;
  IF v_attempts < 1 THEN
    RAISE EXCEPTION 'PROOF W6 FAILED: the attempt was not counted';
  END IF;

  -- Still owed, just not yet: a due-only claim must skip it.
  PERFORM 1 FROM claim_workflow_start_intents(50, 120) WHERE generation_id = v_gen;
  IF FOUND THEN
    RAISE EXCEPTION 'PROOF W6 FAILED: backoff was ignored by the claim';
  END IF;

  RAISE NOTICE 'PROOF W6 PASS: an undeliverable start stays owed, with backoff';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF W7 — a second intent for one generation is physically impossible
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_m6_uniq_' || gen_random_uuid()::text;
  v_project uuid;
  v_gen uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'm6uniq') RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image', 'p')
            ->> 'generation_id')::uuid;

  BEGIN
    INSERT INTO workflow_start_outbox (generation_id, workflow_id, clerk_user_id)
    VALUES (v_gen, 'gen:' || v_gen::text, v_user);
    RAISE EXCEPTION 'PROOF W7 FAILED: a second start intent was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PROOF W7 PASS: the primary key forbids a second start intent';
  END;
END $$;


-- ---------------------------------------------------------------------------
-- PROOF W8 — routing/attempt/credit invariants are untouched by this migration
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM 1 FROM pg_indexes WHERE indexname = 'generations_user_idempotency_uniq';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROOF W8 FAILED: generation idempotency index disappeared';
  END IF;

  PERFORM 1 FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'model_routes';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROOF W8 FAILED: routing tables disappeared';
  END IF;

  PERFORM 1 FROM pg_indexes WHERE indexname = 'credit_ledger_external_ref_type_uniq';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROOF W8 FAILED: credit ledger idempotency backstop disappeared';
  END IF;

  RAISE NOTICE 'PROOF W8 PASS: existing invariants intact and additive';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF W9 — administrative retirement is auditable and idempotent
-- ---------------------------------------------------------------------------
-- Retiring a stale generation must (a) reach a state the schema already
-- allows, (b) say WHY on the row, and (c) do nothing at all the second time.
DO $$
DECLARE
  v_user text := 'user_retire_' || gen_random_uuid()::text;
  v_project uuid;
  v_gen uuid;
  v_first jsonb;
  v_second jsonb;
  v_reason text;
  v_events integer;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'retire') RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image', 'p')
            ->> 'generation_id')::uuid;

  v_first := cancel_generation_tx(v_gen, 'stale_retired_never_submitted');
  IF (v_first ->> 'applied')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'PROOF W9 FAILED: retirement did not apply';
  END IF;

  SELECT metadata -> 'orchestration' ->> 'cancelReason' INTO v_reason
    FROM generations WHERE id = v_gen;
  IF v_reason IS DISTINCT FROM 'stale_retired_never_submitted' THEN
    RAISE EXCEPTION 'PROOF W9 FAILED: the reason was validated and then discarded (got %)', v_reason;
  END IF;

  PERFORM 1 FROM generations WHERE id = v_gen AND status = 'cancelled' AND completed_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROOF W9 FAILED: row did not reach the existing terminal state';
  END IF;

  SELECT count(*) INTO v_events FROM outbox_events
   WHERE aggregate_id = v_gen::text AND event_type = 'generation.cancelled';

  -- Replay.
  v_second := cancel_generation_tx(v_gen, 'stale_retired_never_submitted');
  IF (v_second ->> 'applied')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'PROOF W9 FAILED: a terminal row was transitioned a second time';
  END IF;

  IF (SELECT count(*) FROM outbox_events
       WHERE aggregate_id = v_gen::text AND event_type = 'generation.cancelled') <> v_events THEN
    RAISE EXCEPTION 'PROOF W9 FAILED: replay emitted a second event';
  END IF;

  RAISE NOTICE 'PROOF W9 PASS: retirement is terminal, auditable, and idempotent on replay';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF W10 — a reasonless cancellation is byte-identical to before
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user text := 'user_noreason_' || gen_random_uuid()::text;
  v_project uuid;
  v_gen uuid;
  v_has_key boolean;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, 'noreason') RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image', 'p')
            ->> 'generation_id')::uuid;

  PERFORM cancel_generation_tx(v_gen);

  SELECT (metadata -> 'orchestration') ? 'cancelReason' INTO v_has_key
    FROM generations WHERE id = v_gen;
  IF v_has_key THEN
    RAISE EXCEPTION 'PROOF W10 FAILED: a NULL reason left a key behind';
  END IF;

  RAISE NOTICE 'PROOF W10 PASS: reasonless cancellation unchanged by the fix';
END $$;
