import type { PricingRecord, ProviderBillingUnit } from "@/lib/pricing/pricing-types";

/**
 * Provider execution cost, normalized for ROUTING (Phase 7-D).
 *
 * THIS IS NOT BILLING. It answers one question — "where should this
 * generation run?" — and it must never answer "what does the user pay?".
 * Those are different numbers with different owners:
 *
 *   provider_unit_cost      what Cinefield pays upstream    -> routing (here)
 *   credit_price_per_unit   what the user is charged        -> Phase 10
 *
 * `model_pricing` already stores both and already refuses to conflate them.
 * This module reads ONLY the provider-cost side. Nothing here can move a
 * credit balance, and nothing here is exposed to a browser.
 *
 * UNKNOWN COST != ZERO COST. A route with no verified price is not free; it
 * is unpriced. Treating absence as zero would make every unpriced provider
 * the cheapest option in the system, which is precisely backwards — an
 * unverified provider is the one Cinefield knows least about.
 *
 * Pure. The database read lives in routing-cost-repository.ts.
 */

export type CostState =
  /** A verified, active, fresh price exists for this route. */
  | "known"
  /** No active pricing row. NOT free — just unpriced. */
  | "unknown"
  /** A price exists but was verified too long ago to compare against. */
  | "stale";

export interface RouteCost {
  providerId: string;
  providerModelId: string;
  state: CostState;
  /**
   * Estimated provider cost for THIS request, in `currency`. Present only
   * when state is "known". Comparable across routes because it is the cost
   * of the same work, not a per-unit figure with different units per row.
   */
  estimatedCost?: number;
  currency?: string;
  billingUnit?: ProviderBillingUnit;
  /** Which model_pricing row produced this. Audit correlation, not a copy. */
  pricingVersion?: number;
  verifiedAt?: string;
}

/** What the request contributes to the unit calculation. */
export interface CostRequestShape {
  /** Outputs requested. Used by `per_output` rows; ignored by `per_request`. */
  outputCount: number;
}

export interface CostPolicy {
  /** A price verified longer ago than this is treated as STALE. */
  freshnessDays: number;
  /**
   * The cost treated as "most expensive" when normalizing to [0,1].
   *
   * A ceiling rather than a max-of-candidates, so a route's cost score does
   * not swing because an unrelated expensive route was added or removed —
   * that would make routing non-reproducible from one request to the next.
   */
  ceiling: number;
  /**
   * Score multiplier for a route whose cost is unknown or stale.
   *
   * Below 1, so an unpriced route loses a close race to a priced one — the
   * conservative direction, since Cinefield cannot bound what that route
   * will cost. NOT zero and NOT exclusion: with real prices absent from
   * `model_pricing` for every non-mock model today, excluding unpriced
   * routes would disable production routing entirely.
   */
  unknownCostFactor: number;
  /** Currencies that may be compared directly. */
  comparableCurrency: string;
}

export const DEFAULT_COST_POLICY: CostPolicy = {
  freshnessDays: 180,
  ceiling: 1.0,
  unknownCostFactor: 0.95,
  comparableCurrency: "USD",
};

/** Cost for a route nothing is priced for. Explicitly unknown, never zero. */
export function unknownCost(providerId: string, providerModelId: string): RouteCost {
  return { providerId, providerModelId, state: "unknown" };
}

/**
 * Turns one pricing row into a comparable cost for this request.
 *
 * A row whose currency is not the comparable one is treated as UNKNOWN
 * rather than converted. Converting would require an exchange rate, which is
 * a business number nobody has set, and inventing one to make a routing
 * comparison work would be exactly the kind of fabricated input this phase
 * forbids.
 */
export function normalizeRoutingCost(
  providerId: string,
  providerModelId: string,
  record: PricingRecord | null,
  request: CostRequestShape,
  now: Date,
  policy: CostPolicy = DEFAULT_COST_POLICY
): RouteCost {
  if (!record) return unknownCost(providerId, providerModelId);

  if (record.providerCurrency !== policy.comparableCurrency) {
    return { ...unknownCost(providerId, providerModelId), state: "unknown" };
  }

  if (!Number.isFinite(record.providerUnitCost) || record.providerUnitCost < 0) {
    // A corrupt row must not become a free route.
    return unknownCost(providerId, providerModelId);
  }

  const verifiedAt = Date.parse(record.verifiedAt);
  const stale =
    !Number.isFinite(verifiedAt) ||
    (now.getTime() - verifiedAt) / 86_400_000 > policy.freshnessDays;

  const units = unitsFor(record.providerBillingUnit, request);
  if (units === null) return unknownCost(providerId, providerModelId);

  return {
    providerId,
    providerModelId,
    state: stale ? "stale" : "known",
    // Reported either way. A stale price is still the best information
    // available; the STATE is what tells the scorer to discount it, rather
    // than the number being hidden.
    estimatedCost: record.providerUnitCost * units,
    currency: record.providerCurrency,
    billingUnit: record.providerBillingUnit,
    pricingVersion: record.pricingVersion,
    verifiedAt: record.verifiedAt,
  };
}

/**
 * Units this request consumes under a billing unit.
 *
 * Returns null for a unit this function cannot compute, which becomes
 * UNKNOWN upstream. Guessing would produce a confidently wrong comparison.
 */
function unitsFor(billingUnit: ProviderBillingUnit, request: CostRequestShape): number | null {
  if (billingUnit === "per_request") return 1;
  if (billingUnit === "per_output") {
    const count = request.outputCount;
    return Number.isInteger(count) && count > 0 ? count : null;
  }
  return null;
}

export interface CostScore {
  state: CostState;
  /** [0,1]; 1 is cheapest. Neutral (1) when unknown — see below. */
  component: number;
  /** Multiplier applied for an unknown or stale price. */
  confidenceFactor: number;
}

/**
 * Scores cost. Cheaper is better, bounded, deterministic.
 *
 * An unknown cost scores NEUTRAL on the axis and takes a confidence penalty
 * on the total. That combination is deliberate: scoring it 0 would make
 * unpriced routes unusable (and today every real provider is unpriced),
 * while scoring it 1 with no penalty would make "we have no idea" tie with
 * "verified free". Neutral-but-discounted says what is actually true — this
 * route might be cheap or expensive, and that uncertainty is itself a
 * reason to prefer a route Cinefield can bound.
 */
export function scoreCost(cost: RouteCost, policy: CostPolicy = DEFAULT_COST_POLICY): CostScore {
  if (cost.state === "unknown" || cost.estimatedCost === undefined) {
    return { state: cost.state, component: 1, confidenceFactor: policy.unknownCostFactor };
  }

  const normalized = Math.min(1, Math.max(0, cost.estimatedCost / policy.ceiling));
  return {
    state: cost.state,
    component: 1 - normalized,
    confidenceFactor: cost.state === "stale" ? policy.unknownCostFactor : 1,
  };
}
