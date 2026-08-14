import "server-only";
import {
  acquireLock,
  releaseLock,
  type DistributedLockRedisClient,
} from "@/lib/redis/distributed-lock";
import { encodeKeySegment } from "@/lib/redis/redis-keys";
import { createFieldLogger } from "@/lib/observability/logger";

/**
 * Single-flight admission for a HALF_OPEN circuit breaker (Phase 7-C fix).
 *
 * THE DEFECT THIS EXISTS TO CLOSE
 * The breaker's in-flight counter lived inside the breaker record, and the
 * record was updated read-modify-write: GET, mutate in memory, SET. Two
 * workers reaching a cooled-down breaker at the same time both read
 * `halfOpenInFlight: 0`, both concluded there was a slot free, and both sent
 * a request to a provider that had just been failing. The counter was also
 * never incremented from the routing path at all, so in practice HALF_OPEN
 * admitted every waiting request at once — precisely the thundering herd the
 * bound was supposed to prevent, aimed at a provider mid-recovery.
 *
 * A counter cannot fix that, however carefully it is written. Any
 * read-then-write across a network round trip has a window. The admission
 * decision has to BE the atomic operation, which is what `SET key value EX
 * ttl NX` gives: exactly one caller creates the key, everybody else is told
 * the slot is taken, and the answer is decided inside Redis.
 *
 * REUSES THE EXISTING LOCK. `distributed-lock.ts` already implements SET NX
 * with a TTL and a Lua compare-and-delete release. Writing a second one here
 * would be a second implementation of the hardest part of this file.
 *
 * FAILS CLOSED. Unreachable Redis means no probe is granted. That is the safe
 * direction and it costs nothing: this path is only reached after a breaker
 * record was successfully READ as OPEN-and-cooled-down, so Redis was up a
 * moment ago. A route whose probe cannot be coordinated simply stays excluded
 * until its breaker record expires, at which point it is CLOSED again.
 *
 * NOT A GENERATION LOCK. Losing this lease loses nothing: the generation is
 * owned by Temporal and stored in PostgreSQL. The worst case of a lost lease
 * is one extra request to a recovering provider, and the worst case of a
 * stranded lease is one cooldown of delay — which is why the TTL is short and
 * a dead worker cannot deadlock the route.
 */

/** Namespaced under the shared lock keyspace: `cinefield:v1:lock:...`. */
const PROBE_RESOURCE_TYPE = "breaker-probe";

/**
 * How long one probe may hold the slot.
 *
 * Long enough to cover a slow provider call, short enough that a worker that
 * dies mid-probe costs one interval rather than an outage. Deliberately
 * shorter than the breaker cooldown, so a crashed probe cannot keep a route
 * out of rotation longer than the breaker itself would have.
 */
export const PROBE_LEASE_TTL_SECONDS = 30;

export type ProbeAdmission =
  /** This caller owns the recovery probe. It must release the token. */
  | { granted: true; ownerToken: string }
  /** Another caller holds it, or Redis could not answer. Do not send traffic. */
  | { granted: false; reason: "busy" | "unavailable" };

/**
 * Phase 13-E: delegates to the Sensitive Data Guard.
 *
 * The call sites below are unchanged — the difference is that every field
 * now passes the telemetry allow-list before it reaches console or any
 * future sink. An unknown or unsafe field is dropped, not printed.
 */
const emit = createFieldLogger("half-open-probe");

function log(fields: Record<string, unknown>): void {
  emit(fields);
}

function resourceIdFor(providerId: string, providerModelId: string): string {
  // Scoped per provider MODEL, matching the breaker itself: one endpoint
  // recovering must not consume another endpoint's probe slot.
  return `${encodeKeySegment(providerId)}-${encodeKeySegment(providerModelId)}`;
}

/**
 * Attempts to claim the single recovery probe for this provider model.
 *
 * Exactly one concurrent caller can succeed, because exactly one `SET NX`
 * can create the key.
 */
export async function tryAcquireProbe(
  providerId: string,
  providerModelId: string,
  testClientOverride?: DistributedLockRedisClient | null
): Promise<ProbeAdmission> {
  const outcome = await acquireLock(
    PROBE_RESOURCE_TYPE,
    resourceIdFor(providerId, providerModelId),
    PROBE_LEASE_TTL_SECONDS,
    testClientOverride
  );

  if (outcome.outcome === "acquired") {
    log({ providerId, providerModelId, result: "probe_granted" });
    return { granted: true, ownerToken: outcome.ownerToken };
  }

  log({ providerId, providerModelId, result: `probe_${outcome.outcome}` });
  return { granted: false, reason: outcome.outcome === "busy" ? "busy" : "unavailable" };
}

/**
 * Releases the probe slot.
 *
 * Compare-and-delete, so a caller whose lease already expired and was
 * reacquired by someone else cannot delete the new holder's slot. Best-effort
 * by design: if the release is lost the TTL reclaims it.
 */
export async function releaseProbe(
  providerId: string,
  providerModelId: string,
  ownerToken: string,
  testClientOverride?: DistributedLockRedisClient | null
): Promise<void> {
  const outcome = await releaseLock(
    PROBE_RESOURCE_TYPE,
    resourceIdFor(providerId, providerModelId),
    ownerToken,
    testClientOverride
  );
  if (outcome.outcome === "not_owner") {
    // The lease expired and someone else is probing now. Nothing to do, but
    // worth recording: it means a probe outlived its TTL.
    log({ providerId, providerModelId, result: "probe_release_not_owner" });
  }
}
