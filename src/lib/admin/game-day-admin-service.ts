import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GAME_DAY_SCENARIOS } from "@/lib/chaos/game-day-catalogue";
import { RTO_TARGETS, RPO_TARGETS } from "@/lib/recovery/recovery-target-registry";
import type { GameDayAdminResult, GameDayExerciseRow } from "./game-day-admin-contract";

const MAX_ROWS = 100;

/**
 * The Phase 26-D admin Game-Day read service.
 *
 * A plain read, matching `secrets-admin-service.ts`'s own "not a second
 * authority" discipline: `game_day_exercises` is read straight from its
 * table (Phase 26-D), the scenario count is the static catalogue's own
 * length (Phase 26-A), and the RTO/RPO configured counts are Phase 15-D/2's
 * OWN registries' real size — reported honestly (today: always 0, no
 * business-approved target exists), never fabricated.
 */
export async function getGameDayAdminView(admin: SupabaseClient): Promise<GameDayAdminResult> {
  try {
    const { data, error } = await admin
      .from("game_day_exercises")
      .select(
        "id, scenario_id, environment, started_at, ended_at, recovery_result, target_rto_ms, observed_recovery_ms, target_rpo_seconds, observed_data_loss_seconds, outcome, outcome_reason_code, failed_guardrails, permanent_actions, runbook_update_ref, recorded_at"
      )
      .order("recorded_at", { ascending: false })
      .limit(MAX_ROWS);

    if (error) return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "game_day_exercises_read_failed" };

    const exercises: GameDayExerciseRow[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      exerciseId: row.id as string,
      scenarioId: row.scenario_id as string,
      environment: row.environment as string,
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string | null) ?? null,
      recoveryResult: row.recovery_result as GameDayExerciseRow["recoveryResult"],
      targetRtoMs: (row.target_rto_ms as number | null) ?? null,
      observedRecoveryMs: (row.observed_recovery_ms as number | null) ?? null,
      targetRpoSeconds: (row.target_rpo_seconds as number | null) ?? null,
      observedDataLossSeconds: (row.observed_data_loss_seconds as number | null) ?? null,
      outcome: row.outcome as GameDayExerciseRow["outcome"],
      outcomeReasonCode: row.outcome_reason_code as string,
      failedGuardrails: (row.failed_guardrails as string[] | null) ?? [],
      permanentActions: (row.permanent_actions as string[] | null) ?? [],
      runbookUpdateRef: (row.runbook_update_ref as string | null) ?? null,
      recordedAt: row.recorded_at as string,
    }));

    return {
      outcome: "FOUND",
      view: {
        exercises,
        scenarioCount: GAME_DAY_SCENARIOS.length,
        rtoTargetsConfigured: Object.keys(RTO_TARGETS).length,
        rpoTargetsConfigured: Object.keys(RPO_TARGETS).length,
      },
    };
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "game_day_admin_read_failed" };
  }
}
