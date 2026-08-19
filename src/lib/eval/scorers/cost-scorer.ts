import type { CostObservation } from "@/lib/finops/cost-contract";
import type { EvalCase, ScoreResult } from "../eval-contract";
import { verdictForScore } from "../eval-contract";

/**
 * Cost scorer (Phase 22-B) — reuses Phase 15-B's own `CostObservation`
 * verbatim, never a second cost concept. The CALLER resolves the
 * observation (via `observeProviderCost()`, same as routing/cost-guard
 * already do) — this scorer only interprets it against the case's own
 * bound, so it stays a pure function with no Supabase/pricing dependency
 * of its own.
 */
export function scoreCost(evalCase: EvalCase, observation: CostObservation, passThreshold: number | null): ScoreResult {
  const bound = evalCase.criteria.maxCost;

  if (observation.state !== "known" || observation.estimatedCost === undefined) {
    return { dimension: "cost", score: null, verdict: "inconclusive", reasonCode: `cost_${observation.state}` };
  }
  if (!bound) {
    return { dimension: "cost", score: 1, verdict: "pass", reasonCode: "no_cost_bound_declared" };
  }
  if (observation.estimatedCost < 0) {
    return { dimension: "cost", score: null, verdict: "inconclusive", reasonCode: "invalid_cost_observation" };
  }

  const score = Math.max(0, Math.min(1, 1 - observation.estimatedCost / bound));
  return { dimension: "cost", score, verdict: verdictForScore(score, passThreshold), reasonCode: "measured" };
}
