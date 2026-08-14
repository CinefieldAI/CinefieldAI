import "server-only";
import { getRedisClient } from "./redis-client";
import { rateLimitKey, type RateLimitSubject } from "./redis-keys";
import { createFieldLogger } from "@/lib/observability/logger";

/**
 * Cinefield Redis rate-limit state foundation (Phase 6R.7).
 *
 * Pure infrastructure/state. This module has NO opinion about product or
 * business limits — it does not know what "free" or "pro" means, and it
 * never hard-codes a request count. A future API/security policy layer
 * decides what `limit`/`windowSeconds` to pass; this module only makes the
 * counting itself atomic, cross-process, and cross-instance safe.
 *
 * NOT WIRED IN YET. No route, Cloudflare integration, or business policy
 * calls this today — this phase is the state foundation only.
 *
 * ALGORITHM — FIXED WINDOW, ONE ATOMIC OPERATION
 * A fixed-window counter: the current window is floor(now / windowSeconds),
 * turned into a windowId string by the caller-facing function below (never
 * computed inside redis-keys.ts itself, matching that module's own "no time
 * computation" rule). Incrementing the counter and setting its expiry both
 * happen inside ONE Lua script (RATE_LIMIT_INCREMENT_SCRIPT) — never a
 * separate INCR followed by a separate EXPIRE call. Two round trips would
 * leave a real window where a process could crash between them and strand
 * a counter with no expiry at all (a permanent key, exactly what this
 * module must never create). Redis executes the whole script as one
 * indivisible unit, so this failure mode cannot occur, and N concurrent
 * callers incrementing the same key can never lose an increment — each
 * INCR the script issues is itself atomic at the Redis level, and running
 * the conditional EXPIRE inside the same script means "was this the first
 * hit" is answered from the SAME atomic INCR's return value, not a
 * separate, racy check.
 *
 * SERVER-KNOWN IDENTITY ONLY
 * `subjectId` must already be a server-verified identity (an authenticated
 * Clerk user id, a server-derived IP fingerprint, a service identity) by
 * the time it reaches this module. This module does not authenticate
 * anything and does not accept a raw browser-supplied identity as
 * authoritative — that verification is entirely the future caller's
 * responsibility. No email, prompt, or other PII may be used as `subjectId`
 * or `action`; both flow through the centralized keyspace's identifier()
 * validation (redis-keys.ts), which rejects anything that isn't a short,
 * safe, opaque token.
 *
 * FAILURE SEMANTICS — DELIBERATELY NOT FAIL-OPEN
 * Unlike provider-health-store.ts (a pure observability cache with zero
 * correctness stake), a rate limiter is a real control. This module never
 * conflates "Redis is unavailable" with "the request is allowed" — every
 * function returns an explicit `unavailable` outcome, distinct from both
 * `allowed` and `limited`. It is deliberately silent on what a future
 * caller should DO with `unavailable` (fail open vs fail closed is a
 * policy decision for that caller — e.g. a future cost-bearing
 * /api/generate limiter would likely want to fail closed rather than allow
 * unlimited paid generation during a Redis outage, but that decision does
 * not belong in this infrastructure module).
 */

/** Safety ceilings only — never a product/business policy value. */
const MAX_LIMIT = 1_000_000;
const MAX_WINDOW_SECONDS = 86_400; // 24h, same order of magnitude as the idempotency TTL ceiling elsewhere in this codebase.

export type RateLimitOutcome =
  | { outcome: "allowed"; limit: number; remaining: number; resetAfterSeconds: number }
  | {
      outcome: "limited";
      limit: number;
      remaining: number;
      retryAfterSeconds: number;
      resetAfterSeconds: number;
    }
  | { outcome: "unavailable" };

export interface ConsumeRateLimitParams {
  subject: RateLimitSubject;
  /** MUST already be a server-verified identity. Never a raw browser-supplied value. */
  subjectId: string;
  /** Distinguishes independently-limited operations for the same subject, e.g. "generate". */
  action: string;
  limit: number;
  windowSeconds: number;
}

/**
 * The narrow surface this store needs from Redis, kept independent of
 * ioredis's shapes so a zero-cost test can supply an in-memory fake with no
 * mocking framework and no real Lua interpreter.
 */
export interface RateLimitRedisClient {
  /**
   * Atomic fixed-window increment: increments `key`, and sets its expiry to
   * `windowSeconds` ONLY when this increment is the first hit in the
   * window (i.e. the counter's new value is 1) — never a separate command.
   * Returns `[countAfterIncrement, ttlSecondsRemaining]`.
   */
  incrementWindow(key: string, windowSeconds: number): Promise<[count: number, ttlSeconds: number]>;
}

/**
 * KEYS[1] = key
 * ARGV[1] = windowSeconds
 *
 * INCR is itself atomic; wrapping it with a conditional EXPIRE in the same
 * script makes "increment AND ensure expiry" one indivisible operation, so
 * no process crash between two separate commands can ever strand a
 * permanent (never-expiring) key.
 */
const RATE_LIMIT_INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

/**
 * Phase 13-E: delegates to the Sensitive Data Guard.
 *
 * The call sites below are unchanged — the difference is that every field
 * now passes the telemetry allow-list before it reaches console or any
 * future sink. An unknown or unsafe field is dropped, not printed.
 */
const emit = createFieldLogger("rate-limit-store");

function log(fields: Record<string, unknown>): void {
  emit(fields);
}

function validatePositiveInteger(label: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`rate-limit-store: invalid ${label}`);
  }
}

function wrapRealClient(): RateLimitRedisClient | null {
  const client = getRedisClient();
  if (!client) return null;

  return {
    async incrementWindow(key, windowSeconds) {
      const result = await client.eval(RATE_LIMIT_INCREMENT_SCRIPT, 1, key, String(windowSeconds));
      const [count, ttl] = result as [number, number];
      return [Number(count), Number(ttl)];
    },
  };
}

function resolveClient(override?: RateLimitRedisClient | null): RateLimitRedisClient | null {
  if (override !== undefined) return override;
  return wrapRealClient();
}

/**
 * Floors the current time to a `windowSeconds`-wide bucket and returns it as
 * an opaque windowId string — the caller-side time computation
 * redis-keys.ts's own doc comment says never belongs inside that module.
 */
function currentWindowId(windowSeconds: number): string {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  return String(bucket);
}

/**
 * Consumes one unit of a fixed-window rate limit for (subject, subjectId,
 * action). Throws synchronously (rejected promise) for an invalid
 * `subjectId`/`action` (via the centralized identifier() validation) or an
 * invalid `limit`/`windowSeconds` (zero, negative, non-integer, or beyond
 * this module's safety ceilings) — independent of Redis availability, the
 * same discipline every other Cinefield Redis store follows.
 */
export async function consumeRateLimit(
  params: ConsumeRateLimitParams,
  testClientOverride?: RateLimitRedisClient | null
): Promise<RateLimitOutcome> {
  validatePositiveInteger("limit", params.limit, MAX_LIMIT);
  validatePositiveInteger("windowSeconds", params.windowSeconds, MAX_WINDOW_SECONDS);

  const windowId = currentWindowId(params.windowSeconds);
  const key = rateLimitKey(params.subject, params.subjectId, params.action, windowId);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    const [count, ttl] = await client.incrementWindow(key, params.windowSeconds);
    const resetAfterSeconds = Math.max(ttl, 0);

    if (count <= params.limit) {
      return {
        outcome: "allowed",
        limit: params.limit,
        remaining: Math.max(params.limit - count, 0),
        resetAfterSeconds,
      };
    }

    return {
      outcome: "limited",
      limit: params.limit,
      remaining: 0,
      retryAfterSeconds: resetAfterSeconds,
      resetAfterSeconds,
    };
  } catch (caught) {
    log({
      subject: params.subject,
      action: params.action,
      op: "consume",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}
