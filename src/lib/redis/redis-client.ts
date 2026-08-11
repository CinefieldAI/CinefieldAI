import "server-only";
import Redis from "ioredis";
import { getRedisConfig } from "./redis-config";

/**
 * Cinefield Redis client (Phase 6R — Redis foundation, Phase A).
 *
 * A lazy, server-only singleton. Importing this module MUST NOT open a
 * socket: ioredis is only ever constructed inside getRedisClient(), and
 * only when a caller actually invokes it. No connect(), no ping(), no
 * command runs anywhere in this file at Phase A — this is connection
 * plumbing only, with zero callers.
 *
 * This is the generic application Redis client (future rate limiting,
 * short-lived cache, ephemeral state). It is NOT the future BullMQ
 * connection — BullMQ's Queue/Worker will get their own connection factory
 * in a later phase, never this one.
 *
 * Credentials: REDIS_URL, read once by redis-config.ts. Never logged here.
 */

let client: Redis | null = null;

/**
 * Returns the process-wide Redis client, constructing it on first call.
 * Returns null when Redis is not enabled/configured — callers must treat
 * that as "Redis is unavailable" and degrade accordingly, never throw.
 *
 * `lazyConnect: true` means the constructor itself never opens a socket —
 * ioredis only connects when a command is first issued against the client,
 * or connect() is called explicitly. Neither happens in this file, so
 * calling this function still performs zero network activity by itself;
 * that is deferred entirely to whatever future caller issues the first
 * real command.
 */
export function getRedisClient(): Redis | null {
  const config = getRedisConfig();
  if (!config) return null;

  if (!client) {
    client = new Redis(config.url, { lazyConnect: true });
  }

  return client;
}
