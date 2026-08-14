import "server-only";
import { getRedisClient } from "./redis-client";
import { providerHealthKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import { createFieldLogger } from "@/lib/observability/logger";

/**
 * Cinefield provider-health state store (Phase 6R.7 — first Redis
 * application-state caller).
 *
 * Redis-backed operational cache of "how is this provider doing right
 * now" — never a source of truth. Nothing here participates in a
 * generation's correctness: the provider registry, the model registry, and
 * the generation_attempts CAS remain the only things that decide whether a
 * provider may be called. This store exists purely so a future caller
 * (Model Router, an ops dashboard) can read a cheap operational signal
 * instead of none at all.
 *
 * FAIL-OPEN BY DESIGN
 * Every function here degrades safely instead of throwing:
 *   - Redis disabled/unconfigured -> reads return null, writes are a no-op
 *   - Redis reachable but a command fails (timeout, auth drop, network
 *     blip) -> reads return null, writes are swallowed
 * A provider-health read/write failure must never interrupt or fail a
 * generation. Errors are logged with a safe classification only (error
 * name, provider id) — never a message that could carry a connection
 * string or credential.
 *
 * KEY VALIDATION IS NOT PART OF THE FAIL-OPEN CONTRACT
 * An invalid providerId is a caller bug, not a Redis-availability
 * condition — providerHealthKey() (Phase C's centralized keyspace
 * contract) is invoked before any Redis-availability check and throws
 * synchronously for a malformed id, regardless of whether Redis is
 * enabled/configured/reachable.
 *
 * WHAT NEVER GOES IN
 * Only the operational fields below. No API keys, no provider credentials,
 * no prompts, no generated user content, no raw provider response bodies,
 * no stack traces. This module cannot enforce that on a caller who
 * deliberately misuses it, but its own type stays intentionally narrow so
 * a well-typed caller cannot pass anything else by accident.
 *
 * NOT WIRED IN YET
 * Phase D1 creates this store only. No Model Router, no provider adapter,
 * and no execution path calls it yet — that wiring is a later phase.
 */

export type ProviderHealthStatus = "healthy" | "degraded" | "unhealthy";

export interface ProviderHealthState {
  status: ProviderHealthStatus;
  /** Non-negative. Consecutive failed health observations. */
  consecutiveFailures: number;
  /** Non-negative, finite. Omitted when no latency observation exists yet. */
  latencyMs?: number;
  /** ISO-8601. When this state was last observed/written. */
  lastCheckedAt: string;
  /** ISO-8601. Omitted until the first successful observation. */
  lastSuccessAt?: string;
  /** ISO-8601. Omitted until the first failed observation. */
  lastFailureAt?: string;
}

/**
 * The subset of the ioredis client this store actually calls. Narrowing to
 * this shape (rather than depending on the full `Redis` type everywhere)
 * is what lets Phase D1's zero-cost tests inject an in-memory fake instead
 * of a real connection — no network, no Redis Cloud, no mocking framework.
 */
export interface ProviderHealthRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * Phase 13-E: delegates to the Sensitive Data Guard.
 *
 * The call sites below are unchanged — the difference is that every field
 * now passes the telemetry allow-list before it reaches console or any
 * future sink. An unknown or unsafe field is dropped, not printed.
 */
const emit = createFieldLogger("provider-health-store");

function log(fields: Record<string, unknown>): void {
  emit(fields);
}

/** Narrow, defensive parse — malformed/foreign data is treated as absent, never thrown. */
export function parseProviderHealthState(raw: string): ProviderHealthState | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof candidate !== "object" || candidate === null) return null;
  const record = candidate as Record<string, unknown>;

  const status = record.status;
  if (status !== "healthy" && status !== "degraded" && status !== "unhealthy") return null;

  const consecutiveFailures = record.consecutiveFailures;
  if (typeof consecutiveFailures !== "number" || !Number.isFinite(consecutiveFailures) || consecutiveFailures < 0) {
    return null;
  }

  const lastCheckedAt = record.lastCheckedAt;
  if (typeof lastCheckedAt !== "string" || Number.isNaN(Date.parse(lastCheckedAt))) return null;

  const latencyMs = record.latencyMs;
  if (latencyMs !== undefined && (typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs < 0)) {
    return null;
  }

  const lastSuccessAt = record.lastSuccessAt;
  if (lastSuccessAt !== undefined && (typeof lastSuccessAt !== "string" || Number.isNaN(Date.parse(lastSuccessAt)))) {
    return null;
  }

  const lastFailureAt = record.lastFailureAt;
  if (lastFailureAt !== undefined && (typeof lastFailureAt !== "string" || Number.isNaN(Date.parse(lastFailureAt)))) {
    return null;
  }

  return {
    status,
    consecutiveFailures,
    lastCheckedAt,
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(lastSuccessAt !== undefined ? { lastSuccessAt } : {}),
    ...(lastFailureAt !== undefined ? { lastFailureAt } : {}),
  };
}

/**
 * Resolves the client to use. `override` exists solely as a test seam
 * (Phase D1's zero-cost tests pass an in-memory fake here); production
 * callers never pass it, so they always get the real lazy singleton — or
 * null when Redis is disabled/unconfigured.
 */
function resolveClient(override?: ProviderHealthRedisClient | null): ProviderHealthRedisClient | null {
  if (override !== undefined) return override;
  return getRedisClient();
}

/**
 * Reads the last-known health state for a provider. Returns null when Redis
 * is disabled/unconfigured, unreachable, the key does not exist, or the
 * stored value cannot be safely parsed — every one of those is "no signal
 * available", never an error a caller must handle specially.
 *
 * Throws synchronously (as a rejected promise) only for an invalid
 * `providerId` — a caller bug the centralized keyspace contract rejects
 * before any Redis interaction is attempted.
 */
export async function getProviderHealth(
  providerId: string,
  testClientOverride?: ProviderHealthRedisClient | null
): Promise<ProviderHealthState | null> {
  const key = providerHealthKey(providerId);

  const client = resolveClient(testClientOverride);
  if (!client) return null;

  try {
    const raw = await client.get(key);
    if (raw === null) return null;
    return parseProviderHealthState(raw);
  } catch (caught) {
    log({
      providerId,
      op: "get",
      result: "fail_open",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return null;
  }
}

/**
 * Writes a provider's health state with the centralized provider-health
 * TTL. A no-op when Redis is disabled/unconfigured or the write fails —
 * callers must not treat either as an error; provider health is a
 * best-effort cache, and a failed write here must never fail or slow a
 * generation.
 *
 * Throws synchronously (as a rejected promise) only for an invalid
 * `providerId`, same as getProviderHealth.
 */
export async function setProviderHealth(
  providerId: string,
  state: ProviderHealthState,
  testClientOverride?: ProviderHealthRedisClient | null
): Promise<void> {
  const key = providerHealthKey(providerId);

  const client = resolveClient(testClientOverride);
  if (!client) return;

  try {
    await client.set(key, JSON.stringify(state), "EX", REDIS_KEY_TTL_SECONDS["provider-health"]);
  } catch (caught) {
    log({
      providerId,
      op: "set",
      result: "fail_open",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
  }
}

/**
 * Clears a provider's cached health state. A no-op under every failure
 * mode, for the same fail-open reasons as setProviderHealth. Same
 * synchronous-throw-on-invalid-id behavior as the other two functions.
 */
export async function clearProviderHealth(
  providerId: string,
  testClientOverride?: ProviderHealthRedisClient | null
): Promise<void> {
  const key = providerHealthKey(providerId);

  const client = resolveClient(testClientOverride);
  if (!client) return;

  try {
    await client.del(key);
  } catch (caught) {
    log({
      providerId,
      op: "del",
      result: "fail_open",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
  }
}
