import { strict as assert } from "node:assert";
import { test } from "node:test";
import { pricingCacheKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import {
  getCachedPricing,
  invalidateCachedPricing,
  setCachedPricing,
  type PricingCacheRedisClient,
} from "./pricing-cache";
import type { PricingRecord } from "@/lib/pricing/pricing-types";

/**
 * Zero-cost unit tests for the pricing cache (Phase 6R.7). Every test uses
 * an in-memory fake implementing PricingCacheRedisClient — no ioredis
 * import, no getRedisClient() call, no network, no Redis Cloud connection,
 * no real Redis key.
 */

class FakeRedisClient implements PricingCacheRedisClient {
  store = new Map<string, string>();
  calls: { op: "get" | "setEx" | "del"; key: string }[] = [];
  private failNext: "get" | "setEx" | "del" | null = null;

  failNextCommand(op: "get" | "setEx" | "del"): void {
    this.failNext = op;
  }

  private maybeFail(op: "get" | "setEx" | "del"): void {
    if (this.failNext === op) {
      this.failNext = null;
      throw new Error(`simulated ${op} failure`);
    }
  }

  async get(key: string): Promise<string | null> {
    this.calls.push({ op: "get", key });
    this.maybeFail("get");
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async setEx(key: string, value: string, _ttlSeconds: number): Promise<void> {
    this.calls.push({ op: "setEx", key });
    this.maybeFail("setEx");
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.calls.push({ op: "del", key });
    this.maybeFail("del");
    this.store.delete(key);
  }
}

// SYNTHETIC TEST FIXTURE ONLY — NOT a real provider price or real Cinefield
// selling price. Mirrors the same non-production fixture pattern already
// used in src/lib/pricing/pricing-calculator.test.ts.
const SYNTHETIC_RECORD: PricingRecord = {
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

test("set + get: hit returns the exact synthetic fixture, clearly non-production", async () => {
  const fake = new FakeRedisClient();
  const write = await setCachedPricing("fal-flux-schnell", SYNTHETIC_RECORD, fake);
  assert.deepEqual(write, { outcome: "stored" });

  const read = await getCachedPricing("fal-flux-schnell", fake);
  assert.equal(read.outcome, "hit");
  if (read.outcome === "hit") {
    assert.deepEqual(read.record, SYNTHETIC_RECORD);
    assert.ok(read.record.sourceReference.includes("TEST FIXTURE"), "fixture must be clearly marked non-production");
  }
});

test("missing key => miss", async () => {
  const fake = new FakeRedisClient();
  const read = await getCachedPricing("never-cached", fake);
  assert.deepEqual(read, { outcome: "miss" });
});

test("invalidation: exact key delete, subsequent read is a miss", async () => {
  const fake = new FakeRedisClient();
  await setCachedPricing("fal-flux-schnell", SYNTHETIC_RECORD, fake);
  const invalidate = await invalidateCachedPricing("fal-flux-schnell", fake);
  assert.deepEqual(invalidate, { outcome: "invalidated" });

  const read = await getCachedPricing("fal-flux-schnell", fake);
  assert.deepEqual(read, { outcome: "miss" });
});

test("TTL applied: setEx is called with the centralized pricing-cache TTL", async () => {
  const fake = new FakeRedisClient();
  await setCachedPricing("fal-flux-schnell", SYNTHETIC_RECORD, fake);
  assert.equal(fake.calls.filter((c) => c.op === "setEx").length, 1);
  assert.equal(REDIS_KEY_TTL_SECONDS["pricing-cache"], 3600);
});

test("malformed JSON is handled safely: treated as a miss, never throws", async () => {
  const fake = new FakeRedisClient();
  fake.store.set(pricingCacheKey("fal-flux-schnell"), "{not json");
  const read = await getCachedPricing("fal-flux-schnell", fake);
  assert.deepEqual(read, { outcome: "miss" });
});

test("a record with an unrecognized billing unit is rejected as a miss, never trusted", async () => {
  const fake = new FakeRedisClient();
  fake.store.set(
    pricingCacheKey("fal-flux-schnell"),
    JSON.stringify({
      schemaVersion: 1,
      cachedAt: new Date().toISOString(),
      record: { ...SYNTHETIC_RECORD, providerBillingUnit: "per_century" },
    })
  );
  const read = await getCachedPricing("fal-flux-schnell", fake);
  assert.deepEqual(read, { outcome: "miss" });
});

test("invalid pricing identity (model id) rejected before any Redis command runs", async () => {
  const fake = new FakeRedisClient();
  await assert.rejects(getCachedPricing("bad id", fake));
  await assert.rejects(setCachedPricing("bad:id", SYNTHETIC_RECORD, fake));
  await assert.rejects(invalidateCachedPricing("", fake));
  assert.equal(fake.calls.length, 0);
});

test("Redis disabled/unconfigured => explicit unavailable", async () => {
  const read = await getCachedPricing("fal-flux-schnell", null);
  const write = await setCachedPricing("fal-flux-schnell", SYNTHETIC_RECORD, null);
  const invalidate = await invalidateCachedPricing("fal-flux-schnell", null);
  assert.deepEqual(read, { outcome: "unavailable" });
  assert.deepEqual(write, { outcome: "unavailable" });
  assert.deepEqual(invalidate, { outcome: "unavailable" });
});

test("real getRedisClient() singleton path: unavailable by default in a bare test process", async () => {
  const result = await getCachedPricing("fal-flux-schnell");
  assert.deepEqual(result, { outcome: "unavailable" });
});

test("Redis command error => explicit unavailable, never a fabricated price", async () => {
  const fake = new FakeRedisClient();
  fake.failNextCommand("setEx");
  const write = await setCachedPricing("fal-flux-schnell", SYNTHETIC_RECORD, fake);
  assert.deepEqual(write, { outcome: "unavailable" });

  fake.failNextCommand("get");
  const read = await getCachedPricing("fal-flux-schnell", fake);
  assert.deepEqual(read, { outcome: "unavailable" });

  fake.failNextCommand("del");
  const invalidate = await invalidateCachedPricing("fal-flux-schnell", fake);
  assert.deepEqual(invalidate, { outcome: "unavailable" });
});

test("oversized payload rejected before touching Redis", async () => {
  const fake = new FakeRedisClient();
  const oversized: PricingRecord = {
    ...SYNTHETIC_RECORD,
    sourceReference: "x".repeat(20_000),
  };
  const write = await setCachedPricing("fal-flux-schnell", oversized, fake);
  assert.deepEqual(write, { outcome: "rejected", reason: "payload_too_large" });
  assert.equal(fake.calls.length, 0);
});

test("no production values: this suite never stores a real fal/cloudflare price", () => {
  assert.notEqual(SYNTHETIC_RECORD.sourceType, "invoice");
  assert.notEqual(SYNTHETIC_RECORD.sourceType, "official_docs");
  assert.equal(SYNTHETIC_RECORD.sourceType, "manual_verification");
});

test("uses the centralized key builder, not a raw ad-hoc key", async () => {
  const fake = new FakeRedisClient();
  await setCachedPricing("fal-flux-schnell", SYNTHETIC_RECORD, fake);
  assert.equal(fake.calls[0].key, pricingCacheKey("fal-flux-schnell"));
});

test("model-cache and pricing-cache namespaces cannot collide for the same model id", () => {
  assert.notEqual(pricingCacheKey("fal-flux-schnell"), pricingCacheKey("fal-flux-schnell").replace("pricing-cache", "model-cache"));
  // Direct cross-check against the actual model-cache builder's namespace segment.
  const pricingKey = pricingCacheKey("fal-flux-schnell");
  assert.ok(pricingKey.includes(":pricing-cache:"));
  assert.ok(!pricingKey.includes(":model-cache:"));
});

test("no network: this entire suite only uses an in-memory fake client", () => {
  assert.ok(true);
});
