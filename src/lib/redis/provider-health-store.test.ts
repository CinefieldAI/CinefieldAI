import { strict as assert } from "node:assert";
import { test } from "node:test";
import { providerHealthKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import {
  clearProviderHealth,
  getProviderHealth,
  parseProviderHealthState,
  setProviderHealth,
  type ProviderHealthRedisClient,
  type ProviderHealthState,
} from "./provider-health-store";

/**
 * Zero-cost unit tests for the provider-health Redis store (Phase 6R.7,
 * D1). Every test uses an in-memory fake implementing
 * ProviderHealthRedisClient — no ioredis import, no getRedisClient() call,
 * no network, no Redis Cloud connection, no real Redis key.
 */

/** In-memory fake standing in for the ioredis client. */
class FakeRedisClient implements ProviderHealthRedisClient {
  store = new Map<string, string>();
  calls: { op: "get" | "set" | "del"; key: string; ttlSeconds?: number }[] = [];
  private failNext: string | null = null;

  failNextCommand(op: "get" | "set" | "del"): void {
    this.failNext = op;
  }

  private maybeFail(op: "get" | "set" | "del"): void {
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

  async set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown> {
    this.calls.push({ op: "set", key, ttlSeconds: seconds });
    this.maybeFail("set");
    assert.equal(mode, "EX");
    this.store.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<unknown> {
    this.calls.push({ op: "del", key });
    this.maybeFail("del");
    this.store.delete(key);
    return 1;
  }
}

const HEALTHY: ProviderHealthState = {
  status: "healthy",
  consecutiveFailures: 0,
  latencyMs: 420,
  lastCheckedAt: "2026-08-11T10:00:00.000Z",
  lastSuccessAt: "2026-08-11T10:00:00.000Z",
};

const DEGRADED: ProviderHealthState = {
  status: "degraded",
  consecutiveFailures: 2,
  latencyMs: 3200,
  lastCheckedAt: "2026-08-11T10:05:00.000Z",
  lastSuccessAt: "2026-08-11T09:50:00.000Z",
  lastFailureAt: "2026-08-11T10:05:00.000Z",
};

const UNHEALTHY: ProviderHealthState = {
  status: "unhealthy",
  consecutiveFailures: 7,
  lastCheckedAt: "2026-08-11T10:10:00.000Z",
  lastFailureAt: "2026-08-11T10:10:00.000Z",
};

test("setProviderHealth uses the centralized key builder and provider-health TTL", async () => {
  const fake = new FakeRedisClient();
  await setProviderHealth("fal", HEALTHY, fake);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].op, "set");
  assert.equal(fake.calls[0].key, providerHealthKey("fal"));
  assert.equal(fake.calls[0].ttlSeconds, REDIS_KEY_TTL_SECONDS["provider-health"]);
});

test("getProviderHealth uses the centralized key builder", async () => {
  const fake = new FakeRedisClient();
  fake.store.set(providerHealthKey("mock"), JSON.stringify(HEALTHY));

  const result = await getProviderHealth("mock", fake);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].op, "get");
  assert.equal(fake.calls[0].key, providerHealthKey("mock"));
  assert.deepEqual(result, HEALTHY);
});

test("round-trip serialization preserves healthy state", async () => {
  const fake = new FakeRedisClient();
  await setProviderHealth("fal", HEALTHY, fake);
  const result = await getProviderHealth("fal", fake);
  assert.deepEqual(result, HEALTHY);
});

test("round-trip serialization preserves degraded state", async () => {
  const fake = new FakeRedisClient();
  await setProviderHealth("cloudflare-workers-ai", DEGRADED, fake);
  const result = await getProviderHealth("cloudflare-workers-ai", fake);
  assert.deepEqual(result, DEGRADED);
});

test("round-trip serialization preserves unhealthy state", async () => {
  const fake = new FakeRedisClient();
  await setProviderHealth("fal", UNHEALTHY, fake);
  const result = await getProviderHealth("fal", fake);
  assert.deepEqual(result, UNHEALTHY);
});

test("clearProviderHealth removes the key via the centralized key builder", async () => {
  const fake = new FakeRedisClient();
  await setProviderHealth("fal", HEALTHY, fake);
  await clearProviderHealth("fal", fake);

  assert.equal(fake.store.has(providerHealthKey("fal")), false);
  const afterClear = await getProviderHealth("fal", fake);
  assert.equal(afterClear, null);
});

test("getProviderHealth returns null for a missing key", async () => {
  const fake = new FakeRedisClient();
  const result = await getProviderHealth("never-written", fake);
  assert.equal(result, null);
});

test("parseProviderHealthState rejects malformed stored data instead of throwing", () => {
  assert.equal(parseProviderHealthState("not json"), null);
  assert.equal(parseProviderHealthState("{}"), null);
  assert.equal(parseProviderHealthState(JSON.stringify({ status: "on-fire" })), null);
  assert.equal(
    parseProviderHealthState(JSON.stringify({ status: "healthy", consecutiveFailures: -1, lastCheckedAt: "x" })),
    null
  );
});

test("Redis-disabled/unconfigured behavior: reads null, writes/clears no-op, no throw", async () => {
  // Passing `null` as the override simulates getRedisClient() returning null
  // (Redis disabled or REDIS_URL absent) without touching process.env or the
  // real singleton.
  const read = await getProviderHealth("fal", null);
  assert.equal(read, null);

  await assert.doesNotReject(setProviderHealth("fal", HEALTHY, null));
  await assert.doesNotReject(clearProviderHealth("fal", null));
});

test("real getRedisClient() singleton path: disabled by default in a bare test process", async () => {
  // No override passed at all -> exercises the actual resolveClient() ->
  // getRedisClient() path. A plain `node:test` run never calls
  // @next/env's loadEnvConfig, so REDIS_ENABLED is unset here and
  // getRedisClient() returns null exactly as it does when Redis is
  // genuinely disabled. No network attempted either way.
  const result = await getProviderHealth("fal");
  assert.equal(result, null);
});

test("Redis command failure fails open on get/set/del instead of throwing", async () => {
  const fake = new FakeRedisClient();
  await setProviderHealth("fal", HEALTHY, fake);

  fake.failNextCommand("get");
  await assert.doesNotReject(async () => {
    const result = await getProviderHealth("fal", fake);
    assert.equal(result, null);
  });

  fake.failNextCommand("set");
  await assert.doesNotReject(setProviderHealth("fal", DEGRADED, fake));

  fake.failNextCommand("del");
  await assert.doesNotReject(clearProviderHealth("fal", fake));
});

test("invalid provider id is rejected by the centralized keyspace validation, regardless of Redis availability", async () => {
  await assert.rejects(getProviderHealth("fal:evil"), /invalid providerId identifier/);
  await assert.rejects(setProviderHealth("has space", HEALTHY), /invalid providerId identifier/);
  await assert.rejects(clearProviderHealth(""), /invalid providerId identifier/);

  // Rejected even when a working fake client is supplied - key validation
  // happens before any Redis interaction is attempted.
  const fake = new FakeRedisClient();
  await assert.rejects(getProviderHealth("bad:id", fake), /invalid providerId identifier/);
  assert.equal(fake.calls.length, 0, "no Redis command should run for an invalid provider id");
});
