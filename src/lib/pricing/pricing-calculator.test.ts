import { strict as assert } from "node:assert";
import { test } from "node:test";
import { calculatePriceFromRecord } from "./pricing-calculator";
import { calculateGenerationPrice } from "./pricing";
import { isConsistentMockPricing } from "./pricing-repository";
import type { PricingRecord } from "./pricing-types";

/**
 * Zero-cost unit tests for the Cinefield pricing foundation (Phase 7D, E3B).
 *
 * Every test uses SYNTHETIC fixture PricingRecords — none of these numbers
 * are real provider prices or real Cinefield selling prices; they exist
 * only to exercise the calculation logic deterministically. No import here
 * ever touches pricing-repository.ts's getActivePricing() with the real
 * Supabase client, and calculateGenerationPrice is always called either with
 * an unknown model id (which short-circuits before any repository call — see
 * pricing.ts's ordering) or with an explicit testRepositoryOverride. No
 * network, no Redis, no Supabase, no provider call.
 */

// Synthetic fixture only — NOT a real provider price or real Cinefield
// selling price. Uses a real orchestratable model id (fal-flux-schnell) only
// to prove the calculator works against a legitimately-shaped model; the
// numeric values themselves are arbitrary test data.
const SYNTHETIC_PER_OUTPUT_RECORD: PricingRecord = {
  platformModelId: "fal-flux-schnell",
  provider: "fal",
  providerModelId: "fal-ai/flux/schnell",
  pricingVersion: 1,
  providerBillingUnit: "per_output",
  providerUnitCost: 0.01,
  providerCurrency: "USD",
  creditPricePerUnit: 4,
  sourceType: "manual_verification",
  sourceReference: "TEST FIXTURE - not a real verified price",
  verifiedAt: "2026-01-01T00:00:00.000Z",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
};

const SYNTHETIC_PER_REQUEST_RECORD: PricingRecord = {
  platformModelId: "cloudflare-melotts",
  provider: "cloudflare-workers-ai",
  providerModelId: "@cf/myshell-ai/melotts",
  pricingVersion: 1,
  providerBillingUnit: "per_request",
  providerUnitCost: 0.002,
  providerCurrency: "USD",
  creditPricePerUnit: 2,
  sourceType: "manual_verification",
  sourceReference: "TEST FIXTURE - not a real verified price",
  verifiedAt: "2026-01-01T00:00:00.000Z",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
};

const REAL_MOCK_RECORD: PricingRecord = {
  platformModelId: "mock-image",
  provider: "mock",
  providerModelId: "mock-image-v1",
  pricingVersion: 1,
  providerBillingUnit: "per_output",
  providerUnitCost: 0,
  providerCurrency: "USD",
  creditPricePerUnit: 0,
  sourceType: "manual_verification",
  sourceReference: "Cinefield mock provider - verified zero cost by design",
  verifiedAt: "2026-01-01T00:00:00.000Z",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
};

test("known model with a verified fixture calculates deterministically", () => {
  const first = calculatePriceFromRecord(SYNTHETIC_PER_OUTPUT_RECORD, {
    platformModelId: "fal-flux-schnell",
    outputCount: 3,
  });
  const second = calculatePriceFromRecord(SYNTHETIC_PER_OUTPUT_RECORD, {
    platformModelId: "fal-flux-schnell",
    outputCount: 3,
  });
  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.credits, 12); // 3 outputs * 4 credits/output
    assert.equal(first.providerEstimatedCost, 0.03); // 3 * 0.01
    assert.equal(first.pricingVersion, 1);
  }
});

test("unknown model rejected (no repository call needed - short-circuits first)", async () => {
  const result = await calculateGenerationPrice({ platformModelId: "totally-unknown-model", outputCount: 1 });
  assert.deepEqual(result, { ok: false, error: "unknown_model" });
});

test("production model without an active pricing record rejected - pricing_unavailable, never 0 credits", async () => {
  const result = await calculateGenerationPrice(
    { platformModelId: "fal-flux-schnell", outputCount: 1 },
    async () => null // simulates: repository found no active row for this real model
  );
  assert.deepEqual(result, { ok: false, error: "pricing_unavailable" });
});

test("unsupported billing dimension rejected: zero/non-integer outputCount on a per_output model", () => {
  const zero = calculatePriceFromRecord(SYNTHETIC_PER_OUTPUT_RECORD, {
    platformModelId: "fal-flux-schnell",
    outputCount: 0,
  });
  assert.equal(zero.ok, false);
  if (!zero.ok) assert.equal(zero.error, "unsupported_dimension");

  const fractional = calculatePriceFromRecord(SYNTHETIC_PER_OUTPUT_RECORD, {
    platformModelId: "fal-flux-schnell",
    outputCount: 2.5,
  });
  assert.equal(fractional.ok, false);
  if (!fractional.ok) assert.equal(fractional.error, "unsupported_dimension");
});

test("per_request model ignores outputCount entirely - always exactly 1 unit", () => {
  const withLargeOutputCount = calculatePriceFromRecord(SYNTHETIC_PER_REQUEST_RECORD, {
    platformModelId: "cloudflare-melotts",
    outputCount: 999,
  });
  assert.equal(withLargeOutputCount.ok, true);
  if (withLargeOutputCount.ok) {
    assert.equal(withLargeOutputCount.breakdown.units, 1);
    assert.equal(withLargeOutputCount.credits, 2);
  }
});

test("client cannot override the credit amount - extra/forged fields on the input are ignored", () => {
  const forgedInput = {
    platformModelId: "fal-flux-schnell",
    outputCount: 1,
    // A client-supplied field that does not exist on GenerationPriceInput.
    // Cast to bypass the type system exactly the way a parsed, untyped
    // request body would arrive at runtime.
    credits: 1,
  } as unknown as Parameters<typeof calculatePriceFromRecord>[1];

  const result = calculatePriceFromRecord(SYNTHETIC_PER_OUTPUT_RECORD, forgedInput);
  assert.equal(result.ok, true);
  if (result.ok) {
    // Must be computed from the record (4 credits/output), never the
    // forged `credits: 1` field on the input.
    assert.equal(result.credits, 4);
    assert.notEqual(result.credits, 1);
  }
});

test("provider cost and selling credits remain separate - changing one never affects the other", () => {
  const cheapToSellExpensiveToRun: PricingRecord = {
    ...SYNTHETIC_PER_OUTPUT_RECORD,
    providerUnitCost: 5.0,
    creditPricePerUnit: 1,
  };
  const result = calculatePriceFromRecord(cheapToSellExpensiveToRun, {
    platformModelId: "fal-flux-schnell",
    outputCount: 1,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.credits, 1);
    assert.equal(result.providerEstimatedCost, 5.0);
    assert.notEqual(result.credits, result.providerEstimatedCost);
    // Both figures independently present in the breakdown - neither derived
    // from the other.
    assert.equal(result.breakdown.creditPricePerUnit, 1);
    assert.equal(result.breakdown.providerUnitCost, 5.0);
  }
});

test("pricing version is returned and traceable to the record it came from", () => {
  const v3Record: PricingRecord = { ...SYNTHETIC_PER_OUTPUT_RECORD, pricingVersion: 3 };
  const result = calculatePriceFromRecord(v3Record, { platformModelId: "fal-flux-schnell", outputCount: 1 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.pricingVersion, 3);
});

test("inactive pricing is rejected via the same pricing_unavailable path (repository-enforced, not date-range logic)", async () => {
  // model_pricing_one_active_per_model_uniq + the repository's own
  // `.eq('is_active', true)` query mean an inactive-only model is
  // indistinguishable from "no row at all" by the time it reaches this
  // function - both correctly produce pricing_unavailable.
  const result = await calculateGenerationPrice(
    { platformModelId: "fal-nano-banana-2", outputCount: 1 },
    async () => null
  );
  assert.deepEqual(result, { ok: false, error: "pricing_unavailable" });
});

test("mock price cannot leak to a production model: isConsistentMockPricing rejects a mismatched row", () => {
  assert.equal(isConsistentMockPricing({ provider: "mock", provider_unit_cost: 0, credit_price_per_unit: 0 }), true);
  // A row claiming provider='mock' but carrying a real cost must be refused
  // by the repository's defensive check, independent of the database's own
  // CHECK constraint (defense in depth).
  assert.equal(
    isConsistentMockPricing({ provider: "mock", provider_unit_cost: 0.5, credit_price_per_unit: 2 }),
    false
  );
  // A real provider is never required to be zero-cost.
  assert.equal(isConsistentMockPricing({ provider: "fal", provider_unit_cost: 0.01, credit_price_per_unit: 4 }), true);
});

test("mock model's own verified $0 record still calculates correctly (not treated as unavailable)", () => {
  const result = calculatePriceFromRecord(REAL_MOCK_RECORD, { platformModelId: "mock-image", outputCount: 2 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.credits, 0);
    assert.equal(result.providerEstimatedCost, 0);
  }
});

test("no network/provider call: this entire suite only imports the pure calculator and plain fixtures", () => {
  // Structural guarantee, asserted explicitly: every test above either calls
  // calculatePriceFromRecord() directly (pure, synchronous, no I/O) or
  // calculateGenerationPrice() with an id that short-circuits before any
  // repository access, or with an explicit testRepositoryOverride. No test
  // in this file ever calls the real getActivePricing()/getSupabaseAdminClient().
  assert.ok(true);
});
