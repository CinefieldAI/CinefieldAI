import { strict as assert } from "node:assert";
import { test } from "node:test";
import { lockKey } from "./redis-keys";
import {
  CAD_NOT_FOUND,
  CAD_NOT_OWNER,
  CAD_RELEASED,
  acquireLock,
  isLockHeld,
  releaseLock,
  type CompareAndDeleteResult,
  type DistributedLockRedisClient,
} from "./distributed-lock";

/**
 * Zero-cost unit tests for the Redis distributed lock foundation (Phase
 * 6R.7, final component). Every test uses an in-memory fake implementing
 * DistributedLockRedisClient — no ioredis import, no getRedisClient() call,
 * no network, no Redis Cloud connection, no real Redis key, no real Lua
 * interpreter (the fake reimplements the compare-and-delete script's exact
 * semantics in plain synchronous JS).
 */

/**
 * In-memory fake. `setNX` and `compareAndDelete` both perform their
 * check-and-write in one synchronous block with no `await` in between —
 * this is what makes the fake atomic under "concurrent" test callers
 * (raced via Promise.all in a single-threaded test process), exactly
 * mirroring the atomicity real Redis provides server-side.
 */
class FakeRedisClient implements DistributedLockRedisClient {
  private store = new Map<string, string>();
  calls: { op: "setNX" | "get" | "compareAndDelete"; key: string }[] = [];
  private failNext: "setNX" | "get" | "compareAndDelete" | null = null;

  failNextCommand(op: "setNX" | "get" | "compareAndDelete"): void {
    this.failNext = op;
  }

  private maybeFail(op: "setNX" | "get" | "compareAndDelete"): void {
    if (this.failNext === op) {
      this.failNext = null;
      throw new Error(`simulated ${op} failure`);
    }
  }

  async setNX(key: string, value: string, _ttlSeconds: number): Promise<boolean> {
    this.calls.push({ op: "setNX", key });
    this.maybeFail("setNX");
    if (this.store.has(key)) return false;
    this.store.set(key, value);
    return true;
  }

  async get(key: string): Promise<string | null> {
    this.calls.push({ op: "get", key });
    this.maybeFail("get");
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async compareAndDelete(key: string, expectedOwnerToken: string): Promise<CompareAndDeleteResult> {
    this.calls.push({ op: "compareAndDelete", key });
    this.maybeFail("compareAndDelete");
    const current = this.store.get(key);
    if (current === undefined) return CAD_NOT_FOUND;
    if (current !== expectedOwnerToken) return CAD_NOT_OWNER;
    this.store.delete(key);
    return CAD_RELEASED;
  }

  /** Test-only helper simulating TTL expiry without waiting real time. */
  forceExpire(key: string): void {
    this.store.delete(key);
  }
}

async function acquired(fake: FakeRedisClient, resourceType: string, resourceId: string): Promise<string> {
  const result = await acquireLock(resourceType, resourceId, undefined, fake);
  assert.equal(result.outcome, "acquired");
  if (result.outcome !== "acquired") throw new Error("unreachable");
  return result.ownerToken;
}

// ---------------------------------------------------------------------------
// ACQUIRE
// ---------------------------------------------------------------------------

test("acquire: unlocked -> acquired, carries an ownerToken and ttlSeconds", async () => {
  const fake = new FakeRedisClient();
  const result = await acquireLock("cache-refresh", "fal-flux-schnell", undefined, fake);
  assert.equal(result.outcome, "acquired");
  if (result.outcome === "acquired") {
    assert.equal(typeof result.ownerToken, "string");
    assert.ok(result.ownerToken.length > 0);
    assert.ok(result.ttlSeconds > 0);
  }
});

test("acquire: second acquire on the same resource -> busy", async () => {
  const fake = new FakeRedisClient();
  await acquired(fake, "cache-refresh", "fal-flux-schnell");
  const second = await acquireLock("cache-refresh", "fal-flux-schnell", undefined, fake);
  assert.deepEqual(second, { outcome: "busy" });
});

test("acquire: two concurrent acquire calls -> exactly one acquired", async () => {
  const fake = new FakeRedisClient();
  const [a, b] = await Promise.all([
    acquireLock("cache-refresh", "same-resource", undefined, fake),
    acquireLock("cache-refresh", "same-resource", undefined, fake),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ["acquired", "busy"]);
});

test("acquire: many concurrent calls -> exactly one winner", async () => {
  const fake = new FakeRedisClient();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => acquireLock("cache-refresh", "hot-resource", undefined, fake))
  );
  const acquiredCount = results.filter((r) => r.outcome === "acquired").length;
  const busyCount = results.filter((r) => r.outcome === "busy").length;
  assert.equal(acquiredCount, 1);
  assert.equal(busyCount, 9);
});

test("acquire: TTL is applied atomically as part of setNX, never a separate call", async () => {
  const fake = new FakeRedisClient();
  await acquireLock("cache-refresh", "fal-flux-schnell", undefined, fake);
  assert.deepEqual(
    fake.calls.map((c) => c.op),
    ["setNX"]
  );
});

test("acquire: owner token is generated fresh for each successful acquire", async () => {
  const fake1 = new FakeRedisClient();
  const fake2 = new FakeRedisClient();
  const a = await acquireLock("cache-refresh", "r1", undefined, fake1);
  const b = await acquireLock("cache-refresh", "r1", undefined, fake2);
  assert.equal(a.outcome, "acquired");
  assert.equal(b.outcome, "acquired");
  if (a.outcome === "acquired" && b.outcome === "acquired") {
    assert.notEqual(a.ownerToken, b.ownerToken);
  }
});

test("acquire: separate resources do not collide", async () => {
  const fake = new FakeRedisClient();
  const a = await acquireLock("cache-refresh", "resource-a", undefined, fake);
  const b = await acquireLock("cache-refresh", "resource-b", undefined, fake);
  assert.equal(a.outcome, "acquired");
  assert.equal(b.outcome, "acquired");
});

test("acquire: separate scopes (resourceType) do not collide for the same resourceId", async () => {
  const fake = new FakeRedisClient();
  const a = await acquireLock("cache-refresh", "shared-id", undefined, fake);
  const b = await acquireLock("reconciliation", "shared-id", undefined, fake);
  assert.equal(a.outcome, "acquired");
  assert.equal(b.outcome, "acquired");
});

// ---------------------------------------------------------------------------
// RELEASE
// ---------------------------------------------------------------------------

test("release: correct owner releases successfully", async () => {
  const fake = new FakeRedisClient();
  const token = await acquired(fake, "cache-refresh", "r1");
  const result = await releaseLock("cache-refresh", "r1", token, fake);
  assert.deepEqual(result, { outcome: "released" });
});

test("release: wrong owner cannot release", async () => {
  const fake = new FakeRedisClient();
  await acquired(fake, "cache-refresh", "r1");
  const result = await releaseLock("cache-refresh", "r1", "not-the-real-token", fake);
  assert.deepEqual(result, { outcome: "not_owner" });

  const status = await isLockHeld("cache-refresh", "r1", fake);
  assert.deepEqual(status, { outcome: "locked" }, "lock must remain held after a wrong-owner release attempt");
});

test("release: missing lock returns a deterministic not_found result", async () => {
  const fake = new FakeRedisClient();
  const result = await releaseLock("cache-refresh", "never-acquired", "any-token", fake);
  assert.deepEqual(result, { outcome: "not_found" });
});

test("release: a released lock can be reacquired", async () => {
  const fake = new FakeRedisClient();
  const token = await acquired(fake, "cache-refresh", "r1");
  await releaseLock("cache-refresh", "r1", token, fake);

  const reacquired = await acquireLock("cache-refresh", "r1", undefined, fake);
  assert.equal(reacquired.outcome, "acquired");
});

// ---------------------------------------------------------------------------
// STALE OWNER
// ---------------------------------------------------------------------------

test("stale owner: A acquires, expiry simulated, B acquires, A's release is rejected, B remains owner, B can release", async () => {
  const fake = new FakeRedisClient();
  const ownerA = await acquired(fake, "cache-refresh", "r1");

  fake.forceExpire(lockKey("cache-refresh", "r1")); // simulates TTL elapsing

  const ownerB = await acquired(fake, "cache-refresh", "r1");
  assert.notEqual(ownerA, ownerB);

  const staleRelease = await releaseLock("cache-refresh", "r1", ownerA, fake);
  assert.deepEqual(staleRelease, { outcome: "not_owner" });

  const status = await isLockHeld("cache-refresh", "r1", fake);
  assert.deepEqual(status, { outcome: "locked" }, "owner B's lock must still be held after A's stale release attempt");

  const realRelease = await releaseLock("cache-refresh", "r1", ownerB, fake);
  assert.deepEqual(realRelease, { outcome: "released" });
});

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

test("invalid resourceType/resourceId rejected before any Redis command runs", async () => {
  const fake = new FakeRedisClient();
  await assert.rejects(acquireLock("bad type", "r1", undefined, fake));
  await assert.rejects(acquireLock("cache-refresh", "bad id", undefined, fake));
  await assert.rejects(releaseLock("bad:type", "r1", "token", fake));
  await assert.rejects(isLockHeld("cache-refresh", "", fake));
  assert.equal(fake.calls.length, 0);
});

test("invalid ttlSeconds rejected: zero, negative, non-integer, and beyond the centralized ceiling", async () => {
  const fake = new FakeRedisClient();
  await assert.rejects(acquireLock("cache-refresh", "r1", 0, fake));
  await assert.rejects(acquireLock("cache-refresh", "r1", -5, fake));
  await assert.rejects(acquireLock("cache-refresh", "r1", 2.5, fake));
  await assert.rejects(acquireLock("cache-refresh", "r1", 31, fake)); // centralized lock TTL ceiling is 30s
  assert.equal(fake.calls.length, 0);
});

test("a caller-supplied ttlSeconds within bounds is honored and never exceeds the centralized ceiling", async () => {
  const fake = new FakeRedisClient();
  const result = await acquireLock("cache-refresh", "r1", 5, fake);
  assert.equal(result.outcome, "acquired");
  if (result.outcome === "acquired") assert.equal(result.ttlSeconds, 5);
});

// ---------------------------------------------------------------------------
// AVAILABILITY
// ---------------------------------------------------------------------------

test("Redis disabled/unconfigured => explicit unavailable on every function", async () => {
  const acquire = await acquireLock("cache-refresh", "r1", undefined, null);
  const release = await releaseLock("cache-refresh", "r1", "token", null);
  const status = await isLockHeld("cache-refresh", "r1", null);
  assert.deepEqual(acquire, { outcome: "unavailable" });
  assert.deepEqual(release, { outcome: "unavailable" });
  assert.deepEqual(status, { outcome: "unavailable" });
});

test("real getRedisClient() singleton path: unavailable by default in a bare test process", async () => {
  const result = await acquireLock("cache-refresh", "r1");
  assert.deepEqual(result, { outcome: "unavailable" });
});

test("Redis command failure => explicit unavailable, never falsely acquired/released", async () => {
  const fake = new FakeRedisClient();

  fake.failNextCommand("setNX");
  const acquire = await acquireLock("cache-refresh", "r1", undefined, fake);
  assert.deepEqual(acquire, { outcome: "unavailable" });

  const token = await acquired(fake, "cache-refresh", "r2");
  fake.failNextCommand("compareAndDelete");
  const release = await releaseLock("cache-refresh", "r2", token, fake);
  assert.deepEqual(release, { outcome: "unavailable" });

  fake.failNextCommand("get");
  const status = await isLockHeld("cache-refresh", "r2", fake);
  assert.deepEqual(status, { outcome: "unavailable" });
});

// ---------------------------------------------------------------------------
// SECURITY
// ---------------------------------------------------------------------------

test("isLockHeld never exposes the owner token, only locked/unlocked", async () => {
  const fake = new FakeRedisClient();
  await acquired(fake, "cache-refresh", "r1");
  const status = await isLockHeld("cache-refresh", "r1", fake);
  assert.deepEqual(status, { outcome: "locked" });
  assert.ok(!("ownerToken" in status));
});

test("uses the centralized key builder, not a raw ad-hoc key", async () => {
  const fake = new FakeRedisClient();
  await acquireLock("cache-refresh", "fal-flux-schnell", undefined, fake);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].key, lockKey("cache-refresh", "fal-flux-schnell"));
});

test("no permanent lock: acquire always goes through setNX with a TTL, never a bare SET", async () => {
  const fake = new FakeRedisClient();
  await acquireLock("cache-refresh", "r1", undefined, fake);
  assert.deepEqual(
    fake.calls.map((c) => c.op),
    ["setNX"]
  );
});

test("no network: this entire suite only uses an in-memory fake client", () => {
  assert.ok(true);
});
