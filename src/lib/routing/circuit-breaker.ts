/**
 * Provider-model circuit breaker — pure state policy (Phase 7-C).
 *
 * WHAT A BREAKER IS FOR HERE
 * Not retry. Temporal owns retry. This exists so that when a provider model
 * is failing, Cinefield stops CHOOSING it — the routing decision changes,
 * rather than the same doomed destination being attempted again with a longer
 * sleep in front of it.
 *
 * STATES
 *   CLOSED     normal. Qualifying failures accumulate; enough of them open it.
 *   OPEN       excluded from selection until the cooldown elapses.
 *   HALF_OPEN  cooldown elapsed. A limited amount of REAL traffic is allowed
 *              through as recovery evidence.
 *
 * NO SYNTHETIC PROBES. A half-open breaker is not tested by sending the
 * provider a request Cinefield invented — that request would be billable, and
 * paying to ask "are you better yet?" every thirty seconds is a way to spend
 * real money on an outage. Recovery evidence is ordinary user traffic that was
 * going to be sent anyway.
 *
 * PURE. Every function here maps (state, event, now) to a new state. No Redis,
 * no clock, no I/O — `now` is always passed in, which is what makes the
 * transitions exhaustively testable and keeps the policy identical whether it
 * runs in a request, a worker, or a test.
 */

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerRecord {
  state: BreakerState;
  /** Qualifying consecutive failures observed while CLOSED. */
  consecutiveFailures: number;
  /** ISO-8601 of the most recent qualifying failure. */
  lastFailureAt?: string;
  /** ISO-8601 of the most recent success. */
  lastSuccessAt?: string;
  /** ISO-8601 the breaker entered OPEN. Cooldown is measured from here. */
  openedAt?: string;
  /** Successes observed since entering HALF_OPEN. */
  halfOpenSuccesses: number;
  /** ISO-8601 of the last write. Freshness is judged against this. */
  updatedAt: string;
}

export interface CircuitBreakerPolicy {
  /** Qualifying consecutive failures that open a CLOSED breaker. */
  failureThreshold: number;
  /** How long OPEN lasts before trial traffic is allowed. */
  cooldownSeconds: number;
  /** Successes needed in HALF_OPEN to close it. */
  successThreshold: number;
}

/**
 * Deliberately conservative in both directions.
 *
 * Three failures rather than one: a single 5xx is noise, and opening on it
 * would make routing thrash on a provider that is fine. Sixty seconds rather
 * than five minutes: an OPEN breaker is a self-inflicted capacity reduction,
 * so it should expire quickly and be re-earned. Two successes to close: a
 * single lucky response during a partial outage should not reopen the
 * floodgates.
 *
 * How MANY concurrent trials HALF_OPEN allows is not configured here — it is
 * one, structurally, because the probe is a single Redis key.
 */
export const DEFAULT_BREAKER_POLICY: CircuitBreakerPolicy = {
  failureThreshold: 3,
  cooldownSeconds: 60,
  successThreshold: 2,
};

export function initialBreakerRecord(nowIso: string): CircuitBreakerRecord {
  return {
    state: "CLOSED",
    consecutiveFailures: 0,
    halfOpenSuccesses: 0,
    updatedAt: nowIso,
  };
}

/**
 * The state a breaker is EFFECTIVELY in right now.
 *
 * Stored state and effective state differ for exactly one reason: an OPEN
 * breaker becomes HALF_OPEN by the passage of time, not by anyone writing to
 * it. Computing that on read means a breaker recovers even if no process ever
 * touches it again, instead of staying open forever because the thing that
 * would have reset it was the traffic it was blocking.
 */
export function effectiveBreakerState(
  record: CircuitBreakerRecord,
  now: Date,
  policy: CircuitBreakerPolicy = DEFAULT_BREAKER_POLICY
): BreakerState {
  if (record.state !== "OPEN") return record.state;
  if (!record.openedAt) return "OPEN";

  const openedAt = Date.parse(record.openedAt);
  if (!Number.isFinite(openedAt)) return "OPEN";

  const elapsedSeconds = (now.getTime() - openedAt) / 1000;
  return elapsedSeconds >= policy.cooldownSeconds ? "HALF_OPEN" : "OPEN";
}

/**
 * May a route in this breaker state be selected AT ALL?
 *
 * Three-valued on purpose. CLOSED admits, OPEN excludes, and HALF_OPEN is
 * "maybe — ask the probe lease", because whether a trial slot is free is not
 * something this record can answer.
 *
 * IT USED TO TRY, AND THAT WAS A BUG. An in-flight counter inside the record
 * is read, mutated and written back across a network round trip, so two
 * workers both read zero and both proceed. The bound has to be enforced by an
 * atomic operation, which is what half-open-probe.ts does with SET NX. This
 * function therefore reports the state and stops short of the decision.
 */
export type TrafficAdmission = "admit" | "deny" | "probe_required";

export function admissionFor(
  record: CircuitBreakerRecord,
  now: Date,
  policy: CircuitBreakerPolicy = DEFAULT_BREAKER_POLICY
): TrafficAdmission {
  const state = effectiveBreakerState(record, now, policy);
  if (state === "CLOSED") return "admit";
  if (state === "OPEN") return "deny";
  return "probe_required";
}

/**
 * A qualifying provider failure.
 *
 * The caller decides what "qualifying" means — see failure-classification.ts.
 * By the time a failure reaches this function it has already been judged to
 * be the provider's fault; this only counts it.
 */
export function recordFailure(
  record: CircuitBreakerRecord,
  now: Date,
  policy: CircuitBreakerPolicy = DEFAULT_BREAKER_POLICY
): CircuitBreakerRecord {
  const nowIso = now.toISOString();
  const state = effectiveBreakerState(record, now, policy);

  // A failed trial reopens immediately, and the cooldown restarts from now.
  // Counting toward the threshold instead would let a provider that fails
  // every single trial creep back toward CLOSED.
  if (state === "HALF_OPEN") {
    return {
      ...record,
      state: "OPEN",
      openedAt: nowIso,
      lastFailureAt: nowIso,
      halfOpenSuccesses: 0,
      updatedAt: nowIso,
    };
  }

  if (state === "OPEN") {
    return { ...record, lastFailureAt: nowIso, updatedAt: nowIso };
  }

  const consecutiveFailures = record.consecutiveFailures + 1;
  if (consecutiveFailures >= policy.failureThreshold) {
    return {
      ...record,
      state: "OPEN",
      openedAt: nowIso,
      consecutiveFailures,
      lastFailureAt: nowIso,
      halfOpenSuccesses: 0,
      updatedAt: nowIso,
    };
  }

  return { ...record, consecutiveFailures, lastFailureAt: nowIso, updatedAt: nowIso };
}

/** A successful provider execution. */
export function recordSuccess(
  record: CircuitBreakerRecord,
  now: Date,
  policy: CircuitBreakerPolicy = DEFAULT_BREAKER_POLICY
): CircuitBreakerRecord {
  const nowIso = now.toISOString();
  const state = effectiveBreakerState(record, now, policy);

  if (state === "HALF_OPEN") {
    const halfOpenSuccesses = record.halfOpenSuccesses + 1;

    if (halfOpenSuccesses >= policy.successThreshold) {
      return {
        state: "CLOSED",
        consecutiveFailures: 0,
        halfOpenSuccesses: 0,
        lastSuccessAt: nowIso,
        lastFailureAt: record.lastFailureAt,
        updatedAt: nowIso,
      };
    }

    return {
      ...record,
      state: "HALF_OPEN",
      halfOpenSuccesses,
      lastSuccessAt: nowIso,
      updatedAt: nowIso,
    };
  }

  // A success while OPEN is not impossible — an in-flight request from before
  // the breaker tripped can land late. It is not recovery evidence, because
  // it was never a trial, so it clears nothing.
  if (state === "OPEN") {
    return { ...record, lastSuccessAt: nowIso, updatedAt: nowIso };
  }

  return {
    ...record,
    state: "CLOSED",
    consecutiveFailures: 0,
    lastSuccessAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Is this record recent enough to act on?
 *
 * Stale breaker state is not authority. If the last write is older than the
 * freshness window, the caller treats the breaker as unknown rather than
 * trusting a verdict formed during an incident that may be long over.
 */
export function isBreakerFresh(
  record: CircuitBreakerRecord,
  now: Date,
  freshnessSeconds: number
): boolean {
  const updatedAt = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  return (now.getTime() - updatedAt) / 1000 <= freshnessSeconds;
}
