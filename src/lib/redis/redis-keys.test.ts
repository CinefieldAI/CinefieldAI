import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  idempotencyKey,
  lockKey,
  modelCacheKey,
  pricingCacheKey,
  providerErrorRateKey,
  providerHealthKey,
  providerLatencyKey,
  rateLimitKey,
  REDIS_KEY_TTL_SECONDS,
  REDIS_KEY_VERSION,
} from "./redis-keys";

/**
 * Zero-cost unit tests for the Redis keyspace contract (Phase 6R.7).
 *
 * Pure string-building tests only — no ioredis import, no getRedisClient()
 * call, no network, no Redis Cloud connection. Run with:
 *   npx tsx --test src/lib/redis/redis-keys.test.ts
 */

test("provider observability keys are versioned and namespaced", () => {
  assert.equal(providerHealthKey("fal"), `cinefield:v${REDIS_KEY_VERSION}:provider-health:fal`);
  assert.equal(providerLatencyKey("fal"), `cinefield:v${REDIS_KEY_VERSION}:provider-latency:fal`);
  assert.equal(
    providerErrorRateKey("cloudflare-workers-ai"),
    `cinefield:v${REDIS_KEY_VERSION}:provider-error-rate:cloudflare-workers-ai`
  );
});

test("rate-limit keys scope by subject type, subject id, and window", () => {
  assert.equal(
    rateLimitKey("user", "user_abc123", "20260811T1200"),
    `cinefield:v${REDIS_KEY_VERSION}:rate-limit:user:user_abc123:20260811T1200`
  );
  assert.equal(
    rateLimitKey("ip", "203-0-113-1", "20260811T1200"),
    `cinefield:v${REDIS_KEY_VERSION}:rate-limit:ip:203-0-113-1:20260811T1200`
  );
});

test("idempotency keys scope by attempt vs command", () => {
  const attemptId = "8f2a4b1e-6c3d-4e7a-9b5f-1a2c3d4e5f6a";
  assert.equal(
    idempotencyKey("attempt", attemptId),
    `cinefield:v${REDIS_KEY_VERSION}:idempotency:attempt:${attemptId}`
  );
  assert.equal(
    idempotencyKey("command", attemptId),
    `cinefield:v${REDIS_KEY_VERSION}:idempotency:command:${attemptId}`
  );
});

test("model/pricing cache keys are namespaced by model id", () => {
  assert.equal(modelCacheKey("fal-flux-schnell"), `cinefield:v${REDIS_KEY_VERSION}:model-cache:fal-flux-schnell`);
  assert.equal(
    pricingCacheKey("fal-flux-schnell"),
    `cinefield:v${REDIS_KEY_VERSION}:pricing-cache:fal-flux-schnell`
  );
});

test("lock keys scope by resource type and resource id", () => {
  const generationId = "3d9e7c2a-5b1f-4a8e-9c6d-2b3a4c5d6e7f";
  assert.equal(
    lockKey("generation-finalize", generationId),
    `cinefield:v${REDIS_KEY_VERSION}:lock:generation-finalize:${generationId}`
  );
});

test("identifiers reject characters that could inject a key segment", () => {
  assert.throws(() => providerHealthKey("fal:evil"), /invalid providerId identifier/);
  assert.throws(() => providerHealthKey(""), /invalid providerId identifier/);
  assert.throws(() => rateLimitKey("user", "has space", "w1"), /invalid subjectId identifier/);
  assert.throws(() => lockKey("type", "id with colon:here"), /invalid resourceId identifier/);
});

test("every namespace has a documented TTL", () => {
  const namespaces = [
    "provider-health",
    "provider-latency",
    "provider-error-rate",
    "rate-limit",
    "idempotency",
    "model-cache",
    "pricing-cache",
    "lock",
  ] as const;

  for (const namespace of namespaces) {
    const ttl = REDIS_KEY_TTL_SECONDS[namespace];
    assert.ok(typeof ttl === "number" && ttl > 0, `${namespace} must have a positive TTL documented`);
  }
});

test("two different providers never collide", () => {
  assert.notEqual(providerHealthKey("fal"), providerHealthKey("mock"));
});
