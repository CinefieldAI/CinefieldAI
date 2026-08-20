import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { measureRecovery } from "@/lib/recovery/recovery-measurement-engine";
import type { RecoveryIncidentEvidence } from "@/lib/recovery/recovery-contract";
import type { RestoreValidationState } from "@/lib/dr/restore-evidence-contract";
import { gameDayScenario } from "./game-day-catalogue";
import { isChaosExecutionAllowed } from "./chaos-environment-guard";
import {
  classifyGameDayOutcome,
  isValidGuardrailOrActionEntry,
  MAX_GUARDRAIL_ENTRIES,
  MAX_PERMANENT_ACTION_ENTRIES,
  type GameDayExerciseRecord,
} from "./game-day-contract";

/**
 * Game-day exercise recording service (Phase 26-D).
 *
 * ---------------------------------------------------------------------------
 * "OPERATOR CLAIMS RECOVERED" != "RECOVERY VERIFIED" — SAME DISCIPLINE AS
 * PHASE 25's "PROVIDER ACCEPTS NEW SECRET != ROTATION VERIFIED"
 * ---------------------------------------------------------------------------
 * The caller (an admin who ran a drill — locally, or against a real staging
 * environment outside this repository) submits raw incident timestamps and
 * observations, never a verdict. This service ALWAYS recomputes the outcome
 * server-side via Phase 15-D/2's own `measureRecovery()` — it never accepts
 * a caller-supplied `outcome`/`recovery.result` field. A submission cannot
 * lie its way to PASS.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A RECORDER, NOT A FAULT-INJECTION TRIGGER
 * ---------------------------------------------------------------------------
 * No fault is injected by this file. It records the measured outcome of a
 * drill that already happened — run locally against a fake/test target
 * today, or (once 26-B/26-C's AWS FIS wiring and stop conditions are applied
 * for real, a separate and later decision) against a real staging or
 * production environment. `isChaosExecutionAllowed` still refuses a
 * `production` submission unconditionally: recording evidence FROM a
 * production drill is out of scope for this batch exactly because no
 * production drill can safely happen yet.
 */

export type RecordGameDayExerciseOutcome =
  | { readonly outcome: "UNKNOWN_SCENARIO" }
  | { readonly outcome: "ENVIRONMENT_DENIED"; readonly reasonCode: string }
  | { readonly outcome: "INVALID_INPUT"; readonly reasonCode: string }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "RECORDED"; readonly record: GameDayExerciseRecord };

export interface RecordGameDayExerciseParams {
  readonly scenarioId: string;
  readonly environment: string;
  readonly actorClerkUserId: string;
  readonly incident: RecoveryIncidentEvidence;
  readonly now: Date;
  readonly observedDataLossSeconds?: number | null;
  readonly restoreValidationState?: RestoreValidationState;
  readonly failedGuardrails?: readonly string[];
  readonly permanentActions?: readonly string[];
  readonly runbookUpdateRef?: string | null;
}

function validateEntries(values: readonly string[] | undefined, max: number): boolean {
  if (values === undefined) return true;
  if (values.length > max) return false;
  return values.every(isValidGuardrailOrActionEntry);
}

export async function recordGameDayExercise(
  admin: SupabaseClient,
  params: RecordGameDayExerciseParams
): Promise<RecordGameDayExerciseOutcome> {
  const scenario = gameDayScenario(params.scenarioId);
  if (!scenario) return { outcome: "UNKNOWN_SCENARIO" };

  const environmentDecision = isChaosExecutionAllowed(params.environment);
  if (!environmentDecision.allowed) {
    return { outcome: "ENVIRONMENT_DENIED", reasonCode: environmentDecision.reasonCode };
  }

  if (params.incident.recoveryClass !== scenario.recoveryClass || params.incident.affectedComponent !== scenario.affectedComponent) {
    return { outcome: "INVALID_INPUT", reasonCode: "incident_does_not_match_scenario" };
  }

  const failedGuardrails = params.failedGuardrails ?? [];
  const permanentActions = params.permanentActions ?? [];
  if (!validateEntries(failedGuardrails, MAX_GUARDRAIL_ENTRIES)) {
    return { outcome: "INVALID_INPUT", reasonCode: "failed_guardrails_malformed" };
  }
  if (!validateEntries(permanentActions, MAX_PERMANENT_ACTION_ENTRIES)) {
    return { outcome: "INVALID_INPUT", reasonCode: "permanent_actions_malformed" };
  }
  if (params.runbookUpdateRef !== undefined && params.runbookUpdateRef !== null && params.runbookUpdateRef.length > 200) {
    return { outcome: "INVALID_INPUT", reasonCode: "runbook_update_ref_too_long" };
  }

  const recovery = measureRecovery({
    incident: params.incident,
    now: params.now,
    observedDataLossSeconds: params.observedDataLossSeconds,
    restoreValidationState: params.restoreValidationState,
  });

  const { outcome, reasonCode } = classifyGameDayOutcome(recovery, failedGuardrails);

  const record: GameDayExerciseRecord = {
    exerciseId: randomUUID(),
    scenarioId: scenario.id,
    environment: params.environment as GameDayExerciseRecord["environment"],
    startedAt: params.incident.startedAt,
    endedAt: params.incident.serviceRestoredAt ?? null,
    recovery,
    outcome,
    outcomeReasonCode: reasonCode,
    failedGuardrails,
    permanentActions,
    runbookUpdateRef: params.runbookUpdateRef ?? null,
    recordedByClerkUserId: params.actorClerkUserId,
    recordedAt: params.now.toISOString(),
  };

  try {
    const { error } = await admin.from("game_day_exercises").insert({
      id: record.exerciseId,
      scenario_id: record.scenarioId,
      environment: record.environment,
      started_at: record.startedAt,
      ended_at: record.endedAt,
      recovery_class: recovery.recoveryClass,
      affected_component: recovery.affectedComponent,
      recovery_result: recovery.result,
      recovery_reason_code: recovery.reasonCode,
      target_rto_ms: recovery.targetRtoMs ?? null,
      observed_recovery_ms: recovery.recoveryDurationMs ?? null,
      target_rpo_seconds: recovery.targetRpoSeconds ?? null,
      observed_data_loss_seconds: recovery.observedDataLossSeconds ?? null,
      outcome: record.outcome,
      outcome_reason_code: record.outcomeReasonCode,
      failed_guardrails: record.failedGuardrails,
      permanent_actions: record.permanentActions,
      runbook_update_ref: record.runbookUpdateRef,
      recorded_by_clerk_user_id: record.recordedByClerkUserId,
      recorded_at: record.recordedAt,
    });
    if (error) return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "game_day_exercises_write_failed" };
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "game_day_exercises_write_failed" };
  }

  return { outcome: "RECORDED", record };
}
