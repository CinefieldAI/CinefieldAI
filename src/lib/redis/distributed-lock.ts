import "server-only";
import { randomUUID } from "node:crypto";
import { getRedisClient } from "./redis-client";
import { lockKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";

/**
 * Cinefield Redis distributed lock foundation (Phase 6R.7 — final
 * component).
 *
 * A reusable, server-only mutual-exclusion primitive for future
 * cross-instance coordination (reconciliation ownership, cache-refresh
 * ownership, singleton operational jobs, narrowly scoped coordination).
 * NOT WIRED IN YET — no route, job, or workflow calls this today.
 *
 * REDIS IS COORDINATION STATE, NOT SOURCE OF TRUTH
 * A held lock must never be treated as durable business truth. PostgreSQL
 * (generation_attempts's own CAS, credit_reservations, etc.) remains
 * authoritative wherever real correctness is at stake; this module only
 * helps multiple processes agree on "who is doing X right now."
 *
 * SINGLE REDIS, NOT REDLOCK
 * Cinefield's Redis A is one logical Redis service (Redis Cloud). Redlock
 * exists to tolerate a MINORITY of independent Redis nodes failing when a
 * lock is distributed across several of them — a problem this
 * architecture does not have. Introducing Redlock here would add real
 * complexity (multiple connections, quorum arithmetic, clock-drift
 * caveats) to solve a failure mode that cannot occur against a single
 * Redis. The smallest correct primitive for one Redis is a single atomic
 * SET...NX...EX for acquire and a single atomic compare-and-delete Lua
 * script for release — both used below.
 *
 * ACQUIRE — ONE ATOMIC COMMAND
 * `SET key ownerToken EX ttlSeconds NX` — a single Redis command, exactly
 * the same primitive idempotency-store.ts's claimIdempotency() already
 * uses for its first-writer claim. Never a GET-then-SET pair. Exactly one
 * concurrent caller can ever create the key; every other caller's SET NX
 * fails atomically and is reported `busy`.
 *
 * RELEASE — OWNERSHIP-VERIFIED, ATOMIC COMPARE-AND-DELETE
 * A lock may only be released by the exact ownerToken it was acquired
 * with. This matters concretely: owner A acquires, the lock's TTL elapses,
 * owner B acquires the now-free key, and only THEN does owner A's release
 * call arrive — an unchecked `DEL key` would delete owner B's valid,
 * currently-held lock. Release therefore runs a single Lua script (GET,
 * compare, DEL) as one atomic unit — the same "let Redis itself decide
 * inside one indivisible script" principle idempotency-store.ts's
 * compare-and-set transitions and rate-limit-store.ts's increment script
 * already use. There is no code path anywhere in this file that calls DEL
 * without first proving ownership inside the same atomic operation.
 *
 * TTL
 * Every lock uses the centralized `REDIS_KEY_TTL_SECONDS.lock` (30s) as
 * both the default and the hard ceiling — a caller MAY request a shorter
 * lease (useful for a fast operation that wants to fail over quickly) but
 * can never request one longer than the centralized safety ceiling. No
 * lock can ever be effectively permanent.
 *
 * OWNER TOKENS
 * Minted via `node:crypto`'s `randomUUID()` — never derived from user
 * content, never logged (every log call below carries only resourceType/
 * resourceId/op/result/error — never the token). `isLockHeld()` exposes
 * only `locked`/`unlocked`, never the token itself, matching the
 * "ownership stays private" instruction.
 *
 * NO extendLock() — DELIBERATELY OMITTED
 * No real caller exists yet to demonstrate a genuine need for a
 * safe, ownership-checked lease extension, and the centralized TTL is a
 * short (30s) ceiling by design. Adding extension now would be
 * speculative completeness, not a real requirement — it can be added,
 * following the exact same ownership-verified Lua-script discipline as
 * release, whenever a real long-running lock holder needs it.
 *
 * FAILURE SEMANTICS
 * Redis disabled/unconfigured/failing returns an explicit `unavailable`
 * outcome on every function — never conflated with `acquired`, `busy`,
 * `released`, or any other real outcome. Whether a future caller should
 * fail closed, defer, or fall back to a durable DB coordination mechanism
 * on `unavailable` is entirely that caller's policy decision, not this
 * module's.
 */

const MAX_TTL_SECONDS = REDIS_KEY_TTL_SECONDS.lock; // hard ceiling — never a longer-lived lock than this.
const MIN_TTL_SECONDS = 1;

export type LockAcquireOutcome =
  | { outcome: "acquired"; ownerToken: string; ttlSeconds: number }
  | { outcome: "busy" }
  | { outcome: "unavailable" };

export type LockReleaseOutcome =
  | { outcome: "released" }
  | { outcome: "not_owner" }
  | { outcome: "not_found" }
  | { outcome: "unavailable" };

export type LockStatusOutcome = { outcome: "locked" } | { outcome: "unlocked" } | { outcome: "unavailable" };

/** Result codes for the compare-and-delete primitive. */
export const CAD_NOT_FOUND = 0;
export const CAD_RELEASED = 1;
export const CAD_NOT_OWNER = 2;
export type CompareAndDeleteResult = typeof CAD_NOT_FOUND | typeof CAD_RELEASED | typeof CAD_NOT_OWNER;

/**
 * The narrow surface this store needs from Redis, kept independent of
 * ioredis's shapes so a zero-cost test can supply an in-memory fake with no
 * mocking framework and no real Lua interpreter.
 */
export interface DistributedLockRedisClient {
  /** `SET key value EX ttlSeconds NX`. Returns true iff this call created the key. */
  setNX(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  /**
   * Atomic compare-and-delete: deletes `key` ONLY IF its current value
   * equals `expectedOwnerToken`. Real implementation is a single Lua
   * script — GET, compare, DEL, all in one indivisible unit.
   */
  compareAndDelete(key: string, expectedOwnerToken: string): Promise<CompareAndDeleteResult>;
}

/**
 * KEYS[1] = key
 * ARGV[1] = expected owner token
 *
 * Returns 0 (key absent), 1 (deleted), or 2 (present but owned by someone
 * else) — see CAD_* constants above.
 */
const COMPARE_AND_DELETE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == false then
  return 0
end
if current ~= ARGV[1] then
  return 2
end
redis.call('DEL', KEYS[1])
return 1
`;

function log(fields: Record<string, unknown>): void {
  // Never includes ownerToken or any Redis value.
  console.info("[cinefield:distributed-lock]", JSON.stringify(fields));
}

function resolveTtlSeconds(ttlSeconds?: number): number {
  if (ttlSeconds === undefined) return MAX_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error("distributed-lock: invalid ttlSeconds");
  }
  return ttlSeconds;
}

function wrapRealClient(): DistributedLockRedisClient | null {
  const client = getRedisClient();
  if (!client) return null;

  return {
    async setNX(key, value, ttlSeconds) {
      const result = await client.set(key, value, "EX", ttlSeconds, "NX");
      return result === "OK";
    },
    async get(key) {
      return client.get(key);
    },
    async compareAndDelete(key, expectedOwnerToken) {
      const result = await client.eval(COMPARE_AND_DELETE_SCRIPT, 1, key, expectedOwnerToken);
      return Number(result) as CompareAndDeleteResult;
    },
  };
}

function resolveClient(override?: DistributedLockRedisClient | null): DistributedLockRedisClient | null {
  if (override !== undefined) return override;
  return wrapRealClient();
}

/**
 * Attempts to acquire the lock for (resourceType, resourceId). Atomic — a
 * single SET...NX...EX, no GET-then-SET. On success, mints a fresh
 * cryptographically random ownerToken the caller must hold onto to later
 * release this exact lock. Throws synchronously (rejected promise) for an
 * invalid resourceType/resourceId (centralized keyspace validation) or an
 * invalid `ttlSeconds` override, independent of Redis availability.
 */
export async function acquireLock(
  resourceType: string,
  resourceId: string,
  ttlSeconds?: number,
  testClientOverride?: DistributedLockRedisClient | null
): Promise<LockAcquireOutcome> {
  const key = lockKey(resourceType, resourceId);
  const effectiveTtl = resolveTtlSeconds(ttlSeconds);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  const ownerToken = randomUUID();

  try {
    const created = await client.setNX(key, ownerToken, effectiveTtl);
    return created ? { outcome: "acquired", ownerToken, ttlSeconds: effectiveTtl } : { outcome: "busy" };
  } catch (caught) {
    log({
      resourceType,
      op: "acquire",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}

/**
 * Releases the lock for (resourceType, resourceId), ONLY if `ownerToken`
 * matches the token currently holding it — enforced atomically by the
 * compare-and-delete script, never by a prior read. A stale owner (whose
 * lease already expired and was reacquired by someone else) gets
 * `not_owner` and must not treat that as success; the current holder's
 * lock is left completely untouched.
 */
export async function releaseLock(
  resourceType: string,
  resourceId: string,
  ownerToken: string,
  testClientOverride?: DistributedLockRedisClient | null
): Promise<LockReleaseOutcome> {
  const key = lockKey(resourceType, resourceId);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    const result = await client.compareAndDelete(key, ownerToken);
    if (result === CAD_RELEASED) return { outcome: "released" };
    if (result === CAD_NOT_OWNER) return { outcome: "not_owner" };
    return { outcome: "not_found" };
  } catch (caught) {
    log({
      resourceType,
      op: "release",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}

/**
 * Reports only whether a lock is currently held — never the owner token.
 * Minimal by design; a fuller "who owns this" inspection API is
 * deliberately not exposed.
 */
export async function isLockHeld(
  resourceType: string,
  resourceId: string,
  testClientOverride?: DistributedLockRedisClient | null
): Promise<LockStatusOutcome> {
  const key = lockKey(resourceType, resourceId);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    const raw = await client.get(key);
    return raw === null ? { outcome: "unlocked" } : { outcome: "locked" };
  } catch (caught) {
    log({
      resourceType,
      op: "status",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}
