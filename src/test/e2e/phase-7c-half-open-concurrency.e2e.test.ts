import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  PROBE_LEASE_TTL_SECONDS,
  releaseProbe,
  tryAcquireProbe,
} from "@/lib/routing/half-open-probe";
import {
  CAD_NOT_FOUND,
  CAD_NOT_OWNER,
  CAD_RELEASED,
  type CompareAndDeleteResult,
  type DistributedLockRedisClient,
} from "@/lib/redis/distributed-lock";
import {
  DEFAULT_BREAKER_POLICY,
  admissionFor,
  initialBreakerRecord,
  recordFailure,
} from "@/lib/routing/circuit-breaker";

/**
 * HALF_OPEN SINGLE-FLIGHT — concurrency proof.
 *
 * THE DEFECT THIS FILE EXISTS TO PREVENT COMING BACK
 * The first Phase 7-C implementation bounded half-open trials with a counter
 * inside the breaker record, updated read-modify-write. Two workers reaching a
 * cooled-down breaker at the same moment both read zero in-flight and both
 * sent a request to a provider that had just been failing. Worse, the counter
 * was never incremented from the routing path at all, so in practice HALF_OPEN
 * admitted the entire waiting backlog.
 *
 * The tests below are therefore CONCURRENT, not sequential. A sequential test
 * passes against the broken implementation, which is precisely why the
 * original one did.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A Redis double that models the real latency window.
 *
 * `setNX` is atomic — the check and the write happen in one synchronous step,
 * exactly as Redis executes SET NX — but every call yields to the event loop
 * BEFORE and AFTER it, so concurrent callers genuinely interleave around it.
 * That interleaving is what makes this a race rather than a formality: an
 * implementation that read first and wrote later would lose here.
 */
function racyRedis(): DistributedLockRedisClient & {
  store: Map<string, string>;
  setNxCalls: number;
} {
  const store = new Map<string, string>();
  const self = {
    store,
    setNxCalls: 0,
    async setNX(key: string, value: string, _ttlSeconds: number): Promise<boolean> {
      await tick();
      self.setNxCalls += 1;
      // ---- the indivisible part, as Redis performs it -------------------
      if (store.has(key)) {
        await tick();
        return false;
      }
      store.set(key, value);
      // -------------------------------------------------------------------
      await tick();
      return true;
    },
    async get(key: string): Promise<string | null> {
      await tick();
      return store.get(key) ?? null;
    },
    async compareAndDelete(
      key: string,
      expectedOwnerToken: string
    ): Promise<CompareAndDeleteResult> {
      await tick();
      const current = store.get(key);
      if (current === undefined) return CAD_NOT_FOUND;
      if (current !== expectedOwnerToken) return CAD_NOT_OWNER;
      store.delete(key);
      return CAD_RELEASED;
    },
  };
  return self;
}

test("only ONE of many concurrent callers wins the half-open probe", async () => {
  const client = racyRedis();

  // Twenty requests arriving at a provider whose cooldown just elapsed —
  // launched together, resolved together. No awaits between them.
  const admissions = await Promise.all(
    Array.from({ length: 20 }, () => tryAcquireProbe("fal", "fal-ai/flux/schnell", client))
  );

  const granted = admissions.filter((a) => a.granted);
  assert.equal(granted.length, 1, `exactly one probe may be granted, got ${granted.length}`);
  assert.equal(client.setNxCalls, 20, "every caller must have raced for the same key");

  for (const denied of admissions.filter((a) => !a.granted)) {
    assert.equal(denied.granted, false);
    if (!denied.granted) assert.equal(denied.reason, "busy");
  }
});

test("the race is decided by the atomic write, not by call ordering", async () => {
  // Run the same race repeatedly. A read-then-write implementation would pass
  // occasionally; it cannot pass fifty times.
  for (let round = 0; round < 50; round += 1) {
    const client = racyRedis();
    const admissions = await Promise.all(
      Array.from({ length: 8 }, () => tryAcquireProbe("mock", "mock-image", client))
    );
    assert.equal(
      admissions.filter((a) => a.granted).length,
      1,
      `round ${round} admitted more than one probe`
    );
  }
});

test("different provider models do not share a probe slot", async () => {
  const client = racyRedis();

  const [first, second] = await Promise.all([
    tryAcquireProbe("fal", "fal-ai/flux/schnell", client),
    tryAcquireProbe("fal", "fal-ai/flux/dev", client),
  ]);

  // One endpoint recovering must not consume another endpoint's trial slot.
  assert.equal(first.granted, true);
  assert.equal(second.granted, true);
  assert.equal(client.store.size, 2);
});

test("provider models whose ids differ only in punctuation get distinct slots", async () => {
  const client = racyRedis();
  const [a, b] = await Promise.all([
    tryAcquireProbe("fal", "a/b", client),
    tryAcquireProbe("fal", "a.b", client),
  ]);
  assert.equal(a.granted, true);
  assert.equal(b.granted, true, "hex encoding must keep a/b and a.b apart");
});

test("releasing the slot lets exactly one more caller in", async () => {
  const client = racyRedis();

  const first = await tryAcquireProbe("mock", "mock-image", client);
  assert.equal(first.granted, true);
  if (!first.granted) return;

  const blocked = await tryAcquireProbe("mock", "mock-image", client);
  assert.equal(blocked.granted, false);

  await releaseProbe("mock", "mock-image", first.ownerToken, client);

  const nextRound = await Promise.all(
    Array.from({ length: 5 }, () => tryAcquireProbe("mock", "mock-image", client))
  );
  assert.equal(nextRound.filter((a) => a.granted).length, 1);
});

test("a stale owner cannot steal the current holder's slot", async () => {
  const client = racyRedis();

  const first = await tryAcquireProbe("mock", "mock-image", client);
  assert.equal(first.granted, true);
  if (!first.granted) return;

  // Simulate the lease expiring and a second worker claiming it.
  client.store.delete("cinefield:v1:lock:breaker-probe:mock-mock-image");
  const second = await tryAcquireProbe("mock", "mock-image", client);
  assert.equal(second.granted, true);

  // The first worker, finishing late, must not release what it no longer owns.
  await releaseProbe("mock", "mock-image", first.granted ? first.ownerToken : "", client);
  const stillHeld = await tryAcquireProbe("mock", "mock-image", client);
  assert.equal(stillHeld.granted, false, "the live holder's slot was destroyed by a stale owner");
});

test("the probe lease is namespaced, TTL-bounded and cannot deadlock", async () => {
  const client = racyRedis();
  await tryAcquireProbe("mock", "mock-image", client);

  const [key] = [...client.store.keys()];
  assert.match(key, /^cinefield:v1:lock:breaker-probe:/, "must live in the versioned keyspace");

  // Shorter than the breaker cooldown: a worker that dies mid-probe costs one
  // lease interval, never longer than the breaker would have excluded it.
  assert.ok(PROBE_LEASE_TTL_SECONDS > 0);
  assert.ok(
    PROBE_LEASE_TTL_SECONDS < DEFAULT_BREAKER_POLICY.cooldownSeconds,
    "a crashed probe must not keep a route out longer than the cooldown itself"
  );

  const source = readSource("src/lib/routing/half-open-probe.ts");
  assert.match(source, /PROBE_LEASE_TTL_SECONDS/);
  assert.match(source, /acquireLock\(/, "must reuse the existing SET NX lock, not a new one");
  assert.match(source, /^import "server-only";/m);
});

test("an unavailable Redis denies the probe rather than admitting it", async () => {
  // Fails closed. This path is only reached after a breaker was successfully
  // read as cooled-down, so an unavailable lock means "cannot coordinate" —
  // and un-coordinated trial traffic to a recovering provider is the exact
  // thing the lease exists to prevent.
  const dead: DistributedLockRedisClient = {
    async setNX() {
      throw new Error("ECONNREFUSED");
    },
    async get() {
      throw new Error("ECONNREFUSED");
    },
    async compareAndDelete(): Promise<CompareAndDeleteResult> {
      throw new Error("ECONNREFUSED");
    },
  };

  const admission = await tryAcquireProbe("mock", "mock-image", dead);
  assert.equal(admission.granted, false);
  if (!admission.granted) assert.equal(admission.reason, "unavailable");
});

test("the breaker record no longer carries a field that pretended to bound this", async () => {
  // The in-flight counter is gone entirely. A field nothing can maintain
  // correctly is worse than no field: it reads as a guarantee.
  let record = initialBreakerRecord(new Date("2026-08-12T10:00:00.000Z").toISOString());
  assert.ok(!("halfOpenInFlight" in record));

  for (let i = 0; i < DEFAULT_BREAKER_POLICY.failureThreshold; i += 1) {
    record = recordFailure(record, new Date(Date.parse("2026-08-12T10:00:00.000Z") + i * 1000));
  }

  const cooled = new Date(
    Date.parse("2026-08-12T10:00:00.000Z") +
      (DEFAULT_BREAKER_POLICY.failureThreshold + DEFAULT_BREAKER_POLICY.cooldownSeconds) * 1000
  );
  assert.equal(
    admissionFor(record, cooled),
    "probe_required",
    "a cooled-down breaker must ask the lease, never answer for itself"
  );

  const source = readSource("src/lib/routing/circuit-breaker.ts");
  assert.ok(!/halfOpenInFlight/.test(source));
  assert.ok(!/halfOpenMaxInFlight/.test(source));
});

test("the router resolves probe_required atomically before letting a route win", () => {
  const source = readSource("src/lib/routing/health-aware-router.ts");
  assert.match(source, /tryAcquireProbe\(/, "the router must claim the lease");
  assert.match(source, /admission !== "probe_required"/);
  assert.match(source, /deniedProbes/, "a denied probe must re-select, not proceed");

  // And the pure selector must not decide it on its own.
  const selector = /export function selectHealthyRoute[\s\S]*?\n\}/.exec(source);
  assert.ok(selector);
  assert.ok(
    !/tryAcquireProbe/.test(selector[0]),
    "the pure function must stay pure; the atomic step belongs to the caller"
  );
});
