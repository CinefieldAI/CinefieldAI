import "server-only";
import Redis from "ioredis";
import { getBullmqRedisConfig } from "./bullmq-config";

/**
 * Cinefield dedicated BullMQ Redis (Redis B) connection (Phase 6R.8).
 *
 * COMPLETELY SEPARATE FROM REDIS A
 * This is its own `ioredis` singleton, constructed from `BULLMQ_REDIS_URL`
 * only — it never imports, reads, or falls back to
 * `src/lib/redis/redis-client.ts` (Redis A's application-state
 * connection). Redis A and Redis B are two different logical Redis
 * services; mixing their connections would let BullMQ's queue bookkeeping
 * share failure domains and memory pressure with application state that
 * has nothing to do with background jobs.
 *
 * LAZY, SERVER-ONLY
 * Importing this module MUST NOT open a socket — `Redis` is only ever
 * constructed inside `getBullmqConnection()`, and only when a caller
 * actually invokes it. Same discipline as Redis A's `redis-client.ts`.
 *
 * `maxRetriesPerRequest: null` is BullMQ's own documented requirement for
 * the connection it manages (BullMQ issues blocking commands internally
 * that must not be short-circuited by ioredis's own retry ceiling) — not a
 * Cinefield-invented setting.
 */

let client: Redis | null = null;

/**
 * Returns the process-wide BullMQ Redis connection, constructing it on
 * first call. Returns null when Redis B is not enabled/configured —
 * callers must treat that as "BullMQ is unavailable" and must NEVER
 * substitute Redis A's connection instead.
 */
export function getBullmqConnection(): Redis | null {
  const config = getBullmqRedisConfig();
  if (!config) return null;

  if (!client) {
    client = new Redis(config.url, { lazyConnect: true, maxRetriesPerRequest: null });
  }

  return client;
}
