import { DEFAULT_HEALTH_POLICY, type HealthPolicy } from "./route-health";
import { DEFAULT_COST_POLICY, type CostPolicy } from "./routing-cost";
import { DEFAULT_QUALITY_POLICY, type QualityPolicy } from "./route-quality";

/**
 * THE routing policy (Phase 7-D).
 *
 * One structure, server-side, holding every weight and threshold the router
 * uses. Not because a config object is inherently better, but because the
 * alternative is what usually happens: a 0.35 in the health scorer, a 0.2 in
 * the cost scorer, a freshness window in a third file, and no way to answer
 * "why did it pick that one?" without reading four modules and adding up
 * constants by hand.
 *
 * STATIC, AND THAT IS PHASE 7-D's SCOPE. These values change with a deploy.
 * Runtime flags, per-environment overrides, canary rollout and kill switches
 * are Phase 7-E / Phase 21 and are deliberately absent — there is no reader
 * here for an environment variable, a feature flag, or a database row.
 *
 * THE BROWSER CANNOT REACH THIS. Nothing in a request maps onto these fields,
 * no API accepts them, and no client bundle imports this module.
 */

export interface RoutingPolicy {
  health: HealthPolicy;
  cost: CostPolicy;
  quality: QualityPolicy;
  weights: RoutingWeights;
}

export interface RoutingWeights {
  staticPriority: number;
  errorRate: number;
  latency: number;
  cost: number;
  quality: number;
}

/**
 * Weights, and the reasoning behind their ORDER OF MAGNITUDE.
 *
 * Static priority dominates everything by design. It is the operator's
 * explicit instruction, and no automatic signal should quietly overturn it —
 * an operator who sets priority 900 has said something the system does not
 * get to disagree with over one slow response.
 *
 * Error rate outweighs latency: a route that fails is worse than a route that
 * is slow, and by more than the numbers alone suggest, because a failure also
 * costs a retry.
 *
 * Cost sits below both. Choosing a cheaper provider that fails more often is
 * not a saving; it is a slower, more expensive failure. Cost breaks ties
 * between routes that are already comparable on reliability.
 *
 * Quality is weighted but INERT today: no trusted evaluator exists, so every
 * route scores neutral on that axis and the weight multiplies nothing. It is
 * declared so Phase 22 has a place to land, not so it can do something now.
 */
export const DEFAULT_ROUTING_WEIGHTS: RoutingWeights = {
  staticPriority: 1.0,
  errorRate: 0.35,
  latency: 0.15,
  cost: 0.2,
  quality: 0.25,
};

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  health: DEFAULT_HEALTH_POLICY,
  cost: DEFAULT_COST_POLICY,
  quality: DEFAULT_QUALITY_POLICY,
  weights: DEFAULT_ROUTING_WEIGHTS,
};
