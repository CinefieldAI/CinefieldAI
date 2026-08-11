import "server-only";
import type { GenerationPriceInput, GenerationPriceResult, PricingRecord } from "./pricing-types";

/**
 * Cinefield pure pricing calculator (Phase 7D foundation, E3B).
 *
 * Deterministic, synchronous, zero I/O: given an already-resolved
 * PricingRecord and a request's billing dimensions, computes credits and
 * provider-estimated cost. No database call, no network call, no provider
 * API call lives here — those belong to pricing-repository.ts. This split
 * is what makes this file testable with plain fixtures and no Redis/Supabase
 * connection, and what keeps "no network calls" true for the calculation
 * itself even though resolving a PricingRecord obviously requires reading
 * Postgres somewhere in the full path (pricing.ts composes the two).
 *
 * FAIL-CLOSED
 * There is no code path here that returns a nonzero credit price for a
 * request whose dimensions this function does not recognize, and no code
 * path that fabricates a price when none was supplied — the caller
 * (pricing-repository.ts / pricing.ts) is responsible for returning
 * "pricing_unavailable" BEFORE this function is ever called, for any model
 * with no active price row. This function only ever answers "given this
 * verified record, what does this specific request cost" — it never invents
 * the record itself.
 */

export function calculatePriceFromRecord(
  record: PricingRecord,
  input: GenerationPriceInput
): GenerationPriceResult {
  if (record.platformModelId !== input.platformModelId) {
    // Defensive: the caller is expected to have resolved `record` FOR
    // `input.platformModelId` already. A mismatch here means a caller bug
    // (passed the wrong record), never a legitimate runtime state — treated
    // as pricing_unavailable rather than silently pricing the wrong model.
    return { ok: false, error: "pricing_unavailable", detail: "record/input model mismatch" };
  }

  let units: number;

  if (record.providerBillingUnit === "per_request") {
    units = 1;
  } else if (record.providerBillingUnit === "per_output") {
    if (!Number.isInteger(input.outputCount) || input.outputCount < 1) {
      return {
        ok: false,
        error: "unsupported_dimension",
        detail: "outputCount must be a positive integer for a per_output model",
      };
    }
    units = input.outputCount;
  } else {
    // Exhaustive per the ProviderBillingUnit union today; guards against a
    // future union widening without a matching branch here.
    return { ok: false, error: "unsupported_dimension", detail: "unrecognized billing unit" };
  }

  return {
    ok: true,
    credits: Math.ceil(units * record.creditPricePerUnit),
    providerEstimatedCost: units * record.providerUnitCost,
    currency: record.providerCurrency,
    breakdown: {
      billingUnit: record.providerBillingUnit,
      units,
      creditPricePerUnit: record.creditPricePerUnit,
      providerUnitCost: record.providerUnitCost,
    },
    pricingVersion: record.pricingVersion,
  };
}
