-- ===========================================================================
-- PHASE 9-E — the quarantine release lane, proven by PostgreSQL
-- ===========================================================================
-- The application tests cover what the SERVICE refuses. These cover what the
-- DATABASE refuses no matter what any service, admin or future caller
-- decides: releasing unmoderated media, one human counting twice, a release
-- and a reject both taking effect, a replay emitting a second event, and an
-- audit row being edited after the fact.
--
-- Race fixtures live at the bottom; the runner calls them from genuinely
-- parallel connections and asserts the invariants afterwards.
-- ===========================================================================

\set ON_ERROR_STOP on

-- A helper the proofs share: an asset carrying every piece of evidence EXCEPT
-- a moderation verdict. Nothing here mints a verdict — the UPDATE that sets
-- 'passed' is written explicitly by each proof that needs one, so a reader can
-- see exactly where the simulated engine spoke.
CREATE OR REPLACE FUNCTION public.mk_evidenced_asset(p_tag text)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_user text := 'user_' || p_tag || '_' || substr(gen_random_uuid()::text, 1, 8);
        v_id uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/' || p_tag || '/original.png')
  RETURNING id INTO v_id;

  PERFORM record_media_ingest(v_id, 'verified', 'image/png', repeat('e', 64));
  PERFORM finalize_media_asset(v_id, 4096, 'image/png');
  RETURN v_id;
END;
$fn$;


-- ---------------------------------------------------------------------------
-- PROOF E1 — two approvals of an unmoderated asset still do not release it
-- ---------------------------------------------------------------------------
-- The headline property of this batch. Administrative authority releases a
-- CLEARED asset; it does not clear one.
DO $$
DECLARE v_id uuid := mk_evidenced_asset('e1'); v_a jsonb; v_b jsonb; v_status text;
BEGIN
  v_a := approve_media_release(v_id, 'admin_alpha', 'ops_review');
  v_b := approve_media_release(v_id, 'admin_beta', 'ops_review');

  ASSERT (v_a->>'released')::boolean = false, 'E1: first approval released an unmoderated asset';
  ASSERT (v_b->>'released')::boolean = false, 'E1: second approval released an unmoderated asset';
  ASSERT v_a->>'reason' = 'moderation_not_passed', 'E1: wrong refusal, got ' || (v_a->>'reason');
  ASSERT v_b->>'reason' = 'moderation_not_passed', 'E1: wrong refusal, got ' || (v_b->>'reason');

  SELECT quarantine_status INTO v_status FROM media_assets WHERE id = v_id;
  ASSERT v_status = 'quarantined', 'E1: asset left quarantine, status is ' || v_status;

  -- And no approval was even banked: the moderation gate is checked before
  -- the counter, so an unmoderated asset cannot silently accumulate consent.
  ASSERT (SELECT count(*) FROM media_release_approvals WHERE asset_id = v_id) = 0,
    'E1: approvals were recorded for an asset moderation never cleared';

  RAISE NOTICE 'PROOF E1 PASS: no number of admins releases unmoderated media';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF E2 — one human cannot reach the threshold alone
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_id uuid := mk_evidenced_asset('e2'); v_1 jsonb; v_2 jsonb; v_status text;
BEGIN
  UPDATE media_assets SET moderation_status = 'passed', moderated_at = now() WHERE id = v_id;

  v_1 := approve_media_release(v_id, 'admin_alpha');
  ASSERT (v_1->>'released')::boolean = false, 'E2: one approval released the asset';
  ASSERT v_1->>'reason' = 'awaiting_second_approval', 'E2: got ' || (v_1->>'reason');
  ASSERT (v_1->>'approvals')::integer = 1, 'E2: approval count wrong';

  -- The same admin, again. ON CONFLICT DO NOTHING writes the same row, so the
  -- count does not move.
  v_2 := approve_media_release(v_id, 'admin_alpha');
  ASSERT (v_2->>'released')::boolean = false, 'E2: the same admin approving twice released it';
  ASSERT (v_2->>'approvals')::integer = 1, 'E2: a repeat approval incremented the count';

  SELECT quarantine_status INTO v_status FROM media_assets WHERE id = v_id;
  ASSERT v_status = 'quarantined', 'E2: asset left quarantine on one signature';

  RAISE NOTICE 'PROOF E2 PASS: the same admin twice is still one approval';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF E3 — a genuine release: two admins, cleared asset, one event
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_id uuid := mk_evidenced_asset('e3'); v_r jsonb; v_replay jsonb;
        v_status text; v_events integer;
BEGIN
  UPDATE media_assets SET moderation_status = 'passed', moderated_at = now() WHERE id = v_id;

  PERFORM approve_media_release(v_id, 'admin_alpha', 'ops_review');
  v_r := approve_media_release(v_id, 'admin_beta', 'ops_review', 'trace-e3');

  ASSERT (v_r->>'released')::boolean = true,
    'E3: two approvals did not release, got ' || (v_r->>'reason');

  SELECT quarantine_status INTO v_status FROM media_assets WHERE id = v_id;
  ASSERT v_status = 'released', 'E3: status is ' || v_status;

  -- The event agrees with the final state, and shares the release's
  -- transaction: it exists because the UPDATE committed.
  SELECT count(*) INTO v_events FROM outbox_events
   WHERE event_type = 'asset.released' AND aggregate_id = v_id::text;
  ASSERT v_events = 1, 'E3: expected exactly one released event, got ' || v_events;
  ASSERT (v_r->>'event_id') IS NOT NULL, 'E3: no event id returned';

  -- REPLAY IS INERT. A retried approval reports already_released and emits
  -- nothing further.
  v_replay := approve_media_release(v_id, 'admin_gamma', 'ops_review');
  ASSERT (v_replay->>'released')::boolean = false, 'E3: replay re-released';
  ASSERT v_replay->>'reason' = 'already_released', 'E3: replay reason ' || (v_replay->>'reason');

  SELECT count(*) INTO v_events FROM outbox_events
   WHERE event_type = 'asset.released' AND aggregate_id = v_id::text;
  ASSERT v_events = 1, 'E3: replay emitted a second event, total ' || v_events;

  RAISE NOTICE 'PROOF E3 PASS: one release, one event, replay inert';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF E4 — a genuine reject: single admin, terminal, replay inert
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_id uuid := mk_evidenced_asset('e4'); v_r jsonb; v_replay jsonb;
        v_mod text; v_ingest text; v_events integer;
BEGIN
  -- An approval banked before the rejection, to prove it is voided.
  UPDATE media_assets SET moderation_status = 'passed', moderated_at = now() WHERE id = v_id;
  PERFORM approve_media_release(v_id, 'admin_alpha');
  ASSERT (SELECT count(*) FROM media_release_approvals WHERE asset_id = v_id) = 1,
    'E4: fixture did not bank an approval';

  v_r := reject_media_asset(v_id, 'admin_beta', 'policy_violation', 'trace-e4');
  ASSERT (v_r->>'rejected')::boolean = true, 'E4: reject failed, ' || (v_r->>'reason');

  SELECT moderation_status, ingest_status INTO v_mod, v_ingest FROM media_assets WHERE id = v_id;
  ASSERT v_mod = 'rejected', 'E4: moderation_status is ' || v_mod;
  ASSERT v_ingest = 'rejected', 'E4: ingest_status is ' || v_ingest;

  ASSERT (SELECT count(*) FROM media_release_approvals WHERE asset_id = v_id) = 0,
    'E4: approvals survived the rejection';

  SELECT count(*) INTO v_events FROM outbox_events
   WHERE event_type = 'asset.rejected' AND aggregate_id = v_id::text;
  ASSERT v_events = 1, 'E4: expected one rejected event, got ' || v_events;

  v_replay := reject_media_asset(v_id, 'admin_beta', 'policy_violation');
  ASSERT (v_replay->>'rejected')::boolean = false, 'E4: replay re-rejected';
  ASSERT v_replay->>'reason' = 'already_rejected', 'E4: replay reason ' || (v_replay->>'reason');

  SELECT count(*) INTO v_events FROM outbox_events
   WHERE event_type = 'asset.rejected' AND aggregate_id = v_id::text;
  ASSERT v_events = 1, 'E4: replay emitted a second event';

  -- And a rejected asset cannot then be released, even by two admins.
  ASSERT (approve_media_release(v_id, 'admin_gamma')->>'reason') = 'asset_rejected',
    'E4: a rejected asset was still releasable';

  RAISE NOTICE 'PROOF E4 PASS: reject is terminal, voids consent, replay inert';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF E5 — the safety audit is append-only
-- ---------------------------------------------------------------------------
-- An audit an operator can edit is not evidence. The trigger refuses UPDATE
-- and DELETE to every role, including the one that writes it.
DO $$
DECLARE v_id uuid := mk_evidenced_asset('e5'); v_audit_id uuid;
BEGIN
  UPDATE media_assets SET moderation_status = 'passed', moderated_at = now() WHERE id = v_id;
  PERFORM approve_media_release(v_id, 'admin_alpha', 'ops_review');

  SELECT id INTO v_audit_id FROM media_safety_audit WHERE asset_id = v_id LIMIT 1;
  ASSERT v_audit_id IS NOT NULL, 'E5: nothing was audited';

  BEGIN
    UPDATE media_safety_audit SET reason_code = 'rewritten' WHERE id = v_audit_id;
    RAISE EXCEPTION 'PROOF E5 FAILED: an audit row was edited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM media_safety_audit WHERE id = v_audit_id;
    RAISE EXCEPTION 'PROOF E5 FAILED: an audit row was deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Free text is refused too: the audit carries short codes, never an
  -- operator's prose and never a payload.
  BEGIN
    PERFORM approve_media_release(v_id, 'admin_beta', 'contains a space');
    RAISE EXCEPTION 'PROOF E5 FAILED: a free-text reason was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  RAISE NOTICE 'PROOF E5 PASS: the safety audit cannot be edited, deleted or narrated';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF E6 — evidence gaps refuse with the right reason
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text := 'user_e6_' || substr(gen_random_uuid()::text, 1, 8); v_id uuid;
BEGIN
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'browser_upload', 'original', 'image', 'cinefield-media',
          'quarantine/input/' || v_user || '/e6/original.png')
  RETURNING id INTO v_id;

  ASSERT (approve_media_release(v_id, 'admin_alpha')->>'reason') = 'ingest_not_verified',
    'E6: an unverified asset did not refuse with ingest_not_verified';

  PERFORM record_media_ingest(v_id, 'verified', 'image/png', repeat('f', 64));
  ASSERT (approve_media_release(v_id, 'admin_alpha')->>'reason') = 'asset_not_finalized',
    'E6: an unfinalized asset did not refuse with asset_not_finalized';

  PERFORM finalize_media_asset(v_id, 2048, 'image/png');
  UPDATE media_assets SET moderation_status = 'passed', moderated_at = now() WHERE id = v_id;
  UPDATE media_assets SET tombstoned_at = now() WHERE id = v_id;
  ASSERT (approve_media_release(v_id, 'admin_alpha')->>'reason') = 'asset_tombstoned',
    'E6: a tombstoned asset was still releasable';

  ASSERT (approve_media_release(gen_random_uuid(), 'admin_alpha')->>'reason') = 'not_found',
    'E6: an unknown asset did not refuse with not_found';

  RAISE NOTICE 'PROOF E6 PASS: every evidence gap names itself';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF E7 — unauthorized direct mutation is blocked at the grant layer
-- ---------------------------------------------------------------------------
-- The service checks an allowlist, but the service is not the last line. A
-- browser-facing role must not be able to reach the tables or the functions
-- at all, whatever a route forgets.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s->%s', grantee, table_name), ', ') INTO v_bad
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('media_safety_audit', 'media_release_approvals')
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  ASSERT v_bad IS NULL, 'E7: browser roles hold table grants: ' || v_bad;

  SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('approve_media_release', 'reject_media_asset',
                       'request_media_release', 'media_release_required_approvals')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  ASSERT v_bad IS NULL, 'E7: browser roles can execute: ' || v_bad;

  -- RLS is on, and no policy grants a browser role anything.
  ASSERT (SELECT bool_and(relrowsecurity) FROM pg_class
           WHERE relname IN ('media_safety_audit', 'media_release_approvals')),
    'E7: row level security is not enabled on both tables';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies
                      WHERE tablename IN ('media_safety_audit', 'media_release_approvals')
                        AND ('anon' = ANY(roles) OR 'authenticated' = ANY(roles))),
    'E7: a policy exposes the safety tables to a browser role';

  RAISE NOTICE 'PROOF E7 PASS: no browser role can read, write or execute the release lane';
END $$;


-- ===========================================================================
-- Race fixtures — invoked by run_pg_tests.sh from parallel connections
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.release_race_results (
  race text NOT NULL,
  worker integer NOT NULL,
  outcome text NOT NULL,
  detail text
);

-- Several admins approving at the same instant. Exactly one call may flip the
-- row; the rest must find themselves second or already-released. None may
-- emit a duplicate event.
CREATE OR REPLACE FUNCTION public.release_race(p_worker integer, p_asset uuid, p_actor text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  v := approve_media_release(p_asset, p_actor, 'ops_review');
  INSERT INTO release_race_results (race, worker, outcome, detail)
  VALUES ('release', p_worker,
          CASE WHEN (v->>'released')::boolean THEN 'released' ELSE v->>'reason' END,
          v->>'event_id');
EXCEPTION WHEN others THEN
  INSERT INTO release_race_results (race, worker, outcome, detail)
  VALUES ('release', p_worker, 'error', SQLERRM);
END;
$fn$;

-- A release and a reject arriving together. The row lock decides which wins;
-- what must never happen is both taking effect, or the asset ending in a
-- state the emitted events disagree with.
CREATE OR REPLACE FUNCTION public.release_vs_reject_race(
  p_worker integer, p_asset uuid, p_actor text, p_intent text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  IF p_intent = 'release' THEN
    v := approve_media_release(p_asset, p_actor, 'ops_review');
    INSERT INTO release_race_results (race, worker, outcome, detail)
    VALUES ('vs', p_worker,
            CASE WHEN (v->>'released')::boolean THEN 'released' ELSE v->>'reason' END, p_intent);
  ELSE
    v := reject_media_asset(p_asset, p_actor, 'policy_violation');
    INSERT INTO release_race_results (race, worker, outcome, detail)
    VALUES ('vs', p_worker,
            CASE WHEN (v->>'rejected')::boolean THEN 'rejected' ELSE v->>'reason' END, p_intent);
  END IF;
EXCEPTION WHEN others THEN
  INSERT INTO release_race_results (race, worker, outcome, detail)
  VALUES ('vs', p_worker, 'error', SQLERRM);
END;
$fn$;

-- Six connections rejecting the same asset. One effective reject, five inert.
CREATE OR REPLACE FUNCTION public.reject_race(p_worker integer, p_asset uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  v := reject_media_asset(p_asset, 'admin_r' || p_worker, 'policy_violation');
  INSERT INTO release_race_results (race, worker, outcome, detail)
  VALUES ('reject', p_worker,
          CASE WHEN (v->>'rejected')::boolean THEN 'rejected' ELSE v->>'reason' END,
          v->>'event_id');
EXCEPTION WHEN others THEN
  INSERT INTO release_race_results (race, worker, outcome, detail)
  VALUES ('reject', p_worker, 'error', SQLERRM);
END;
$fn$;

SELECT 'PHASE 9-E SEQUENTIAL PROOFS PASSED' AS result;
