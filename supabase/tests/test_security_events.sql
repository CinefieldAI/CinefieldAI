-- ===========================================================================
-- PHASE 12-C — Security Event Logger + Risk Engine, PostgreSQL proofs
-- ===========================================================================
-- S12C-1  .. append-only refuses UPDATE and DELETE, for every role
-- S12C-2  .. storm control coalesces a repeat inside one window
-- S12C-3  .. a different subject is a different key, never coalesced
-- S12C-4  .. the taxonomy is bounded by CHECK, not by convention
-- S12C-5  .. reason_code cannot hold prose, a URL, or a prompt
-- S12C-6  .. risk_score is bounded 0..100
-- S12C-7  .. a warning emits exactly one ROUTABLE outbox row
-- S12C-8  .. a coalesced repeat emits NO second warning
-- S12C-9  .. no tenant means no warning, even when one is requested
-- S12C-10 .. recurrence counts windows, and no browser role can read any of it
--
-- Run through: bash supabase/tests/run_pg_tests.sh
-- ===========================================================================

\set ON_ERROR_STOP on

-- A tenant with a real generation, so an emitted warning has something to
-- prove routing against.
DO $$
DECLARE v_user text := 'user_sec_12c';
BEGIN
  INSERT INTO profiles (clerk_user_id, plan, credits)
    VALUES (v_user, 'pro', 1000) ON CONFLICT DO NOTHING;
  INSERT INTO projects (id, clerk_user_id, title)
    VALUES ('12c00000-0000-4000-8000-000000000001', v_user, 'sec')
    ON CONFLICT DO NOTHING;
END $$;


-- ---------------------------------------------------------------------------
-- S12C-1. Append-only, enforced by trigger and not by grant alone
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_id uuid; v_ok boolean;
BEGIN
  PERFORM record_security_event(
    'rate_limit_denied', 'low', 'route_rate_limit', 'route_class_paid_compute',
    's1:subject:route_class_paid_compute', 60, 'user_sec_12c', 'user_sec_12c'
  );
  SELECT id INTO v_id FROM security_events WHERE dedupe_key = 's1:subject:route_class_paid_compute';
  ASSERT v_id IS NOT NULL, 'S12C-1: the row was not written';

  -- UPDATE
  v_ok := false;
  BEGIN
    UPDATE security_events SET risk_score = 99 WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN
    v_ok := true;
  END;
  ASSERT v_ok, 'S12C-1: evidence must not be editable';

  -- DELETE
  v_ok := false;
  BEGIN
    DELETE FROM security_events WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN
    v_ok := true;
  END;
  ASSERT v_ok, 'S12C-1: evidence must not be deletable';

  RAISE NOTICE 'S12C-1 PASS: security evidence is append-only for every role, owner included';
END $$;


-- ---------------------------------------------------------------------------
-- S12C-2. Storm control
-- ---------------------------------------------------------------------------
-- The attack this defends against: ten thousand refused requests turning the
-- security logger into a database amplifier that finishes the job.
DO $$
DECLARE v_rows integer; v_coalesced integer := 0; r jsonb; i integer;
BEGIN
  FOR i IN 1..50 LOOP
    r := record_security_event(
      'rate_limit_denied', 'low', 'route_rate_limit', 'route_class_paid_compute',
      's2:storm:route_class_paid_compute', 3600, 'user_sec_12c', 'user_sec_12c'
    );
    IF NOT (r->>'recorded')::boolean THEN
      v_coalesced := v_coalesced + 1;
      ASSERT r->>'reason' = 'coalesced',
        'S12C-2: a repeat must be reported as coalesced, got ' || COALESCE(r->>'reason','<null>');
    END IF;
  END LOOP;

  SELECT count(*) INTO v_rows FROM security_events WHERE dedupe_key = 's2:storm:route_class_paid_compute';
  ASSERT v_rows = 1, 'S12C-2: fifty signals in one window must write ONE row, got ' || v_rows;
  ASSERT v_coalesced = 49, 'S12C-2: forty-nine must be reported coalesced, got ' || v_coalesced;

  RAISE NOTICE 'S12C-2 PASS: 50 signals in one window -> 1 row, 49 coalesced and reported as such';
END $$;


-- ---------------------------------------------------------------------------
-- S12C-3. Coalescing is per SUBJECT, never global
-- ---------------------------------------------------------------------------
-- The failure this rules out is the dangerous one: one noisy subject silently
-- suppressing everybody else's evidence for the rest of the window.
DO $$
DECLARE v_rows integer;
BEGIN
  PERFORM record_security_event('rate_limit_denied','low','route_rate_limit','route_class_paid_compute',
    's3:alice:route_class_paid_compute', 3600, 'user_alice', 'user_alice');
  PERFORM record_security_event('rate_limit_denied','low','route_rate_limit','route_class_paid_compute',
    's3:bob:route_class_paid_compute', 3600, 'user_bob', 'user_bob');

  SELECT count(*) INTO v_rows FROM security_events WHERE dedupe_key LIKE 's3:%';
  ASSERT v_rows = 2, 'S12C-3: two subjects must produce two rows, got ' || v_rows;

  RAISE NOTICE 'S12C-3 PASS: one subject cannot suppress another subject''s evidence';
END $$;


-- ---------------------------------------------------------------------------
-- S12C-4. The taxonomy is bounded by the database
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_ok boolean;
BEGIN
  FOR v_ok IN SELECT true LOOP END LOOP;

  -- kind
  v_ok := false;
  BEGIN
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key, window_started_at)
    VALUES ('made_up_kind','low','route_rate_limit','x_code','s4:a', now());
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12C-4: an unknown kind must be refused';

  -- severity
  v_ok := false;
  BEGIN
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key, window_started_at)
    VALUES ('rate_limit_denied','catastrophic','route_rate_limit','x_code','s4:b', now());
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12C-4: an unknown severity must be refused';

  -- source
  v_ok := false;
  BEGIN
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key, window_started_at)
    VALUES ('rate_limit_denied','low','somewhere_else','x_code','s4:c', now());
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12C-4: an unknown source must be refused';

  -- action
  v_ok := false;
  BEGIN
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key,
                                 window_started_at, recommended_action)
    VALUES ('rate_limit_denied','low','route_rate_limit','x_code','s4:d', now(), 'permanent_ban');
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12C-4: a permanent ban is not a representable action in this phase';

  RAISE NOTICE 'S12C-4 PASS: kind, severity, source and action are bounded — permanent_ban is unrepresentable';
END $$;


-- ---------------------------------------------------------------------------
-- S12C-5. A reason code cannot become a place secrets end up
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_ok boolean; v_bad text;
BEGIN
  FOREACH v_bad IN ARRAY ARRAY[
    'https://provider.example/out.mp4?X-Amz-Signature=deadbeef',
    'Provider said: your prompt contained something',
    'Rate Limited',
    '../../etc/passwd',
    ''
  ] LOOP
    v_ok := false;
    BEGIN
      INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key, window_started_at)
      VALUES ('rate_limit_denied','low','route_rate_limit', v_bad, 's5:' || md5(v_bad), now());
    EXCEPTION WHEN check_violation THEN v_ok := true; END;
    ASSERT v_ok, 'S12C-5: reason_code accepted free text: ' || v_bad;
  END LOOP;

  RAISE NOTICE 'S12C-5 PASS: a signed URL, a provider message and a path cannot enter reason_code';
END $$;


-- ---------------------------------------------------------------------------
-- S12C-6. Risk score is bounded
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_ok boolean;
BEGIN
  v_ok := false;
  BEGIN
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key,
                                 window_started_at, risk_score)
    VALUES ('rate_limit_denied','low','route_rate_limit','x_code','s6:a', now(), 101);
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12C-6: a score above 100 must be refused';

  v_ok := false;
  BEGIN
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key,
                                 window_started_at, risk_score)
    VALUES ('rate_limit_denied','low','route_rate_limit','x_code','s6:b', now(), -1);
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12C-6: a negative score must be refused';

  RAISE NOTICE 'S12C-6 PASS: risk_score is bounded 0..100';
END $$;


-- ---------------------------------------------------------------------------
-- S12C-7. A warning is emitted ONCE, through the outbox, and it is ROUTABLE
-- ---------------------------------------------------------------------------
-- The last clause is the one that matters. An emitted warning with a NULL
-- tenant commits, looks correct in the outbox, and reaches nobody — the exact
-- shape of D-11-1. This proves `outbox_tenant_for_aggregate` resolves the new
-- aggregate type rather than silently returning NULL.
DO $$
DECLARE r jsonb; v_outbox integer; v_tenant text; v_type text; v_payload jsonb;
BEGIN
  r := record_security_event(
    'rate_limit_denied', 'low', 'route_rate_limit', 'route_class_paid_compute',
    's7:warn:route_class_paid_compute', 3600, 'user_sec_12c', 'user_sec_12c',
    NULL, 'route', 'paid-compute', 'trace-12c-7', 44, 'warning', true
  );
  ASSERT (r->>'recorded')::boolean, 'S12C-7: the evidence row must exist';
  ASSERT r->>'outbox_event_id' IS NOT NULL, 'S12C-7: a warning must produce an outbox row';

  SELECT count(*) INTO v_outbox FROM outbox_events
   WHERE event_id = (r->>'outbox_event_id')::uuid;
  ASSERT v_outbox = 1, 'S12C-7: exactly one outbox row, got ' || v_outbox;

  SELECT event_type, tenant_id, payload INTO v_type, v_tenant, v_payload
    FROM outbox_events WHERE event_id = (r->>'outbox_event_id')::uuid;

  ASSERT v_type = 'security.warning',
    'S12C-7: the event type must be the one 11-B already maps, got ' || v_type;
  ASSERT v_tenant = 'user_sec_12c',
    'S12C-7: the warning must be ROUTABLE — tenant resolved to ' || COALESCE(v_tenant, '<null>');

  -- The payload carries what a person can act on and nothing an attacker
  -- would want: no score, no threshold, no recurrence, no route, no address.
  ASSERT v_payload ? 'reasonCode' AND v_payload ? 'severity',
    'S12C-7: the payload must carry the reason and the severity';
  ASSERT NOT (v_payload ? 'riskScore' OR v_payload ? 'score' OR v_payload ? 'dedupeKey'
              OR v_payload ? 'subjectHash' OR v_payload ? 'recommendedAction'),
    'S12C-7: the payload leaked detection detail: ' || v_payload::text;

  RAISE NOTICE 'S12C-7 PASS: one routable security.warning, carrying reason + severity only';
END $$;


-- ---------------------------------------------------------------------------
-- S12C-8. A coalesced repeat emits NO second warning
-- ---------------------------------------------------------------------------
-- A user told once per window is informed. A user told per request is being
-- attacked through the notification channel.
DO $$
DECLARE v_before integer; v_after integer; r jsonb; i integer;
BEGIN
  SELECT count(*) INTO v_before FROM outbox_events WHERE event_type = 'security.warning';

  FOR i IN 1..25 LOOP
    r := record_security_event(
      'rate_limit_denied', 'low', 'route_rate_limit', 'route_class_paid_compute',
      's7:warn:route_class_paid_compute', 3600, 'user_sec_12c', 'user_sec_12c',
      NULL, 'route', 'paid-compute', 'trace-12c-8', 44, 'warning', true
    );
    ASSERT NOT (r->>'recorded')::boolean, 'S12C-8: the window is already occupied';
  END LOOP;

  SELECT count(*) INTO v_after FROM outbox_events WHERE event_type = 'security.warning';
  ASSERT v_after = v_before,
    'S12C-8: 25 coalesced repeats emitted ' || (v_after - v_before) || ' extra warnings';

  RAISE NOTICE 'S12C-8 PASS: storm control bounds the NOTIFICATION rate, not just the write rate';
END $$;


-- ---------------------------------------------------------------------------
-- S12C-9. No tenant, no warning — even when one is asked for
-- ---------------------------------------------------------------------------
-- An anonymous denial has nobody to tell. Emitting anyway would write an
-- untenanted row the dispatcher must then drop as unroutable, turning every
-- anonymous refusal into permanent outbox debt.
DO $$
DECLARE r jsonb; v_outbox integer;
BEGIN
  r := record_security_event(
    'rate_limit_denied', 'low', 'route_rate_limit', 'route_class_public_dev_stub',
    's9:anon:route_class_public_dev_stub', 3600, NULL, NULL,
    'ab12cd34ef56ab12cd34', 'route', 'public-stub', NULL, 28, 'warning', true
  );
  ASSERT (r->>'recorded')::boolean, 'S12C-9: the evidence row must still be written';
  ASSERT r->>'outbox_event_id' IS NULL,
    'S12C-9: an untenanted signal must not emit a warning';

  SELECT count(*) INTO v_outbox FROM outbox_events
   WHERE aggregate_type = 'security_event' AND tenant_id IS NULL;
  ASSERT v_outbox = 0, 'S12C-9: no untenanted security warning may exist, found ' || v_outbox;

  RAISE NOTICE 'S12C-9 PASS: an anonymous refusal is evidence, and creates no unroutable debt';
END $$;


-- ---------------------------------------------------------------------------
-- S12C-10. Recurrence counts windows, and nothing browser-facing can read it
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n integer; v_priv integer;
BEGIN
  -- Three distinct one-second windows for one subject.
  PERFORM record_security_event('outbound_fetch_blocked','high','outbound_fetch_gateway',
    'ip_blocked_loopback','s10:recurrence', 1, 'user_sec_12c', 'user_sec_12c');
  PERFORM pg_sleep(1.05);
  PERFORM record_security_event('outbound_fetch_blocked','high','outbound_fetch_gateway',
    'ip_blocked_loopback','s10:recurrence', 1, 'user_sec_12c', 'user_sec_12c');
  PERFORM pg_sleep(1.05);
  PERFORM record_security_event('outbound_fetch_blocked','high','outbound_fetch_gateway',
    'ip_blocked_loopback','s10:recurrence', 1, 'user_sec_12c', 'user_sec_12c');

  v_n := security_event_recurrence('s10:recurrence', 900);
  ASSERT v_n = 3, 'S12C-10: three windows must be counted, got ' || v_n;

  -- An unrelated subject must not inflate it.
  ASSERT security_event_recurrence('s10:nobody', 900) = 0,
    'S12C-10: recurrence must be per subject';

  -- Raw evidence is operator data. Exposing it would hand an attacker the
  -- detection rules along with their own score.
  SELECT count(*) INTO v_priv
    FROM information_schema.role_table_grants
   WHERE table_name = 'security_events' AND grantee IN ('anon', 'authenticated');
  ASSERT v_priv = 0, 'S12C-10: browser roles must hold no privilege on security_events';

  SELECT count(*) INTO v_priv
    FROM information_schema.role_routine_grants
   WHERE routine_name IN ('record_security_event', 'security_event_recurrence')
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  ASSERT v_priv = 0, 'S12C-10: no browser role may execute the security functions';

  RAISE NOTICE 'S12C-10 PASS: recurrence is per-subject and per-window; no browser role can reach any of it';
END $$;

SELECT 'SECURITY EVENT PROOFS PASSED' AS result;
