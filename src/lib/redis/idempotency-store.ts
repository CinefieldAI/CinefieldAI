import "server-only";
import { randomUUID } from "node:crypto";
import { getRedisClient } from "./redis-client";
import { idempotencyKey, REDIS_KEY_TTL_SECONDS, type IdempotencyScope } from "./redis-keys";
import { createFieldLogger } from "@/lib/observability/logger";

/**
 * Cinefield Redis idempotency claim store (Phase 6R.7, E1 -> E3A).
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
 * `generations` rows. This module is a fast, atomic, distributed first-writer
 * claim a future caller can take on a caller-supplied idempotency key before
 * creating a generation, so a second concurrent/retried request with the
 * same key can be told "duplicate" instead of proceeding.
 *
 * NOT WIRED IN YET
 * No route, activity, or workflow calls this module today (confirmed by the
 * E3 architecture audit). Wiring it — and the matching durable Postgres
 * uniqueness a production rollout would eventually want — is a later,
 * explicitly separate phase's decision.
 *
 * ===========================================================================
 * E3A LIFECYCLE HARDENING
 * ===========================================================================
 * E1/E2 shipped a two-state store (pending -> completed) whose completion
 * write was an UNCONDITIONAL overwrite — no compare-and-set, no ownership
 * check. That was safe only because nothing called it yet. E3's architecture
 * audit found a real gap it would have caused once wired: if a Redis claim
 * succeeds but generation creation then fails (a real possibility — a
 * transient DB error, a validation failure) BEFORE any external side effect
 * occurred, the identity would be stuck "pending" for the full 24h TTL,
 * blocking the user's own legitimate retry of their own request.
 *
 * The lifecycle is now:
 *
 *   (absent) --claim--> PENDING(ownerToken)
 *                          |
 *                          +--complete(ownerToken)--> COMPLETED(value)  [terminal]
 *                          |
 *                          +--fail(ownerToken)------> FAILED_RETRYABLE(reason)
 *                                                          |
 *                                                          +--retry--> PENDING(newOwnerToken)
 *
 * FAILED_RETRYABLE MEANS ONLY ONE THING: the request failed BEFORE any
 * ambiguous or irreversible external side effect was allowed to occur (e.g.
 * generation-row creation failed, or credit reservation failed before any
 * provider was ever contacted). It must NEVER be reached after a provider
 * submission may have happened — that ambiguity is exactly what the
 * generation_attempts "ambiguous" evidence marker exists for elsewhere in
 * this codebase, and retrying THAT case automatically would risk a second
 * paid provider call. This module has no way to enforce that a caller only
 * fails "before any side effect" — that discipline belongs to whichever
 * future route calls failIdempotency(), and must never be exercised past a
 * provider dispatch.
 *
 * OWNERSHIP TOKENS AND ATOMIC TRANSITIONS
 * Every fresh claim (an absent->pending or a failed_retryable->pending
 * reclaim) mints a new cryptographically random ownerToken
 * (node:crypto randomUUID — never derived from user content, never logged).
 * Only the holder of the CURRENT ownerToken may transition a pending record
 * to completed or failed_retryable — enforced by a single atomic Lua script
 * (COMPARE_AND_SET_SCRIPT below), not by a GET-then-SET pair. Redis executes
 * a Lua script as one atomic unit — no other command, from any client, can
 * interleave mid-script — so this is a true compare-and-set: it reads the
 * current value, checks state and (when required) ownerToken, and writes the
 * new value, all in one indivisible server-side step. A stale process that
 * lost a race (its claim was reclaimed by someone else, or its target was
 * already completed by a faster caller) will find its ownerToken no longer
 * matches and its transition will be rejected — it can never overwrite a
 * newer claim.
 *
 * Reclaiming a FAILED_RETRYABLE record does NOT check an owner token (the
 * previous owner already failed and gave up its claim) — it checks ONLY that
 * the current state is still "failed_retryable". Because the check-and-write
 * is inside the same atomic script, if N callers race to reclaim the same
 * failed identity, only the first to execute observes "failed_retryable" and
 * wins; every later one observes the now-"pending" state (written by the
 * winner) and is rejected. Exactly one winner, by construction — never a
 * GET-then-SET race.
 *
 * COMPLETED IS IMMUTABLE
 * The compare-and-set script only ever transitions FROM "pending" (complete/
 * fail) or FROM "failed_retryable" (reclaim). There is no code path, in this
 * module, that can write over a "completed" record — a duplicate request
 * that observes "completed" must read it and return its value, never call
 * complete/fail/retry against it. No general-purpose clear/delete API exists
 * for the same reason it did not in E1/E2: an idempotency claim must survive
 * until its TTL naturally expires so a legitimate retry within the window
 * still observes it.
 *
 * TTL
 * A fresh claim (initial or reclaimed) gets the full centralized
 * REDIS_KEY_TTL_SECONDS.idempotency window. Completing or failing a claim
 * preserves the ORIGINAL claim's remaining TTL (KEEPTTL) rather than
 * resetting it — the dedup window is bounded by when the first request
 * started, not by how long each step took. No key here is ever written
 * without an expiry.
 *
 * FAILURE SEMANTICS — DELIBERATELY NOT FAIL-OPEN
 * Unchanged from E1: every function returns an explicit `"unavailable"`
 * outcome on a disabled/unconfigured Redis or a command failure — never
 * conflated with any other outcome. A future caller must fail CLOSED.
 */

export type IdempotencyState = "pending" | "completed" | "failed_retryable";

export interface PendingRecord {
  state: "pending";
  /** Cryptographically random. Only this token's holder may complete/fail this claim. */
  ownerToken: string;
  claimedAt: string;
}

export interface CompletedRecord {
  state: "completed";
  /** Caller-chosen opaque identifier (e.g. a generationId), never content. */
  value?: string;
  claimedAt: string;
  completedAt: string;
}

export interface FailedRetryableRecord {
  state: "failed_retryable";
  /** Short safe reason code — never a raw error message or stack trace. */
  reason?: string;
  claimedAt: string;
  failedAt: string;
}

export type IdempotencyRecord = PendingRecord | CompletedRecord | FailedRetryableRecord;

export type IdempotencyClaimOutcome =
  | { outcome: "claimed"; ownerToken: string }
  | { outcome: "duplicate" }
  | { outcome: "unavailable" };

export type IdempotencyReadOutcome =
  | { outcome: "present"; record: IdempotencyRecord }
  | { outcome: "absent" }
  | { outcome: "unavailable" };

export type IdempotencyCompleteOutcome =
  | { outcome: "completed" }
  | { outcome: "owner_mismatch" }
  | { outcome: "not_pending" }
  | { outcome: "unavailable" };

export type IdempotencyFailOutcome =
  | { outcome: "failed_retryable" }
  | { outcome: "owner_mismatch" }
  | { outcome: "not_pending" }
  | { outcome: "unavailable" };

export type IdempotencyRetryOutcome =
  | { outcome: "claimed"; ownerToken: string }
  | { outcome: "not_failed_retryable" }
  | { outcome: "unavailable" };

/** Result codes for the compare-and-set primitive. See CompareAndSetResult. */
export const CAS_ABSENT = 0;
export const CAS_OK = 1;
export const CAS_STATE_MISMATCH = 2;
export const CAS_OWNER_MISMATCH = 3;
export type CompareAndSetResult =
  | typeof CAS_ABSENT
  | typeof CAS_OK
  | typeof CAS_STATE_MISMATCH
  | typeof CAS_OWNER_MISMATCH;

/**
 * The narrow surface this store needs from Redis, kept independent of
 * ioredis's shapes so a zero-cost test can supply an in-memory fake with no
 * mocking framework and no real Lua interpreter.
 */
export interface IdempotencyRedisClient {
  /** `SET key value EX ttlSeconds NX`. Returns true iff this call created the key. */
  setNX(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  /**
   * Atomic compare-and-set. Replaces the value at `key` with `newValue`
   * ONLY IF the currently stored record's `state` equals `expectedState`
   * AND (when `expectedOwnerToken` is not null) its `ownerToken` equals
   * `expectedOwnerToken`. `ttl` is either a fresh TTL in seconds, or the
   * literal "keep" to preserve the key's current remaining TTL.
   *
   * Real implementation: a single Lua script (COMPARE_AND_SET_SCRIPT),
   * atomic by construction — Redis never interleaves another command mid
   * script. No GET-then-SET pair exists anywhere in this interface.
   */
  compareAndSetState(
    key: string,
    expectedState: IdempotencyState,
    expectedOwnerToken: string | null,
    newValue: string,
    ttl: number | "keep"
  ): Promise<CompareAndSetResult>;
}

/**
 * KEYS[1] = key
 * ARGV[1] = expected state
 * ARGV[2] = expected owner token, or "" to skip the owner check (reclaim)
 * ARGV[3] = new value (JSON string) to write on success
 * ARGV[4] = ttl seconds, or the literal string "keep"
 *
 * Returns 0 (absent/corrupt), 1 (success), 2 (state mismatch), or 3 (owner
 * mismatch) — see CAS_* constants above. One round trip, one atomic unit.
 */
const COMPARE_AND_SET_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == false then
  return 0
end
local ok, decoded = pcall(cjson.decode, current)
if not ok or type(decoded) ~= 'table' then
  return 0
end
if decoded.state ~= ARGV[1] then
  return 2
end
if ARGV[2] ~= '' and decoded.ownerToken ~= ARGV[2] then
  return 3
end
if ARGV[4] == 'keep' then
  redis.call('SET', KEYS[1], ARGV[3], 'KEEPTTL')
else
  redis.call('SET', KEYS[1], ARGV[3], 'EX', tonumber(ARGV[4]))
end
return 1
`;

/**
 * Phase 13-E: delegates to the Sensitive Data Guard.
 *
 * The call sites below are unchanged — the difference is that every field
 * now passes the telemetry allow-list before it reaches console or any
 * future sink. An unknown or unsafe field is dropped, not printed.
 */
const emit = createFieldLogger("idempotency-store");

function log(fields: Record<string, unknown>): void {
  emit(fields);
}

/** Short, safe reason codes only — bounded length, restricted charset. Never raw error text. */
const REASON_PATTERN = /^[a-z0-9_]{1,64}$/;

function validateReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  if (!REASON_PATTERN.test(reason)) {
    throw new Error("idempotency-store: invalid reason code");
  }
  return reason;
}

export function parseRecord(raw: string): IdempotencyRecord | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof candidate !== "object" || candidate === null) return null;
  const record = candidate as Record<string, unknown>;

  const claimedAt = record.claimedAt;
  if (typeof claimedAt !== "string" || Number.isNaN(Date.parse(claimedAt))) return null;

  if (record.state === "pending") {
    const ownerToken = record.ownerToken;
    if (typeof ownerToken !== "string" || ownerToken.length === 0) return null;
    return { state: "pending", ownerToken, claimedAt };
  }

  if (record.state === "completed") {
    const value = record.value;
    if (value !== undefined && typeof value !== "string") return null;
    const completedAt = record.completedAt;
    if (typeof completedAt !== "string" || Number.isNaN(Date.parse(completedAt))) return null;
    return { state: "completed", claimedAt, completedAt, ...(value !== undefined ? { value } : {}) };
  }

  if (record.state === "failed_retryable") {
    const reason = record.reason;
    if (reason !== undefined && typeof reason !== "string") return null;
    const failedAt = record.failedAt;
    if (typeof failedAt !== "string" || Number.isNaN(Date.parse(failedAt))) return null;
    return { state: "failed_retryable", claimedAt, failedAt, ...(reason !== undefined ? { reason } : {}) };
  }

  return null;
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
    async get(key) {
      return client.get(key);
    },
    async compareAndSetState(key, expectedState, expectedOwnerToken, newValue, ttl) {
      const result = await client.eval(
        COMPARE_AND_SET_SCRIPT,
        1,
        key,
        expectedState,
        expectedOwnerToken ?? "",
        newValue,
        ttl === "keep" ? "keep" : String(ttl)
      );
      return Number(result) as CompareAndSetResult;
    },
  };
}

function resolveClient(override?: IdempotencyRedisClient | null): IdempotencyRedisClient | null {
  if (override !== undefined) return override;
  return wrapRealClient();
}

/**
 * Attempts to become the first writer for (scope, id). Atomic — a single
 * SET...NX, no GET-then-SET. On success, mints a fresh cryptographically
 * random ownerToken (never logged, never derived from content) and returns
 * it — the caller must hold onto it to later complete or fail this exact
 * claim. Throws synchronously (rejected promise) only for an invalid `id`,
 * via the centralized `idempotencyKey()` validation, independent of Redis
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

  const ownerToken = randomUUID();
  const record: PendingRecord = { state: "pending", ownerToken, claimedAt: new Date().toISOString() };

  try {
    const created = await client.setNX(key, JSON.stringify(record), REDIS_KEY_TTL_SECONDS.idempotency);
    return created ? { outcome: "claimed", ownerToken } : { outcome: "duplicate" };
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

/** Reads the current claim record for (scope, id), if any. Same invalid-id behavior as claimIdempotency. */
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
 * Transitions a PENDING claim to COMPLETED(value), but ONLY if `ownerToken`
 * matches the token this exact claim was created with — enforced atomically
 * by the compare-and-set script, not by a prior read. A stale/losing caller
 * (wrong token, or the record already left "pending") gets `owner_mismatch`
 * or `not_pending` and must not treat that as success.
 *
 * TTL is preserved (KEEPTTL) from the original claim — completing never
 * extends the dedup window past when the first request started.
 */
export async function completeIdempotency(
  scope: IdempotencyScope,
  id: string,
  ownerToken: string,
  value?: string,
  testClientOverride?: IdempotencyRedisClient | null
): Promise<IdempotencyCompleteOutcome> {
  const key = idempotencyKey(scope, id);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    // Preliminary, non-authoritative read: only to preserve the original
    // claimedAt in the completed record for observability. Safe because the
    // actual transition below is independently atomic and owner-checked —
    // if this read is stale by the time compareAndSetState runs, the CAS
    // simply fails closed (owner_mismatch/not_pending); it can never succeed
    // spuriously from stale data here.
    const existingRaw = await client.get(key);
    const existing = existingRaw ? parseRecord(existingRaw) : null;
    const claimedAt = existing && existing.state === "pending" ? existing.claimedAt : new Date().toISOString();

    const record: CompletedRecord = {
      state: "completed",
      claimedAt,
      completedAt: new Date().toISOString(),
      ...(value !== undefined ? { value } : {}),
    };

    const result = await client.compareAndSetState(
      key,
      "pending",
      ownerToken,
      JSON.stringify(record),
      "keep"
    );

    if (result === CAS_OK) return { outcome: "completed" };
    if (result === CAS_OWNER_MISMATCH) return { outcome: "owner_mismatch" };
    return { outcome: "not_pending" };
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

/**
 * Transitions a PENDING claim to FAILED_RETRYABLE, owner-checked exactly
 * like completeIdempotency. `reason` must be a short safe code (bounded
 * length, restricted charset) — never a raw error message, stack trace,
 * prompt, request body, or PII; invalid reasons throw rather than being
 * silently stored.
 *
 * CALLER RESPONSIBILITY, NOT ENFORCED HERE: this must only ever be called
 * when the failure happened BEFORE any ambiguous or irreversible external
 * side effect (e.g. before a provider was ever contacted). Never call this
 * after a provider submission may have occurred — an ambiguous submission
 * must be left "pending" (or handled by the same evidence-based machinery
 * generation_attempts already uses elsewhere), never marked retryable.
 */
export async function failIdempotency(
  scope: IdempotencyScope,
  id: string,
  ownerToken: string,
  reason?: string,
  testClientOverride?: IdempotencyRedisClient | null
): Promise<IdempotencyFailOutcome> {
  const key = idempotencyKey(scope, id);
  const safeReason = validateReason(reason);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    const existingRaw = await client.get(key);
    const existing = existingRaw ? parseRecord(existingRaw) : null;
    const claimedAt = existing && existing.state === "pending" ? existing.claimedAt : new Date().toISOString();

    const record: FailedRetryableRecord = {
      state: "failed_retryable",
      claimedAt,
      failedAt: new Date().toISOString(),
      ...(safeReason !== undefined ? { reason: safeReason } : {}),
    };

    const result = await client.compareAndSetState(
      key,
      "pending",
      ownerToken,
      JSON.stringify(record),
      "keep"
    );

    if (result === CAS_OK) return { outcome: "failed_retryable" };
    if (result === CAS_OWNER_MISMATCH) return { outcome: "owner_mismatch" };
    return { outcome: "not_pending" };
  } catch (caught) {
    log({
      scope,
      op: "fail",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}

/**
 * Reclaims a FAILED_RETRYABLE identity back to PENDING with a brand new
 * ownerToken, for a legitimate retry of the same request intent. No owner
 * check — the previous owner already failed and gave up its claim — only a
 * state check (must currently be "failed_retryable"), enforced by the same
 * atomic compare-and-set script. If N callers race to reclaim the same
 * identity, exactly one observes "failed_retryable" and wins; every other
 * one observes the winner's new "pending" state and is rejected.
 *
 * A fresh, full TTL window is granted on reclaim (not KEEPTTL) — a retry is
 * a new attempt at the same intent and deserves its own full dedup window,
 * not whatever time happened to remain on the original claim.
 *
 * COMPLETED can never be reclaimed: the compare-and-set only matches when
 * the current state is exactly "failed_retryable".
 */
export async function retryIdempotency(
  scope: IdempotencyScope,
  id: string,
  testClientOverride?: IdempotencyRedisClient | null
): Promise<IdempotencyRetryOutcome> {
  const key = idempotencyKey(scope, id);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  const ownerToken = randomUUID();
  const record: PendingRecord = { state: "pending", ownerToken, claimedAt: new Date().toISOString() };

  try {
    const result = await client.compareAndSetState(
      key,
      "failed_retryable",
      null,
      JSON.stringify(record),
      REDIS_KEY_TTL_SECONDS.idempotency
    );

    if (result === CAS_OK) return { outcome: "claimed", ownerToken };
    return { outcome: "not_failed_retryable" };
  } catch (caught) {
    log({
      scope,
      op: "retry",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}
