import { scoreRoute, type RouteHealth } from "./route-health";
import { scoreCost, type RouteCost } from "./routing-cost";
import { scoreQuality, type RouteQuality } from "./route-quality";
import { DEFAULT_ROUTING_POLICY, type RoutingPolicy } from "./routing-policy";

/**
 * The composite routing score (Phase 7-D).
 *
 * Composes the Phase 7-C health scorer with cost and quality rather than
 * replacing it — `scoreRoute` is still the thing that turns priority, error
 * rate and latency into numbers, and its behaviour is unchanged.
 *
 * EXPLAINABLE BY CONSTRUCTION. Every axis is a separate, bounded [0,1] value
 * with its own weight, and the breakdown is kept. There is no single opaque
 * formula, because the question that gets asked in an incident is never "what
 * was the score" but "why did it pick THAT one", and only a per-axis
 * breakdown answers it.
 *
 * SAFETY IS NOT IN HERE. Eligibility and the circuit breaker run BEFORE
 * scoring and can veto; nothing in this function can revive a route they
 * rejected. Cost and quality are optimizations applied to survivors — a
 * cheaper or better-rated route that is disabled, incompatible or behind an
 * open breaker never reaches this function at all.
 *
 * Pure.
 */

export interface CompositeScoreBreakdown {
  // Health axes (Phase 7-C, unchanged semantics).
  priorityComponent: number;
  errorComponent: number;
  latencyComponent: number;
  healthConfidenceFactor: number;
  // Phase 7-D axes.
  costComponent: number;
  costState: RouteCost["state"];
  costConfidenceFactor: number;
  qualityComponent: number;
  qualityState: RouteQuality["state"];
  /**
   * What each axis ACTUALLY contributed to the total.
   *
   * Zero for an axis with no evidence. This is the field to read when asking
   * "did quality influence this decision?" — `qualityComponent` answers "what
   * would it have contributed if it were known", which is a different and
   * much more misleading question.
   */
  costContribution: number;
  qualityContribution: number;
  /** Sum of the weights that were actually applied. */
  appliedWeight: number;
  /** Weighted mean over axes WITH evidence, × confidence factors. */
  total: number;
}

export function scoreRouteComposite(
  priority: number,
  maxPriority: number,
  health: RouteHealth,
  cost: RouteCost,
  quality: RouteQuality,
  policy: RoutingPolicy = DEFAULT_ROUTING_POLICY
): CompositeScoreBreakdown {
  const healthScore = scoreRoute(priority, maxPriority, health, policy.health);
  const costScore = scoreCost(cost, policy.cost);
  const qualityScore = scoreQuality(quality);

  const { weights } = policy;

  // ---- Axes with evidence are averaged; axes without are ABSENT ----------
  //
  // AN EARLIER VERSION ADDED `weights.quality * 1.0` TO EVERY ROUTE, and that
  // was wrong in two ways. The harmless-looking one: it inflated every score
  // by a constant, which is fabricated evidence — the number claimed quality
  // had been considered when nothing had been measured. The one that actually
  // broke ranking: a route with a REAL, mediocre score of 0.4 contributed
  // 0.25 × 0.4, while a route nobody had ever evaluated contributed
  // 0.25 × 1.0. Unmeasured beat measured-and-mediocre. That is the opposite
  // of what a quality signal is for.
  //
  // So an axis with no evidence contributes nothing AND claims none of the
  // weight. The score is the weighted mean over the axes that actually know
  // something. Unknown quality is then exactly neutral: it cannot help a
  // route, cannot hurt it, and cannot move a total across any threshold.
  // Measured-bad still loses to unmeasured, which is correct — the only
  // route we know is bad is the one that was measured.
  const axes: { weight: number; component: number }[] = [
    { weight: weights.staticPriority, component: healthScore.priorityComponent },
    { weight: weights.errorRate, component: healthScore.errorComponent },
    { weight: weights.latency, component: healthScore.latencyComponent },
  ];

  // Cost counts when a price exists at all. A STALE price is still evidence;
  // its uncertainty is expressed by the confidence factor, not by pretending
  // the axis is absent.
  const costCounts = costScore.state !== "unknown";
  if (costCounts) axes.push({ weight: weights.cost, component: costScore.component });

  // Quality counts ONLY for a trusted, fresh, sufficiently-sampled signal.
  // "low_confidence" is not partial evidence to be discounted — it is a
  // signal the policy has decided not to act on.
  const qualityCounts = qualityScore.state === "known";
  if (qualityCounts) axes.push({ weight: weights.quality, component: qualityScore.component });

  const appliedWeight = axes.reduce((sum, axis) => sum + axis.weight, 0);
  const weighted = axes.reduce((sum, axis) => sum + axis.weight * axis.component, 0);

  // Confidence multiplies rather than subtracts. Two independent kinds of
  // "we are not sure" (health telemetry and pricing) compound, which is the
  // honest composition — a route unknown on both counts is less trustworthy
  // than one unknown on either.
  const mean = appliedWeight > 0 ? weighted / appliedWeight : 0;
  const total = mean * healthScore.confidenceFactor * costScore.confidenceFactor;

  return {
    priorityComponent: healthScore.priorityComponent,
    errorComponent: healthScore.errorComponent,
    latencyComponent: healthScore.latencyComponent,
    healthConfidenceFactor: healthScore.confidenceFactor,
    costComponent: costScore.component,
    costState: costScore.state,
    costConfidenceFactor: costScore.confidenceFactor,
    qualityComponent: qualityScore.component,
    qualityState: qualityScore.state,
    costContribution: costCounts ? weights.cost * costScore.component : 0,
    qualityContribution: qualityCounts ? weights.quality * qualityScore.component : 0,
    appliedWeight,
    total,
  };
}
