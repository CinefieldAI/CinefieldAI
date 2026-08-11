/**
 * Cinefield server-side pricing types (Phase 7D foundation, E3B).
 *
 * Mirrors supabase/migrations/20260812000000_model_pricing.sql exactly.
 * No network, no I/O, no "server-only" dependency beyond that convention —
 * this file is pure type/shape definitions, safe to import from the pure
 * calculator, the repository, and their tests alike.
 */

/**
 * Only the billing shapes today's model-registry.ts catalog actually needs:
 * image models charged by output count, and TTS models that always produce
 * exactly one file per request. Extending this is a schema + type change
 * together, deliberately — never guessed ahead of a real model that needs it.
 */
export type ProviderBillingUnit = "per_output" | "per_request";

export type PricingSourceType = "official_docs" | "invoice" | "manual_verification" | "other";

/** One row of supabase's model_pricing, exactly as read back. */
export interface PricingRecord {
  platformModelId: string;
  provider: string;
  providerModelId: string;
  pricingVersion: number;

  providerBillingUnit: ProviderBillingUnit;
  /** In providerCurrency, per one billing unit. Never the credit price. */
  providerUnitCost: number;
  providerCurrency: string;

  /** Integer credits per one billing unit. Never the provider cost. */
  creditPricePerUnit: number;

  sourceType: PricingSourceType;
  sourceReference: string;
  verifiedAt: string;
  effectiveFrom: string;
}

/**
 * What the pure calculator needs from a generation request to compute
 * units. Deliberately minimal and generic — no prompt text, no user
 * identity, no credentials; only the billing-relevant dimension(s).
 */
export interface GenerationPriceInput {
  platformModelId: string;
  /** Required for `per_output` models; ignored for `per_request` models. */
  outputCount: number;
}

export interface GenerationPriceBreakdown {
  billingUnit: ProviderBillingUnit;
  units: number;
  creditPricePerUnit: number;
  providerUnitCost: number;
}

export type GenerationPriceError =
  | "unknown_model"
  | "pricing_unavailable"
  | "unsupported_dimension";

export type GenerationPriceResult =
  | {
      ok: true;
      credits: number;
      providerEstimatedCost: number;
      currency: string;
      breakdown: GenerationPriceBreakdown;
      pricingVersion: number;
    }
  | { ok: false; error: GenerationPriceError; detail?: string };
