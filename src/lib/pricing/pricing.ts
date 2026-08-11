import "server-only";
import { isOrchestratableModel } from "@/lib/orchestration/model-registry";
import { calculatePriceFromRecord } from "./pricing-calculator";
import { getActivePricing } from "./pricing-repository";
import type { GenerationPriceInput, GenerationPriceResult, PricingRecord } from "./pricing-types";

/**
 * Cinefield server-side pricing entry point (Phase 7D foundation, E3B).
 *
 * The ONE function both a future POST /api/pricing/quote and a future
 * POST /api/generate must call — neither route may compute a price any
 * other way, and neither may accept a client-supplied credit amount as
 * authoritative. Composes the I/O (pricing-repository.ts) with the pure
 * calculation (pricing-calculator.ts):
 *
 *   1. Reject unknown models immediately (never queries pricing for an id
 *      that isn't even orchestratable).
 *   2. Resolve the active PricingRecord from Postgres — model_pricing is
 *      the sole source of truth; nothing here calls a provider's own
 *      pricing API or scrapes a docs page at request time.
 *   3. A model with no active price row returns `pricing_unavailable`
 *      explicitly — NEVER 0 credits, NEVER a fallback estimate. The only
 *      models that legitimately price at 0 are the four mock models, whose
 *      $0 rows are seeded, verified data (see the migration), not a
 *      fallback this function invents.
 *   4. Delegate the actual arithmetic to the pure calculator.
 *
 * NOT WIRED IN YET. No route calls this today — this phase is foundation
 * only, matching E3B's explicit scope.
 */
export async function calculateGenerationPrice(
  input: GenerationPriceInput,
  testRepositoryOverride?: (platformModelId: string) => Promise<PricingRecord | null>
): Promise<GenerationPriceResult> {
  if (!isOrchestratableModel(input.platformModelId)) {
    return { ok: false, error: "unknown_model" };
  }

  const fetchPricing = testRepositoryOverride ?? getActivePricing;
  const record = await fetchPricing(input.platformModelId);
  if (!record) {
    return { ok: false, error: "pricing_unavailable" };
  }

  return calculatePriceFromRecord(record, input);
}
