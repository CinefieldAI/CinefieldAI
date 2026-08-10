-- Cinefield Phase 6R.6 — generation_attempts + Temporal workflow correlation.
--
-- WHY THIS TABLE EXISTS
-- Through Phase 6 the entire execution truth for a generation lived in
-- generations.metadata JSON: the provider job id, the submission evidence,
-- the finalization lease. That was correct for one provider and one attempt,
-- but the locked Phase 6R architecture has Temporal retrying activities and
-- (from Phase 7) a router trying more than one provider for the same
-- generation. Neither is safe while the only record of "did we already send
-- this to a provider?" is a JSON blob that every writer replaces wholesale.
--
-- generation_attempts makes one provider submission a first-class row, so the
-- double-billing rules become DATABASE constraints instead of conventions:
-- exactly one active attempt per generation, and one external provider job
-- claimed by at most one attempt.
--
-- ADDITIVE AND REVERSIBLE
-- Nothing existing is dropped, renamed, or rewritten. generations keeps every
-- column and every status value it has today, so current API and UI consumers
-- are unaffected. One nullable column is added to generations for workflow
-- correlation.

-- ---------------------------------------------------------------------------
-- generations: Temporal workflow correlation
-- ---------------------------------------------------------------------------
-- Nullable on purpose: rows created before Temporal ownership, and rows still
-- running on the direct/trigger paths, simply have no workflow. UNIQUE gives
-- the inverse mapping (one generation per workflow id) a database guarantee
-- rather than trusting the id derivation to stay deterministic forever.
ALTER TABLE "public"."generations"
  ADD COLUMN IF NOT EXISTS "temporal_workflow_id" "text";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'generations_temporal_workflow_id_key'
  ) THEN
    ALTER TABLE "public"."generations"
      ADD CONSTRAINT "generations_temporal_workflow_id_key" UNIQUE ("temporal_workflow_id");
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- generation_attempts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."generation_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "generation_id" "uuid" NOT NULL,
    -- 1-based, dense per generation. Ordering and the retry count come from
    -- this rather than from row insertion order.
    "attempt_no" integer NOT NULL,

    -- Cinefield provider registry id ("mock", "fal", ...) and the provider's
    -- own model identifier. Recorded per attempt because Phase 7's router may
    -- reach the same Cinefield model through different providers.
    "provider" "text" NOT NULL,
    "provider_model" "text" NOT NULL,

    -- The external provider's own job/task id. NULL until the provider
    -- returns one. Its presence is the strongest evidence a billable job
    -- exists — see the partial unique index below.
    "provider_job_id" "text",

    -- Attempt lifecycle. Deliberately richer than generations.status so the
    -- coarse public status column never has to change:
    --   pending    row created, nothing sent
    --   claimed    atomically reserved for submission (the CAS winner)
    --   submitting provider call in flight — the dangerous window
    --   submitted  provider accepted, provider_job_id known
    --   processing provider reported it is working
    --   succeeded / failed / cancelled  terminal
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,

    -- What Cinefield can PROVE about whether an external job exists. Mirrors
    -- the SubmissionEvidence union already used by the Phase 6 orchestrator:
    --   none       provably nothing sent; a submit may be attempted
    --   ambiguous  a request may have reached the provider, outcome unknown;
    --              never resubmit, never fail over, reconcile first
    --   job        provider returned a job id; never submit again
    "submission_evidence" "text" DEFAULT 'none'::"text" NOT NULL,

    -- Orchestration error CODE only (never a message, payload, or provider
    -- response) for the failure that made the outcome unknown.
    "submission_error_code" "text",

    -- Temporal correlation. workflow_id is the deterministic gen:<id> value;
    -- run_id identifies the specific execution that drove THIS attempt, which
    -- is not derivable and is what makes a Temporal run traceable to a row.
    "workflow_id" "text",
    "workflow_run_id" "text",

    -- Populated only when a provider actually reports them. No value is ever
    -- estimated or inferred: an unknown cost stays NULL.
    "cost_amount" numeric(12,6),
    "cost_currency" "text",
    "latency_ms" integer,

    -- Normalized OrchestrationErrorCode. Never a provider message.
    "error_code" "text",

    "started_at" timestamp with time zone,
    "submitted_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "generation_attempts_attempt_no_check" CHECK (("attempt_no" >= 1)),
    CONSTRAINT "generation_attempts_provider_check"
      CHECK ((("char_length"("provider") >= 1) AND ("char_length"("provider") <= 100))),
    CONSTRAINT "generation_attempts_provider_model_check"
      CHECK ((("char_length"("provider_model") >= 1) AND ("char_length"("provider_model") <= 200))),
    CONSTRAINT "generation_attempts_provider_job_id_check"
      CHECK (("provider_job_id" IS NULL) OR ("char_length"("provider_job_id") <= 500)),
    CONSTRAINT "generation_attempts_status_check" CHECK (("status" = ANY (ARRAY[
      'pending'::"text",
      'claimed'::"text",
      'submitting'::"text",
      'submitted'::"text",
      'processing'::"text",
      'succeeded'::"text",
      'failed'::"text",
      'cancelled'::"text"
    ]))),
    CONSTRAINT "generation_attempts_submission_evidence_check"
      CHECK (("submission_evidence" = ANY (ARRAY[
        'none'::"text",
        'ambiguous'::"text",
        'job'::"text"
      ]))),
    -- Evidence and job id must agree. A job id without 'job' evidence, or
    -- 'job' evidence without a job id, would defeat every guard built on
    -- either one, so the database refuses the combination outright.
    CONSTRAINT "generation_attempts_job_evidence_check" CHECK (
      (("submission_evidence" = 'job'::"text") AND ("provider_job_id" IS NOT NULL))
      OR (("submission_evidence" <> 'job'::"text") AND ("provider_job_id" IS NULL))
    ),
    CONSTRAINT "generation_attempts_completed_at_check" CHECK (
      ("completed_at" IS NULL) OR ("status" = ANY (ARRAY[
        'succeeded'::"text", 'failed'::"text", 'cancelled'::"text"
      ]))
    ),
    CONSTRAINT "generation_attempts_cost_currency_check"
      CHECK (("cost_currency" IS NULL) OR ("char_length"("cost_currency") = 3)),
    CONSTRAINT "generation_attempts_latency_check"
      CHECK (("latency_ms" IS NULL) OR ("latency_ms" >= 0))
);

ALTER TABLE "public"."generation_attempts" OWNER TO "postgres";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'generation_attempts_pkey'
  ) THEN
    ALTER TABLE ONLY "public"."generation_attempts"
      ADD CONSTRAINT "generation_attempts_pkey" PRIMARY KEY ("id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'generation_attempts_generation_id_fkey'
  ) THEN
    ALTER TABLE ONLY "public"."generation_attempts"
      ADD CONSTRAINT "generation_attempts_generation_id_fkey"
      FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE CASCADE;
  END IF;

  -- Attempt numbering is dense and unique per generation, so "attempt 2"
  -- always means the same row and a concurrent double-create loses.
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'generation_attempts_generation_id_attempt_no_key'
  ) THEN
    ALTER TABLE ONLY "public"."generation_attempts"
      ADD CONSTRAINT "generation_attempts_generation_id_attempt_no_key"
      UNIQUE ("generation_id", "attempt_no");
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Double-billing protection, enforced by the database
-- ---------------------------------------------------------------------------

-- One external provider job belongs to at most one attempt. Partial, because
-- provider_job_id is NULL until a provider answers and many NULLs must
-- coexist. Scoped by provider: two providers may legitimately mint the same
-- id string. This is what makes a webhook's (provider, job id) correlation a
-- database guarantee rather than a best-effort lookup.
CREATE UNIQUE INDEX IF NOT EXISTS "generation_attempts_provider_job_uniq"
  ON "public"."generation_attempts" ("provider", "provider_job_id")
  WHERE ("provider_job_id" IS NOT NULL);

-- AT MOST ONE ACTIVE ATTEMPT PER GENERATION.
-- The locked B3 rule, in the one place that cannot be bypassed by a retry, a
-- race, or a second process: a Temporal activity re-running after a crash
-- cannot insert a second live attempt, because the index rejects it.
CREATE UNIQUE INDEX IF NOT EXISTS "generation_attempts_one_active_uniq"
  ON "public"."generation_attempts" ("generation_id")
  WHERE ("status" = ANY (ARRAY[
    'pending'::"text", 'claimed'::"text", 'submitting'::"text",
    'submitted'::"text", 'processing'::"text"
  ]));

-- Reconciliation (Phase 7) scans for attempts whose outcome is unknown.
CREATE INDEX IF NOT EXISTS "generation_attempts_ambiguous_idx"
  ON "public"."generation_attempts" ("submission_evidence", "created_at")
  WHERE ("submission_evidence" = 'ambiguous'::"text");

CREATE INDEX IF NOT EXISTS "generation_attempts_generation_id_idx"
  ON "public"."generation_attempts" ("generation_id", "attempt_no" DESC);

CREATE INDEX IF NOT EXISTS "generation_attempts_status_created_at_idx"
  ON "public"."generation_attempts" ("status", "created_at");

CREATE INDEX IF NOT EXISTS "generation_attempts_provider_status_idx"
  ON "public"."generation_attempts" ("provider", "status");

CREATE INDEX IF NOT EXISTS "generation_attempts_workflow_id_idx"
  ON "public"."generation_attempts" ("workflow_id")
  WHERE ("workflow_id" IS NOT NULL);

-- Reuses the existing shared trigger function rather than defining a second.
CREATE OR REPLACE TRIGGER "generation_attempts_set_updated_at"
  BEFORE UPDATE ON "public"."generation_attempts"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- ---------------------------------------------------------------------------
-- Access: server-only
-- ---------------------------------------------------------------------------
-- This table is internal execution truth — provider ids, evidence, error
-- codes. The browser never needs it and must not have it, so RLS is on with
-- NO policy for `authenticated`: no policy means no rows, which is the
-- correct default for a table the browser has no business reading. Only the
-- service-role server client may touch it.
ALTER TABLE "public"."generation_attempts" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."generation_attempts" TO "service_role";
