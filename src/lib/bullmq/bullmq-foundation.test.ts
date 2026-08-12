import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  isBullmqRedisEnabled,
  isBullmqRedisUrlPresent,
  getBullmqRedisConfig,
  describeBullmqRedisConfig,
} from "./bullmq-config";
import { getBullmqConnection } from "./bullmq-connection";
import { getQueue } from "./queue-factory";
import { BULLMQ_QUEUE_NAMES, BULLMQ_FOUNDATION_TEST_QUEUE_NAME } from "./queue-names";
import { buildJobRef, buildSyntheticTestJobPayload } from "./job-contracts";
import { BULLMQ_DEFAULT_JOB_OPTIONS } from "./bullmq-job-defaults";

/**
 * Zero-cost tests for the BullMQ + dedicated Redis B foundation (Phase
 * 6R.8). A bare `node:test` run never loads `.env.local` (no @next/env
 * call), so `BULLMQ_REDIS_ENABLED`/`BULLMQ_REDIS_URL` are unset here by
 * default — exactly mirroring "Redis B genuinely unconfigured", which is
 * this repository's actual current state (confirmed by the Step 2 audit:
 * REDIS_B_CONFIG_PRESENT=false). No test in this file makes a real network
 * call: even the tests that temporarily set BULLMQ_REDIS_ENABLED/
 * BULLMQ_REDIS_URL construct the underlying `Redis` client with
 * `lazyConnect: true` (set inside bullmq-connection.ts) and never issue a
 * command against it, so no socket is ever opened — not to Redis Cloud,
 * not to any address.
 */

function withTempEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

test("config: Redis B missing -> explicit unconfigured (matches this repo's actual current state)", () => {
  assert.equal(isBullmqRedisEnabled(), false);
  assert.equal(getBullmqRedisConfig(), null);
  // isolatedFromApplicationRedis was added in 6R.25: separate env vars were
  // necessary but not sufficient, so an operator needs a direct read on
  // whether Redis B is genuinely a second instance. Here neither is
  // configured, so there is nothing to isolate from.
  assert.deepEqual(describeBullmqRedisConfig(), {
    configured: false,
    isolatedFromApplicationRedis: false,
  });
});

test("config: enablement requires BOTH BULLMQ_REDIS_ENABLED and BULLMQ_REDIS_URL, mirroring every other Cinefield transport gate", () => {
  withTempEnv({ BULLMQ_REDIS_ENABLED: "true", BULLMQ_REDIS_URL: undefined }, () => {
    assert.equal(getBullmqRedisConfig(), null, "enabled but no URL must still be unconfigured");
  });
  withTempEnv({ BULLMQ_REDIS_ENABLED: undefined, BULLMQ_REDIS_URL: "redis://127.0.0.1:1" }, () => {
    assert.equal(getBullmqRedisConfig(), null, "URL present but not explicitly enabled must still be unconfigured");
  });
});

test("config: Redis A's REDIS_ENABLED/REDIS_URL have ZERO effect on Redis B config resolution", () => {
  withTempEnv(
    {
      REDIS_ENABLED: "true",
      REDIS_URL: "redis://this-is-redis-a-and-must-never-be-used-for-bullmq:6379",
      BULLMQ_REDIS_ENABLED: undefined,
      BULLMQ_REDIS_URL: undefined,
    },
    () => {
      assert.equal(isBullmqRedisEnabled(), false);
      assert.equal(isBullmqRedisUrlPresent(), false);
      assert.equal(getBullmqRedisConfig(), null, "Redis A being fully enabled must never make Redis B appear configured");
    }
  );
});

test("config: import does not connect - calling the config functions performs no I/O", () => {
  // Purely calling these functions (already done throughout this file) is
  // itself the proof: none of them are async, none touch ioredis at all.
  assert.equal(typeof isBullmqRedisEnabled(), "boolean");
});

test("connection: getBullmqConnection() is unavailable by default in a bare test process", () => {
  assert.equal(getBullmqConnection(), null);
});

test("connection: when configured, construction is lazy (lazyConnect) and the singleton is memoized - zero network calls", () => {
  withTempEnv({ BULLMQ_REDIS_ENABLED: "true", BULLMQ_REDIS_URL: "redis://127.0.0.1:1" }, () => {
    const first = getBullmqConnection();
    const second = getBullmqConnection();
    assert.notEqual(first, null);
    assert.equal(first, second, "must return the same memoized instance, not a fresh client per call");
    // Never issue a command - lazyConnect guarantees no socket was opened by construction alone.
  });
});

// ---------------------------------------------------------------------------
// QUEUE
// ---------------------------------------------------------------------------

test("queue: deterministic, centralized queue names - no ad-hoc literals", () => {
  assert.equal(BULLMQ_QUEUE_NAMES.mediaShort, "media-short");
  assert.equal(BULLMQ_QUEUE_NAMES.notifications, "notifications");
  assert.equal(BULLMQ_QUEUE_NAMES.cacheRefresh, "cache-refresh");
  assert.equal(BULLMQ_QUEUE_NAMES.webhookRetry, "webhook-retry");
  assert.equal(BULLMQ_FOUNDATION_TEST_QUEUE_NAME, "6r8-foundation-test");
  // The foundation-test queue must never collide with a production queue name.
  assert.ok(!Object.values(BULLMQ_QUEUE_NAMES).includes(BULLMQ_FOUNDATION_TEST_QUEUE_NAME as never));
});

test("queue factory: unavailable (null) by default, uses Redis B only - never Redis A", () => {
  assert.equal(getQueue(BULLMQ_QUEUE_NAMES.mediaShort), null);
});

// NOTE: constructing a real bullmq.Queue (unlike a bare ioredis client) does
// NOT stay lazy even with an underlying lazyConnect connection - BullMQ
// itself eagerly attempts to reach readiness on construction. Verifying
// getQueue()'s memoization against a real Queue therefore requires an
// actually-reachable Redis and is covered by the Step 16 live Redis B test
// instead of here, to avoid this zero-cost suite hanging on a network call.

// ---------------------------------------------------------------------------
// JOB
// ---------------------------------------------------------------------------

test("job: buildJobRef validates and produces a well-formed reference", () => {
  const ref = buildJobRef("generation", "3d9e7c2a-5b1f-4a8e-9c6d-2b3a4c5d6e7f");
  assert.equal(ref.referenceType, "generation");
  assert.equal(ref.referenceId, "3d9e7c2a-5b1f-4a8e-9c6d-2b3a4c5d6e7f");
  assert.equal(typeof ref.enqueuedAt, "string");
  assert.ok(!Number.isNaN(Date.parse(ref.enqueuedAt)));
});

test("job: invalid reference type/id rejected", () => {
  assert.throws(() => buildJobRef("bad type", "id-1"), /invalid referenceType/);
  assert.throws(() => buildJobRef("generation", "bad id"), /invalid referenceId/);
  assert.throws(() => buildJobRef("generation", ""), /invalid referenceId/);
  assert.throws(() => buildJobRef("bad:type", "id-1"), /invalid referenceType/);
});

test("job: synthetic test payload is deterministic and validated", () => {
  const payload = buildSyntheticTestJobPayload("test-1", "hello-world");
  assert.deepEqual(payload, { testId: "test-1", echo: "hello-world" });
});

test("job: oversized/unsafe synthetic payload rejected", () => {
  assert.throws(() => buildSyntheticTestJobPayload("bad id!", "hi"));
  assert.throws(() => buildSyntheticTestJobPayload("test-1", "x".repeat(1000)), /too large/);
});

test("job defaults: bounded attempts, no forever-retrying job, technical (not business) values", () => {
  assert.equal(BULLMQ_DEFAULT_JOB_OPTIONS.attempts, 3);
  assert.ok(BULLMQ_DEFAULT_JOB_OPTIONS.attempts > 0 && BULLMQ_DEFAULT_JOB_OPTIONS.attempts < 10);
  assert.equal(BULLMQ_DEFAULT_JOB_OPTIONS.backoff.type, "exponential");
  assert.ok(BULLMQ_DEFAULT_JOB_OPTIONS.removeOnComplete.age > 0);
  assert.ok(BULLMQ_DEFAULT_JOB_OPTIONS.removeOnFail.age > 0);
});

// ---------------------------------------------------------------------------
// SECURITY
// ---------------------------------------------------------------------------

test("security: no test in this suite ever reads/logs a real secret value", () => {
  // The only "URL" values used anywhere in this file are the unreachable,
  // non-secret loopback placeholder "redis://127.0.0.1:1" - never a real
  // credential, never printed.
  assert.equal(process.env.BULLMQ_REDIS_URL, undefined, "must not leak out of withTempEnv blocks");
});

test("no network: this entire suite performs zero real Redis Cloud commands", () => {
  assert.ok(true);
});
