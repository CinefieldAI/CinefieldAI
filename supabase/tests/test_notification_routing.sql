-- ===========================================================================
-- PRE-11 + PHASE 11-A — event contract and tenant routing, proven by Postgres
-- ===========================================================================
-- The application tests prove what the Notification Service refuses. These
-- prove what the DATABASE guarantees before the service ever sees a row:
-- that the canonical event name is emitted, that exactly one event exists per
-- logical transition, that a replay adds none, and that the tenant written
-- beside the fact is the real owner and nobody else's.
--
-- Race fixtures are at the bottom; the runner drives them from genuinely
-- parallel connections.
-- ===========================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.mk_tenant_project(p_tag text, OUT o_user text, OUT o_project uuid)
RETURNS record LANGUAGE plpgsql AS $fn$
BEGIN
  o_user := 'user_' || p_tag || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  INSERT INTO profiles (clerk_user_id) VALUES (o_user);
  INSERT INTO projects (clerk_user_id, title) VALUES (o_user, p_tag || ' project')
  RETURNING id INTO o_project;
END;
$fn$;


-- ---------------------------------------------------------------------------
-- PROOF N1 — the canonical asset family is what actually gets emitted
-- ---------------------------------------------------------------------------
-- D-1's repair, observed at the only place that settles it: a row in the
-- outbox. Not the migration text — the emitted fact.
DO $$
DECLARE v_user text; v_id uuid; v_types text[];
BEGIN
  v_user := 'user_n1' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/n1/original.png')
  RETURNING id INTO v_id;

  PERFORM record_media_ingest(v_id, 'verified', 'image/png', repeat('a', 64));
  PERFORM finalize_media_asset(v_id, 4096, 'image/png');
  UPDATE media_assets SET moderation_status = 'passed', moderated_at = now() WHERE id = v_id;

  PERFORM approve_media_release(v_id, 'admin_alpha', 'ops_review');
  PERFORM approve_media_release(v_id, 'admin_beta', 'ops_review');

  SELECT array_agg(event_type ORDER BY event_type) INTO v_types
    FROM outbox_events WHERE aggregate_id = v_id::text;

  ASSERT v_types = ARRAY['asset.released'],
    'N1: expected exactly [asset.released], got ' || COALESCE(v_types::text, 'NULL');
  ASSERT NOT EXISTS (SELECT 1 FROM outbox_events WHERE event_type LIKE 'media.%'),
    'N1: a media.* event was emitted';

  RAISE NOTICE 'PROOF N1 PASS: release emits the canonical asset.released, never media.*';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF N2 — asset.rejected likewise, and the tenant is the asset owner
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text; v_id uuid; v_type text; v_tenant text;
BEGIN
  v_user := 'user_n2' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'browser_upload', 'original', 'image', 'cinefield-media',
          'quarantine/input/' || v_user || '/n2/original.png')
  RETURNING id INTO v_id;

  PERFORM reject_media_asset(v_id, 'admin_alpha', 'policy_violation');

  SELECT event_type, tenant_id INTO v_type, v_tenant
    FROM outbox_events WHERE aggregate_id = v_id::text;

  ASSERT v_type = 'asset.rejected', 'N2: got ' || COALESCE(v_type, 'NULL');
  ASSERT v_tenant = v_user, 'N2: tenant is ' || COALESCE(v_tenant, 'NULL') || ', expected the asset owner';

  RAISE NOTICE 'PROOF N2 PASS: reject emits asset.rejected carrying the owning tenant';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF N3 — replay of release/reject remains inert, and emits no second event
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text; v_id uuid; v_n integer;
BEGIN
  v_user := 'user_n3' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  INSERT INTO profiles (clerk_user_id) VALUES (v_user);
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_user, 'provider_output', 'original', 'image', 'cinefield-media',
          'quarantine/output/' || v_user || '/n3/original.png')
  RETURNING id INTO v_id;

  PERFORM record_media_ingest(v_id, 'verified', 'image/png', repeat('b', 64));
  PERFORM finalize_media_asset(v_id, 4096, 'image/png');
  UPDATE media_assets SET moderation_status = 'passed', moderated_at = now() WHERE id = v_id;
  PERFORM approve_media_release(v_id, 'admin_alpha', 'ops_review');
  PERFORM approve_media_release(v_id, 'admin_beta', 'ops_review');

  -- Replays, in both directions.
  PERFORM approve_media_release(v_id, 'admin_gamma', 'ops_review');
  PERFORM approve_media_release(v_id, 'admin_delta', 'ops_review');
  PERFORM reject_media_asset(v_id, 'admin_alpha', 'policy_violation');

  SELECT count(*) INTO v_n FROM outbox_events WHERE aggregate_id = v_id::text;
  ASSERT v_n = 1, 'N3: replay produced ' || v_n || ' events, expected 1';

  RAISE NOTICE 'PROOF N3 PASS: replayed release/reject emits nothing further';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF N4 — generation.created is emitted once, and a replay adds none
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text; v_project uuid; v_first jsonb; v_replay jsonb;
        v_gen uuid; v_n integer; v_tenant text;
BEGIN
  SELECT o_user, o_project INTO v_user, v_project FROM mk_tenant_project('n4');

  v_first := create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image',
                                  'a prompt', '{}'::jsonb, NULL, NULL, 'idem-n4-key', 'hash-n4');
  ASSERT (v_first->>'created')::boolean, 'N4: fixture did not create';
  ASSERT v_first->>'status' = 'queued', 'N4: new generation should be queued';
  v_gen := (v_first->>'generation_id')::uuid;

  SELECT count(*), max(tenant_id) INTO v_n, v_tenant
    FROM outbox_events WHERE event_type = 'generation.created' AND aggregate_id = v_gen::text;
  ASSERT v_n = 1, 'N4: expected one generation.created, got ' || v_n;
  ASSERT v_tenant = v_user, 'N4: tenant is ' || COALESCE(v_tenant, 'NULL');

  -- Same idempotency key. One logical request, one queued event.
  v_replay := create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image',
                                   'a prompt', '{}'::jsonb, NULL, NULL, 'idem-n4-key', 'hash-n4');
  ASSERT NOT (v_replay->>'created')::boolean, 'N4: replay created a second generation';

  SELECT count(*) INTO v_n
    FROM outbox_events WHERE event_type = 'generation.created' AND aggregate_id = v_gen::text;
  ASSERT v_n = 1, 'N4: replay emitted a second queued event, total ' || v_n;

  RAISE NOTICE 'PROOF N4 PASS: one queued event per logical request, replay inert';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF N5 — generation.processing is emitted once, by the claim that wins
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_user text; v_project uuid; v_gen uuid; v_claim jsonb; v_again jsonb;
        v_n integer; v_status text; v_tenant text;
BEGIN
  SELECT o_user, o_project INTO v_user, v_project FROM mk_tenant_project('n5');
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image',
                                 'p', '{}'::jsonb, NULL, NULL, 'idem-n5-key', 'h')->>'generation_id')::uuid;

  v_claim := claim_generation_tx(v_gen, 'submitting', 'trace-n5');
  ASSERT (v_claim->>'claimed')::boolean, 'N5: claim failed';

  SELECT status INTO v_status FROM generations WHERE id = v_gen;
  ASSERT v_status = 'processing', 'N5: status is ' || v_status;

  SELECT count(*), max(tenant_id) INTO v_n, v_tenant
    FROM outbox_events WHERE event_type = 'generation.processing' AND aggregate_id = v_gen::text;
  ASSERT v_n = 1, 'N5: expected one processing event, got ' || v_n;
  ASSERT v_tenant = v_user, 'N5: tenant is ' || COALESCE(v_tenant, 'NULL');

  -- A second claim finds the row no longer queued and emits nothing.
  v_again := claim_generation_tx(v_gen, 'submitting', 'trace-n5b');
  ASSERT NOT (v_again->>'claimed')::boolean, 'N5: a second claim succeeded';
  ASSERT v_again->>'reason' = 'not_queued', 'N5: got ' || (v_again->>'reason');

  SELECT count(*) INTO v_n
    FROM outbox_events WHERE event_type = 'generation.processing' AND aggregate_id = v_gen::text;
  ASSERT v_n = 1, 'N5: a losing claim emitted an event, total ' || v_n;

  RAISE NOTICE 'PROOF N5 PASS: one processing event, emitted only by the winning claim';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF N6 — the tenant resolver returns the real owner, for both aggregates
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_a text; v_pa uuid; v_b text; v_pb uuid; v_gen_a uuid; v_asset_b uuid;
BEGIN
  SELECT o_user, o_project INTO v_a, v_pa FROM mk_tenant_project('n6a');
  SELECT o_user, o_project INTO v_b, v_pb FROM mk_tenant_project('n6b');

  v_gen_a := (create_generation_tx(v_a, v_pa, 'image', 'mock', 'mock-image',
                                   'p', '{}'::jsonb, NULL, NULL, 'idem-n6a-key', 'h')->>'generation_id')::uuid;
  INSERT INTO media_assets (clerk_user_id, source, role, media_type, bucket, object_key)
  VALUES (v_b, 'browser_upload', 'original', 'image', 'cinefield-media',
          'quarantine/input/' || v_b || '/n6/original.png')
  RETURNING id INTO v_asset_b;

  ASSERT outbox_tenant_for_aggregate('generation', v_gen_a::text) = v_a, 'N6: generation tenant wrong';
  ASSERT outbox_tenant_for_aggregate('media_asset', v_asset_b::text) = v_b, 'N6: asset tenant wrong';

  -- AND NOT THE OTHER ONE. The whole point.
  ASSERT outbox_tenant_for_aggregate('generation', v_gen_a::text) <> v_b, 'N6: cross-tenant resolution';
  ASSERT outbox_tenant_for_aggregate('media_asset', v_asset_b::text) <> v_a, 'N6: cross-tenant resolution';

  RAISE NOTICE 'PROOF N6 PASS: each aggregate resolves to its own owner and no other';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF N7 — an unprovable tenant fails closed
-- ---------------------------------------------------------------------------
-- NULL means "not captured". It must never become a value that routes.
DO $$
DECLARE v_id uuid; v_tenant text;
BEGIN
  ASSERT outbox_tenant_for_aggregate('generation', gen_random_uuid()::text) IS NULL,
    'N7: an unknown generation resolved to a tenant';
  ASSERT outbox_tenant_for_aggregate('media_asset', gen_random_uuid()::text) IS NULL,
    'N7: an unknown asset resolved to a tenant';
  ASSERT outbox_tenant_for_aggregate('not_a_real_aggregate', gen_random_uuid()::text) IS NULL,
    'N7: an unregistered aggregate type resolved to a tenant';
  ASSERT outbox_tenant_for_aggregate('generation', 'not-a-uuid') IS NULL,
    'N7: a malformed aggregate id resolved to a tenant';
  ASSERT outbox_tenant_for_aggregate(NULL, NULL) IS NULL, 'N7: NULL input resolved to a tenant';

  -- An emit whose aggregate cannot be resolved still records the fact, with a
  -- NULL tenant. The event is durable; it is simply unroutable, which the
  -- service refuses rather than broadcasts.
  v_id := emit_outbox_event('generation.cancelled', 1, 'not_a_real_aggregate',
                            gen_random_uuid()::text, '{}'::jsonb);
  SELECT tenant_id INTO v_tenant FROM outbox_events WHERE event_id = v_id;
  ASSERT v_tenant IS NULL, 'N7: an unresolvable emit invented a tenant: ' || v_tenant;

  RAISE NOTICE 'PROOF N7 PASS: an unprovable tenant stays NULL and never becomes a channel';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF N8 — every existing lifecycle producer now captures a tenant
-- ---------------------------------------------------------------------------
-- complete/fail/cancel were NOT rewritten by this migration. They gain tenant
-- capture because it lives in emit_outbox_event. This proves that actually
-- happened rather than being assumed.
DO $$
DECLARE v_user text; v_project uuid; v_gen uuid; v_tenant text; v_missing text;
BEGIN
  SELECT o_user, o_project INTO v_user, v_project FROM mk_tenant_project('n8');
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image',
                                 'p', '{}'::jsonb, NULL, NULL, 'idem-n8-key', 'h')->>'generation_id')::uuid;
  PERFORM claim_generation_tx(v_gen);
  PERFORM complete_generation_tx(v_gen, 'out/n8.png', NULL, 'mock', false, 'sync', 120, NULL, NULL);

  SELECT string_agg(event_type, ',') INTO v_missing
    FROM outbox_events WHERE aggregate_id = v_gen::text AND tenant_id IS NULL;
  ASSERT v_missing IS NULL, 'N8: events without a tenant: ' || v_missing;

  SELECT DISTINCT tenant_id INTO v_tenant FROM outbox_events WHERE aggregate_id = v_gen::text;
  ASSERT v_tenant = v_user, 'N8: tenant is ' || COALESCE(v_tenant, 'NULL');

  -- created + processing + completed, each exactly once.
  ASSERT (SELECT count(*) FROM outbox_events WHERE aggregate_id = v_gen::text) = 3,
    'N8: expected three lifecycle events, got '
      || (SELECT count(*) FROM outbox_events WHERE aggregate_id = v_gen::text);

  RAISE NOTICE 'PROOF N8 PASS: untouched producers capture the tenant through emit_outbox_event';
END $$;


-- ---------------------------------------------------------------------------
-- PROOF N9 — the outbox is still the transaction boundary
-- ---------------------------------------------------------------------------
-- The 11-A additions must not have loosened what 6R proved. If the emit fails,
-- the state change fails with it.
DO $$
DECLARE v_user text; v_project uuid; v_gen uuid; v_status text; v_n integer;
BEGIN
  SELECT o_user, o_project INTO v_user, v_project FROM mk_tenant_project('n9');
  v_gen := (create_generation_tx(v_user, v_project, 'image', 'mock', 'mock-image',
                                 'p', '{}'::jsonb, NULL, NULL, 'idem-n9-key', 'h')->>'generation_id')::uuid;

  BEGIN
    PERFORM outbox_tx_rollback_probe(v_gen);
    RAISE EXCEPTION 'PROOF N9 FAILED: the rollback probe did not raise';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  SELECT status INTO v_status FROM generations WHERE id = v_gen;
  ASSERT v_status = 'queued', 'N9: the probe UPDATE survived its failed emit, status is ' || v_status;

  SELECT count(*) INTO v_n FROM outbox_events
   WHERE aggregate_id = v_gen::text AND event_type = 'generation.cancelled';
  ASSERT v_n = 0, 'N9: a cancelled event survived the rollback';

  RAISE NOTICE 'PROOF N9 PASS: outbox and business write still commit or roll back together';
END $$;


-- ===========================================================================
-- Race fixtures — driven by run_pg_tests.sh from parallel connections
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.notification_race_results (
  race text NOT NULL,
  worker integer NOT NULL,
  outcome text NOT NULL,
  detail text
);

CREATE TABLE IF NOT EXISTS public.notification_race_fixtures (
  tag text PRIMARY KEY,
  generation_id uuid,
  clerk_user_id text
);

-- N concurrent claims of one queued generation. Exactly one may win, so
-- exactly one processing event may exist.
CREATE OR REPLACE FUNCTION public.claim_race(p_worker integer, p_generation uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  v := claim_generation_tx(p_generation, 'submitting', 'trace-claim-' || p_worker);
  INSERT INTO notification_race_results (race, worker, outcome, detail)
  VALUES ('claim', p_worker,
          CASE WHEN (v->>'claimed')::boolean THEN 'claimed' ELSE v->>'reason' END,
          v->>'event_id');
EXCEPTION WHEN others THEN
  INSERT INTO notification_race_results (race, worker, outcome, detail)
  VALUES ('claim', p_worker, 'error', SQLERRM);
END;
$fn$;

-- N concurrent creations under ONE idempotency key. Exactly one generation,
-- and therefore exactly one queued event.
CREATE OR REPLACE FUNCTION public.create_event_race(
  p_worker integer, p_user text, p_project uuid, p_key text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  v := create_generation_tx(p_user, p_project, 'image', 'mock', 'mock-image',
                            'race prompt', '{}'::jsonb, NULL, NULL, p_key, 'hash-race');
  INSERT INTO notification_race_results (race, worker, outcome, detail)
  VALUES ('create', p_worker,
          CASE WHEN (v->>'created')::boolean THEN 'created' ELSE 'replayed' END,
          v->>'generation_id');
EXCEPTION WHEN others THEN
  INSERT INTO notification_race_results (race, worker, outcome, detail)
  VALUES ('create', p_worker, 'error', SQLERRM);
END;
$fn$;

SELECT 'PHASE 11-A SEQUENTIAL PROOFS PASSED' AS result;
