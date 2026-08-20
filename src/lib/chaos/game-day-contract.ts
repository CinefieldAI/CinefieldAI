import type { RecoveryEvidence, RecoveryResultState } from "@/lib/recovery/recovery-contract";
import type { ChaosEnvironment } from "./game-day-catalogue";

/**
 * Game-day exercise evidence contract (Phase 26-D).
 *
 * ---------------------------------------------------------------------------
 * THIS DOES NOT MEASURE RECOVERY — IT CLASSIFIES AN ALREADY-MEASURED ONE
 * ---------------------------------------------------------------------------
 * The RTO/RPO arithmetic belongs entirely to Phase 15-D/2's
 * `measureRecovery()` (`recovery-measurement-engine.ts`), called UNMODIFIED
 * by `game-day-execution-service.ts`. This file adds exactly one new
 * question on top of that result: given a `RecoveryResultState` and whatever
 * guardrails failed during the drill, did the EXERCISE pass, fail, or stay
 * inconclusive? Section 20 of the Phase 26 brief names the exact vocabulary
 * (`PASS`/`FAIL`/`INCONCLUSIVE`/`NO_TARGET_CONFIGURED`) and forbids
 * reinterpreting the SLO math — `classifyGameDayOutcome` never touches
 * `rtoMet`/`rpoMet` beyond reading them.
 */

export type GameDayOutcome = "PASS" | "FAIL" | "INCONCLUSIVE" | "NO_TARGET_CONFIGURED";

const NON_FABRICATED_RESULT_STATES: ReadonlySet<RecoveryResultState> = new Set([
  "RECOVERED_WITHIN_TARGET",
  "RECOVERED_OUTSIDE_TARGET",
  "RECOVERED_NO_TARGET",
]);

/**
 * `failedGuardrails` are STOP CONDITIONS / safety invariants that tripped
 * during the drill (e.g. a blast-radius guardrail firing) — distinct from
 * the recovery itself succeeding or failing. A guardrail failure downgrades
 * a would-be PASS to FAIL even when the underlying recovery met its target,
 * because a drill that only "worked" by violating its own safety boundary
 * did not actually prove anything safe.
 */
export function classifyGameDayOutcome(
  evidence: RecoveryEvidence,
  failedGuardrails: readonly string[]
): { outcome: GameDayOutcome; reasonCode: string } {
  if (!NON_FABRICATED_RESULT_STATES.has(evidence.result)) {
    // INVALID_EVIDENCE / EVIDENCE_UNAVAILABLE / RECOVERY_INCOMPLETE — the
    // measurement engine itself never reached a proven conclusion. Calling
    // this anything but INCONCLUSIVE would be exactly the fabricated pass
    // section 9's "No fake pass" forbids.
    return { outcome: "INCONCLUSIVE", reasonCode: `recovery_${evidence.result.toLowerCase()}` };
  }

  if (failedGuardrails.length > 0) {
    return { outcome: "FAIL", reasonCode: "guardrail_failed" };
  }

  if (evidence.result === "RECOVERED_NO_TARGET") {
    return { outcome: "NO_TARGET_CONFIGURED", reasonCode: "no_target_configured" };
  }

  if (evidence.result === "RECOVERED_OUTSIDE_TARGET") {
    return { outcome: "FAIL", reasonCode: evidence.reasonCode };
  }

  return { outcome: "PASS", reasonCode: "recovered_within_target" };
}

/**
 * The complete, durable record of one game-day exercise. Bounded by
 * construction: every field is an id, an enum, a timestamp, a count, or a
 * short array of short reason-code-shaped strings — no prose, no log, no
 * stack trace, no secret value has anywhere to go in this shape.
 */
export interface GameDayExerciseRecord {
  readonly exerciseId: string;
  readonly scenarioId: string;
  readonly environment: ChaosEnvironment;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly recovery: RecoveryEvidence;
  readonly outcome: GameDayOutcome;
  readonly outcomeReasonCode: string;
  /** Bounded, short reason-code-shaped entries — never a stack trace or log line. */
  readonly failedGuardrails: readonly string[];
  readonly permanentActions: readonly string[];
  readonly runbookUpdateRef: string | null;
  readonly recordedByClerkUserId: string;
  readonly recordedAt: string;
}

const REASON_CODE_SHAPE = /^[a-z][a-z0-9_]{1,64}$/;

export function isValidGuardrailOrActionEntry(value: string): boolean {
  return REASON_CODE_SHAPE.test(value);
}

export const MAX_GUARDRAIL_ENTRIES = 20;
export const MAX_PERMANENT_ACTION_ENTRIES = 20;
