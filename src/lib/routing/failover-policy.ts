import { provesNoProviderJob, type OrchestrationError } from "@/lib/orchestration/errors";
import type { GenerationAttempt } from "@/types/database";

/**
 * When is a second provider attempt SAFE? (Phase 7-C)
 *
 * THE RULE THIS FILE EXISTS FOR:
 *
 *     AMBIGUOUS != SAFE TO RETRY
 *
 * A failover is a second provider execution. If the first one may already be
 * running, the second one is a duplicate — a second billable job for a
 * request the user made once. The global invariant is
 *
 *     1 logical request = 1 generation_id = max 1 billable settlement
 *
 * and failover is the single most likely way to break it. So the question is
 * never "did it fail?" but "can Cinefield PROVE nothing was started?".
 *
 * REUSES PHASE 6/6R, DOES NOT REPLACE IT. The evidence ladder already exists
 * on `generation_attempts.submission_evidence` ("none" | "ambiguous" | "job"),
 * and `provesNoProviderJob()` in errors.ts already encodes which error codes
 * prove the provider was never reached. This module composes those two into a
 * failover decision. It defines no new submission state machine.
 *
 * Pure. No database, no Redis, no provider.
 */

export type FailoverDecision =
  /** Nothing was submitted. A different route may be tried. */
  | { decision: "safe_to_failover"; reason: string }
  /**
   * A provider job exists or may exist. No second execution, ever, on this
   * path — the generation goes to reconciliation instead.
   */
  | { decision: "reconciliation_required"; reason: string }
  /** The failure was not the provider's, so switching provider fixes nothing. */
  | { decision: "no_failover_local_failure"; reason: string }
  /** Attempts or routes are used up. Bounded, terminal, typed. */
  | { decision: "failover_exhausted"; reason: string };

export interface FailoverContext {
  /** The attempt that just failed. */
  attempt: Pick<GenerationAttempt, "submission_evidence" | "provider_job_id" | "status">;
  /** Its error code, if one was recorded. */
  errorCode?: string | null;
  /** True when this model cannot create an external job at all (mock). */
  isMockProvider: boolean;
  /** How many attempts this generation has already used. */
  attemptCount: number;
  /** Hard ceiling. Bounded retry is Temporal's contract, not the router's. */
  maxAttempts: number;
  /** Routes that remain eligible and healthy, excluding tried ones. */
  alternativeRoutesAvailable: number;
}

/** Two provider attempts is the ceiling: the original, and one failover. */
export const DEFAULT_MAX_ATTEMPTS = 2;

/**
 * Decides whether a failover may happen.
 *
 * The order of the checks is itself a safety property. Evidence is examined
 * BEFORE attempt counts and route availability, so a system that is otherwise
 * eager to retry can never reach a retry decision for an ambiguous
 * submission. Reordering these is the way this file gets subtly broken.
 */
export function decideFailover(context: FailoverContext): FailoverDecision {
  const { attempt, errorCode, isMockProvider } = context;

  // ---- 1. Hard evidence that a provider job EXISTS ------------------------
  if (attempt.provider_job_id !== null && attempt.provider_job_id !== undefined) {
    return {
      decision: "reconciliation_required",
      reason: "provider_job_id_present",
    };
  }
  if (attempt.submission_evidence === "job") {
    return { decision: "reconciliation_required", reason: "evidence_job" };
  }

  // ---- 2. Evidence that a job MIGHT exist ---------------------------------
  // The whole point of the phase. "Might" is treated exactly like "does".
  if (attempt.submission_evidence === "ambiguous") {
    return { decision: "reconciliation_required", reason: "evidence_ambiguous" };
  }

  // ---- 3. Did the error itself prove nothing was submitted? ---------------
  // A mock provider is exempt: it cannot create an external job, so there is
  // nothing to duplicate and nothing to reconcile.
  if (!isMockProvider) {
    if (!errorCode) {
      // No code means no proof. Fail closed — the alternative is treating
      // "we do not know what happened" as "nothing happened", which is the
      // exact reasoning that double-bills a customer.
      return { decision: "reconciliation_required", reason: "no_error_code_no_proof" };
    }
    if (!provesNoProviderJobCode(errorCode)) {
      return { decision: "reconciliation_required", reason: `unproven_error_${errorCode}` };
    }
  }

  // ---- 4. Would switching provider even help? -----------------------------
  if (errorCode && isLocalFailureCode(errorCode)) {
    return { decision: "no_failover_local_failure", reason: `local_${errorCode}` };
  }

  // ---- 5. Bounds -----------------------------------------------------------
  if (context.attemptCount >= context.maxAttempts) {
    return { decision: "failover_exhausted", reason: "max_attempts_reached" };
  }
  if (context.alternativeRoutesAvailable <= 0) {
    return { decision: "failover_exhausted", reason: "no_alternative_route" };
  }

  return { decision: "safe_to_failover", reason: "no_provider_job_proven" };
}

/**
 * Codes that prove no provider job exists.
 *
 * Delegates to the Phase 6R allowlist in errors.ts rather than restating it —
 * that list is fail-closed by construction and has already been reasoned
 * about once, in the place that also knows which adapter calls can raise
 * each code after a job was created.
 */
function provesNoProviderJobCode(errorCode: string): boolean {
  return provesNoProviderJob({ code: errorCode } as OrchestrationError);
}

/** Failures that belong to Cinefield or the request, not to the provider. */
const LOCAL_FAILURE_CODES: ReadonlySet<string> = new Set([
  "INVALID_INPUT",
  "UNKNOWN_MODEL",
  "MODEL_DISABLED",
  "UNSUPPORTED_WORKFLOW",
  "REQUIRED_INPUT_MISSING",
  "UNSUPPORTED_INPUT_TYPE",
  "CAPABILITY_NOT_SUPPORTED",
  "DATABASE_UPDATE_FAILED",
  "DUPLICATE_EXECUTION",
]);

function isLocalFailureCode(errorCode: string): boolean {
  return LOCAL_FAILURE_CODES.has(errorCode);
}
