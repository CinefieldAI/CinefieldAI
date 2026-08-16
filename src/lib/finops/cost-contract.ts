import {
  normalizeRoutingCost,
  type CostRequestShape,
  type CostState as RoutingCostState,
} from "@/lib/routing/routing-cost";
import type { PricingRecord } from "@/lib/pricing/pricing-types";

/**
 * Operational provider cost observation (Phase 15-B/1).
 *
 * Pure. No I/O, no clock, no database, no network. The caller reads pricing
 * and passes it in, exactly as Phase 15-A's adapters do — which is what keeps
 * "what does this cost" auditable months later and testable without a
 * Supabase connection.
 *
 * ---------------------------------------------------------------------------
 * THIS IS AN ESTIMATE. IT IS NOT SPEND, AND IT IS NOT MONEY OWED.
 * ---------------------------------------------------------------------------
 * `generation_attempts.cost_amount` exists in the schema but NO production
 * caller writes it today, so no observed provider spend exists in this system
 * to read. Everything this module produces is therefore derived from
 * `model_pricing` — a price list — multiplied by requested units. That is a
 * forecast of what a provider will probably charge, not a record of what a
 * provider did charge.
 *
 * `CostBasis` makes that distinction a value rather than a comment, so a later
 * batch that starts recording real spend changes the basis instead of quietly
 * redefining what every existing number meant. Nothing in this batch may
 * produce OBSERVED_ACTUAL; there is no evidence in the repository that could
 * justify it.
 *
 * ---------------------------------------------------------------------------
 * THREE SEPARATE NUMBERS THAT MUST NEVER MERGE
 * ---------------------------------------------------------------------------
 *   provider cost   what a provider charges Cinefield   <- THIS MODULE
 *   credit price    what a customer is charged          <- Phase 10
 *   invoice total   what a bank statement says          <- external
 *
 * `model_pricing` carries the first two side by side (`provider_unit_cost` and
 * `credit_price_per_unit`). Only the first is an operational cost. Using
 * `credit_price_per_unit` here would silently substitute revenue for expense
 * and produce a "cost guard" that gets less worried the more margin is
 * charged — so this module never reads that column, and a structural test
 * enforces it.
 *
 * The third does not exist in this repository at all. It is not zero; it is
 * DEFERRED_EXTERNAL, and no code here may invent a figure for it.
 *
 * ---------------------------------------------------------------------------
 * UNKNOWN IS NOT FREE
 * ---------------------------------------------------------------------------
 * Every failure to price something resolves to a NAMED non-numeric state, and
 * never to `estimatedCost: 0`. A missing price means the cost is unknown, not
 * that the request is free — and a budget guard that read unpriced traffic as
 * costless would wave through exactly the traffic nobody has costed.
 */

/**
 * Where a cost number came from.
 *
 * ESTIMATE_BASED is the only value this batch can produce. OBSERVED_ACTUAL
 * exists so the successor batch has a place to put real spend without
 * reinterpreting historical numbers.
 */
export type CostBasis = "ESTIMATE_BASED" | "OBSERVED_ACTUAL";

/**
 * Resolution state of a cost observation.
 *
 * The first three are Phase 7's `CostState`, reused by construction rather
 * than copied: the union below is built FROM the routing type, so a change
 * there is a compile error here instead of a silent disagreement about what
 * "stale" means. 15-B adds two states Phase 7 has no use for — routing has no
 * repository-failure concept because it treats an unreadable price as just
 * another unpriced route, whereas a budget guard must be able to say "I could
 * not see the numbers" out loud.
 */
export type CostState = RoutingCostState | "unavailable" | "invalid";

/** Only this state carries a usable number. Everything else must fail closed. */
export const PRICED_STATES: readonly CostState[] = ["known"];

/**
 * A bounded operational cost observation.
 *
 * Bounded on purpose: a provider id, a model id, a currency code, a number and
 * a few enum labels. No provider payload, no billing response, no Stripe
 * object, no AWS invoice, no request body, no user identity. A "cost record"
 * is one of the easiest places for a raw upstream response to get logged by
 * accident, so the shape simply has nowhere to put one.
 */
export interface CostObservation {
  readonly provider: string;
  readonly modelId: string;
  readonly basis: CostBasis;
  readonly state: CostState;
  /** Present only when state is "known". Absent is not zero. */
  readonly estimatedCost?: number;
  /**
   * The PROVIDER's own id for this model, as carried by `model_pricing`.
   *
   * Distinct from `modelId`, which is Cinefield's platform id, and present
   * only when a pricing row was actually read. Phase 7 uses this exact value
   * as the id of a `provider-model` control target, so keeping it separate is
   * what lets a recommendation name a target the routing layer already
   * recognises instead of a string this module invented.
   */
  readonly providerModelId?: string;
  /** ISO 4217, present whenever a usable price row was read. */
  readonly currency?: string;
  /** Which model_pricing row this came from. Correlation, not a copy. */
  readonly pricingVersion?: number;
  /** Short code naming why the state is what it is. Never a message. */
  readonly reasonCode: string;
  /** Where the number came from: the pricing row's own source_type. */
  readonly source?: string;
  /** ISO-8601, derived from the caller's clock. This module has none. */
  readonly observedAt: string;
}

/** What `observeProviderCost` needs. The caller does the reading. */
export interface CostObservationInput {
  readonly provider: string;
  readonly modelId: string;
  /** The active pricing row, or null when none is active for this model. */
  readonly record: PricingRecord | null;
  /** Billing dimensions for this request. */
  readonly request: CostRequestShape;
  /**
   * FALSE when the pricing read itself failed.
   *
   * A query that threw and a model that genuinely has no price both arrive
   * here as `record: null`; only the caller knows which happened. Phase 15-A
   * established this exact convention, and collapsing the two would turn a
   * dropped database connection into "this model is unpriced" — which is at
   * least honest, but UNAVAILABLE is what an operator actually needs to see.
   */
  readonly sourceAvailable: boolean;
  readonly now: Date;
}

/** ISO 4217: three letters. Anything else is a corrupt row, not a currency. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Matches Phase 7's default freshness window, so both agree on "stale". */
const FRESHNESS_DAYS = 180;

/**
 * One pricing row plus one request shape -> one bounded cost observation.
 *
 * The arithmetic is NOT reimplemented here. Units-per-billing-unit and price
 * freshness are Phase 7's `normalizeRoutingCost`, and this function delegates
 * to it so the router and the cost guard can never quote different numbers for
 * the same request. What 15-B adds on top is the two states routing does not
 * model (UNAVAILABLE, INVALID), decided BEFORE delegating so a corrupt row is
 * named as corrupt rather than folded into "unknown".
 */
export function observeProviderCost(input: CostObservationInput): CostObservation {
  const base = {
    provider: input.provider,
    modelId: input.modelId,
    basis: "ESTIMATE_BASED" as const,
    observedAt: input.now.toISOString(),
  };

  // A failed read is not an unpriced model, and neither one is a free model.
  if (!input.sourceAvailable) {
    return { ...base, state: "unavailable", reasonCode: "pricing_source_unavailable" };
  }
  if (!input.record) {
    return { ...base, state: "unknown", reasonCode: "no_active_pricing" };
  }

  const record = input.record;

  // Corrupt numerics are named, not absorbed. NaN and Infinity both fail
  // `Number.isFinite`; a negative provider cost is not a discount, it is a
  // broken row, and admitting it would let a budget be "refunded" by bad data.
  if (typeof record.providerUnitCost !== "number" || !Number.isFinite(record.providerUnitCost)) {
    return { ...base, state: "invalid", reasonCode: "provider_unit_cost_not_finite" };
  }
  if (record.providerUnitCost < 0) {
    return { ...base, state: "invalid", reasonCode: "provider_unit_cost_negative" };
  }
  if (typeof record.providerCurrency !== "string" || !CURRENCY_PATTERN.test(record.providerCurrency)) {
    return { ...base, state: "invalid", reasonCode: "currency_not_iso4217" };
  }

  // Phase 7 owns units and freshness. Its default policy pins one comparable
  // currency because it ranks routes AGAINST EACH OTHER, which needs a single
  // yardstick. 15-B compares a cost against a BUDGET instead, so the yardstick
  // is the budget's currency and that check lives in `evaluateCostBudget`.
  // Passing the row's own currency here keeps the check in one place rather
  // than having two layers each half-enforce it.
  const routed = normalizeRoutingCost(input.provider, record.providerModelId, record, input.request, input.now, {
    freshnessDays: FRESHNESS_DAYS,
    ceiling: 1.0,
    unknownCostFactor: 0.95,
    comparableCurrency: record.providerCurrency,
  });

  if (routed.state === "unknown" || typeof routed.estimatedCost !== "number") {
    // Reached when the billing unit cannot be turned into a unit count — a
    // per_output row with no output count, for instance. Guessing 1 would
    // produce a confidently wrong number, which is worse than admitting
    // ignorance.
    return { ...base, state: "unknown", reasonCode: "units_not_computable" };
  }

  return {
    ...base,
    state: routed.state,
    estimatedCost: routed.estimatedCost,
    providerModelId: record.providerModelId,
    currency: record.providerCurrency,
    pricingVersion: record.pricingVersion,
    reasonCode: routed.state === "stale" ? "pricing_verified_too_long_ago" : "active_pricing",
    source: record.sourceType,
  };
}

/**
 * Sum of many observations over a window.
 *
 * Any non-priced member poisons the total. That is deliberate, and it is the
 * whole point: a window in which three of forty attempts could not be priced
 * has an unknown total, not a total that happens to omit three. Reporting the
 * partial sum would understate spend by exactly the amount nobody could see,
 * and the budget guard would then compare a too-small number against a limit.
 */
export interface CostAggregate {
  readonly state: CostState;
  /** Present only when state is "known". */
  readonly estimatedSpend?: number;
  readonly currency?: string;
  readonly basis: CostBasis;
  readonly observationCount: number;
  readonly reasonCode: string;
}

export function aggregateCost(observations: readonly CostObservation[]): CostAggregate {
  const base = { basis: "ESTIMATE_BASED" as const, observationCount: observations.length };

  // An empty window is a real, priced zero: nothing ran, so nothing was spent.
  // This is the one place a zero is honest, and it stays distinguishable from
  // "unpriced" because the observation count says how it was reached.
  if (observations.length === 0) {
    return { ...base, state: "known", estimatedSpend: 0, reasonCode: "no_observations" };
  }

  const unpriced = observations.find((o) => o.state !== "known");
  if (unpriced) {
    return { ...base, state: unpriced.state, reasonCode: unpriced.reasonCode };
  }

  const currency = observations[0]?.currency;
  if (typeof currency !== "string") {
    return { ...base, state: "invalid", reasonCode: "priced_observation_without_currency" };
  }
  // No implicit conversion, ever. Adding EUR to USD needs an exchange rate,
  // which is a business number nobody has set; inventing one to make a sum
  // work is exactly the fabricated input this phase forbids.
  if (observations.some((o) => o.currency !== currency)) {
    return { ...base, state: "invalid", reasonCode: "mixed_currency_observations" };
  }

  let total = 0;
  for (const o of observations) total += o.estimatedCost ?? 0;
  if (!Number.isFinite(total)) {
    return { ...base, state: "invalid", reasonCode: "aggregate_not_finite" };
  }

  return { ...base, state: "known", estimatedSpend: total, currency, reasonCode: "aggregated" };
}

/**
 * Currency amount -> integer micro-units, for telemetry only.
 *
 * The Phase 13-E redactor validates numeric fields as `count`, which rounds to
 * the nearest integer. A provider call costing USD 0.04 would therefore be
 * logged as `0` — a cost guard whose logs claim every request was free.
 * Emitting micro-units (0.04 -> 40000) preserves six decimal places, exactly
 * the precision `model_pricing.provider_unit_cost numeric(12,6)` stores, so
 * nothing is lost on the way to a log line.
 *
 * Returns null for anything not safely representable, so a caller cannot
 * accidentally log a rounded, negative or overflowed amount.
 */
export const MICROS_PER_UNIT = 1_000_000;

export function toCostMicros(amount: number): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null;
  const micros = Math.round(amount * MICROS_PER_UNIT);
  return Number.isSafeInteger(micros) ? micros : null;
}
