import { strict as assert } from "node:assert";
import { test } from "node:test";
import { idempotencyKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import {
  CAS_ABSENT,
  CAS_OK,
  CAS_OWNER_MISMATCH,
  CAS_STATE_MISMATCH,
  claimIdempotency,
  completeIdempotency,
  failIdempotency,
  getIdempotency,
  retryIdempotency,
  type CompareAndSetResult,
  type IdempotencyRedisClient,
  type IdempotencyState,
} from "./idempotency-store";

/**
 * Zero-cost unit tests for the Redis idempotency claim store (Phase 6R.7,
 * E1 -> E3A). Every test uses an in-memory fake implementing
 * IdempotencyRedisClient — no ioredis import, no getRedisClient() call, no
 * network, no Redis Cloud connection, no real Redis key, no real Lua
 * interpreter (the fake reimplements the CAS script's exact semantics in
 * plain synchronous JS).
 */

/**
 * In-memory fake. `setNX` and `compareAndSetState` both perform their
 * check-and-write in one synchronous block with no `await` in between — this
 * is what makes the fake atomic under "concurrent" test callers (raced via
 * Promise.all in a single-threaded test process), exactly mirroring the
 * atomicity real Redis provides server-side (SET...NX is a single command;
 * the real compareAndSetState is a single Lua script, which Redis never
 * interleaves with any other command).
 */
class FakeRedisClient implements IdempotencyRedisClient {
  store = new Map<string, string>();
  calls: { op: "setNX" | "get" | "compareAndSetState"; key: string; ttlSeconds?: number | "keep" }[] = [];
  private failNext: "setNX" | "get" | "compareAndSetState" | null = null;

  failNextCommand(op: "setNX" | "get" | "compareAndSetState"): void {
    this.failNext = op;
  }

  private maybeFail(op: "setNX" | "get" | "compareAndSetState"): void {
    if (this.failNext === op) {
      this.failNext = null;
      throw new Error(`simulated ${op} failure`);
    }
  }

  async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    this.calls.push({ op: "setNX", key, ttlSeconds });
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

  async compareAndSetState(
    key: string,
    expectedState: IdempotencyState,
    expectedOwnerToken: string | null,
    newValue: string,
    ttl: number | "keep"
  ): Promise<CompareAndSetResult> {
    this.calls.push({ op: "compareAndSetState", key, ttlSeconds: ttl });
    this.maybeFail("compareAndSetState");

    const current = this.store.get(key);
    if (current === undefined) return CAS_ABSENT;

    let decoded: Record<string, unknown>;
    try {
      decoded = JSON.parse(current);
    } catch {
      return CAS_ABSENT;
    }

    if (decoded.state !== expectedState) return CAS_STATE_MISMATCH;
    if (expectedOwnerToken !== null && decoded.ownerToken !== expectedOwnerToken) return CAS_OWNER_MISMATCH;

    // Synchronous write, no await since the check above - this is the
    // "single atomic unit" the real Lua script provides server-side.
    this.store.set(key, newValue);
    return CAS_OK;
  }
}

async function claimed(fake: FakeRedisClient, scope: "command" | "attempt", id: string): Promise<string> {
  const result = await claimIdempotency(scope, id, fake);
  assert.equal(result.outcome, "claimed");
  if (result.outcome !== "claimed") throw new Error("unreachable");
  return result.ownerToken;
}

// ---------------------------------------------------------------------------
// INITIAL CLAIM
// ---------------------------------------------------------------------------

test("initial claim: absent -> claimed, carries an ownerToken", async () => {
  const fake = new FakeRedisClient();
  const result = await claimIdempotency("command", "cmd-1", fake);
  assert.equal(result.outcome, "claimed");
  if (result.outcome === "claimed") {
    assert.equal(typeof result.ownerToken, "string");
    assert.ok(result.ownerToken.length > 0);
  }
});

test("initial claim: second same claim -> duplicate", async () => {
  const fake = new FakeRedisClient();
  await claimIdempotency("command", "cmd-1", fake);
  const second = await claimIdempotency("command", "cmd-1", fake);
  assert.deepEqual(second, { outcome: "duplicate" });
});

test("initial claim: two concurrent claims -> exactly one winner", async () => {
  const fake = new FakeRedisClient();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => claimIdempotency("command", "race-cmd", fake))
  );
  const claimedCount = results.filter((r) => r.outcome === "claimed").length;
  const duplicateCount = results.filter((r) => r.outcome === "duplicate").length;
  assert.equal(claimedCount, 1);
  assert.equal(duplicateCount, 7);
});

test("claim uses the centralized key builder and idempotency TTL, no GET before its SET", async () => {
  const fake = new FakeRedisClient();
  await claimIdempotency("attempt", "attempt-1", fake);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].op, "setNX");
  assert.equal(fake.calls[0].key, idempotencyKey("attempt", "attempt-1"));
  assert.equal(fake.calls[0].ttlSeconds, REDIS_KEY_TTL_SECONDS.idempotency);
});

// ---------------------------------------------------------------------------
// COMPLETION
// ---------------------------------------------------------------------------

test("completion: owner can complete, completed record carries the value", async () => {
  const fake = new FakeRedisClient();
  const token = await claimed(fake, "command", "cmd-1");

  const result = await completeIdempotency("command", "cmd-1", token, "generation-abc", fake);
  assert.deepEqual(result, { outcome: "completed" });

  const read = await getIdempotency("command", "cmd-1", fake);
  assert.equal(read.outcome, "present");
  if (read.outcome === "present") {
    assert.equal(read.record.state, "completed");
    if (read.record.state === "completed") {
      assert.equal(read.record.value, "generation-abc");
    }
  }
});

test("completion: wrong owner cannot complete", async () => {
  const fake = new FakeRedisClient();
  await claimed(fake, "command", "cmd-1");

  const result = await completeIdempotency("command", "cmd-1", "not-the-real-token", "gen-x", fake);
  assert.deepEqual(result, { outcome: "owner_mismatch" });

  const read = await getIdempotency("command", "cmd-1", fake);
  assert.equal(read.outcome, "present");
  if (read.outcome === "present") assert.equal(read.record.state, "pending");
});

test("completion: completed cannot become pending again (no second complete/fail applies)", async () => {
  const fake = new FakeRedisClient();
  const token = await claimed(fake, "command", "cmd-1");
  await completeIdempotency("command", "cmd-1", token, "gen-1", fake);

  // Same owner, same claim - but the record already left "pending".
  const second = await completeIdempotency("command", "cmd-1", token, "gen-2", fake);
  assert.deepEqual(second, { outcome: "not_pending" });

  const read = await getIdempotency("command", "cmd-1", fake);
  assert.equal(read.outcome, "present");
  if (read.outcome === "present" && read.record.state === "completed") {
    assert.equal(read.record.value, "gen-1", "original completion must not be overwritten");
  }
});

// ---------------------------------------------------------------------------
// FAILURE
// ---------------------------------------------------------------------------

test("failure: owner can mark pending as failed_retryable", async () => {
  const fake = new FakeRedisClient();
  const token = await claimed(fake, "command", "cmd-1");

  const result = await failIdempotency("command", "cmd-1", token, "generation_create_failed", fake);
  assert.deepEqual(result, { outcome: "failed_retryable" });

  const read = await getIdempotency("command", "cmd-1", fake);
  assert.equal(read.outcome, "present");
  if (read.outcome === "present") assert.equal(read.record.state, "failed_retryable");
});

test("failure: wrong owner cannot mark failed", async () => {
  const fake = new FakeRedisClient();
  await claimed(fake, "command", "cmd-1");

  const result = await failIdempotency("command", "cmd-1", "wrong-token", undefined, fake);
  assert.deepEqual(result, { outcome: "owner_mismatch" });

  const read = await getIdempotency("command", "cmd-1", fake);
  assert.equal(read.outcome, "present");
  if (read.outcome === "present") assert.equal(read.record.state, "pending");
});

test("failure: completed cannot be marked failed", async () => {
  const fake = new FakeRedisClient();
  const token = await claimed(fake, "command", "cmd-1");
  await completeIdempotency("command", "cmd-1", token, "gen-1", fake);

  const result = await failIdempotency("command", "cmd-1", token, "generation_create_failed", fake);
  assert.deepEqual(result, { outcome: "not_pending" });

  const read = await getIdempotency("command", "cmd-1", fake);
  assert.equal(read.outcome, "present");
  if (read.outcome === "present") assert.equal(read.record.state, "completed", "completed must remain untouched");
});

test("failure: failed record contains no raw exception text - only a validated short reason code", async () => {
  const fake = new FakeRedisClient();
  const token = await claimed(fake, "command", "cmd-1");

  await assert.rejects(
    failIdempotency(
      "command",
      "cmd-1",
      token,
      "TypeError: Cannot read properties of undefined (reading 'foo') at /app/route.ts:42",
      fake
    ),
    /invalid reason code/
  );

  // A short safe code is accepted.
  const ok = await failIdempotency("command", "cmd-1", token, "generation_create_failed", fake);
  assert.equal(ok.outcome, "failed_retryable");
});

// ---------------------------------------------------------------------------
// RETRY
// ---------------------------------------------------------------------------

test("retry: failed_retryable can be reclaimed, produces a new owner token", async () => {
  const fake = new FakeRedisClient();
  const originalToken = await claimed(fake, "command", "cmd-1");
  await failIdempotency("command", "cmd-1", originalToken, "generation_create_failed", fake);

  const result = await retryIdempotency("command", "cmd-1", fake);
  assert.equal(result.outcome, "claimed");
  if (result.outcome === "claimed") {
    assert.notEqual(result.ownerToken, originalToken);
  }

  const read = await getIdempotency("command", "cmd-1", fake);
  assert.equal(read.outcome, "present");
  if (read.outcome === "present") assert.equal(read.record.state, "pending");
});

test("retry: two concurrent retries on the same failed identity -> exactly one winner", async () => {
  const fake = new FakeRedisClient();
  const token = await claimed(fake, "command", "cmd-1");
  await failIdempotency("command", "cmd-1", token, undefined, fake);

  const results = await Promise.all(
    Array.from({ length: 6 }, () => retryIdempotency("command", "cmd-1", fake))
  );
  const claimedCount = results.filter((r) => r.outcome === "claimed").length;
  const rejectedCount = results.filter((r) => r.outcome === "not_failed_retryable").length;
  assert.equal(claimedCount, 1);
  assert.equal(rejectedCount, 5);
});

test("retry: successful retry returns to pending and can then be completed by its new owner", async () => {
  const fake = new FakeRedisClient();
  const originalToken = await claimed(fake, "command", "cmd-1");
  await failIdempotency("command", "cmd-1", originalToken, undefined, fake);

  const retry = await retryIdempotency("command", "cmd-1", fake);
  assert.equal(retry.outcome, "claimed");
  if (retry.outcome !== "claimed") throw new Error("unreachable");

  const completed = await completeIdempotency("command", "cmd-1", retry.ownerToken, "gen-final", fake);
  assert.deepEqual(completed, { outcome: "completed" });
});

test("retry: completed can never be reclaimed", async () => {
  const fake = new FakeRedisClient();
  const token = await claimed(fake, "command", "cmd-1");
  await completeIdempotency("command", "cmd-1", token, "gen-1", fake);

  const result = await retryIdempotency("command", "cmd-1", fake);
  assert.deepEqual(result, { outcome: "not_failed_retryable" });

  const read = await getIdempotency("command", "cmd-1", fake);
  assert.equal(read.outcome, "present");
  if (read.outcome === "present") assert.equal(read.record.state, "completed");
});

test("retry: a pending (never-failed) claim cannot be reclaimed", async () => {
  const fake = new FakeRedisClient();
  await claimed(fake, "command", "cmd-1");

  const result = await retryIdempotency("command", "cmd-1", fake);
  assert.deepEqual(result, { outcome: "not_failed_retryable" });
});

// ---------------------------------------------------------------------------
// STALE OWNER
// ---------------------------------------------------------------------------

test("stale owner: owner A fails, retry creates owner B, stale owner A cannot complete/fail owner B's claim", async () => {
  const fake = new FakeRedisClient();
  const ownerA = await claimed(fake, "command", "cmd-1");
  await failIdempotency("command", "cmd-1", ownerA, undefined, fake);

  const retry = await retryIdempotency("command", "cmd-1", fake);
  assert.equal(retry.outcome, "claimed");
  if (retry.outcome !== "claimed") throw new Error("unreachable");
  const ownerB = retry.ownerToken;
  assert.notEqual(ownerA, ownerB);

  // Stale owner A, using its old token, must not be able to affect owner B's claim.
  const staleComplete = await completeIdempotency("command", "cmd-1", ownerA, "gen-from-A", fake);
  assert.deepEqual(staleComplete, { outcome: "owner_mismatch" });

  const staleFail = await failIdempotency("command", "cmd-1", ownerA, undefined, fake);
  assert.deepEqual(staleFail, { outcome: "owner_mismatch" });

  // Owner B's claim is untouched and can complete normally.
  const realComplete = await completeIdempotency("command", "cmd-1", ownerB, "gen-from-B", fake);
  assert.deepEqual(realComplete, { outcome: "completed" });
});

// ---------------------------------------------------------------------------
// AVAILABILITY
// ---------------------------------------------------------------------------

test("Redis-disabled/unconfigured behavior: every function reports unavailable, never claimed", async () => {
  const claim = await claimIdempotency("command", "cmd-1", null);
  const read = await getIdempotency("command", "cmd-1", null);
  const complete = await completeIdempotency("command", "cmd-1", "token", "v", null);
  const fail = await failIdempotency("command", "cmd-1", "token", undefined, null);
  const retry = await retryIdempotency("command", "cmd-1", null);

  assert.deepEqual(claim, { outcome: "unavailable" });
  assert.deepEqual(read, { outcome: "unavailable" });
  assert.deepEqual(complete, { outcome: "unavailable" });
  assert.deepEqual(fail, { outcome: "unavailable" });
  assert.deepEqual(retry, { outcome: "unavailable" });
});

test("real getRedisClient() singleton path: unavailable by default in a bare test process", async () => {
  const result = await claimIdempotency("command", "cmd-1");
  assert.deepEqual(result, { outcome: "unavailable" });
});

test("Redis command failure reports unavailable on every transition, never falsely succeeds, never throws", async () => {
  const fake = new FakeRedisClient();

  fake.failNextCommand("setNX");
  const claimResult = await claimIdempotency("command", "cmd-1", fake);
  assert.deepEqual(claimResult, { outcome: "unavailable" });
  assert.equal(fake.store.has(idempotencyKey("command", "cmd-1")), false);

  const token = await claimed(fake, "command", "cmd-2");

  fake.failNextCommand("get");
  const readResult = await getIdempotency("command", "cmd-2", fake);
  assert.deepEqual(readResult, { outcome: "unavailable" });

  fake.failNextCommand("compareAndSetState");
  const completeResult = await completeIdempotency("command", "cmd-2", token, "v", fake);
  assert.deepEqual(completeResult, { outcome: "unavailable" });

  fake.failNextCommand("compareAndSetState");
  const failResult = await failIdempotency("command", "cmd-2", token, undefined, fake);
  assert.deepEqual(failResult, { outcome: "unavailable" });

  await failIdempotency("command", "cmd-2", token, undefined, fake);
  fake.failNextCommand("compareAndSetState");
  const retryResult = await retryIdempotency("command", "cmd-2", fake);
  assert.deepEqual(retryResult, { outcome: "unavailable" });
});

// ---------------------------------------------------------------------------
// KEY CONTRACT
// ---------------------------------------------------------------------------

test("getIdempotency: absent for a never-claimed id", async () => {
  const fake = new FakeRedisClient();
  const result = await getIdempotency("command", "never-claimed", fake);
  assert.deepEqual(result, { outcome: "absent" });
});

test("invalid identifier is rejected regardless of Redis availability, before any Redis command runs", async () => {
  await assert.rejects(claimIdempotency("command", "has space"), /invalid id identifier/);
  await assert.rejects(getIdempotency("command", "bad:id"), /invalid id identifier/);
  await assert.rejects(completeIdempotency("command", "", "token"), /invalid id identifier/);
  await assert.rejects(failIdempotency("command", "bad:id", "token"), /invalid id identifier/);
  await assert.rejects(retryIdempotency("command", "bad:id"), /invalid id identifier/);

  const fake = new FakeRedisClient();
  await assert.rejects(claimIdempotency("command", "bad:id", fake), /invalid id identifier/);
  assert.equal(fake.calls.length, 0, "no Redis command should run for an invalid identifier");
});

test("complete/fail use KEEPTTL semantics (ttl='keep'), never a fresh full-window reset", async () => {
  const fake = new FakeRedisClient();
  const token = await claimed(fake, "command", "cmd-1");
  await completeIdempotency("command", "cmd-1", token, "v", fake);

  const casCalls = fake.calls.filter((c) => c.op === "compareAndSetState");
  assert.equal(casCalls.length, 1);
  assert.equal(casCalls[0].ttlSeconds, "keep");
});

test("retry grants a fresh full TTL window, not KEEPTTL", async () => {
  const fake = new FakeRedisClient();
  const token = await claimed(fake, "command", "cmd-1");
  await failIdempotency("command", "cmd-1", token, undefined, fake);

  fake.calls.length = 0;
  await retryIdempotency("command", "cmd-1", fake);

  const casCalls = fake.calls.filter((c) => c.op === "compareAndSetState");
  assert.equal(casCalls.length, 1);
  assert.equal(casCalls[0].ttlSeconds, REDIS_KEY_TTL_SECONDS.idempotency);
});
