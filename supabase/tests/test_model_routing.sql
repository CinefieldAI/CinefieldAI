-- Cinefield Phase 7-A — routing schema proofs against REAL PostgreSQL.
--
-- Everything here is a database guarantee that no TypeScript test can make:
-- partial unique indexes, CHECK constraints, foreign-key behaviour on delete.
-- The router's POLICY is proven in src/test/e2e/phase-7-routing.e2e.test.ts;
-- this file proves the storage underneath it cannot hold an illegal state.

\set ON_ERROR_STOP on

-- Fixtures. Distinct from the seeded rows so a failure here is unambiguous.
INSERT INTO providers (id, label, enabled) VALUES ('proof-provider', 'Proof Provider', true)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO models (id, label, generation_type, lifecycle)
  VALUES ('proof-model', 'Proof Model', 'image', 'active')
  ON CONFLICT (id) DO NOTHING;

-- This file runs before the concurrency fixtures, so it owns its own project.
INSERT INTO projects (id, clerk_user_id, title)
  VALUES ('88888888-8888-4888-8888-888888888888', 'user_routing_proof', 'routing proof')
  ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_version_a uuid;
  v_version_b uuid;
  v_provider_model uuid;
  v_route uuid;
  v_failed boolean;
  v_count integer;
BEGIN
  INSERT INTO model_versions (model_id, version, status, capabilities)
    VALUES ('proof-model', 1, 'active', '{}'::jsonb)
    RETURNING id INTO v_version_a;

  -- ---- PROOF 1: one active version per model --------------------------
  -- Two "active" versions would make "the current version of this model" a
  -- question with two answers, and the router would pick by accident.
  v_failed := false;
  BEGIN
    INSERT INTO model_versions (model_id, version, status, capabilities)
      VALUES ('proof-model', 2, 'active', '{}'::jsonb);
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'ROUTING: a model must not have two active versions at once';
  RAISE NOTICE 'PROOF R1 PASS: one active model version is enforced by the database';

  -- A non-active second version is legitimate — that is how a rollout stages.
  INSERT INTO model_versions (model_id, version, status, capabilities)
    VALUES ('proof-model', 2, 'preview', '{}'::jsonb)
    RETURNING id INTO v_version_b;

  -- ---- PROOF 2: duplicate version numbers are impossible ---------------
  v_failed := false;
  BEGIN
    INSERT INTO model_versions (model_id, version, status, capabilities)
      VALUES ('proof-model', 2, 'disabled', '{}'::jsonb);
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'ROUTING: (model_id, version) must be unique';
  RAISE NOTICE 'PROOF R2 PASS: model version numbers are unique per model';

  INSERT INTO provider_models (provider_id, provider_model_id, enabled)
    VALUES ('proof-provider', 'proof/endpoint-v1', true)
    RETURNING id INTO v_provider_model;

  -- ---- PROOF 3: one provider cannot declare the same endpoint twice ----
  v_failed := false;
  BEGIN
    INSERT INTO provider_models (provider_id, provider_model_id, enabled)
      VALUES ('proof-provider', 'proof/endpoint-v1', false);
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'ROUTING: (provider_id, provider_model_id) must be unique';
  RAISE NOTICE 'PROOF R3 PASS: a provider endpoint is declared once';

  INSERT INTO model_routes (model_id, model_version_id, provider_model_id, enabled, priority, status)
    VALUES ('proof-model', v_version_a, v_provider_model, true, 100, 'active')
    RETURNING id INTO v_route;

  -- ---- PROOF 4: one route per (version, provider endpoint) -------------
  -- Duplicates would produce two candidates identical in every field the
  -- tie-break reads except the route id, which is exactly the ambiguity the
  -- deterministic router exists to avoid.
  v_failed := false;
  BEGIN
    INSERT INTO model_routes (model_id, model_version_id, provider_model_id, enabled, priority, status)
      VALUES ('proof-model', v_version_a, v_provider_model, true, 500, 'active');
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'ROUTING: (model_version_id, provider_model_id) must be unique';
  RAISE NOTICE 'PROOF R4 PASS: a version/endpoint pair has at most one route';

  -- ---- PROOF 5: priority and status are bounded ------------------------
  v_failed := false;
  BEGIN
    INSERT INTO model_routes (model_id, model_version_id, provider_model_id, enabled, priority, status)
      VALUES ('proof-model', v_version_b, v_provider_model, true, 99999, 'active');
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'ROUTING: priority must be range-checked';

  v_failed := false;
  BEGIN
    INSERT INTO model_routes (model_id, model_version_id, provider_model_id, enabled, priority, status)
      VALUES ('proof-model', v_version_b, v_provider_model, true, 100, 'whatever');
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'ROUTING: route status must be constrained to known values';
  RAISE NOTICE 'PROOF R5 PASS: priority and status cannot hold nonsense';

  -- ---- PROOF 6: attempt correlation is additive and survives deletion --
  -- The columns are nullable, so an attempt written before routing existed is
  -- still valid; and deleting a route must NEVER cascade into the attempt
  -- history, which is billing and audit evidence.
  INSERT INTO generations (id, project_id, clerk_user_id, generation_type, provider, model, prompt, status)
    VALUES ('77777777-7777-4777-8777-777777777777',
            '88888888-8888-4888-8888-888888888888',
            'user_routing_proof', 'image', 'mock', 'mock-image', 'routing proof', 'processing');

  INSERT INTO generation_attempts
    (generation_id, attempt_no, provider, provider_model, status, submission_evidence)
    VALUES ('77777777-7777-4777-8777-777777777777', 1, 'mock', 'mock-image', 'pending', 'none');

  SELECT count(*) INTO v_count
    FROM generation_attempts
   WHERE generation_id = '77777777-7777-4777-8777-777777777777'
     AND model_route_id IS NULL;
  ASSERT v_count = 1, 'ROUTING: an attempt without routing correlation must still be insertable';

  UPDATE generation_attempts
     SET model_version_id = v_version_a, model_route_id = v_route
   WHERE generation_id = '77777777-7777-4777-8777-777777777777';

  DELETE FROM model_routes WHERE id = v_route;

  SELECT count(*) INTO v_count
    FROM generation_attempts
   WHERE generation_id = '77777777-7777-4777-8777-777777777777'
     AND model_route_id IS NULL;
  ASSERT v_count = 1,
    'ROUTING: deleting a route must null the correlation, never delete the attempt';
  RAISE NOTICE 'PROOF R6 PASS: routing correlation is additive and never destroys attempt history';

  -- ---- PROOF 7: the tables are closed to the browser -------------------
  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('providers','models','model_versions','provider_models','model_routes');
  ASSERT v_count = 0, 'ROUTING: route tables must expose no RLS policy, found ' || v_count;

  SELECT count(*) INTO v_count
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('providers','models','model_versions','provider_models','model_routes')
     AND c.relrowsecurity;
  ASSERT v_count = 5, 'ROUTING: all five route tables must have RLS enabled, got ' || v_count;
  RAISE NOTICE 'PROOF R7 PASS: routing data is service-role only';

  -- ---- PROOF 8: Phase 6R attempt semantics survived the 7-A migration --
  -- The routing columns were added to a table whose concurrency guarantees
  -- predate them. Those guarantees are the reason one click cannot become two
  -- billable provider jobs, so an additive migration has to leave every one
  -- of them in place — this asserts the structures themselves, not a comment
  -- claiming they are still there.
  SELECT count(*) INTO v_count
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'generation_attempts'
     AND indexdef ILIKE '%UNIQUE%'
     AND indexdef ILIKE '%generation_id%';
  ASSERT v_count >= 2,
    'ATTEMPTS: the one-active-attempt and attempt_no unique indexes must survive, found '
      || v_count;

  SELECT count(*) INTO v_count
    FROM pg_constraint
   WHERE conrelid = 'public.generation_attempts'::regclass
     AND contype = 'f'
     AND confrelid = 'public.generations'::regclass;
  ASSERT v_count = 1,
    'ATTEMPTS: the generation_id foreign key must remain exactly one, found ' || v_count;

  -- generation_id stays NOT NULL: an attempt that belongs to no generation
  -- would break the 1 request = 1 generation = max 1 settlement invariant.
  SELECT count(*) INTO v_count
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'generation_attempts'
     AND column_name = 'generation_id' AND is_nullable = 'NO';
  ASSERT v_count = 1, 'ATTEMPTS: generation_id must remain NOT NULL';

  -- And the two new columns must be the ONLY thing 7-A added.
  SELECT count(*) INTO v_count
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'generation_attempts'
     AND column_name IN ('model_version_id','model_route_id')
     AND is_nullable = 'YES';
  ASSERT v_count = 2, 'ATTEMPTS: both routing columns must exist and be nullable';

  -- No second attempt system was introduced alongside the first.
  SELECT count(*) INTO v_count
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE '%attempt%';
  ASSERT v_count = 1,
    'ATTEMPTS: there must be exactly one attempt table, found ' || v_count;
  RAISE NOTICE 'PROOF R8 PASS: Phase 6R attempt semantics are intact and additive';
END $$;

SELECT 'ROUTING PROOFS PASSED' AS result;
