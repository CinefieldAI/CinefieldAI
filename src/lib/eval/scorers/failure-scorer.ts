import type { ScoreResult } from "../eval-contract";

/**
 * Failure scorer (Phase 22-B) — did the generation itself succeed. The
 * simplest dimension and deliberately not a judgment call: a case whose
 * generation errored, timed out, or never produced output fails this
 * dimension outright, regardless of every other score.
 */
export function scoreFailure(generationSucceeded: boolean, reasonCode: string = "measured"): ScoreResult {
  return generationSucceeded
    ? { dimension: "failure", score: 1, verdict: "pass", reasonCode }
    : { dimension: "failure", score: 0, verdict: "fail", reasonCode };
}
