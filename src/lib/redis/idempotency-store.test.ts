import { strict as assert } from "node:assert";
import { test } from "node:test";
import { idempotencyKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import {
  claimIdempotency,
  completeIdempotency,
  getIdempotency,
  type IdempotencyRedisClient,
} from "./idempotency-store";

/**
 * Zero-cost unit tests for the Redis idempotency claim store (Phase 6R.7,
 * E1). Every test uses an in-memory fake implementing
 * IdempotencyRedisClient — no ioredis import, no getRedisClient() call, no
 * network, no Redis Cloud connection, no real Redis key.
 */

/**
 * In-memory fake. `setNX` mirrors real Redis SET...NX atomicity: the
 * check-and-set happens in one synchronous block with no `await` in
 * between, so two "concurrent" calls (raced via Promise.all in a
 * single-threaded test process) can never both observe an empty slot -
 * exactly the guarantee real Redis provides server-side.
 */
class FakeRedisClient implements IdempotencyRedisClient {
  store = new Map<string, string>();
  calls: { op: "setNX" | "setKeepTtl" | "get"; key: string; ttlSeconds?: number }[] = [];
  private failNext: "setNX" | "setKeepTtl" | "get" | null = null;

  failNextCommand(op: "setNX" | "setKeepTtl" | "get"): void {
    this.failNext = op;
  }

  private maybeFail(op: "setNX" | "setKeepTtl" | "get"): void {
    if (this.failNext === op) {
      this.failNext = null;
      throw new Error(`simulated ${op} failure`);
    }
  }

  async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    this.calls.push({ op: "setNX", key, ttlSeconds });
    this.maybeFail("setNX");
    // No await between the check and the write - this is the synchronous
    // block that makes the fake atomic under concurrent test callers.
    if (this.store.has(key)) return false;
    this.store.set(key, value);
    return true;
  }

  async setKeepTtl(key: string, value: string): Promise<void> {
    this.calls.push({ op: "setKeepTtl", key });
    this.maybeFail("setKeepTtl");
    this.store.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    this.calls.push({ op: "get", key });
    this.maybeFail("get");
    return this.store.has(key) ? this.store.get(key)! : null;
  }
}

test("claimIdempotency: first claim succeeds", async () => {
  const fake = new FakeRedisClient();
  const result = await claimIdempotency("command", "cmd-1", fake);
  assert.deepEqual(result, { outcome: "claimed" });
});

test("claimIdempotency: duplicate claim is rejected, does not overwrite", async () => {
  const fake = new FakeRedisClient();
  const first = await claimIdempotency("command", "cmd-1", fake);
  const second = await claimIdempotency("command", "cmd-1", fake);

  assert.deepEqual(first, { outcome: "claimed" });
  assert.deepEqual(second, { outcome: "duplicate" });
});

test("claimIdempotency: uses the centralized key builder and idempotency TTL", async () => {
  const fake = new FakeRedisClient();
  await claimIdempotency("attempt", "attempt-1", fake);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].op, "setNX");
  assert.equal(fake.calls[0].key, idempotencyKey("attempt", "attempt-1"));
  assert.equal(fake.calls[0].ttlSeconds, REDIS_KEY_TTL_SECONDS.idempotency);
});

test("claimIdempotency: uses atomic NX - no GET is ever issued by claim itself", async () => {
  const fake = new FakeRedisClient();
  await claimIdempotency("command", "cmd-1", fake);
  await claimIdempotency("command", "cmd-1", fake);

  assert.ok(
    fake.calls.every((c) => c.op === "setNX"),
    "claimIdempotency must never call get() - no GET-then-SET race"
  );
});

test("concurrent duplicate claims on the same id: exactly one winner", async () => {
  const fake = new FakeRedisClient();
  const attempts = 8;
  const results = await Promise.all(
    Array.from({ length: attempts }, () => claimIdempotency("command", "race-cmd", fake))
  );

  const claimed = results.filter((r) => r.outcome === "claimed");
  const duplicates = results.filter((r) => r.outcome === "duplicate");

  assert.equal(claimed.length, 1, "exactly one caller must win the claim");
  assert.equal(duplicates.length, attempts - 1);
});

test("concurrent claims on DIFFERENT ids: every distinct id wins independently", async () => {
  const fake = new FakeRedisClient();
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => claimIdempotency("command", `distinct-${i}`, fake))
  );
  assert.ok(results.every((r) => r.outcome === "claimed"));
});

test("getIdempotency: reflects a pending claim, then a completed one", async () => {
  const fake = new FakeRedisClient();
  await claimIdempotency("command", "cmd-1", fake);

  const pending = await getIdempotency("command", "cmd-1", fake);
  assert.equal(pending.outcome, "present");
  if (pending.outcome === "present") {
    assert.equal(pending.record.state, "pending");
    assert.equal(pending.record.value, undefined);
  }

  await completeIdempotency("command", "cmd-1", "generation-abc", fake);

  const completed = await getIdempotency("command", "cmd-1", fake);
  assert.equal(completed.outcome, "present");
  if (completed.outcome === "present") {
    assert.equal(completed.record.state, "completed");
    assert.equal(completed.record.value, "generation-abc");
    assert.equal(completed.record.claimedAt, pending.outcome === "present" ? pending.record.claimedAt : undefined);
  }
});

test("getIdempotency: absent for a never-claimed id", async () => {
  const fake = new FakeRedisClient();
  const result = await getIdempotency("command", "never-claimed", fake);
  assert.deepEqual(result, { outcome: "absent" });
});

test("completeIdempotency: preserves original claimedAt via KEEPTTL semantics, not a fresh SET", async () => {
  const fake = new FakeRedisClient();
  await claimIdempotency("command", "cmd-1", fake);
  await completeIdempotency("command", "cmd-1", "value-1", fake);

  const setKeepTtlCalls = fake.calls.filter((c) => c.op === "setKeepTtl");
  assert.equal(setKeepTtlCalls.length, 1);
  assert.equal(setKeepTtlCalls[0].key, idempotencyKey("command", "cmd-1"));
});

test("Redis-disabled/unconfigured behavior: every function reports unavailable, never claimed", async () => {
  const claim = await claimIdempotency("command", "cmd-1", null);
  const read = await getIdempotency("command", "cmd-1", null);
  const complete = await completeIdempotency("command", "cmd-1", "v", null);

  assert.deepEqual(claim, { outcome: "unavailable" });
  assert.deepEqual(read, { outcome: "unavailable" });
  assert.deepEqual(complete, { outcome: "unavailable" });
});

test("real getRedisClient() singleton path: unavailable by default in a bare test process", async () => {
  // No override -> exercises the real resolveClient()/getRedisClient() path.
  // A plain node:test run never loads .env.local, so REDIS_ENABLED is unset
  // here and getRedisClient() returns null, exactly as it does when Redis
  // is genuinely disabled. No network attempted either way.
  const result = await claimIdempotency("command", "cmd-1");
  assert.deepEqual(result, { outcome: "unavailable" });
});

test("Redis command failure reports unavailable, never falsely claimed, never throws", async () => {
  const fake = new FakeRedisClient();

  fake.failNextCommand("setNX");
  const claimResult = await claimIdempotency("command", "cmd-1", fake);
  assert.deepEqual(claimResult, { outcome: "unavailable" });
  // Critical: a failed claim attempt must not be indistinguishable from a
  // successful one, and must not have left a record behind.
  assert.equal(fake.store.has(idempotencyKey("command", "cmd-1")), false);

  await claimIdempotency("command", "cmd-2", fake);
  fake.failNextCommand("get");
  const readResult = await getIdempotency("command", "cmd-2", fake);
  assert.deepEqual(readResult, { outcome: "unavailable" });

  fake.failNextCommand("setKeepTtl");
  const completeResult = await completeIdempotency("command", "cmd-2", "v", fake);
  assert.deepEqual(completeResult, { outcome: "unavailable" });
});

test("invalid identifier is rejected regardless of Redis availability, before any Redis command runs", async () => {
  await assert.rejects(claimIdempotency("command", "has space"), /invalid id identifier/);
  await assert.rejects(getIdempotency("command", "bad:id"), /invalid id identifier/);
  await assert.rejects(completeIdempotency("command", ""), /invalid id identifier/);

  const fake = new FakeRedisClient();
  await assert.rejects(claimIdempotency("command", "bad:id", fake), /invalid id identifier/);
  assert.equal(fake.calls.length, 0, "no Redis command should run for an invalid identifier");
});

test("claimIdempotency never performs a GET before its SET - purely NX-based", async () => {
  const fake = new FakeRedisClient();
  await claimIdempotency("attempt", "no-race-check", fake);
  assert.deepEqual(
    fake.calls.map((c) => c.op),
    ["setNX"]
  );
});
