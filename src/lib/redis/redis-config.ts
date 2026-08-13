import "server-only";
import { OrchestrationError } from "@/lib/orchestration/errors";

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
 * Schemes ioredis understands. `redis:` is plaintext, `rediss:` is TLS.
 * Anything else — an http URL, a pasted CLI command, a connection string
 * from a different product — is an operator mistake, not a connection.
 */
const SUPPORTED_SCHEMES = new Set(["redis:", "rediss:"]);

/**
 * Non-secret reason a URL was rejected. Safe to log and to attach to an
 * error: it describes the SHAPE of the mistake, never any part of the value.
 */
export type RedisConfigProblem = "missing_url" | "invalid_url" | "unsupported_scheme";

/**
 * Validates REDIS_URL without ever revealing it.
 *
 * WHY THIS EXISTS (M4). `getRedisConfig()` used to check only that the
 * variable was non-empty, so a malformed value sailed through and became a
 * raw `TypeError: Invalid URL` inside `new Redis(...)`. That surfaced as a
 * crash in the middle of route resolution and took down every generation
 * request — observed live on 2026-08-13, where a pasted block of prose had
 * ended up in REDIS_URL. A configuration mistake must fail as a typed
 * configuration error at the boundary, not as an unhandled exception three
 * layers down.
 *
 * NOT re-interpreted as "Redis disabled". Silently degrading would take
 * rate limits, distributed locks and the Phase 7-E runtime routing controls
 * offline while everything looked healthy.
 */
export function validateRedisUrl(url: string | undefined): RedisConfigProblem | null {
  if (!url) return "missing_url";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "invalid_url";
  }

  if (!SUPPORTED_SCHEMES.has(parsed.protocol)) return "unsupported_scheme";
  return null;
}

/**
 * Resolves Redis configuration, or null when Redis was never enabled.
 *
 * Enabled-but-broken is NOT null — it throws `REDIS_CONFIGURATION_INVALID`
 * carrying only the shape of the problem. The two states are different
 * facts and callers must be able to tell them apart.
 */
export function getRedisConfig(): RedisConfig | null {
  if (!isRedisEnabled()) return null;

  const url = read("REDIS_URL");
  const problem = validateRedisUrl(url);
  if (problem) {
    throw new OrchestrationError("REDIS_CONFIGURATION_INVALID", {
      // `reason` is one of three fixed strings. The URL, its length, its
      // prefix and any credential inside it never appear here.
      context: { reason: problem },
    });
  }

  return { url: url as string };
}
