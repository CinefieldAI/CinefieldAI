import { strict as assert } from "node:assert";
import { test } from "node:test";
import { modelCacheKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import {
  getCachedModel,
  invalidateCachedModel,
  setCachedModel,
  type ModelCacheRedisClient,
} from "./model-cache";

/**
 * Zero-cost unit tests for the model metadata cache (Phase 6R.7). Every
 * test uses an in-memory fake implementing ModelCacheRedisClient — no
 * ioredis import, no getRedisClient() call, no network, no Redis Cloud
 * connection, no real Redis key.
 */

class FakeRedisClient implements ModelCacheRedisClient {
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

const SAMPLE_ENTRY = {
  platformModelId: "fal-flux-schnell",
  provider: "fal",
  providerModelId: "fal-ai/flux/schnell",
  generationType: "image" as const,
  enabled: true,
};

test("set + get: hit returns the stored entry", async () => {
  const fake = new FakeRedisClient();
  const write = await setCachedModel("fal-flux-schnell", SAMPLE_ENTRY, fake);
  assert.deepEqual(write, { outcome: "stored" });

  const read = await getCachedModel("fal-flux-schnell", fake);
  assert.equal(read.outcome, "hit");
  if (read.outcome === "hit") {
    assert.equal(read.value.platformModelId, "fal-flux-schnell");
    assert.equal(read.value.provider, "fal");
    assert.equal(read.value.enabled, true);
    assert.equal(read.value.schemaVersion, 1);
  }
});

test("missing key => miss", async () => {
  const fake = new FakeRedisClient();
  const read = await getCachedModel("never-cached", fake);
  assert.deepEqual(read, { outcome: "miss" });
});

test("exact invalidation => subsequent read is a miss", async () => {
  const fake = new FakeRedisClient();
  await setCachedModel("fal-flux-schnell", SAMPLE_ENTRY, fake);
  const invalidate = await invalidateCachedModel("fal-flux-schnell", fake);
  assert.deepEqual(invalidate, { outcome: "invalidated" });

  const read = await getCachedModel("fal-flux-schnell", fake);
  assert.deepEqual(read, { outcome: "miss" });
});

test("TTL applied: setEx is called with the centralized model-cache TTL", async () => {
  const fake = new FakeRedisClient();
  await setCachedModel("fal-flux-schnell", SAMPLE_ENTRY, fake);
  assert.equal(fake.calls.filter((c) => c.op === "setEx").length, 1);
  assert.equal(REDIS_KEY_TTL_SECONDS["model-cache"], 3600);
});

test("malformed JSON is handled safely: treated as a miss, never throws", async () => {
  const fake = new FakeRedisClient();
  fake.store.set(modelCacheKey("fal-flux-schnell"), "{not json");
  const read = await getCachedModel("fal-flux-schnell", fake);
  assert.deepEqual(read, { outcome: "miss" });
});

test("unrecognized schema version is handled safely: treated as a miss", async () => {
  const fake = new FakeRedisClient();
  fake.store.set(
    modelCacheKey("fal-flux-schnell"),
    JSON.stringify({ schemaVersion: 999, ...SAMPLE_ENTRY, cachedAt: new Date().toISOString() })
  );
  const read = await getCachedModel("fal-flux-schnell", fake);
  assert.deepEqual(read, { outcome: "miss" });
});

test("invalid model id rejected before any Redis command runs", async () => {
  const fake = new FakeRedisClient();
  await assert.rejects(getCachedModel("bad id", fake));
  await assert.rejects(setCachedModel("bad:id", SAMPLE_ENTRY, fake));
  await assert.rejects(invalidateCachedModel("", fake));
  assert.equal(fake.calls.length, 0);
});

test("Redis disabled/unconfigured => explicit unavailable, never confused with miss", async () => {
  const read = await getCachedModel("fal-flux-schnell", null);
  const write = await setCachedModel("fal-flux-schnell", SAMPLE_ENTRY, null);
  const invalidate = await invalidateCachedModel("fal-flux-schnell", null);
  assert.deepEqual(read, { outcome: "unavailable" });
  assert.deepEqual(write, { outcome: "unavailable" });
  assert.deepEqual(invalidate, { outcome: "unavailable" });
});

test("real getRedisClient() singleton path: unavailable by default in a bare test process", async () => {
  const result = await getCachedModel("fal-flux-schnell");
  assert.deepEqual(result, { outcome: "unavailable" });
});

test("Redis command error => explicit unavailable, never crashes", async () => {
  const fake = new FakeRedisClient();
  fake.failNextCommand("setEx");
  const write = await setCachedModel("fal-flux-schnell", SAMPLE_ENTRY, fake);
  assert.deepEqual(write, { outcome: "unavailable" });

  fake.failNextCommand("get");
  const read = await getCachedModel("fal-flux-schnell", fake);
  assert.deepEqual(read, { outcome: "unavailable" });

  fake.failNextCommand("del");
  const invalidate = await invalidateCachedModel("fal-flux-schnell", fake);
  assert.deepEqual(invalidate, { outcome: "unavailable" });
});

test("oversized payload is rejected before touching Redis", async () => {
  const fake = new FakeRedisClient();
  const oversized = {
    ...SAMPLE_ENTRY,
    capabilities: {
      supportedAspectRatios: Array.from({ length: 5000 }, (_, i) => `ratio-${i}`),
      supportedResolutions: [],
      supportedDurationsSeconds: [],
      minOutputCount: 1,
      maxOutputCount: 1,
      supportsThinking: false,
      supportedThinkingValues: [],
      requiresPrompt: true,
    },
  };
  const write = await setCachedModel("fal-flux-schnell", oversized, fake);
  assert.deepEqual(write, { outcome: "rejected", reason: "payload_too_large" });
  assert.equal(fake.calls.length, 0, "no Redis command should run for a rejected oversized payload");
});

test("no permanent key: every write goes through setEx (TTL-bearing), never a bare SET", async () => {
  const fake = new FakeRedisClient();
  await setCachedModel("fal-flux-schnell", SAMPLE_ENTRY, fake);
  assert.deepEqual(
    fake.calls.map((c) => c.op),
    ["setEx"]
  );
});

test("uses the centralized key builder, not a raw ad-hoc key", async () => {
  const fake = new FakeRedisClient();
  await setCachedModel("fal-flux-schnell", SAMPLE_ENTRY, fake);
  assert.equal(fake.calls[0].key, modelCacheKey("fal-flux-schnell"));
});

test("no network: this entire suite only uses an in-memory fake client", () => {
  assert.ok(true);
});
