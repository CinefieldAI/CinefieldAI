-- ===========================================================================
-- PHASE 12-E — Policy decision evidence, PostgreSQL proofs
-- ===========================================================================
-- S12E-1 .. record_security_event has exactly ONE definition after the
--            parameter was added — the old signature is dropped, not shadowed
-- S12E-2 .. every 12-C call site still resolves and behaves identically
-- S12E-3 .. the two policy kinds and the policy_gate source are accepted
-- S12E-4 .. policy_version is stored, bounded, and never required
-- S12E-5 .. a policy decision row is append-only like every other row
-- S12E-6 .. both outcomes are recordable — a decision log is not a denial log
-- S12E-7 .. the widened CHECK is strictly additive: nothing legal became illegal
-- S12E-8 .. an unknown kind or source is still refused
-- S12E-9 .. no browser role gained anything from the new column or kinds
-- S12E-10 . policy evidence emits no user-facing warning
--
-- Run through: bash supabase/tests/run_pg_tests.sh
-- ===========================================================================

\set ON_ERROR_STOP on


-- ---------------------------------------------------------------------------
-- S12E-1. One function, not two
-- ---------------------------------------------------------------------------
-- 20260824000000 records what happened the last time a parameter was added to
-- a widely-called function: PostgreSQL created an OVERLOAD, the old definition
-- survived, and every existing call became ambiguous.
--
-- This proof caught the SAME mistake in 12-E's first draft, which assumed a
-- trailing DEFAULT parameter would let CREATE OR REPLACE replace the function
-- in place. It does not — PostgreSQL identifies a function by its full
-- argument type list — so the migration now drops the 15-argument signature
-- explicitly. Without this assertion the catalog would have shipped with two
-- callable definitions and every existing call site would have failed as
-- ambiguous the first time a security signal was recorded in production.
DO $$
DECLARE v_count integer; v_args integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_security_event';
  ASSERT v_count = 1,
    'S12E-1: record_security_event must have exactly one definition, found ' || v_count;

  SELECT pronargs INTO v_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_security_event';
  ASSERT v_args = 16, 'S12E-1: expected 16 parameters, found ' || v_args;

  RAISE NOTICE 'S12E-1 PASS: exactly one record_security_event definition — the old signature was dropped, not shadowed';
END $$;


-- ---------------------------------------------------------------------------
-- S12E-2. Every Phase 12-C call still resolves, unchanged
-- ---------------------------------------------------------------------------
DO $$
DECLARE r jsonb; v_row security_events%ROWTYPE;
BEGIN
  INSERT INTO profiles (clerk_user_id, plan, credits)
    VALUES ('user_sec_12e', 'pro', 1000) ON CONFLICT DO NOTHING;

  -- The 8-argument shape 12-C's proofs use.
  r := record_security_event(
    'rate_limit_denied', 'low', 'route_rate_limit', 'route_class_paid_compute',
    'e2:short:route_class_paid_compute', 60, 'user_sec_12e', 'user_sec_12e'
  );
  ASSERT (r->>'recorded')::boolean, 'S12E-2: the short call form stopped working';

  -- The 15-argument shape the TypeScript logger used before 12-E.
  r := record_security_event(
    'rate_limit_denied', 'low', 'route_rate_limit', 'route_class_durable_write',
    'e2:long:route_class_durable_write', 3600, 'user_sec_12e', 'user_sec_12e',
    NULL, 'route', 'durable-write', 'trace-12e-2', 41, 'warning', true
  );
  ASSERT (r->>'recorded')::boolean, 'S12E-2: the 15-argument form stopped working';
  ASSERT r->>'outbox_event_id' IS NOT NULL,
    'S12E-2: the warning path must still emit through the outbox';

  SELECT * INTO v_row FROM security_events WHERE dedupe_key = 'e2:long:route_class_durable_write';
  ASSERT v_row.policy_version IS NULL,
    'S12E-2: a non-policy event must not acquire a policy version';

  RAISE NOTICE 'S12E-2 PASS: 12-C behaviour is byte-for-byte unchanged through the new signature';
END $$;


-- ---------------------------------------------------------------------------
-- S12E-3 / S12E-4. The new vocabulary, and the version that makes it useful
-- ---------------------------------------------------------------------------
DO $$
DECLARE r jsonb; v_version text;
BEGIN
  r := record_security_event(
    'policy_decision_allowed', 'medium', 'policy_gate',
    'allow_allowed_two_person_enforced_downstream',
    'e3:policy:media.quarantine.release:allow', 1,
    'user_admin_1', 'user_admin_1', NULL,
    'media.quarantine.release', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'trace-12e-3', NULL, NULL, false, '2026-08-14.1'
  );
  ASSERT (r->>'recorded')::boolean, 'S12E-3: the policy kinds must be accepted';

  SELECT policy_version INTO v_version FROM security_events
   WHERE dedupe_key = 'e3:policy:media.quarantine.release:allow';
  ASSERT v_version = '2026-08-14.1',
    'S12E-4: the policy version must be stored, got ' || COALESCE(v_version, '<null>');

  RAISE NOTICE 'S12E-3/4 PASS: policy decisions are recordable and attributable to a policy version';
END $$;

DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key,
                                 window_started_at, policy_version)
    VALUES ('policy_decision_denied','medium','policy_gate','deny_unknown_action','e4:long',
            now(), repeat('v', 65));
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12E-4: policy_version must be bounded like every other column';
  RAISE NOTICE 'S12E-4b PASS: policy_version is bounded';
END $$;


-- ---------------------------------------------------------------------------
-- S12E-5. Still append-only
-- ---------------------------------------------------------------------------
-- A decision log that can be edited is not a decision log. The 12-C trigger
-- covers the new rows because it is on the table, not on a kind — but proving
-- it is cheaper than reasoning about it.
DO $$
DECLARE v_id uuid; v_ok boolean;
BEGIN
  SELECT id INTO v_id FROM security_events
   WHERE dedupe_key = 'e3:policy:media.quarantine.release:allow';

  v_ok := false;
  BEGIN
    UPDATE security_events SET policy_version = '9999' WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12E-5: a policy decision must not be editable';

  v_ok := false;
  BEGIN
    DELETE FROM security_events WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12E-5: a policy decision must not be deletable';

  RAISE NOTICE 'S12E-5 PASS: policy decisions inherit the append-only boundary';
END $$;


-- ---------------------------------------------------------------------------
-- S12E-6. Both outcomes, and one row each
-- ---------------------------------------------------------------------------
-- A log holding only refusals cannot answer "who released that asset, under
-- which policy version" — the question an incident actually asks. And because
-- the two policy kinds include the resource in their dedupe key, two decisions
-- in the same second on different resources stay two rows.
DO $$
DECLARE v_allowed integer; v_denied integer;
BEGIN
  PERFORM record_security_event(
    'policy_decision_denied', 'medium', 'policy_gate', 'deny_not_implemented',
    'e6:policy:data.delete:deny', 1, 'user_admin_1', 'user_admin_1', NULL,
    'data.delete', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', NULL, NULL, NULL, false, '2026-08-14.1'
  );
  PERFORM record_security_event(
    'policy_decision_allowed', 'medium', 'policy_gate', 'allow_allowed',
    'e6:policy:media.quarantine.reject:allow:asset-b', 1, 'user_admin_1', 'user_admin_1', NULL,
    'media.quarantine.reject', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', NULL, NULL, NULL, false, '2026-08-14.1'
  );

  SELECT count(*) INTO v_allowed FROM security_events WHERE kind = 'policy_decision_allowed';
  SELECT count(*) INTO v_denied FROM security_events WHERE kind = 'policy_decision_denied';
  ASSERT v_allowed >= 2, 'S12E-6: allow decisions must be recorded too, got ' || v_allowed;
  ASSERT v_denied >= 1, 'S12E-6: deny decisions must be recorded, got ' || v_denied;

  RAISE NOTICE 'S12E-6 PASS: the decision log holds both outcomes, one row per decision';
END $$;


-- ---------------------------------------------------------------------------
-- S12E-7. Strictly additive
-- ---------------------------------------------------------------------------
-- Every kind and source that was legal before 12-E is still legal. A widened
-- CHECK written as DROP + ADD is exactly where a value gets dropped by
-- accident, so the whole prior vocabulary is re-asserted rather than trusted.
DO $$
DECLARE k text; s text; v_n integer := 0;
BEGIN
  FOREACH k IN ARRAY ARRAY['rate_limit_denied','outbound_fetch_blocked',
                           'realtime_connection_denied','media_release_approved',
                           'media_rejected','realtime_event_unroutable','auth_failure'] LOOP
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key, window_started_at)
    VALUES (k, 'low', 'auth', 'additive_check', 'e7:' || k, now());
    v_n := v_n + 1;
  END LOOP;
  ASSERT v_n = 7, 'S12E-7: a pre-12-E kind was lost when the CHECK was widened';

  v_n := 0;
  FOREACH s IN ARRAY ARRAY['route_rate_limit','outbound_fetch_gateway','realtime_gateway',
                           'media_safety','realtime_dispatcher','auth'] LOOP
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key, window_started_at)
    VALUES ('auth_failure', 'low', s, 'additive_check', 'e7:src:' || s, now());
    v_n := v_n + 1;
  END LOOP;
  ASSERT v_n = 6, 'S12E-7: a pre-12-E source was lost when the CHECK was widened';

  RAISE NOTICE 'S12E-7 PASS: the widened vocabulary lost nothing — 7 kinds and 6 sources still legal';
END $$;


-- ---------------------------------------------------------------------------
-- S12E-8. And the boundary still holds
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_ok boolean;
BEGIN
  v_ok := false;
  BEGIN
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key, window_started_at)
    VALUES ('policy_decision_maybe','medium','policy_gate','x_code','e8:a', now());
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12E-8: an invented policy kind must be refused';

  v_ok := false;
  BEGIN
    INSERT INTO security_events (kind, severity, source, reason_code, dedupe_key, window_started_at)
    VALUES ('policy_decision_denied','medium','opa_sidecar','x_code','e8:b', now());
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  ASSERT v_ok, 'S12E-8: an unknown source must still be refused';

  RAISE NOTICE 'S12E-8 PASS: widening the vocabulary did not open it';
END $$;


-- ---------------------------------------------------------------------------
-- S12E-9. No browser role gained anything
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_priv integer;
BEGIN
  SELECT count(*) INTO v_priv
    FROM information_schema.role_table_grants
   WHERE table_name = 'security_events' AND grantee IN ('anon', 'authenticated');
  ASSERT v_priv = 0, 'S12E-9: browser roles must hold no privilege on the decision log';

  SELECT count(*) INTO v_priv
    FROM information_schema.column_privileges
   WHERE table_name = 'security_events' AND column_name = 'policy_version'
     AND grantee IN ('anon', 'authenticated');
  ASSERT v_priv = 0, 'S12E-9: the new column granted nothing to a browser role';

  SELECT count(*) INTO v_priv
    FROM information_schema.role_routine_grants
   WHERE routine_name = 'record_security_event'
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  ASSERT v_priv = 0, 'S12E-9: the re-created function must not have loosened its grants';

  RAISE NOTICE 'S12E-9 PASS: the decision log is service_role only, column included';
END $$;


-- ---------------------------------------------------------------------------
-- S12E-10. A policy decision tells the operator, not the user
-- ---------------------------------------------------------------------------
-- The logger never asks for a warning on a policy kind, but the RPC would
-- honour one if a future caller did. This pins the intent: a decision log
-- entry is operator evidence, and a user learning that a policy rule fired
-- learns something about the rule.
DO $$
DECLARE v_before integer; v_after integer;
BEGIN
  SELECT count(*) INTO v_before FROM outbox_events WHERE event_type = 'security.warning';

  PERFORM record_security_event(
    'policy_decision_denied', 'medium', 'policy_gate', 'deny_role_not_permitted',
    'e10:policy:no-warning', 1, 'user_sec_12e', 'user_sec_12e', NULL,
    'media.quarantine.release', NULL, NULL, NULL, NULL, false, '2026-08-14.1'
  );

  SELECT count(*) INTO v_after FROM outbox_events WHERE event_type = 'security.warning';
  ASSERT v_after = v_before,
    'S12E-10: a policy decision emitted ' || (v_after - v_before) || ' user-facing warnings';

  RAISE NOTICE 'S12E-10 PASS: policy evidence stays operator-side';
END $$;

SELECT 'POLICY DECISION EVIDENCE PROOFS PASSED' AS result;
