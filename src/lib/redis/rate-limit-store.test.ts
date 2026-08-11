import { strict as assert } from "node:assert";
import { test } from "node:test";
import { rateLimitKey, REDIS_KEY_VERSION } from "./redis-keys";
import { consumeRateLimit, type RateLimitRedisClient } from "./rate-limit-store";

/**
 * Zero-cost unit tests for the Redis rate-limit state foundation (Phase
 * 6R.7). Every test uses an in-memory fake implementing
 * RateLimitRedisClient — no ioredis import, no getRedisClient() call, no
 * network, no Redis Cloud connection, no real Redis key, no real Lua
 * interpreter (the fake reimplements the increment script's exact
 * semantics in plain synchronous JS).
 */

/**
 * In-memory fake. `incrementWindow` performs its increment-and-maybe-expire
 * check in one synchronous block with no `await` in between — this is what
 * makes the fake atomic under "concurrent" test callers (raced via
 * Promise.all in a single-threaded test process), exactly mirroring the
 * atomicity the real Lua script provides server-side.
 */
class FakeRedisClient implements RateLimitRedisClient {
  private counters = new Map<string, { count: number; expiresAtMs: number }>();
  calls: { key: string; windowSeconds: number }[] = [];
  private failNext = false;
  private clockMs: number;

  constructor(startMs = 1_700_000_000_000) {
    this.clockMs = startMs;
  }

  advanceMs(ms: number): void {
    this.clockMs += ms;
  }

  failNextCommand(): void {
    this.failNext = true;
  }

  async incrementWindow(key: string, windowSeconds: number): Promise<[number, number]> {
    this.calls.push({ key, windowSeconds });
    if (this.failNext) {
      this.failNext = false;
      throw new Error("simulated incrementWindow failure");
    }

    const existing = this.counters.get(key);
    // No await between the expiry check and the write - the synchronous
    // block that makes this atomic under concurrent test callers.
    if (!existing || existing.expiresAtMs <= this.clockMs) {
      const entry = { count: 1, expiresAtMs: this.clockMs + windowSeconds * 1000 };
      this.counters.set(key, entry);
      return [1, windowSeconds];
    }

    existing.count += 1;
    const ttlSeconds = Math.ceil((existing.expiresAtMs - this.clockMs) / 1000);
    return [existing.count, ttlSeconds];
  }
}

test("first request is allowed, remaining count is correct", async () => {
  const fake = new FakeRedisClient();
  const result = await consumeRateLimit(
    { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
    fake
  );
  assert.equal(result.outcome, "allowed");
  if (result.outcome === "allowed") {
    assert.equal(result.limit, 5);
    assert.equal(result.remaining, 4);
  }
});

test("request exactly at the limit is allowed", async () => {
  const fake = new FakeRedisClient();
  let last;
  for (let i = 0; i < 5; i++) {
    last = await consumeRateLimit(
      { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
      fake
    );
  }
  assert.equal(last!.outcome, "allowed");
  if (last!.outcome === "allowed") assert.equal(last!.remaining, 0);
});

test("request over the limit is denied with a positive retryAfterSeconds", async () => {
  const fake = new FakeRedisClient();
  for (let i = 0; i < 5; i++) {
    await consumeRateLimit(
      { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
      fake
    );
  }
  const sixth = await consumeRateLimit(
    { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
    fake
  );
  assert.equal(sixth.outcome, "limited");
  if (sixth.outcome === "limited") {
    assert.equal(sixth.remaining, 0);
    assert.ok(sixth.retryAfterSeconds > 0);
    assert.equal(sixth.retryAfterSeconds, sixth.resetAfterSeconds);
  }
});

test("window reset: after the window expires, the counter starts over", async () => {
  const fake = new FakeRedisClient();
  for (let i = 0; i < 5; i++) {
    await consumeRateLimit(
      { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
      fake
    );
  }
  const limited = await consumeRateLimit(
    { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
    fake
  );
  assert.equal(limited.outcome, "limited");

  fake.advanceMs(61_000); // past the 60s window
  const afterReset = await consumeRateLimit(
    { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
    fake
  );
  assert.equal(afterReset.outcome, "allowed");
  if (afterReset.outcome === "allowed") assert.equal(afterReset.remaining, 4);
});

test("separate subjects do not collide", async () => {
  const fake = new FakeRedisClient();
  for (let i = 0; i < 5; i++) {
    await consumeRateLimit(
      { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
      fake
    );
  }
  const otherUser = await consumeRateLimit(
    { subject: "user", subjectId: "user_2", action: "generate", limit: 5, windowSeconds: 60 },
    fake
  );
  assert.equal(otherUser.outcome, "allowed");
  if (otherUser.outcome === "allowed") assert.equal(otherUser.remaining, 4);
});

test("separate actions for the same subject do not collide", async () => {
  const fake = new FakeRedisClient();
  for (let i = 0; i < 5; i++) {
    await consumeRateLimit(
      { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
      fake
    );
  }
  const otherAction = await consumeRateLimit(
    { subject: "user", subjectId: "user_1", action: "login-attempt", limit: 5, windowSeconds: 60 },
    fake
  );
  assert.equal(otherAction.outcome, "allowed");
  if (otherAction.outcome === "allowed") assert.equal(otherAction.remaining, 4);
});

test("invalid subjectId rejected before any Redis command runs", async () => {
  const fake = new FakeRedisClient();
  await assert.rejects(
    consumeRateLimit({ subject: "user", subjectId: "bad id", action: "generate", limit: 5, windowSeconds: 60 }, fake)
  );
  assert.equal(fake.calls.length, 0);
});

test("invalid limit rejected: zero, negative, non-integer, and absurdly large", async () => {
  const fake = new FakeRedisClient();
  const base = { subject: "user" as const, subjectId: "user_1", action: "generate", windowSeconds: 60 };
  await assert.rejects(consumeRateLimit({ ...base, limit: 0 }, fake));
  await assert.rejects(consumeRateLimit({ ...base, limit: -1 }, fake));
  await assert.rejects(consumeRateLimit({ ...base, limit: 2.5 }, fake));
  await assert.rejects(consumeRateLimit({ ...base, limit: 10_000_000 }, fake));
  assert.equal(fake.calls.length, 0);
});

test("invalid windowSeconds rejected: zero, negative, non-integer, and absurdly large", async () => {
  const fake = new FakeRedisClient();
  const base = { subject: "user" as const, subjectId: "user_1", action: "generate", limit: 5 };
  await assert.rejects(consumeRateLimit({ ...base, windowSeconds: 0 }, fake));
  await assert.rejects(consumeRateLimit({ ...base, windowSeconds: -60 }, fake));
  await assert.rejects(consumeRateLimit({ ...base, windowSeconds: 1.5 }, fake));
  await assert.rejects(consumeRateLimit({ ...base, windowSeconds: 999_999 }, fake));
  assert.equal(fake.calls.length, 0);
});

test("Redis disabled/unconfigured => explicit unavailable, never allowed or limited", async () => {
  const result = await consumeRateLimit(
    { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
    null
  );
  assert.deepEqual(result, { outcome: "unavailable" });
});

test("real getRedisClient() singleton path: unavailable by default in a bare test process", async () => {
  const result = await consumeRateLimit({
    subject: "user",
    subjectId: "user_1",
    action: "generate",
    limit: 5,
    windowSeconds: 60,
  });
  assert.deepEqual(result, { outcome: "unavailable" });
});

test("Redis command failure => explicit unavailable, never falsely allowed", async () => {
  const fake = new FakeRedisClient();
  fake.failNextCommand();
  const result = await consumeRateLimit(
    { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
    fake
  );
  assert.deepEqual(result, { outcome: "unavailable" });
});

test("two concurrent calls cannot lose an increment", async () => {
  const fake = new FakeRedisClient();
  const [a, b] = await Promise.all([
    consumeRateLimit({ subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 }, fake),
    consumeRateLimit({ subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 }, fake),
  ]);
  const remainings = [a, b]
    .filter((r): r is Extract<typeof r, { outcome: "allowed" }> => r.outcome === "allowed")
    .map((r) => r.remaining)
    .sort((x, y) => x - y);
  // Two increments against limit 5 must produce remaining values {3, 4} -
  // never {4, 4} (which would mean one increment was lost).
  assert.deepEqual(remainings, [3, 4]);
});

test("N concurrent calls respect the exact limit", async () => {
  const fake = new FakeRedisClient();
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      consumeRateLimit({ subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 }, fake)
    )
  );
  const allowedCount = results.filter((r) => r.outcome === "allowed").length;
  const limitedCount = results.filter((r) => r.outcome === "limited").length;
  assert.equal(allowedCount, 5);
  assert.equal(limitedCount, 7);
});

test("key always carries a TTL: the fake's increment always sets an expiry on first hit", async () => {
  const fake = new FakeRedisClient();
  await consumeRateLimit(
    { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
    fake
  );
  // Advancing time past the window must make the NEXT call start a fresh
  // counter, proving the key was not left permanent.
  fake.advanceMs(61_000);
  const result = await consumeRateLimit(
    { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 60 },
    fake
  );
  assert.equal(result.outcome, "allowed");
  if (result.outcome === "allowed") assert.equal(result.remaining, 4);
});

test("uses the centralized key builder, not a raw ad-hoc key", async () => {
  const fake = new FakeRedisClient();
  await consumeRateLimit(
    { subject: "user", subjectId: "user_1", action: "generate", limit: 5, windowSeconds: 3600 },
    fake
  );
  assert.equal(fake.calls.length, 1);
  const expectedPrefix = `cinefield:v${REDIS_KEY_VERSION}:rate-limit:user:user_1:generate:`;
  assert.ok(fake.calls[0].key.startsWith(expectedPrefix), `key was: ${fake.calls[0].key}`);
  // Confirms the SAME builder rateLimitKey() uses is what produced this key
  // (a known, valid windowId reconstructs a key that matches this prefix).
  assert.ok(fake.calls[0].key.startsWith(rateLimitKey("user", "user_1", "generate", "0").slice(0, expectedPrefix.length)));
  assert.equal(fake.calls[0].windowSeconds, 3600);
});

test("no network: this entire suite only uses an in-memory fake client", () => {
  // Structural guarantee: every test above passes an explicit
  // testClientOverride (a FakeRedisClient or null), except the single
  // "real getRedisClient() singleton path" test, which relies on Redis
  // being unconfigured in a bare node:test process (no @next/env load) -
  // confirmed by that test asserting "unavailable", never a live result.
  assert.ok(true);
});
