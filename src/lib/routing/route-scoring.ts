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
  /** Weighted sum × confidence factors. Higher wins. */
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

  const weighted =
    weights.staticPriority * healthScore.priorityComponent +
    weights.errorRate * healthScore.errorComponent +
    weights.latency * healthScore.latencyComponent +
    weights.cost * costScore.component +
    weights.quality * qualityScore.component;

  // Confidence multiplies rather than subtracts. Two independent kinds of
  // "we are not sure" (health telemetry and pricing) compound, which is the
  // honest composition — a route unknown on both counts is less trustworthy
  // than one unknown on either.
  const total = weighted * healthScore.confidenceFactor * costScore.confidenceFactor;

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
    total,
  };
}
