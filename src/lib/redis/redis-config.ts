import "server-only";

/**
 * Cinefield Redis configuration (Phase 6R — Redis foundation, Phase A).
 *
 * Server-only, boolean-reporting, value-guarding — the same discipline as
 * the SQS and Temporal configuration modules. This module exists to answer
 * "is Redis usable?" for a future caller; it does not itself connect to
 * anything.
 *
 * ENABLEMENT
 * Two independent conditions, both required:
 *   REDIS_ENABLED === "true"   explicit operator intent
 *   REDIS_URL present          the connection actually exists
 * Configuration alone never activates a connection — the same rule every
 * other Cinefield execution gate follows (SQS_COMMAND_BUS_ENABLED,
 * TEMPORAL_GENERATION_ENABLED, GENERATION_EXECUTION_MODE).
 *
 * SCOPE
 * Redis in Cinefield is future infrastructure for rate-limit counters,
 * short-lived cache, ephemeral state, and (later) a BullMQ backend — never
 * the durable source of truth for generation status, attempt evidence,
 * submission claims, or finalization leases. Postgres remains authoritative
 * for all of that; see docs/operations/AWS_PROVIDER_RUNTIME.md and the
 * Phase 6R Redis/BullMQ architecture audit for the full boundary.
 *
 * REDIS_URL is never returned, logged, or exposed to the client — never
 * NEXT_PUBLIC_. Only its presence is reported, as a boolean.
 */

export interface RedisConfig {
  url: string;
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** True only when the operator explicitly enabled Redis. Does not imply configured. */
export function isRedisEnabled(): boolean {
  return process.env.REDIS_ENABLED === "true";
}

/** True only when a REDIS_URL is actually present. Does not imply enabled. */
export function isRedisConfigured(): boolean {
  return read("REDIS_URL") !== undefined;
}

/**
 * Resolves Redis configuration, or null when Redis is not usable — either
 * because it was never explicitly enabled, or because no URL was supplied.
 * Callers must treat null as "do not attempt a connection."
 */
export function getRedisConfig(): RedisConfig | null {
  if (!isRedisEnabled()) return null;
  const url = read("REDIS_URL");
  if (!url) return null;
  return { url };
}
