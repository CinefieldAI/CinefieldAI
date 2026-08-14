-- ===========================================================================
-- PHASE 11 CLOSURE — the realtime delivery lane, proven by PostgreSQL
-- ===========================================================================
-- The application tests prove what the DISPATCHER decides. These prove what
-- the database guarantees before any dispatcher runs: that the two sinks are
-- genuinely independent, that a claim is exclusive, that a lost lease cannot
-- overwrite a new owner, and that a crash leaves recoverable debt.
--
-- Race fixtures live at the bottom.
-- ===========================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.mk_realtime_event(p_tag text, p_tenant text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_user text; v_project uuid; v_gen uuid; v_event uuid;
BEGIN
  IF p_tenant IS NULL THEN
    v_user := 'user_' || p_tag || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14);
    INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  ELSE
    v_user := p_tenant;
  END IF;

  INSERT INTO projects (clerk_user_id, title) VALUES (v_user, p_tag) RETURNING id INTO v_project;
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image',
            'p', '{}'::jsonb, NULL, NULL, 'idem-' || p_tag || '-key', 'h')->>'generation_id')::uuid;

  SELECT event_id INTO v_event FROM outbox_events
   WHERE aggregate_id = v_gen::text AND event_type = 'generation.created';
  RETURN v_event;
END;
$fn$;


-- ---------------------------------------------------------------------------
-- PROOF RD1 — the two sinks are genuinely independent
-- ---------------------------------------------------------------------------
-- THE BLOCKER THIS LANE EXISTS TO REMOVE. Finishing one sink must leave the
-- other still owed. If this ever fails, one destination is silently
-- suppressing the other.
DO $$
DECLARE v_event uuid; v_kafka text; v_realtime text; v_claim uuid;
BEGIN
  v_event := mk_realtime_event('rd1');

  -- Kafka drains it.
  PERFORM claim_outbox_events(100, 300);
  SELECT claim_token INTO v_claim FROM outbox_events WHERE event_id = v_event;
  PERFORM mark_outbox_event_published(v_event, v_claim);

  SELECT status, realtime_status INTO v_kafka, v_realtime
    FROM outbox_events WHERE event_id = v_event;

  ASSERT v_kafka = 'published', 'RD1: kafka lane should be published, is ' || v_kafka;
  ASSERT v_realtime = 'pending',
    'RD1: realtime lane must STILL be owed after kafka published, is ' || v_realtime;

  -- And the realtime claim can still see it — the whole point.
  ASSERT EXISTS (SELECT 1 FROM claim_realtime_outbox_events(100, 60) c WHERE c.event_id = v_event),
    'RD1: a kafka-published row became invisible to the realtime claim';

  RAISE NOTICE 'PROOF RD1 PASS: kafka completion does not suppress realtime delivery';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF RD2 — and the reverse
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_token uuid; v_kafka text; v_realtime text;
BEGIN
  v_event := mk_realtime_event('rd2');

  SELECT c.realtime_claim_token INTO v_token
    FROM claim_realtime_outbox_events(100, 60) c WHERE c.event_id = v_event;
  ASSERT v_token IS NOT NULL, 'RD2: fixture was not claimed';
  ASSERT resolve_realtime_outbox_event(v_event, v_token, 'published'), 'RD2: resolve failed';

  SELECT status, realtime_status INTO v_kafka, v_realtime
    FROM outbox_events WHERE event_id = v_event;
  ASSERT v_realtime = 'done', 'RD2: realtime lane is ' || v_realtime;
  ASSERT v_kafka = 'pending', 'RD2: kafka lane must still be owed, is ' || v_kafka;

  ASSERT EXISTS (SELECT 1 FROM claim_outbox_events(100, 300) c WHERE c.event_id = v_event),
    'RD2: a realtime-published row became invisible to the kafka claim';

  RAISE NOTICE 'PROOF RD2 PASS: realtime completion does not suppress kafka delivery';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF RD3 — a claim is exclusive, and a second claimer sees nothing
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_first integer; v_second integer;
BEGIN
  v_event := mk_realtime_event('rd3');

  SELECT count(*) INTO v_first FROM claim_realtime_outbox_events(100, 60) c
   WHERE c.event_id = v_event;
  ASSERT v_first = 1, 'RD3: first claim did not take the row';

  -- Same transaction, lease still live: the row is 'dispatching' and its
  -- claimed_at is now, so the expiry branch cannot match either.
  SELECT count(*) INTO v_second FROM claim_realtime_outbox_events(100, 60) c
   WHERE c.event_id = v_event;
  ASSERT v_second = 0, 'RD3: a live lease was re-claimed';

  RAISE NOTICE 'PROOF RD3 PASS: a live lease is not re-claimable';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF RD4 — a crashed dispatcher's lease expires and the debt recovers
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_recovered integer; v_attempts integer;
BEGIN
  v_event := mk_realtime_event('rd4');
  PERFORM claim_realtime_outbox_events(100, 60);

  -- The dispatcher died: nothing resolved, nothing released. Age the claim
  -- past its lease, which wall-clock does on its own.
  UPDATE outbox_events SET realtime_claimed_at = now() - interval '10 minutes'
   WHERE event_id = v_event;

  SELECT count(*) INTO v_recovered FROM claim_realtime_outbox_events(100, 60) c
   WHERE c.event_id = v_event;
  ASSERT v_recovered = 1, 'RD4: an expired lease was not recoverable';

  SELECT realtime_attempts INTO v_attempts FROM outbox_events WHERE event_id = v_event;
  ASSERT v_attempts = 2, 'RD4: attempts should count both claims, got ' || v_attempts;

  RAISE NOTICE 'PROOF RD4 PASS: a crash leaves recoverable debt, and the attempt is counted';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF RD5 — only the current lease owner may finish the row
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_stale uuid; v_fresh uuid; v_status text; v_disp text;
BEGIN
  v_event := mk_realtime_event('rd5');

  SELECT c.realtime_claim_token INTO v_stale
    FROM claim_realtime_outbox_events(100, 60) c WHERE c.event_id = v_event;

  -- The lease expires and another dispatcher takes over.
  UPDATE outbox_events SET realtime_claimed_at = now() - interval '10 minutes'
   WHERE event_id = v_event;
  SELECT c.realtime_claim_token INTO v_fresh
    FROM claim_realtime_outbox_events(100, 60) c WHERE c.event_id = v_event;
  ASSERT v_fresh IS DISTINCT FROM v_stale, 'RD5: the second claim reused the token';

  -- The zombie returns and tries to finish work it no longer owns.
  ASSERT NOT resolve_realtime_outbox_event(v_event, v_stale, 'published'),
    'RD5: a stale owner resolved the row';
  ASSERT NOT release_realtime_outbox_event(v_event, v_stale, 'realtime_transport'),
    'RD5: a stale owner released the row';

  SELECT realtime_status, realtime_disposition INTO v_status, v_disp
    FROM outbox_events WHERE event_id = v_event;
  ASSERT v_status = 'dispatching', 'RD5: the new owner lost its claim, status ' || v_status;
  ASSERT v_disp IS NULL, 'RD5: a disposition was written by a stale owner';

  -- The rightful owner still can.
  ASSERT resolve_realtime_outbox_event(v_event, v_fresh, 'published'), 'RD5: the owner could not resolve';

  RAISE NOTICE 'PROOF RD5 PASS: claim-token verification refuses a stale dispatcher';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF RD6 — a released row is owed again, never marked delivered
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_token uuid; v_status text; v_disp text; v_err text;
BEGIN
  v_event := mk_realtime_event('rd6');
  SELECT c.realtime_claim_token INTO v_token
    FROM claim_realtime_outbox_events(100, 60) c WHERE c.event_id = v_event;

  ASSERT release_realtime_outbox_event(v_event, v_token, 'realtime_transport'), 'RD6: release failed';

  SELECT realtime_status, realtime_disposition, realtime_last_error_code
    INTO v_status, v_disp, v_err FROM outbox_events WHERE event_id = v_event;

  ASSERT v_status = 'pending', 'RD6: a transport failure must return the row, status ' || v_status;
  ASSERT v_disp IS NULL, 'RD6: a released row must carry no disposition';
  ASSERT v_err = 'realtime_transport', 'RD6: the error class must be recorded';

  ASSERT EXISTS (SELECT 1 FROM claim_realtime_outbox_events(100, 60) c WHERE c.event_id = v_event),
    'RD6: a released row was not re-claimable';

  RAISE NOTICE 'PROOF RD6 PASS: a transport failure leaves recoverable debt, never a delivery';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF RD7 — dispositions are constrained, and a done row is fully written
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_token uuid;
BEGIN
  v_event := mk_realtime_event('rd7');
  SELECT c.realtime_claim_token INTO v_token
    FROM claim_realtime_outbox_events(100, 60) c WHERE c.event_id = v_event;

  BEGIN
    PERFORM resolve_realtime_outbox_event(v_event, v_token, 'probably_fine');
    RAISE EXCEPTION 'PROOF RD7 FAILED: an invented disposition was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Free text cannot be smuggled in as an error code.
  BEGIN
    PERFORM resolve_realtime_outbox_event(v_event, v_token, 'invalid', 'connection refused to 10.0.0.1');
    RAISE EXCEPTION 'PROOF RD7 FAILED: a free-text error was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- A half-written completion is refused by the table itself.
  BEGIN
    UPDATE outbox_events SET realtime_status = 'done' WHERE event_id = v_event;
    RAISE EXCEPTION 'PROOF RD7 FAILED: done without completed_at/disposition';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PROOF RD7 PASS: dispositions and error codes are constrained, done is atomic';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF RD8 — untenanted historical rows were retired, not delivered
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_leaked integer;
BEGIN
  -- The retirement migration ran during setup. Any row it retired must carry
  -- the reason, must be terminal, and must NOT have touched the kafka lane.
  SELECT count(*) INTO v_leaked FROM outbox_events
   WHERE realtime_disposition = 'retired'
     AND (realtime_last_error_code IS DISTINCT FROM 'pre_realtime_untenanted'
          OR realtime_completed_at IS NULL
          OR status <> 'pending');
  ASSERT v_leaked = 0, 'RD8: a retired row is malformed or altered the kafka lane';

  -- And retirement is narrow: nothing WITH a tenant was retired.
  SELECT count(*) INTO v_leaked FROM outbox_events
   WHERE realtime_disposition = 'retired' AND tenant_id IS NOT NULL;
  ASSERT v_leaked = 0, 'RD8: a tenanted row was retired';

  RAISE NOTICE 'PROOF RD8 PASS: historical debt is retired auditably and narrowly';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF RD9 — the debt view exposes counts and nothing else
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_cols text;
BEGIN
  SELECT string_agg(p.attname, ',' ORDER BY p.attnum) INTO v_cols
    FROM pg_proc f
    JOIN pg_namespace n ON n.oid = f.pronamespace
    CROSS JOIN LATERAL unnest(f.proargnames) WITH ORDINALITY AS p(attname, attnum)
   WHERE n.nspname = 'public' AND f.proname = 'realtime_outbox_debt';

  ASSERT v_cols IS NOT NULL, 'RD9: the debt view has no named outputs';

  -- Whole column names, not substrings: `not_user_facing` is a COUNT of a
  -- disposition and contains the letters "user" without exposing one. A
  -- substring match would flag it and teach the next reader to loosen the
  -- rule, which is how a real leak eventually gets through.
  ASSERT NOT EXISTS (
    SELECT 1 FROM unnest(string_to_array(v_cols, ',')) AS col
     WHERE col ~ '(payload|tenant|aggregate|clerk|prompt|email)'
        OR col IN ('event_id', 'user_id', 'clerk_user_id', 'generation_id', 'asset_id')
  ), 'RD9: the debt view exposes identifying data: ' || v_cols;

  ASSERT (SELECT pending FROM realtime_outbox_debt()) >= 0, 'RD9: debt view unreadable';

  RAISE NOTICE 'PROOF RD9 PASS: operational debt is counts and ages only';
END $$;


-- ===========================================================================
-- Race fixtures
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.dispatch_race_results (
  race text NOT NULL,
  worker integer NOT NULL,
  outcome text NOT NULL,
  detail text
);

-- N dispatchers claiming at once. Every row must be claimed by exactly one.
CREATE OR REPLACE FUNCTION public.dispatch_claim_race(p_worker integer)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM claim_realtime_outbox_events(50, 60) LOOP
    INSERT INTO dispatch_race_results (race, worker, outcome, detail)
    VALUES ('claim', p_worker, 'claimed', r.event_id::text);
  END LOOP;
EXCEPTION WHEN others THEN
  INSERT INTO dispatch_race_results (race, worker, outcome, detail)
  VALUES ('claim', p_worker, 'error', SQLERRM);
END;
$fn$;

SELECT 'PHASE 11 DISPATCH LANE PROOFS PASSED' AS result;
