import type { EvalCase, ScoreResult } from "../eval-contract";
import { verdictForScore } from "../eval-contract";

/**
 * Latency scorer (Phase 22-B) — fully real today, no external dependency.
 *
 * Linear falloff from 1.0 (instant) to 0.0 (at or past the case's own
 * `maxLatencyMs` bound). A case with no declared bound cannot fail on
 * latency — absence of a criterion is not a zero criterion.
 */
export function scoreLatency(evalCase: EvalCase, observedLatencyMs: number | null): ScoreResult {
  const bound = evalCase.criteria.maxLatencyMs;
  if (observedLatencyMs === null) {
    return { dimension: "latency", score: null, verdict: "inconclusive", reasonCode: "latency_not_observed" };
  }
  if (!bound) {
    return { dimension: "latency", score: 1, verdict: "pass", reasonCode: "no_latency_bound_declared" };
  }
  if (observedLatencyMs <= 0) {
    return { dimension: "latency", score: null, verdict: "inconclusive", reasonCode: "invalid_latency_observation" };
  }
  const score = Math.max(0, Math.min(1, 1 - observedLatencyMs / bound));
  return { dimension: "latency", score, verdict: verdictForScore(score), reasonCode: "measured" };
}
