import "server-only";
import { randomUUID } from "node:crypto";
import { getRealtimePublisher } from "./realtime-redis";
import { LEASE_TTL_MS, type LimitScope, type ScopeKind } from "./connection-limits";

/**
 * The distributed connection lease (Phase 11-D).
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A PROCESS COUNTER
 * ---------------------------------------------------------------------------
 * Serverless invocations do not share memory. A per-process count would allow
 * USER_MAX connections PER INSTANCE, which under any real traffic is no limit
 * at all — and the number would silently reset on every cold start. The count
 * has to live where every instance can see it, which is Redis A.
 *
 * REDIS A, NEVER REDIS B: Redis B holds BullMQ queue state only. Nothing here
 * reads BULLMQ_REDIS_URL.
 *
 * ---------------------------------------------------------------------------
 * ONE SORTED SET PER SCOPE, SCORED BY EXPIRY
 * ---------------------------------------------------------------------------
 * Each scope (`user:<id>`, `ip:<hash>`, later `ws:<id>`) is a sorted set whose
 * members are lease ids and whose scores are absolute expiry timestamps. That
 * single choice answers three problems at once:
 *
 *   counting     ZCARD after dropping expired members is the live count.
 *   crash safety a function that dies never releases its lease — but its
 *                member's score is in the past, so the NEXT acquire evicts it.
 *                No slot leaks permanently, with no reaper process.
 *   idleness     refresh pushes the score forward. A connection that stops
 *                refreshing falls out of the set on its own.
 *
 * A plain INCR/DECR counter would have neither crash safety nor idle
 * eviction: a lost DECR is a slot lost forever.
 *
 * ---------------------------------------------------------------------------
 * ATOMICITY IS NOT OPTIONAL
 * ---------------------------------------------------------------------------
 * `ZCARD` then `ZADD` from application code is a TOCTOU race: N simultaneous
 * opens all read a count below the limit and all add themselves. Every
 * operation below is a single Lua script, which Redis executes atomically, so
 * N concurrent acquires admit exactly the limit and refuse the rest.
 *
 * The script also evicts expired members BEFORE counting, inside the same
 * atomic step — checking a stale count would refuse a connection that a dead
 * instance was still nominally holding.
 */

/**
 * ARGV: now, ttl, leaseId, then one limit per KEY, in the same order.
 * Returns {1, ""} on success or {0, "<scope key>"} naming the ceiling hit.
 */
const ACQUIRE = `
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local lease = ARGV[3]

-- Evict expired holders first, so a crashed instance never blocks a slot.
for i = 1, #KEYS do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now)
end

-- Check every ceiling BEFORE adding to any, so a partial acquire is
-- impossible: either the connection fits everywhere or it takes nothing.
for i = 1, #KEYS do
  local limit = tonumber(ARGV[3 + i])
  if redis.call('ZCARD', KEYS[i]) >= limit then
    return {0, KEYS[i]}
  end
end

for i = 1, #KEYS do
  redis.call('ZADD', KEYS[i], now + ttl, lease)
  -- A key with no live members should disappear rather than linger empty.
  redis.call('PEXPIRE', KEYS[i], ttl * 2)
end

return {1, ''}
`;

/**
 * Refresh only extends a lease that STILL EXISTS.
 *
 * `ZADD XX` updates an existing member and adds nothing. If the member is
 * gone — expired, or evicted under memory pressure — the refresh reports
 * failure and the connection closes rather than silently re-acquiring a slot
 * it no longer holds. Re-adding would let a stalled connection exceed the
 * ceiling by resurrecting itself.
 */
const REFRESH = `
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local lease = ARGV[3]
local alive = 1

for i = 1, #KEYS do
  local updated = redis.call('ZADD', KEYS[i], 'XX', 'CH', now + ttl, lease)
  if redis.call('ZSCORE', KEYS[i], lease) == false then
    alive = 0
  else
    redis.call('PEXPIRE', KEYS[i], ttl * 2)
  end
end

return alive
`;

const RELEASE = `
for i = 1, #KEYS do
  redis.call('ZREM', KEYS[i], ARGV[1])
end
return 1
`;

/**
 * The minimum the counter must do. Structural rather than `Redis`, so a test
 * can supply one without a socket — the same dependency-injection shape the
 * stream adapter uses for its publisher.
 */
export interface LeaseCounter {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

export type AcquireOutcome =
  | { granted: true; leaseId: string }
  /** A ceiling was hit. The scope is for server-side reasoning only. */
  | { granted: false; reason: "limit_exceeded"; scope: ScopeKind }
  /** The counter itself is unreachable. FAILS CLOSED — see below. */
  | { granted: false; reason: "counter_unavailable" };

export interface ConnectionLease {
  leaseId: string;
  scopes: LimitScope[];
}

/**
 * Takes one slot in every applicable scope, atomically.
 *
 * THE LEASE ID IS SERVER-GENERATED AND NEVER LEAVES THE SERVER. A browser
 * cannot supply, guess or influence it: it is a v4 UUID minted here, held in
 * the request's closure, and used only as a sorted-set member. It carries no
 * user id, no tenant, no IP and no secret — it is an opaque slot handle, and
 * a leaked one would let an attacker release their own connection at most.
 *
 * FAILS CLOSED. If Redis is unreachable the connection is REFUSED, not
 * admitted. A DoS control that switches itself off when its counter is down
 * is not a control — the outage is exactly when the ceiling matters. Realtime
 * degrades; the product does not, because the browser falls back to its
 * normal authoritative fetch and the outbox still holds every fact.
 */
export async function acquireConnectionLease(
  scopes: LimitScope[],
  /** Defaults to Redis A. Injected only by tests. */
  counterOverride?: LeaseCounter | null
): Promise<AcquireOutcome> {
  const redis =
    counterOverride !== undefined ? counterOverride : (getRealtimePublisher() as LeaseCounter | null);
  if (!redis) return { granted: false, reason: "counter_unavailable" };

  const leaseId = randomUUID();
  const keys = scopes.map((s) => s.key);
  const args = [String(Date.now()), String(LEASE_TTL_MS), leaseId, ...scopes.map((s) => String(s.limit))];

  try {
    const result = (await redis.eval(ACQUIRE, keys.length, ...keys, ...args)) as [number, string];
    if (result?.[0] === 1) return { granted: true, leaseId };

    const hitKey = result?.[1] ?? "";
    const scope = scopes.find((s) => s.key === hitKey)?.kind ?? "user";
    return { granted: false, reason: "limit_exceeded", scope };
  } catch {
    // Reason class only — never the key, never the URL.
    return { granted: false, reason: "counter_unavailable" };
  }
}

/**
 * Extends a live lease. Returns false when the lease is gone, which the
 * caller must treat as "this connection no longer holds a slot" and close.
 */
export async function refreshConnectionLease(
  lease: ConnectionLease,
  counterOverride?: LeaseCounter | null
): Promise<boolean> {
  const redis =
    counterOverride !== undefined ? counterOverride : (getRealtimePublisher() as LeaseCounter | null);
  if (!redis) return false;

  const keys = lease.scopes.map((s) => s.key);
  try {
    const alive = (await redis.eval(
      REFRESH,
      keys.length,
      ...keys,
      String(Date.now()),
      String(LEASE_TTL_MS),
      lease.leaseId
    )) as number;
    return alive === 1;
  } catch {
    return false;
  }
}

/**
 * Returns the slot on a clean close.
 *
 * Best effort by design: if it fails, the score-based expiry reclaims the
 * slot within one TTL anyway. That is the whole reason expiry exists rather
 * than relying on a release that a crashed process can never send.
 */
export async function releaseConnectionLease(
  lease: ConnectionLease,
  counterOverride?: LeaseCounter | null
): Promise<void> {
  const redis =
    counterOverride !== undefined ? counterOverride : (getRealtimePublisher() as LeaseCounter | null);
  if (!redis) return;

  const keys = lease.scopes.map((s) => s.key);
  try {
    await redis.eval(RELEASE, keys.length, ...keys, lease.leaseId);
  } catch {
    /* expiry is the backstop */
  }
}
