import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PricingRecord, ProviderBillingUnit, PricingSourceType } from "@/lib/pricing/pricing-types";

/**
 * Reads provider execution cost for ROUTING (Phase 7-D).
 *
 * REUSES `model_pricing`. It already exists, is already server-only under RLS
 * with no permissive policy, already versions its rows, already enforces one
 * active price per model, and already keeps provider cost separate from the
 * credit price. A second cost table would be a second source of truth for
 * money, which is the mistake this codebase has avoided twice already.
 *
 * KEYED BY THE ROUTE, NOT THE MODEL. `getActivePricing()` in
 * src/lib/pricing/pricing-repository.ts looks a row up by
 * `platform_model_id`, which is the right key for "what does this model
 * cost" — the billing question. Routing asks a different one: what does
 * running it on THIS provider endpoint cost, given that two routes for the
 * same model may have different providers. So this reads by
 * (provider, provider_model_id) instead. Same table, same rows, a different
 * question.
 *
 * NO PRICES ARE INVENTED HERE, and none can be: this module only reads. Today
 * `model_pricing` holds four rows, all of them the mock models at a verified
 * zero, so every real provider route resolves to UNKNOWN. That is the true
 * state of the platform's pricing data and the router is built to route
 * correctly in it.
 */

function mapRow(row: Record<string, unknown>): PricingRecord {
  return {
    platformModelId: String(row.platform_model_id),
    provider: String(row.provider),
    providerModelId: String(row.provider_model_id),
    pricingVersion: Number(row.pricing_version),
    providerBillingUnit: String(row.provider_billing_unit) as ProviderBillingUnit,
    providerUnitCost: Number(row.provider_unit_cost),
    providerCurrency: String(row.provider_currency),
    creditPricePerUnit: Number(row.credit_price_per_unit),
    sourceType: String(row.source_type) as PricingSourceType,
    sourceReference: String(row.source_reference),
    verifiedAt: String(row.verified_at),
    effectiveFrom: String(row.effective_from),
  };
}

/**
 * Active pricing for every (provider, providerModel) pair in one query.
 *
 * One round trip for the whole candidate set: routing happens on the request
 * path, and N sequential reads to rank N routes would make the router's own
 * latency a reason not to use it.
 *
 * A read failure returns an empty map, which resolves every route to UNKNOWN
 * cost. Fail-soft in the same direction as health: pricing is an optimization
 * input, and losing it must degrade the ordering, never the generation.
 */
export async function readActiveRouteCosts(
  admin: SupabaseClient,
  routes: readonly { providerId: string; providerModelId: string }[]
): Promise<Map<string, PricingRecord>> {
  const result = new Map<string, PricingRecord>();
  if (routes.length === 0) return result;

  const providerModelIds = [...new Set(routes.map((r) => r.providerModelId))];

  const { data, error } = await admin
    .from("model_pricing")
    .select(
      `platform_model_id, provider, provider_model_id, pricing_version,
       provider_billing_unit, provider_unit_cost, provider_currency,
       credit_price_per_unit, source_type, source_reference, verified_at,
       effective_from`
    )
    .eq("is_active", true)
    .in("provider_model_id", providerModelIds);

  if (error || !data) return result;

  for (const raw of data as Record<string, unknown>[]) {
    const record = mapRow(raw);
    result.set(costKeyFor(record.provider, record.providerModelId), record);
  }

  return result;
}

export function costKeyFor(providerId: string, providerModelId: string): string {
  return `${providerId}::${providerModelId}`;
}
