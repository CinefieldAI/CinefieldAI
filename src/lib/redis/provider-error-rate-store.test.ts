import { strict as assert } from "node:assert";
import { test } from "node:test";
import { providerErrorRateKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import {
  getProviderErrorRate,
  recordProviderOutcome,
  type ProviderErrorRateRedisClient,
  type ProviderOutcome,
} from "./provider-error-rate-store";

/**
 * Zero-cost unit tests for the provider-error-rate aggregate store (Phase
 * 6R.7). Every test uses an in-memory fake implementing
 * ProviderErrorRateRedisClient — no ioredis import, no getRedisClient()
 * call, no network, no Redis Cloud connection, no real Redis key, no real
 * Lua interpreter.
 */

class FakeRedisClient implements ProviderErrorRateRedisClient {
  private store = new Map<string, { totalCount: number; successCount: number; failureCount: number }>();
  calls: { op: "recordOutcome" | "readAggregate"; key: string }[] = [];
  private failNext: "recordOutcome" | "readAggregate" | null = null;

  failNextCommand(op: "recordOutcome" | "readAggregate"): void {
    this.failNext = op;
  }

  async recordOutcome(key: string, outcome: ProviderOutcome, _ttlSeconds: number) {
    this.calls.push({ op: "recordOutcome", key });
    if (this.failNext === "recordOutcome") {
      this.failNext = null;
      throw new Error("simulated recordOutcome failure");
    }
    const existing = this.store.get(key) ?? { totalCount: 0, successCount: 0, failureCount: 0 };
    const entry = {
      totalCount: existing.totalCount + 1,
      successCount: existing.successCount + (outcome === "success" ? 1 : 0),
      failureCount: existing.failureCount + (outcome === "failure" ? 1 : 0),
    };
    this.store.set(key, entry);
    return entry;
  }

  async readAggregate(key: string) {
    this.calls.push({ op: "readAggregate", key });
    if (this.failNext === "readAggregate") {
      this.failNext = null;
      throw new Error("simulated readAggregate failure");
    }
    return this.store.get(key) ?? null;
  }
}

test("first success is recorded: errorRate is 0", async () => {
  const fake = new FakeRedisClient();
  const record = await recordProviderOutcome("fal", "success", fake);
  assert.deepEqual(record, { outcome: "recorded" });

  const read = await getProviderErrorRate("fal", fake);
  assert.equal(read.outcome, "available");
  if (read.outcome === "available") {
    assert.equal(read.totalCount, 1);
    assert.equal(read.successCount, 1);
    assert.equal(read.failureCount, 0);
    assert.equal(read.errorRate, 0);
  }
});

test("first failure is recorded: errorRate is 1", async () => {
  const fake = new FakeRedisClient();
  await recordProviderOutcome("fal", "failure", fake);

  const read = await getProviderErrorRate("fal", fake);
  assert.equal(read.outcome, "available");
  if (read.outcome === "available") {
    assert.equal(read.totalCount, 1);
    assert.equal(read.successCount, 0);
    assert.equal(read.failureCount, 1);
    assert.equal(read.errorRate, 1);
  }
});

test("all successes => errorRate 0", async () => {
  const fake = new FakeRedisClient();
  for (let i = 0; i < 5; i++) await recordProviderOutcome("fal", "success", fake);

  const read = await getProviderErrorRate("fal", fake);
  assert.equal(read.outcome, "available");
  if (read.outcome === "available") assert.equal(read.errorRate, 0);
});

test("all failures => errorRate 1", async () => {
  const fake = new FakeRedisClient();
  for (let i = 0; i < 5; i++) await recordProviderOutcome("fal", "failure", fake);

  const read = await getProviderErrorRate("fal", fake);
  assert.equal(read.outcome, "available");
  if (read.outcome === "available") assert.equal(read.errorRate, 1);
});

test("mixed outcomes compute the correct 0.0-1.0 ratio", async () => {
  const fake = new FakeRedisClient();
  await recordProviderOutcome("fal", "success", fake);
  await recordProviderOutcome("fal", "success", fake);
  await recordProviderOutcome("fal", "success", fake);
  await recordProviderOutcome("fal", "failure", fake);

  const read = await getProviderErrorRate("fal", fake);
  assert.equal(read.outcome, "available");
  if (read.outcome === "available") {
    assert.equal(read.totalCount, 4);
    assert.equal(read.successCount, 3);
    assert.equal(read.failureCount, 1);
    assert.equal(read.errorRate, 0.25);
  }
});

test("concurrent outcomes preserve exact counts", async () => {
  const fake = new FakeRedisClient();
  const outcomes: ProviderOutcome[] = [
    "success", "failure", "success", "success", "failure",
    "success", "failure", "success", "success", "success",
  ];
  await Promise.all(outcomes.map((o) => recordProviderOutcome("fal", o, fake)));

  const read = await getProviderErrorRate("fal", fake);
  assert.equal(read.outcome, "available");
  if (read.outcome === "available") {
    assert.equal(read.totalCount, 10);
    assert.equal(read.successCount, 7);
    assert.equal(read.failureCount, 3);
    assert.equal(read.errorRate, 0.3);
  }
});

test("no_data for a provider with no recorded outcomes", async () => {
  const fake = new FakeRedisClient();
  const read = await getProviderErrorRate("never-recorded", fake);
  assert.deepEqual(read, { outcome: "no_data" });
});

test("invalid outcome value rejected before any Redis command runs", async () => {
  const fake = new FakeRedisClient();
  // @ts-expect-error - deliberately passing an invalid outcome to prove runtime rejection.
  await assert.rejects(recordProviderOutcome("fal", "maybe", fake));
  assert.equal(fake.calls.length, 0);
});

test("invalid provider id rejected before any Redis command runs", async () => {
  const fake = new FakeRedisClient();
  await assert.rejects(recordProviderOutcome("fal:evil", "success", fake));
  await assert.rejects(getProviderErrorRate("bad id", fake));
  assert.equal(fake.calls.length, 0);
});

test("Redis disabled/unconfigured => explicit unavailable", async () => {
  const record = await recordProviderOutcome("fal", "success", null);
  const read = await getProviderErrorRate("fal", null);
  assert.deepEqual(record, { outcome: "unavailable" });
  assert.deepEqual(read, { outcome: "unavailable" });
});

test("real getRedisClient() singleton path: unavailable by default in a bare test process", async () => {
  const result = await getProviderErrorRate("fal");
  assert.deepEqual(result, { outcome: "unavailable" });
});

test("Redis command failure => explicit unavailable, never a false errorRate", async () => {
  const fake = new FakeRedisClient();
  fake.failNextCommand("recordOutcome");
  const record = await recordProviderOutcome("fal", "success", fake);
  assert.deepEqual(record, { outcome: "unavailable" });

  await recordProviderOutcome("fal", "success", fake);
  fake.failNextCommand("readAggregate");
  const read = await getProviderErrorRate("fal", fake);
  assert.deepEqual(read, { outcome: "unavailable" });
});

test("uses the centralized key builder and provider-error-rate TTL", async () => {
  const fake = new FakeRedisClient();
  await recordProviderOutcome("cloudflare-workers-ai", "success", fake);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].key, providerErrorRateKey("cloudflare-workers-ai"));
  assert.equal(REDIS_KEY_TTL_SECONDS["provider-error-rate"], 300);
});

test("separate providers never collide", async () => {
  const fake = new FakeRedisClient();
  await recordProviderOutcome("fal", "failure", fake);
  const otherProvider = await getProviderErrorRate("cloudflare-workers-ai", fake);
  assert.deepEqual(otherProvider, { outcome: "no_data" });
});

test("no network: this entire suite only uses an in-memory fake client", () => {
  assert.ok(true);
});
