import type { GameDayOutcome } from "@/lib/chaos/game-day-contract";
import type { RecoveryResultState } from "@/lib/recovery/recovery-contract";

/**
 * Phase 26-D Admin Game-Day / Chaos Resilience dashboard contract — read-only.
 *
 * Mirrors `secrets-admin-contract.ts`'s own shape: every row is exactly what
 * `game_day_exercises` (Phase 26-D) already says, plus the static scenario
 * catalogue (Phase 26-A) for reference — no second opinion computed here.
 */
export interface GameDayExerciseRow {
  readonly exerciseId: string;
  readonly scenarioId: string;
  readonly environment: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly recoveryResult: RecoveryResultState;
  readonly targetRtoMs: number | null;
  readonly observedRecoveryMs: number | null;
  readonly targetRpoSeconds: number | null;
  readonly observedDataLossSeconds: number | null;
  readonly outcome: GameDayOutcome;
  readonly outcomeReasonCode: string;
  readonly failedGuardrails: readonly string[];
  readonly permanentActions: readonly string[];
  readonly runbookUpdateRef: string | null;
  readonly recordedAt: string;
}

export interface GameDayAdminView {
  readonly exercises: readonly GameDayExerciseRow[];
  readonly scenarioCount: number;
  readonly rtoTargetsConfigured: number;
  readonly rpoTargetsConfigured: number;
}

export type GameDayAdminResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly view: GameDayAdminView };
