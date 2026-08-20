import type { ChaosEnvironment } from "./game-day-catalogue";
import { ALLOWED_CHAOS_ENVIRONMENTS } from "./game-day-catalogue";

/**
 * Chaos execution environment boundary (Phase 26 section 27/28 safety invariant).
 *
 * Pure, structural, and deliberately not the only gate: even an environment
 * this function allows still goes through `game-day-execution-service.ts`'s
 * own Tier-0/policy chain for anything that mutates state. This file answers
 * exactly one question — is `production` ever an allowed target — and the
 * answer is unconditionally no. There is no override parameter, no flag, no
 * "explicit approval" bypass anywhere in this function's signature: a future
 * business decision to permit a controlled production game day is a change
 * to THIS file (reviewed, deliberate), never a caller-supplied boolean.
 */
export type ChaosExecutionRefusalReason = "unknown_environment" | "production_denied_by_default";

export type ChaosExecutionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reasonCode: ChaosExecutionRefusalReason };

export function isChaosExecutionAllowed(environment: string): ChaosExecutionDecision {
  if (environment === "production") {
    return { allowed: false, reasonCode: "production_denied_by_default" };
  }
  if (!ALLOWED_CHAOS_ENVIRONMENTS.includes(environment as ChaosEnvironment)) {
    return { allowed: false, reasonCode: "unknown_environment" };
  }
  return { allowed: true };
}
