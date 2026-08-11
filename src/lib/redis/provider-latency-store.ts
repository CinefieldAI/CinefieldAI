import "server-only";
import { getRedisClient } from "./redis-client";
import { providerLatencyKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";

/**
 * Cinefield provider-latency aggregate state (Phase 6R.7).
 *
 * NOT A DUPLICATE OF provider-health-store.ts
 * provider-health-store.ts's `ProviderHealthState.latencyMs` is a single
 * LATEST-sample snapshot, fully overwritten on every write — it answers
 * "how fast was the most recent call". This module answers a different
 * question — "how fast has this provider been over its current
 * accumulation window" — by maintaining sampleCount/totalLatencyMs/
 * maxLatencyMs and deriving an average. Neither store reads or writes the
 * other; they are two independent operational signals for the same
 * provider id, and a future Model Router (Phase 7) may want either or both.
 *
 * WINDOW SEMANTICS — FIXED ACCUMULATION WINDOW, HONESTLY, NOT A SLIDING WINDOW
 * This is a fixed-TTL accumulator, the same pattern rate-limit-store.ts
 * already uses: the FIRST recorded sample after the key is absent/expired
 * starts a new window and sets its TTL to REDIS_KEY_TTL_SECONDS
 * ["provider-latency"] (120s); every subsequent sample within that same
 * window increments the aggregate WITHOUT touching the TTL (no KEEPTTL
 * extension on every write — extending it would let a busy provider's
 * window never end). When the TTL elapses, the whole aggregate disappears
 * and the next sample starts a fresh window from zero. This is NOT a
 * mathematically sliding window (there is no continuous decay or rolling
 * eviction of old samples within the window) and must never be described
 * as one — it is a simple "reset every ~120s" accumulator, which is the
 * smallest useful, honestly-documented telemetry shape for this phase.
 *
 * ATOMICITY
 * One Lua script per recorded sample: EXISTS check, HINCRBY sampleCount,
 * HINCRBYFLOAT totalLatencyMs, conditional max update, and a conditional
 * EXPIRE (only on the sample that created the key) — all in one atomic
 * unit. There is no GET-modify-SET pair anywhere in this file; the
 * increment and the "was this the first sample" decision both happen
 * inside the same indivisible script execution, so concurrent recorders
 * can never lose a sample and the key can never be left without a TTL.
 *
 * NUMERIC SAFETY
 * latencyMs must be a finite, non-negative number under a defensible
 * TECHNICAL ceiling (10 minutes) — not a business SLA threshold. Anything
 * else (negative, NaN, Infinity, non-number, absurdly large) is rejected
 * before any Redis interaction, protecting the aggregate from corruption.
 *
 * NOT A ROUTING POLICY
 * This module has no concept of "healthy", no threshold, no scoring, no
 * failover — it only accumulates and reads back numbers. Interpreting them
 * belongs entirely to a future Model Router.
 *
 * NOT WIRED IN YET. No provider adapter, route, or Router calls this today.
 */

const MAX_LATENCY_MS = 600_000; // 10 minutes — a technical overflow/corruption guard, not an SLA.

export interface ProviderLatencyAggregate {
  sampleCount: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  maxLatencyMs?: number;
}

export type ProviderLatencyReadOutcome =
  | ({ outcome: "available" } & ProviderLatencyAggregate)
  | { outcome: "no_data" }
  | { outcome: "unavailable" };

export type ProviderLatencyRecordOutcome = { outcome: "recorded" } | { outcome: "unavailable" };

/**
 * The narrow surface this store needs from Redis, kept independent of
 * ioredis's shapes so a zero-cost test can supply an in-memory fake with no
 * mocking framework and no real Lua interpreter.
 */
export interface ProviderLatencyRedisClient {
  /**
   * Atomically records one latency sample: increments sampleCount by 1,
   * increments totalLatencyMs by `latencyMs`, updates maxLatencyMs if this
   * sample is larger, and sets the key's expiry to `ttlSeconds` ONLY if
   * this sample is what created the key (never resets an existing TTL).
   * Returns the aggregate exactly as stored after this write.
   */
  recordSample(
    key: string,
    latencyMs: number,
    ttlSeconds: number
  ): Promise<{ sampleCount: number; totalLatencyMs: number; maxLatencyMs: number }>;
  /** Returns the raw stored fields, or null when the key does not exist. */
  readAggregate(
    key: string
  ): Promise<{ sampleCount: number; totalLatencyMs: number; maxLatencyMs: number } | null>;
}

/**
 * KEYS[1] = key
 * ARGV[1] = latencyMs
 * ARGV[2] = ttlSeconds
 *
 * HINCRBY/HINCRBYFLOAT are themselves atomic; wrapping them with the
 * EXISTS check and conditional EXPIRE in the same script makes the whole
 * "increment AND ensure expiry only on creation" sequence one indivisible
 * operation.
 */
const RECORD_LATENCY_SCRIPT = `
local existed = redis.call('EXISTS', KEYS[1])
redis.call('HINCRBY', KEYS[1], 'sampleCount', 1)
redis.call('HINCRBYFLOAT', KEYS[1], 'totalLatencyMs', ARGV[1])
local currentMax = redis.call('HGET', KEYS[1], 'maxLatencyMs')
if currentMax == false or tonumber(ARGV[1]) > tonumber(currentMax) then
  redis.call('HSET', KEYS[1], 'maxLatencyMs', ARGV[1])
end
if existed == 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
local sampleCount = redis.call('HGET', KEYS[1], 'sampleCount')
local totalLatencyMs = redis.call('HGET', KEYS[1], 'totalLatencyMs')
local maxLatencyMs = redis.call('HGET', KEYS[1], 'maxLatencyMs')
return { sampleCount, totalLatencyMs, maxLatencyMs }
`;

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:provider-latency-store]", JSON.stringify(fields));
}

function validateLatencyMs(latencyMs: number): void {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > MAX_LATENCY_MS) {
    throw new Error("provider-latency-store: invalid latencyMs");
  }
}

function wrapRealClient(): ProviderLatencyRedisClient | null {
  const client = getRedisClient();
  if (!client) return null;

  return {
    async recordSample(key, latencyMs, ttlSeconds) {
      const result = await client.eval(RECORD_LATENCY_SCRIPT, 1, key, String(latencyMs), String(ttlSeconds));
      const [sampleCount, totalLatencyMs, maxLatencyMs] = result as [string, string, string];
      return {
        sampleCount: Number(sampleCount),
        totalLatencyMs: Number(totalLatencyMs),
        maxLatencyMs: Number(maxLatencyMs),
      };
    },
    async readAggregate(key) {
      const raw = await client.hgetall(key);
      if (!raw || Object.keys(raw).length === 0) return null;
      return {
        sampleCount: Number(raw.sampleCount),
        totalLatencyMs: Number(raw.totalLatencyMs),
        maxLatencyMs: Number(raw.maxLatencyMs),
      };
    },
  };
}

function resolveClient(override?: ProviderLatencyRedisClient | null): ProviderLatencyRedisClient | null {
  if (override !== undefined) return override;
  return wrapRealClient();
}

function toReadOutcome(raw: {
  sampleCount: number;
  totalLatencyMs: number;
  maxLatencyMs: number;
} | null): ProviderLatencyReadOutcome {
  if (!raw) return { outcome: "no_data" };

  // Defensive: malformed/foreign Redis state (e.g. corrupted by a manual
  // edit) must never crash the generation path — treated the same as an
  // operational failure, not a parse exception.
  if (
    !Number.isFinite(raw.sampleCount) ||
    raw.sampleCount < 0 ||
    !Number.isFinite(raw.totalLatencyMs) ||
    raw.totalLatencyMs < 0
  ) {
    return { outcome: "unavailable" };
  }
  if (raw.sampleCount === 0) return { outcome: "no_data" };

  return {
    outcome: "available",
    sampleCount: raw.sampleCount,
    totalLatencyMs: raw.totalLatencyMs,
    averageLatencyMs: raw.totalLatencyMs / raw.sampleCount,
    ...(Number.isFinite(raw.maxLatencyMs) ? { maxLatencyMs: raw.maxLatencyMs } : {}),
  };
}

/**
 * Records one latency observation for a provider. Throws synchronously
 * (rejected promise) for an invalid `providerId` (centralized keyspace
 * validation) or an invalid `latencyMs`, independent of Redis availability.
 */
export async function recordProviderLatency(
  providerId: string,
  latencyMs: number,
  testClientOverride?: ProviderLatencyRedisClient | null
): Promise<ProviderLatencyRecordOutcome> {
  const key = providerLatencyKey(providerId);
  validateLatencyMs(latencyMs);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    await client.recordSample(key, latencyMs, REDIS_KEY_TTL_SECONDS["provider-latency"]);
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
 * Reads the current latency aggregate for a provider. `no_data` means the
 * window is empty (no samples yet, or the previous window expired);
 * `unavailable` covers Redis being disabled/unreachable, a command
 * failure, or corrupted stored state — all treated identically as "no
 * reliable signal right now".
 */
export async function getProviderLatency(
  providerId: string,
  testClientOverride?: ProviderLatencyRedisClient | null
): Promise<ProviderLatencyReadOutcome> {
  const key = providerLatencyKey(providerId);

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
