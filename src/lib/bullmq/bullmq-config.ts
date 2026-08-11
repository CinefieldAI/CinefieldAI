import "server-only";

/**
 * Cinefield BullMQ + dedicated Redis B configuration (Phase 6R.8).
 *
 * ===========================================================================
 * RESPONSIBILITY BOUNDARY (read this before adding a job anywhere)
 * ===========================================================================
 *   TEMPORAL     Long-running generation workflow ownership. The durable
 *                owner of one generation's lifecycle (worker/workflows/
 *                generation-workflow.ts). Never touched by this module.
 *
 *   SQS          Durable heavy / cross-service commands. The provider
 *                command transport (src/lib/aws/sqs-command-bus.ts,
 *                worker/provider-worker.ts) — already live and verified in
 *                production this project's Phase 6R work. Never touched by
 *                this module, never replaced by BullMQ.
 *
 *   BULLMQ       Short, fast, retryable BACKGROUND jobs only — thumbnail,
 *                preview, optimize, notification, email, cache-refresh,
 *                short webhook retry. Never a generation's authoritative
 *                lifecycle owner, never a provider command transport.
 *
 *   TRIGGER.DEV  Cron, reconciliation, cleanup, health, audit, restore,
 *                cost operations (e.g. expire_stale_reservations, per
 *                20260811120000_credit_system.sql's own comment: "Called
 *                on a schedule (Trigger.dev)"). Also still the CURRENT
 *                live execution path for GENERATION_EXECUTION_MODE=trigger
 *                environments (src/trigger/generation-task.ts) — that is
 *                NOT a BullMQ candidate and must never be moved here.
 *
 *   REDIS A      Application state (src/lib/redis/*) — provider health,
 *                latency, error-rate, rate-limit, idempotency, model
 *                cache, pricing cache, distributed locks. Phase 6R.7,
 *                complete. This module NEVER reads or writes Redis A's
 *                keyspace and NEVER falls back to Redis A's connection.
 *
 *   REDIS B      BullMQ's own internal queue state ONLY (job data, delayed
 *                sets, stream consumer groups — BullMQ's internal
 *                bookkeeping). A completely separate logical Redis
 *                service/connection from Redis A. If Redis B is not
 *                configured, this module reports that explicitly — it
 *                never silently reuses Redis A's URL as a substitute.
 *
 * ===========================================================================
 * ENABLEMENT — SAME TWO-KEY PATTERN AS EVERY OTHER CINEFIELD TRANSPORT
 * ===========================================================================
 * Mirrors SQS_COMMAND_BUS_ENABLED+queue URL, TEMPORAL_GENERATION_ENABLED+
 * namespace, and Redis A's own REDIS_ENABLED+REDIS_URL: two independent
 * conditions, both required, so configuration alone never activates a
 * connection.
 *
 *   BULLMQ_REDIS_ENABLED === "true"   explicit operator intent
 *   BULLMQ_REDIS_URL present          the connection actually exists
 *
 * No environment variable naming convention for a dedicated queue Redis
 * existed anywhere in this repository before this phase (confirmed by
 * audit — REDIS_B_CONFIG_PRESENT was false). BULLMQ_REDIS_URL is a NEW
 * name, chosen to be unambiguous with Redis A's REDIS_URL and to make an
 * accidental reuse of Redis A's value immediately visually obvious in any
 * .env file. This phase does not set it — that remains an explicit,
 * separate operator action.
 */

export interface BullmqRedisConfig {
  url: string;
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** True only when the operator explicitly enabled the dedicated BullMQ Redis. Does not imply configured. */
export function isBullmqRedisEnabled(): boolean {
  return process.env.BULLMQ_REDIS_ENABLED === "true";
}

/** True only when BULLMQ_REDIS_URL is actually present. Does not imply enabled. */
export function isBullmqRedisUrlPresent(): boolean {
  return read("BULLMQ_REDIS_URL") !== undefined;
}

/**
 * Resolves the dedicated Redis B configuration, or null when it is not
 * usable — either never explicitly enabled, or no URL supplied. Callers
 * must treat null as "do not attempt a BullMQ connection" and must NEVER
 * substitute Redis A's configuration as a fallback.
 */
export function getBullmqRedisConfig(): BullmqRedisConfig | null {
  if (!isBullmqRedisEnabled()) return null;
  const url = read("BULLMQ_REDIS_URL");
  if (!url) return null;
  return { url };
}

/** Safe description for logs/health checks: presence only, never the URL or any credential. */
export function describeBullmqRedisConfig(): { configured: boolean } {
  return { configured: getBullmqRedisConfig() !== null };
}
