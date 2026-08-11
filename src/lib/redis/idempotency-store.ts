import "server-only";
import { getRedisClient } from "./redis-client";
import { idempotencyKey, REDIS_KEY_TTL_SECONDS, type IdempotencyScope } from "./redis-keys";

/**
 * Cinefield Redis idempotency claim store (Phase 6R.7, E1).
 *
 * WHY THIS EXISTS — read this before wiring it into anything
 * The Phase 5C/6/6R idempotency audit (E1) found the `generation_attempts`
 * claim (attempt-repository.ts's `claimAttemptForSubmission`, backed by two
 * Postgres unique partial indexes) already durably and distributedly
 * prevents a known generation/attempt from being submitted to a provider
 * twice — that mechanism is correct, already cross-process/cross-instance
 * safe, and this module does NOT replace, duplicate, or sit in front of it.
 *
 * The gap this module targets is upstream of all of that: nothing today
 * gives two duplicate "create a generation" requests (a double-click that
 * outruns the frontend's in-memory guard, a retried fetch, two tabs) a
 * shared identity BEFORE they diverge into two independent, fully valid
 * `generations` rows — each of which would then correctly, and
 * independently, run through the (working) submission-claim machinery and
 * each get its own real provider job. This module is a fast, atomic,
 * distributed first-writer claim a future caller can take on a
 * caller-supplied idempotency key before creating a generation, so a
 * second concurrent/retried request with the same key can be told
 * "duplicate" instead of proceeding.
 *
 * NOT WIRED IN YET (E1 scope)
 * This phase is store + contract + zero-cost tests only. No API route, no
 * generation-creation code path, and no Postgres schema change is touched
 * here — wiring this into /api routes (and adding the matching durable
 * Postgres uniqueness a production rollout would eventually want) is
 * explicitly a later phase's decision, not this one's.
 *
 * FAILURE SEMANTICS — DELIBERATELY NOT FAIL-OPEN
 * provider-health-store.ts fails open (Redis unavailable -> treat as "no
 * data", never block anything) because Redis there is a pure observability
 * cache with zero correctness stake. Idempotency is different: unlike
 * provider submission, there is currently NO Postgres fallback for
 * request-level dedup, so silently treating a Redis outage as "safe to
 * proceed" would defeat the entire point and risk a real duplicate
 * external side effect (a second provider job, eventually a double credit
 * charge). Every function here therefore returns an explicit `"unavailable"`
 * outcome — never conflated with `"claimed"` or `"duplicate"` — so a future
 * caller is structurally forced to decide, and the correct decision is to
 * fail CLOSED (reject/retry-later the request) rather than assume safety
 * Redis did not actually provide.
 *
 * ATOMICITY
 * claimIdempotency uses `SET key value EX ttl NX` — a single atomic Redis
 * command. There is no GET-then-SET: two concurrent callers racing on the
 * same key can never both observe "no existing claim" and both proceed,
 * because SET NX either creates the key or does nothing, atomically, on
 * the server. This is the same reason `generation_attempts_one_active_uniq`
 * (a Postgres unique index, not an application-level check) is what
 * actually makes claimAttemptForSubmission safe — the pattern here mirrors
 * that "let the datastore itself arbitrate the race" principle.
 *
 * WHAT NEVER GOES IN
 * Only an opaque, caller-chosen `value` string (intended to be an internal
 * identifier, e.g. a future generationId — never a prompt, never user
 * content, never a provider response, never a credential). This module
 * does not validate the *content* of `value` beyond requiring a string;
 * callers remain responsible for never passing anything sensitive.
 */

export interface IdempotencyRecord {
  state: "pending" | "completed";
  /** Caller-chosen opaque identifier (e.g. a generationId), never content. */
  value?: string;
  claimedAt: string;
  completedAt?: string;
}

export type IdempotencyClaimOutcome =
  | { outcome: "claimed" }
  | { outcome: "duplicate" }
  | { outcome: "unavailable" };

export type IdempotencyReadOutcome =
  | { outcome: "present"; record: IdempotencyRecord }
  | { outcome: "absent" }
  | { outcome: "unavailable" };

export type IdempotencyCompleteOutcome = { outcome: "completed" } | { outcome: "unavailable" };

/**
 * The narrow surface this store needs from Redis, kept independent of
 * ioredis's overload shapes so a zero-cost test can supply an in-memory
 * fake with no mocking framework. `setNX` and `setKeepTtl` map directly to
 * single atomic Redis commands (`SET ... NX` / `SET ... KEEPTTL`) — never a
 * read-then-write pair.
 */
export interface IdempotencyRedisClient {
  /** `SET key value EX ttlSeconds NX`. Returns true iff this call created the key. */
  setNX(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** `SET key value KEEPTTL`. Overwrites value without touching the existing expiry. */
  setKeepTtl(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
}

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:idempotency-store]", JSON.stringify(fields));
}

function parseRecord(raw: string): IdempotencyRecord | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof candidate !== "object" || candidate === null) return null;
  const record = candidate as Record<string, unknown>;

  const state = record.state;
  if (state !== "pending" && state !== "completed") return null;

  const claimedAt = record.claimedAt;
  if (typeof claimedAt !== "string" || Number.isNaN(Date.parse(claimedAt))) return null;

  const value = record.value;
  if (value !== undefined && typeof value !== "string") return null;

  const completedAt = record.completedAt;
  if (completedAt !== undefined && (typeof completedAt !== "string" || Number.isNaN(Date.parse(completedAt)))) {
    return null;
  }

  return {
    state,
    claimedAt,
    ...(value !== undefined ? { value } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
}

/**
 * Adapts the real ioredis singleton to the narrow IdempotencyRedisClient
 * surface. Production callers never pass an override, so they always go
 * through this adapter (or get `null` when Redis is disabled/unconfigured).
 */
function wrapRealClient(): IdempotencyRedisClient | null {
  const client = getRedisClient();
  if (!client) return null;

  return {
    async setNX(key, value, ttlSeconds) {
      const result = await client.set(key, value, "EX", ttlSeconds, "NX");
      return result === "OK";
    },
    async setKeepTtl(key, value) {
      await client.set(key, value, "KEEPTTL");
    },
    async get(key) {
      return client.get(key);
    },
  };
}

function resolveClient(override?: IdempotencyRedisClient | null): IdempotencyRedisClient | null {
  if (override !== undefined) return override;
  return wrapRealClient();
}

/**
 * Attempts to become the first writer for (scope, id). Atomic — no
 * GET-then-SET. Throws synchronously (rejected promise) only for an
 * invalid `id`, via the same centralized `idempotencyKey()` validation
 * every other Redis key in Cinefield goes through, independent of Redis
 * availability.
 */
export async function claimIdempotency(
  scope: IdempotencyScope,
  id: string,
  testClientOverride?: IdempotencyRedisClient | null
): Promise<IdempotencyClaimOutcome> {
  const key = idempotencyKey(scope, id);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  const record: IdempotencyRecord = { state: "pending", claimedAt: new Date().toISOString() };

  try {
    const created = await client.setNX(key, JSON.stringify(record), REDIS_KEY_TTL_SECONDS.idempotency);
    return created ? { outcome: "claimed" } : { outcome: "duplicate" };
  } catch (caught) {
    log({
      scope,
      op: "claim",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}

/**
 * Reads the current claim record for (scope, id), if any. Same
 * invalid-id-always-throws behavior as claimIdempotency.
 */
export async function getIdempotency(
  scope: IdempotencyScope,
  id: string,
  testClientOverride?: IdempotencyRedisClient | null
): Promise<IdempotencyReadOutcome> {
  const key = idempotencyKey(scope, id);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    const raw = await client.get(key);
    if (raw === null) return { outcome: "absent" };
    const record = parseRecord(raw);
    if (!record) return { outcome: "absent" };
    return { outcome: "present", record };
  } catch (caught) {
    log({
      scope,
      op: "get",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}

/**
 * Marks an existing claim completed, optionally attaching an opaque
 * `value` (e.g. the generationId the claimed request produced) so a
 * duplicate that observes this record can learn the outcome instead of
 * only "someone else got here first". Uses SET ... KEEPTTL so completing a
 * claim never extends its window past the original claim's TTL — the
 * dedup window is bounded by when the FIRST request started, not by how
 * long it took.
 *
 * Intentionally does not require the caller to have seen `claimIdempotency`
 * succeed first — this module does not track ownership beyond what Redis
 * itself holds, so calling this on an id nobody claimed simply creates a
 * completed record without a TTL guarantee tied to an original claim. That
 * is a caller-discipline concern the future integration phase must respect,
 * not something this foundation enforces.
 *
 * Reads the existing record first (if any) purely to preserve its original
 * `claimedAt` in the completed record. That read-then-write is safe here —
 * unlike claimIdempotency, nothing about first-writer ownership depends on
 * it; at worst a lost race overwrites metadata, never the claim itself.
 *
 * No explicit clear/delete function exists: an idempotency claim is
 * supposed to survive until its TTL naturally expires — deleting it early
 * would defeat its purpose, since a legitimate retry within the window
 * must still observe the duplicate.
 */
export async function completeIdempotency(
  scope: IdempotencyScope,
  id: string,
  value?: string,
  testClientOverride?: IdempotencyRedisClient | null
): Promise<IdempotencyCompleteOutcome> {
  const key = idempotencyKey(scope, id);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    const existingRaw = await client.get(key);
    const existing = existingRaw ? parseRecord(existingRaw) : null;

    const record: IdempotencyRecord = {
      state: "completed",
      claimedAt: existing?.claimedAt ?? new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ...(value !== undefined ? { value } : {}),
    };

    await client.setKeepTtl(key, JSON.stringify(record));
    return { outcome: "completed" };
  } catch (caught) {
    log({
      scope,
      op: "complete",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}
