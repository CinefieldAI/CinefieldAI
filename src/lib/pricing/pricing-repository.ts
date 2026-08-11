import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import type { PricingRecord, ProviderBillingUnit, PricingSourceType } from "./pricing-types";

/**
 * Cinefield pricing repository (Phase 7D foundation, E3B).
 *
 * The ONLY module that reads model_pricing. Server-only, service-role
 * client — model_pricing has no RLS policy for `authenticated` at all (see
 * the migration), so this is also the only code path capable of reading it.
 *
 * Returns null for "no active price exists" — never a zero-cost default,
 * never a guessed fallback. The caller (pricing.ts) turns null into the
 * explicit `pricing_unavailable` result; this repository does not decide
 * that policy itself, it only reports what is (or isn't) durably stored.
 */

const KNOWN_BILLING_UNITS: ReadonlySet<string> = new Set<ProviderBillingUnit>(["per_output", "per_request"]);
const KNOWN_SOURCE_TYPES: ReadonlySet<string> = new Set<PricingSourceType>([
  "official_docs",
  "invoice",
  "manual_verification",
  "other",
]);

/**
 * Defense-in-depth mirror of the migration's `model_pricing_mock_zero_cost_check`
 * CHECK constraint. The database already guarantees this invariant server-side;
 * this is a second, independent guard against ever trusting a row that
 * somehow violates it (a manual SQL edit, a future migration mistake) —
 * never silently accepted, always refused.
 */
export function isConsistentMockPricing(row: {
  provider: string;
  provider_unit_cost: number;
  credit_price_per_unit: number;
}): boolean {
  if (row.provider !== "mock") return true;
  return row.provider_unit_cost === 0 && row.credit_price_per_unit === 0;
}

function mapRow(row: Record<string, unknown>): PricingRecord | null {
  const provider = row.provider;
  const providerUnitCost = row.provider_unit_cost;
  const creditPricePerUnit = row.credit_price_per_unit;
  const providerBillingUnit = row.provider_billing_unit;
  const sourceType = row.source_type;

  if (
    typeof provider !== "string" ||
    typeof providerUnitCost !== "number" ||
    typeof creditPricePerUnit !== "number" ||
    typeof providerBillingUnit !== "string" ||
    !KNOWN_BILLING_UNITS.has(providerBillingUnit) ||
    typeof sourceType !== "string" ||
    !KNOWN_SOURCE_TYPES.has(sourceType) ||
    typeof row.platform_model_id !== "string" ||
    typeof row.provider_model_id !== "string" ||
    typeof row.pricing_version !== "number" ||
    typeof row.provider_currency !== "string" ||
    typeof row.source_reference !== "string" ||
    typeof row.verified_at !== "string" ||
    typeof row.effective_from !== "string"
  ) {
    return null;
  }

  if (!isConsistentMockPricing({ provider, provider_unit_cost: providerUnitCost, credit_price_per_unit: creditPricePerUnit })) {
    return null;
  }

  return {
    platformModelId: row.platform_model_id,
    provider,
    providerModelId: row.provider_model_id,
    pricingVersion: row.pricing_version,
    providerBillingUnit: providerBillingUnit as ProviderBillingUnit,
    providerUnitCost,
    providerCurrency: row.provider_currency,
    creditPricePerUnit,
    sourceType: sourceType as PricingSourceType,
    sourceReference: row.source_reference,
    verifiedAt: row.verified_at,
    effectiveFrom: row.effective_from,
  };
}

/**
 * Reads the single active price row for a platform model id, or null when
 * none exists — enforced at the database level to be at most one row via
 * model_pricing_one_active_per_model_uniq, so this can never be ambiguous.
 */
export async function getActivePricing(platformModelId: string): Promise<PricingRecord | null> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("model_pricing")
    .select("*")
    .eq("platform_model_id", platformModelId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}
