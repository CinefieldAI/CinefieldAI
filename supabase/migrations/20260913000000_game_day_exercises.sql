-- Phase 26-D: game-day exercise evidence (append-only).
--
-- One row per recorded chaos/game-day drill. Written exclusively by
-- src/lib/chaos/game-day-execution-service.ts, which recomputes the outcome
-- server-side from Phase 15-D/2's own measureRecovery() — this table never
-- accepts a caller-supplied verdict, only raw evidence plus the computed
-- result. Append-only: an exercise, once recorded, is never edited (no
-- UPDATE grant), matching credit_ledger's own "history, not a mutable
-- record" shape.
--
-- No secret value, no prompt, no PII, no stack trace, no connection string
-- has anywhere to go in this shape — every text field is an id, a bounded
-- enum, or a reason-code-shaped string; failed_guardrails/permanent_actions
-- are bounded arrays of the same reason-code shape, never free prose.

CREATE TABLE IF NOT EXISTS "public"."game_day_exercises" (
  "id" uuid PRIMARY KEY,
  "scenario_id" text NOT NULL,
  "environment" text NOT NULL,
  "started_at" timestamptz NOT NULL,
  "ended_at" timestamptz,
  "recovery_class" text NOT NULL,
  "affected_component" text NOT NULL,
  "recovery_result" text NOT NULL,
  "recovery_reason_code" text NOT NULL,
  "target_rto_ms" numeric,
  "observed_recovery_ms" numeric,
  "target_rpo_seconds" numeric,
  "observed_data_loss_seconds" numeric,
  "outcome" text NOT NULL,
  "outcome_reason_code" text NOT NULL,
  "failed_guardrails" text[] NOT NULL DEFAULT '{}',
  "permanent_actions" text[] NOT NULL DEFAULT '{}',
  "runbook_update_ref" text,
  "recorded_by_clerk_user_id" text NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "game_day_exercises_scenario_id_length" CHECK (char_length("scenario_id") BETWEEN 1 AND 100),
  -- production is intentionally NOT in this list — chaos-environment-guard.ts
  -- refuses it unconditionally at the application layer; the database CHECK
  -- restates that as a second, independent boundary rather than trusting the
  -- application to be the only place the rule is enforced.
  CONSTRAINT "game_day_exercises_environment_check" CHECK ("environment" IN ('local', 'test', 'staging')),
  CONSTRAINT "game_day_exercises_recovery_result_check" CHECK (
    "recovery_result" IN (
      'RECOVERED_WITHIN_TARGET', 'RECOVERED_OUTSIDE_TARGET', 'RECOVERED_NO_TARGET',
      'RECOVERY_INCOMPLETE', 'EVIDENCE_UNAVAILABLE', 'INVALID_EVIDENCE'
    )
  ),
  CONSTRAINT "game_day_exercises_outcome_check" CHECK ("outcome" IN ('PASS', 'FAIL', 'INCONCLUSIVE', 'NO_TARGET_CONFIGURED')),
  CONSTRAINT "game_day_exercises_recovery_reason_code_check" CHECK ("recovery_reason_code" ~ '^[a-z][a-z0-9_:]{1,80}$'),
  CONSTRAINT "game_day_exercises_outcome_reason_code_check" CHECK ("outcome_reason_code" ~ '^[a-z][a-z0-9_:]{1,80}$'),
  CONSTRAINT "game_day_exercises_recorded_by_length" CHECK (char_length("recorded_by_clerk_user_id") BETWEEN 1 AND 255),
  CONSTRAINT "game_day_exercises_runbook_ref_length" CHECK ("runbook_update_ref" IS NULL OR char_length("runbook_update_ref") <= 200),
  CONSTRAINT "game_day_exercises_guardrails_bounded" CHECK (cardinality("failed_guardrails") <= 20),
  CONSTRAINT "game_day_exercises_actions_bounded" CHECK (cardinality("permanent_actions") <= 20),
  CONSTRAINT "game_day_exercises_target_rto_positive" CHECK ("target_rto_ms" IS NULL OR "target_rto_ms" > 0),
  CONSTRAINT "game_day_exercises_target_rpo_positive" CHECK ("target_rpo_seconds" IS NULL OR "target_rpo_seconds" >= 0)
);

CREATE INDEX IF NOT EXISTS "game_day_exercises_environment_recorded_at_idx"
  ON "public"."game_day_exercises" ("environment", "recorded_at" DESC);

CREATE INDEX IF NOT EXISTS "game_day_exercises_scenario_id_idx"
  ON "public"."game_day_exercises" ("scenario_id");

ALTER TABLE "public"."game_day_exercises" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."game_day_exercises" FROM "anon", "authenticated";
GRANT SELECT, INSERT ON TABLE "public"."game_day_exercises" TO "service_role";
