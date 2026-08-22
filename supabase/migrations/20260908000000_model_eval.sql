-- Cinefield Phase 22 — AI Model Evaluation & Quality Governance.
--
-- ===========================================================================
-- WHAT THIS OWNS, AND WHAT IT DELIBERATELY DOES NOT
-- ===========================================================================
-- Two tables: the durable EXECUTION HISTORY of evaluation runs and their
-- per-case results. This is NOT where the golden dataset's actual prompts/
-- criteria live — those are source-controlled TypeScript fixtures
-- (`src/lib/eval/golden-dataset.ts`), reviewable via a normal PR diff rather
-- than a migration or an admin screen, matching the roadmap's own
-- "temsilî prompt/reference/criteria setleri" (representative fixtures)
-- framing and this project's standing "no DB table by default" discipline.
-- `model_eval_runs`/`model_eval_results` reference a golden-dataset case by
-- its stable `case_key` (a string the TypeScript fixture owns), never a
-- foreign key into a table that does not exist here.
--
-- ===========================================================================
-- THE IDENTITY THIS JOINS ON, AND WHY
-- ===========================================================================
-- `provider_id` + `provider_model_id` here are the SAME text identity pair
-- `src/lib/routing/route-quality.ts`'s `QualitySignalProvider.read()` already
-- takes as its two arguments (Phase 7-D's pre-built, currently-unpopulated
-- quality seam) — not `provider_models.id` (a uuid this migration does not
-- reference). Phase 22's job is to become a real, callable implementation of
-- that EXISTING interface; storing the same two strings this table already
-- expects is what makes a plain equality WHERE, not a join, the real query
-- the router-facing provider issues. `model_version_id` (a real FK into
-- `model_versions`) is stored ADDITIONALLY, for the admin dashboard's own
-- "which Cinefield model version" reporting — it is not part of the
-- router-quality lookup key.
--
-- ===========================================================================
-- IMMUTABLE ONCE COMPLETE
-- ===========================================================================
-- 22-A's own done-criterion is "the first model/provider experiment record
-- is created with IMMUTABLE metadata." A run's identity columns
-- (model_version_id, provider_id, provider_model_id, eval_set_key,
-- evaluator, evaluator_version, started_at) and every result row are never
-- updated after the run reaches a terminal status — only `completed_at` and
-- `status` transition, exactly once, guarded by the RPC below. This mirrors
-- `admin_privileged_action_events`'s append-only discipline for the RESULTS
-- table specifically (a trigger refuses UPDATE/DELETE), and a narrower
-- one-way status transition for the run row itself (a table-wide append-only
-- trigger would also forbid the single legitimate started->completed
-- transition, so the RPC enforces this instead of a trigger).

CREATE TABLE IF NOT EXISTS "public"."model_eval_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,

    -- Real Phase 7 identity — never a second identity space.
    "model_version_id" "uuid" NOT NULL REFERENCES "public"."model_versions"("id") ON DELETE CASCADE,
    "provider_id" "text" NOT NULL,
    "provider_model_id" "text" NOT NULL,

    -- The golden-dataset set this run was measured against — a stable key
    -- the TypeScript fixture owns (src/lib/eval/golden-dataset.ts), not a
    -- foreign key into a table this migration does not create.
    "eval_set_key" "text" NOT NULL,

    -- PROVENANCE. A run with no named evaluator is not a governed
    -- measurement — see route-quality.ts's own "an anonymous number must
    -- not influence routing" rule, which this run feeds.
    "evaluator" "text" NOT NULL,
    "evaluator_version" "text" NOT NULL,

    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,

    -- Bounded, non-secret run-level metadata only — e.g. case counts. Never
    -- a raw provider payload or prompt (those live in the source-controlled
    -- fixture and the per-result row's own bounded columns).
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,

    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "model_eval_runs_provider_id_check" CHECK (("char_length"("provider_id") BETWEEN 1 AND 100)),
    CONSTRAINT "model_eval_runs_provider_model_id_check" CHECK (("char_length"("provider_model_id") BETWEEN 1 AND 200)),
    CONSTRAINT "model_eval_runs_eval_set_key_check" CHECK (("eval_set_key" ~ '^[a-z][a-z0-9_-]{1,80}$'::"text")),
    CONSTRAINT "model_eval_runs_evaluator_check" CHECK (("char_length"("evaluator") BETWEEN 1 AND 100)),
    CONSTRAINT "model_eval_runs_evaluator_version_check" CHECK (("char_length"("evaluator_version") BETWEEN 1 AND 40)),
    CONSTRAINT "model_eval_runs_status_check" CHECK (("status" = ANY (ARRAY[
      'running'::"text", 'completed'::"text", 'failed'::"text"
    ])))
);

CREATE INDEX IF NOT EXISTS "model_eval_runs_lookup_idx"
  ON "public"."model_eval_runs" ("provider_id", "provider_model_id", "status", "completed_at" DESC);

CREATE INDEX IF NOT EXISTS "model_eval_runs_version_idx"
  ON "public"."model_eval_runs" ("model_version_id", "completed_at" DESC);

COMMENT ON TABLE "public"."model_eval_runs" IS
  'Phase 22. One row per evaluation run of one model version against one golden-dataset set. Identity columns and per-result rows are immutable once status leaves "running" — see this file''s header.';

CREATE TABLE IF NOT EXISTS "public"."model_eval_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "run_id" "uuid" NOT NULL REFERENCES "public"."model_eval_runs"("id") ON DELETE CASCADE,

    -- The golden-dataset case key (src/lib/eval/golden-dataset.ts), not a
    -- foreign key.
    "case_key" "text" NOT NULL,

    -- One bounded [0,1] score per scorer dimension, or null when that
    -- dimension could not be measured for this case (e.g. an AI-judge
    -- dimension with no live judge configured) — see
    -- src/lib/eval/scorers/*.ts. NEVER a fabricated number standing in for
    -- "not measured."
    "adherence_score" real,
    "quality_score" real,
    "consistency_score" real,
    "safety_score" real,
    "latency_ms" integer,
    "cost_amount" numeric,
    "cost_currency" "text",
    "failed" boolean NOT NULL,

    -- Bounded reason/verdict — never raw provider output, never a prompt,
    -- never chain-of-thought from an AI judge (src/lib/eval/eval-contract.ts
    -- enforces the same bound in TypeScript before a row is ever written).
    "verdict" "text" NOT NULL,
    "reason_code" "text",

    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "model_eval_results_case_key_check" CHECK (("case_key" ~ '^[a-z][a-z0-9_-]{1,80}$'::"text")),
    CONSTRAINT "model_eval_results_verdict_check" CHECK (("verdict" = ANY (ARRAY[
      'pass'::"text", 'fail'::"text", 'inconclusive'::"text"
    ]))),
    CONSTRAINT "model_eval_results_reason_code_check" CHECK (("reason_code" IS NULL) OR ("reason_code" ~ '^[a-z][a-z0-9_]{1,64}$'::"text")),
    CONSTRAINT "model_eval_results_adherence_range" CHECK (("adherence_score" IS NULL) OR ("adherence_score" BETWEEN 0 AND 1)),
    CONSTRAINT "model_eval_results_quality_range" CHECK (("quality_score" IS NULL) OR ("quality_score" BETWEEN 0 AND 1)),
    CONSTRAINT "model_eval_results_consistency_range" CHECK (("consistency_score" IS NULL) OR ("consistency_score" BETWEEN 0 AND 1)),
    CONSTRAINT "model_eval_results_safety_range" CHECK (("safety_score" IS NULL) OR ("safety_score" BETWEEN 0 AND 1)),
    CONSTRAINT "model_eval_results_latency_check" CHECK (("latency_ms" IS NULL) OR ("latency_ms" >= 0)),
    CONSTRAINT "model_eval_results_cost_check" CHECK (("cost_amount" IS NULL) OR ("cost_amount" >= 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS "model_eval_results_run_case_uniq"
  ON "public"."model_eval_results" ("run_id", "case_key");

COMMENT ON TABLE "public"."model_eval_results" IS
  'Phase 22. Append-only per-case scores for one model_eval_runs row. Never updated or deleted, same discipline feature_flag_audit/admin_privileged_action_events already use.';

-- Append-only, the same pattern feature_flag_audit_append_only() (Phase 21,
-- 20260901000000) and admin_privileged_action_events_append_only() (Phase
-- 16-E, 20260829000000) already established.
CREATE OR REPLACE FUNCTION "public"."model_eval_results_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'model_eval_results is append-only' USING ERRCODE = '0A000';
END;
$$;

DROP TRIGGER IF EXISTS "model_eval_results_no_update" ON "public"."model_eval_results";
CREATE TRIGGER "model_eval_results_no_update"
    BEFORE UPDATE OR DELETE ON "public"."model_eval_results"
    FOR EACH ROW EXECUTE FUNCTION "public"."model_eval_results_append_only"();

-- ---------------------------------------------------------------------------
-- start_model_eval_run() / complete_model_eval_run()
-- ---------------------------------------------------------------------------
-- Two functions rather than one, because a run's lifetime spans many case
-- evaluations (each one a separate provider round-trip in the real
-- implementation) — unlike set_feature_flag()'s single-statement atomic
-- write, a run cannot be one PL/pgSQL transaction without holding it open
-- for the run's entire real-world duration. `start_model_eval_run()` inserts
-- the immutable identity row; each case result is inserted directly (RLS/
-- grants restrict this to service_role, same as every write here);
-- `complete_model_eval_run()` performs the ONE legitimate transition
-- (running -> completed/failed) and refuses a second call on the same row,
-- which is what makes the run's own row immutable in practice without an
-- append-only trigger that would also forbid this one transition.
CREATE OR REPLACE FUNCTION "public"."start_model_eval_run"(
    "p_model_version_id" "uuid",
    "p_provider_id" "text",
    "p_provider_model_id" "text",
    "p_eval_set_key" "text",
    "p_evaluator" "text",
    "p_evaluator_version" "text",
    "p_metadata" "jsonb" DEFAULT '{}'::"jsonb"
) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_run_id uuid;
BEGIN
  INSERT INTO model_eval_runs (
    model_version_id, provider_id, provider_model_id, eval_set_key,
    evaluator, evaluator_version, metadata
  )
  VALUES (
    p_model_version_id, p_provider_id, p_provider_model_id, p_eval_set_key,
    p_evaluator, p_evaluator_version, p_metadata
  )
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."complete_model_eval_run"(
    "p_run_id" "uuid",
    "p_status" "text"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'invalid_terminal_status' USING ERRCODE = '22023';
  END IF;

  -- The predicate is the whole point: only a row still 'running' transitions.
  -- A second call (or a race) affects zero rows rather than silently
  -- re-stamping completed_at, which is what makes the run's own identity
  -- row immutable in practice once it leaves 'running'.
  UPDATE model_eval_runs
  SET status = p_status, completed_at = now()
  WHERE id = p_run_id AND status = 'running';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

ALTER TABLE "public"."model_eval_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."model_eval_results" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."model_eval_runs" TO "service_role";
GRANT ALL ON TABLE "public"."model_eval_results" TO "service_role";

REVOKE ALL ON FUNCTION "public"."start_model_eval_run"("uuid", "text", "text", "text", "text", "text", "jsonb") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."complete_model_eval_run"("uuid", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."start_model_eval_run"("uuid", "text", "text", "text", "text", "text", "jsonb") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."complete_model_eval_run"("uuid", "text") TO "service_role";
