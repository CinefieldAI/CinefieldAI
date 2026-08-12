import { getRedisClient } from "./redis-client";
import { circuitBreakerKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import {
  initialBreakerRecord,
  type CircuitBreakerRecord,
  type BreakerState,
} from "@/lib/routing/circuit-breaker";

/**
 * Circuit breaker state in Redis A (Phase 7-C).
 *
 * REDIS A, EPHEMERAL, NEVER DURABLE TRUTH. This holds an opinion about how a
 * provider model has been behaving in the last few minutes. It holds no
 * generation, no attempt, no billing fact, no credential, no prompt and no
 * media. Losing the entire keyspace costs Cinefield nothing but a fresh start
 * at CLOSED — which is why every read fails OPEN to "no data" rather than
 * throwing, and every write is best-effort.
 *
 * REDIS B IS NOT INVOLVED. Redis B is BullMQ's, and nothing here touches it.
 *
 * The narrow client interface is the same pattern the other provider stores
 * use, so a test injects an in-memory fake instead of a connection.
 */

export interface CircuitBreakerRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export type BreakerReadOutcome =
  | { outcome: "available"; record: CircuitBreakerRecord }
  /** No breaker has ever been written, or it expired. Means CLOSED. */
  | { outcome: "no_data" }
  /** Redis is disabled, unreachable, or returned something unusable. */
  | { outcome: "unavailable" };

function log(fields: Record<string, unknown>): void {
  // Identifiers and state names only. Never a prompt, a payload, a key value.
  console.info("[cinefield:circuit-breaker-store]", JSON.stringify(fields));
}

let testClient: CircuitBreakerRedisClient | null | undefined;

/** Test seam, mirroring the other Redis A stores. */
export function __setCircuitBreakerClientForTesting(
  client: CircuitBreakerRedisClient | null
): void {
  testClient = client;
}

function resolveClient(
  override?: CircuitBreakerRedisClient | null
): CircuitBreakerRedisClient | null {
  if (override !== undefined) return override;
  if (testClient !== undefined) return testClient;
  return (getRedisClient() as CircuitBreakerRedisClient | null) ?? null;
}

const BREAKER_STATES: ReadonlySet<string> = new Set<BreakerState>(["CLOSED", "OPEN", "HALF_OPEN"]);

/**
 * Defensive parse. Anything malformed is treated as absent.
 *
 * A corrupted breaker must never be read as OPEN — that would let one bad
 * write take a provider out of rotation until the TTL expired, with no
 * failure behind it.
 */
export function parseBreakerRecord(raw: string): CircuitBreakerRecord | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;

  const value = candidate as Record<string, unknown>;
  if (typeof value.state !== "string" || !BREAKER_STATES.has(value.state)) return null;
  if (typeof value.updatedAt !== "string") return null;

  const nonNegative = (input: unknown): number =>
    typeof input === "number" && Number.isFinite(input) && input >= 0 ? Math.floor(input) : 0;

  const optionalIso = (input: unknown): string | undefined =>
    typeof input === "string" && input.length > 0 ? input : undefined;

  return {
    state: value.state as BreakerState,
    consecutiveFailures: nonNegative(value.consecutiveFailures),
    halfOpenSuccesses: nonNegative(value.halfOpenSuccesses),
    lastFailureAt: optionalIso(value.lastFailureAt),
    lastSuccessAt: optionalIso(value.lastSuccessAt),
    openedAt: optionalIso(value.openedAt),
    updatedAt: value.updatedAt,
  };
}

export async function getBreaker(
  providerId: string,
  providerModelId: string,
  override?: CircuitBreakerRedisClient | null
): Promise<BreakerReadOutcome> {
  const key = circuitBreakerKey(providerId, providerModelId);
  const client = resolveClient(override);
  if (!client) return { outcome: "unavailable" };

  try {
    const raw = await client.get(key);
    if (raw === null) return { outcome: "no_data" };
    const record = parseBreakerRecord(raw);
    return record ? { outcome: "available", record } : { outcome: "unavailable" };
  } catch (caught) {
    log({
      providerId,
      op: "get",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}

/**
 * Persists breaker state. Best-effort: a failed write must never fail a
 * generation, because the breaker is an optimization and the generation is
 * the product.
 */
export async function setBreaker(
  providerId: string,
  providerModelId: string,
  record: CircuitBreakerRecord,
  override?: CircuitBreakerRedisClient | null
): Promise<boolean> {
  const key = circuitBreakerKey(providerId, providerModelId);
  const client = resolveClient(override);
  if (!client) return false;

  try {
    await client.set(
      key,
      JSON.stringify(record),
      "EX",
      REDIS_KEY_TTL_SECONDS["circuit-breaker"]
    );
    return true;
  } catch (caught) {
    log({
      providerId,
      op: "set",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return false;
  }
}

export async function clearBreaker(
  providerId: string,
  providerModelId: string,
  override?: CircuitBreakerRedisClient | null
): Promise<void> {
  const key = circuitBreakerKey(providerId, providerModelId);
  const client = resolveClient(override);
  if (!client) return;
  try {
    await client.del(key);
  } catch {
    // Best-effort by design; the TTL is the backstop.
  }
}

/**
 * Applies a transition and persists it.
 *
 * Read-modify-write, not a Lua compare-and-set, and that is a deliberate
 * choice rather than an oversight: two concurrent failures racing here can
 * lose one increment, which delays a breaker opening by one observation. The
 * cost of that is one extra request to a failing provider. The cost of making
 * it atomic is a Lua script whose semantics have to be kept in step with the
 * pure policy in circuit-breaker.ts — two implementations of the state
 * machine, which is the failure mode that actually hurts. Durable
 * correctness lives in PostgreSQL; this is a hint.
 */
export async function transitionBreaker(
  providerId: string,
  providerModelId: string,
  transition: (record: CircuitBreakerRecord) => CircuitBreakerRecord,
  now: Date,
  override?: CircuitBreakerRedisClient | null
): Promise<CircuitBreakerRecord | null> {
  const current = await getBreaker(providerId, providerModelId, override);
  if (current.outcome === "unavailable") return null;

  const base =
    current.outcome === "available" ? current.record : initialBreakerRecord(now.toISOString());
  const next = transition(base);

  const written = await setBreaker(providerId, providerModelId, next, override);
  if (!written) return null;

  if (base.state !== next.state) {
    log({ providerId, providerModelId, from: base.state, to: next.state, result: "transition" });
  }
  return next;
}
