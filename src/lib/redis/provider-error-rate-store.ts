import "server-only";
import { getRedisClient } from "./redis-client";
import { providerErrorRateKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";

/**
 * Cinefield provider-error-rate aggregate state (Phase 6R.7).
 *
 * NOT A DUPLICATE OF provider-health-store.ts
 * provider-health-store.ts's `consecutiveFailures` counts a CONSECUTIVE
 * streak tied to health status classification (resets to 0 on any
 * success). This module answers a different question — "out of all
 * outcomes in the current accumulation window, what fraction failed" — by
 * maintaining independent totalCount/successCount/failureCount and
 * deriving a ratio. Neither store reads or writes the other.
 *
 * WINDOW SEMANTICS — FIXED ACCUMULATION WINDOW, NOT A SLIDING WINDOW
 * Same shape as provider-latency-store.ts and rate-limit-store.ts: the
 * FIRST recorded outcome after the key is absent/expired starts a new
 * window and sets its TTL to REDIS_KEY_TTL_SECONDS["provider-error-rate"]
 * (300s); later outcomes within that window increment counts without
 * touching the TTL. When the TTL elapses the aggregate disappears and the
 * next outcome starts a fresh window. This is a simple reset-every-~300s
 * accumulator — never described as a mathematically sliding window.
 *
 * ERROR RATE REPRESENTATION — FIXED, DOCUMENTED CHOICE
 * `errorRate` is always a fraction in the closed range 0.0–1.0
 * (failureCount / totalCount), never a 0–100 percentage. This is the one
 * representation used throughout this module and its tests; a caller that
 * wants a percentage multiplies by 100 itself.
 *
 * ATOMICITY
 * One Lua script per recorded outcome: EXISTS check, HINCRBY totalCount,
 * HINCRBY successCount-or-failureCount, and a conditional EXPIRE (only on
 * the outcome that created the key) — all in one atomic unit. No
 * GET-modify-SET pair anywhere in this file.
 *
 * NOT A ROUTING POLICY
 * No threshold, no circuit-breaker, no scoring, no failover decision lives
 * here — only accumulation and read-back. Interpreting the numbers belongs
 * entirely to a future Model Router.
 *
 * WHAT NEVER GOES IN
 * No raw error messages, no stack traces, no provider response bodies —
 * only the binary success/failure outcome and the provider id.
 *
 * NOT WIRED IN YET. No provider adapter, route, or Router calls this today.
 */

export type ProviderOutcome = "success" | "failure";

export interface ProviderErrorRateAggregate {
  totalCount: number;
  successCount: number;
  failureCount: number;
  /** Fraction in [0.0, 1.0]. Never a 0–100 percentage. */
  errorRate: number;
}

export type ProviderErrorRateReadOutcome =
  | ({ outcome: "available" } & ProviderErrorRateAggregate)
  | { outcome: "no_data" }
  | { outcome: "unavailable" };

export type ProviderOutcomeRecordOutcome = { outcome: "recorded" } | { outcome: "unavailable" };

/**
 * The narrow surface this store needs from Redis, kept independent of
 * ioredis's shapes so a zero-cost test can supply an in-memory fake with no
 * mocking framework and no real Lua interpreter.
 */
export interface ProviderErrorRateRedisClient {
  /**
   * Atomically records one outcome: increments totalCount by 1, increments
   * either successCount or failureCount by 1, and sets the key's expiry to
   * `ttlSeconds` ONLY if this outcome is what created the key. Returns the
   * aggregate exactly as stored after this write.
   */
  recordOutcome(
    key: string,
    outcome: ProviderOutcome,
    ttlSeconds: number
  ): Promise<{ totalCount: number; successCount: number; failureCount: number }>;
  /** Returns the raw stored fields, or null when the key does not exist. */
  readAggregate(
    key: string
  ): Promise<{ totalCount: number; successCount: number; failureCount: number } | null>;
}

/**
 * KEYS[1] = key
 * ARGV[1] = the field to increment ("successCount" or "failureCount") -
 *           always supplied by this module's own code, never raw caller
 *           input, so using it as a dynamic HINCRBY field name is safe.
 * ARGV[2] = ttlSeconds
 */
const RECORD_OUTCOME_SCRIPT = `
local existed = redis.call('EXISTS', KEYS[1])
redis.call('HINCRBY', KEYS[1], 'totalCount', 1)
redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
if existed == 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
local totalCount = redis.call('HGET', KEYS[1], 'totalCount')
local successCount = redis.call('HGET', KEYS[1], 'successCount')
local failureCount = redis.call('HGET', KEYS[1], 'failureCount')
return { totalCount, successCount, failureCount }
`;

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:provider-error-rate-store]", JSON.stringify(fields));
}

function validateOutcome(outcome: ProviderOutcome): void {
  if (outcome !== "success" && outcome !== "failure") {
    throw new Error("provider-error-rate-store: invalid outcome");
  }
}

function wrapRealClient(): ProviderErrorRateRedisClient | null {
  const client = getRedisClient();
  if (!client) return null;

  return {
    async recordOutcome(key, outcome, ttlSeconds) {
      const field = outcome === "success" ? "successCount" : "failureCount";
      const result = await client.eval(RECORD_OUTCOME_SCRIPT, 1, key, field, String(ttlSeconds));
      const [totalCount, successCount, failureCount] = result as [string, string | null, string | null];
      return {
        totalCount: Number(totalCount),
        successCount: successCount ? Number(successCount) : 0,
        failureCount: failureCount ? Number(failureCount) : 0,
      };
    },
    async readAggregate(key) {
      const raw = await client.hgetall(key);
      if (!raw || Object.keys(raw).length === 0) return null;
      return {
        totalCount: Number(raw.totalCount),
        successCount: raw.successCount ? Number(raw.successCount) : 0,
        failureCount: raw.failureCount ? Number(raw.failureCount) : 0,
      };
    },
  };
}

function resolveClient(override?: ProviderErrorRateRedisClient | null): ProviderErrorRateRedisClient | null {
  if (override !== undefined) return override;
  return wrapRealClient();
}

function toReadOutcome(raw: {
  totalCount: number;
  successCount: number;
  failureCount: number;
} | null): ProviderErrorRateReadOutcome {
  if (!raw) return { outcome: "no_data" };

  // Defensive: malformed/foreign Redis state must never crash the
  // generation path.
  if (
    !Number.isFinite(raw.totalCount) ||
    raw.totalCount < 0 ||
    !Number.isFinite(raw.successCount) ||
    raw.successCount < 0 ||
    !Number.isFinite(raw.failureCount) ||
    raw.failureCount < 0
  ) {
    return { outcome: "unavailable" };
  }
  if (raw.totalCount === 0) return { outcome: "no_data" };

  return {
    outcome: "available",
    totalCount: raw.totalCount,
    successCount: raw.successCount,
    failureCount: raw.failureCount,
    errorRate: raw.failureCount / raw.totalCount,
  };
}

/**
 * Records one outcome observation for a provider. Throws synchronously
 * (rejected promise) for an invalid `providerId` (centralized keyspace
 * validation) or an invalid `outcome`, independent of Redis availability.
 */
export async function recordProviderOutcome(
  providerId: string,
  outcome: ProviderOutcome,
  testClientOverride?: ProviderErrorRateRedisClient | null
): Promise<ProviderOutcomeRecordOutcome> {
  const key = providerErrorRateKey(providerId);
  validateOutcome(outcome);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    await client.recordOutcome(key, outcome, REDIS_KEY_TTL_SECONDS["provider-error-rate"]);
    return { outcome: "recorded" };
  } catch (caught) {
    log({
      providerId,
      op: "record",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}

/**
 * Reads the current error-rate aggregate for a provider. `no_data` means
 * the window is empty; `unavailable` covers Redis being
 * disabled/unreachable, a command failure, or corrupted stored state.
 */
export async function getProviderErrorRate(
  providerId: string,
  testClientOverride?: ProviderErrorRateRedisClient | null
): Promise<ProviderErrorRateReadOutcome> {
  const key = providerErrorRateKey(providerId);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    const raw = await client.readAggregate(key);
    return toReadOutcome(raw);
  } catch (caught) {
    log({
      providerId,
      op: "read",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}
