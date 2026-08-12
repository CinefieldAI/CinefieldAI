import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEFAULT_BREAKER_POLICY,
  admitsTraffic,
  effectiveBreakerState,
  initialBreakerRecord,
  isBreakerFresh,
  recordFailure,
  recordSuccess,
  reserveHalfOpenSlot,
  type CircuitBreakerRecord,
} from "@/lib/routing/circuit-breaker";
import {
  classifyFailure,
  countsAgainstProvider,
  isProviderAttributableError,
} from "@/lib/routing/failure-classification";
import {
  DEFAULT_HEALTH_POLICY,
  normalizeHealth,
  scoreRoute,
  unknownHealth,
  type RouteHealth,
} from "@/lib/routing/route-health";
import {
  healthKeyFor,
  selectHealthyRoute,
  type HealthSnapshot,
} from "@/lib/routing/health-aware-router";
import { decideFailover, DEFAULT_MAX_ATTEMPTS } from "@/lib/routing/failover-policy";
import { selectRoute } from "@/lib/routing/model-router";
import type { RouteCandidate } from "@/lib/routing/route-types";
import {
  __setCircuitBreakerClientForTesting,
  getBreaker,
  parseBreakerRecord,
  setBreaker,
  transitionBreaker,
  type CircuitBreakerRedisClient,
} from "@/lib/redis/circuit-breaker-store";
import { circuitBreakerKey, encodeKeySegment } from "@/lib/redis/redis-keys";

/**
 * PHASE 7-C — health-aware routing, circuit breaker, safe failover.
 *
 * The properties worth proving here are not "the code runs" but:
 *   with no health data, routing is EXACTLY Phase 7-B,
 *   health can only ever subtract from eligibility, never add to it,
 *   a breaker never opens on a failure that was not the provider's,
 *   and an ambiguous submission never becomes a second provider execution.
 *
 * Zero cost. No provider is contacted, no Redis is connected — the store's
 * own injectable client seam supplies an in-memory map, and every clock is
 * passed in.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const T0 = new Date("2026-08-12T10:00:00.000Z");
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

let counter = 0;
function candidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  counter += 1;
  return {
    routeId: `route-${String(counter).padStart(4, "0")}`,
    cinefieldModelId: "model-a",
    modelVersionId: `version-${counter}`,
    modelVersion: 1,
    providerId: "mock",
    providerModelId: `pm-${String(counter).padStart(4, "0")}`,
    priority: 100,
    enabled: true,
    routeStatus: "active",
    providerEnabled: true,
    providerModelEnabled: true,
    modelLifecycle: "active",
    modelVersionStatus: "active",
    ...overrides,
  };
}

function healthFor(
  candidateRoute: RouteCandidate,
  overrides: Partial<RouteHealth> = {}
): [string, RouteHealth] {
  return [
    healthKeyFor(candidateRoute.providerId, candidateRoute.providerModelId),
    {
      providerId: candidateRoute.providerId,
      providerModelId: candidateRoute.providerModelId,
      breakerState: "CLOSED",
      admitsTraffic: true,
      sampleCount: 50,
      consecutiveFailures: 0,
      observedAt: T0.toISOString(),
      confidence: "observed",
      telemetryUnavailable: false,
      ...overrides,
    },
  ];
}

const NO_HEALTH: HealthSnapshot = new Map();

// ---------------------------------------------------------------------------
// Static compatibility — 7-C must not change 7-B when it knows nothing
// ---------------------------------------------------------------------------

test("with no health data at all, routing matches the static router exactly", () => {
  const candidates = [
    candidate({ priority: 100 }),
    candidate({ priority: 700 }),
    candidate({ priority: 300 }),
  ];

  const staticResult = selectRoute("model-a", candidates);
  const healthResult = selectHealthyRoute("model-a", candidates, NO_HEALTH, T0);

  assert.equal(staticResult.outcome, "selected");
  assert.equal(healthResult.outcome, "selected");
  if (staticResult.outcome !== "selected" || healthResult.outcome !== "selected") return;
  assert.equal(healthResult.selection.routeId, staticResult.selection.routeId);
  assert.equal(healthResult.selection.providerId, staticResult.selection.providerId);
});

test("health-aware selection is deterministic across repeats and shuffles", () => {
  const a = candidate({ priority: 500, providerModelId: "pm-a" });
  const b = candidate({ priority: 500, providerModelId: "pm-b" });
  const c = candidate({ priority: 500, providerModelId: "pm-c" });
  const health: HealthSnapshot = new Map([healthFor(a), healthFor(b), healthFor(c)]);

  const first = selectHealthyRoute("model-a", [a, b, c], health, T0);
  assert.equal(first.outcome, "selected");
  if (first.outcome !== "selected") return;

  for (let i = 0; i < 100; i += 1) {
    const again = selectHealthyRoute("model-a", [a, b, c], health, T0);
    assert.equal(again.outcome, "selected");
    if (again.outcome === "selected") {
      assert.equal(again.selection.routeId, first.selection.routeId);
    }
  }

  for (const ordering of [
    [c, b, a],
    [b, a, c],
    [c, a, b],
  ]) {
    const shuffled = selectHealthyRoute("model-a", ordering, health, T0);
    assert.equal(shuffled.outcome, "selected");
    if (shuffled.outcome === "selected") {
      assert.equal(
        shuffled.selection.routeId,
        first.selection.routeId,
        "candidate order changed the winner"
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Health influence
// ---------------------------------------------------------------------------

test("a healthy route beats an equally-prioritized unhealthy one", () => {
  const healthy = candidate({ priority: 100, providerModelId: "pm-zzz" });
  const sick = candidate({ priority: 100, providerModelId: "pm-aaa" });

  // Note the tie-break would pick `sick` on provider model id alone. Health
  // has to be what overturns that, or this test proves nothing.
  const health: HealthSnapshot = new Map([
    healthFor(healthy, { errorRate: 0.0 }),
    healthFor(sick, { errorRate: 0.8 }),
  ]);

  const result = selectHealthyRoute("model-a", [sick, healthy], health, T0);
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, healthy.routeId);
  assert.match(result.selection.selectionReason, /^health_weighted_priority_/);
});

test("latency breaks a tie between otherwise comparable routes", () => {
  const fast = candidate({ priority: 100, providerModelId: "pm-zzz" });
  const slow = candidate({ priority: 100, providerModelId: "pm-aaa" });

  const health: HealthSnapshot = new Map([
    healthFor(fast, { errorRate: 0, averageLatencyMs: 1_000 }),
    healthFor(slow, { errorRate: 0, averageLatencyMs: 100_000 }),
  ]);

  const result = selectHealthyRoute("model-a", [slow, fast], health, T0);
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, fast.routeId);
});

test("static priority still dominates a modest health difference", () => {
  // An operator who sets priority 900 means it. One slow response must not
  // silently overrule the configuration.
  const preferred = candidate({ priority: 900 });
  const backup = candidate({ priority: 100 });
  const health: HealthSnapshot = new Map([
    healthFor(preferred, { errorRate: 0.2, averageLatencyMs: 30_000 }),
    healthFor(backup, { errorRate: 0, averageLatencyMs: 500 }),
  ]);

  const result = selectHealthyRoute("model-a", [backup, preferred], health, T0);
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, preferred.routeId);
});

test("eligibility beats every score: a disabled route can never win", () => {
  const disabledButPerfect = candidate({ priority: 10_000, enabled: false });
  const enabledButWorse = candidate({ priority: 1 });

  const health: HealthSnapshot = new Map([
    healthFor(disabledButPerfect, { errorRate: 0, averageLatencyMs: 1 }),
    healthFor(enabledButWorse, { errorRate: 0.9, averageLatencyMs: 100_000 }),
  ]);

  const result = selectHealthyRoute(
    "model-a",
    [disabledButPerfect, enabledButWorse],
    health,
    T0
  );
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, enabledButWorse.routeId);

  const rejected = result.decision.evaluations.find(
    (e) => e.routeId === disabledButPerfect.routeId
  );
  assert.equal(rejected?.rejection, "route_disabled");
  assert.equal(rejected?.eligible, false);
});

test("an unregistered provider stays unusable however healthy it looks", () => {
  const ghost = candidate({ priority: 9_000, providerId: "provider-that-does-not-ship" });
  const health: HealthSnapshot = new Map([healthFor(ghost, { errorRate: 0 })]);

  const result = selectHealthyRoute("model-a", [ghost], health, T0);
  assert.equal(result.outcome, "no_eligible_route");
  if (result.outcome !== "no_eligible_route") return;
  assert.equal(result.decision.evaluations[0].rejection, "provider_not_registered");
});

// ---------------------------------------------------------------------------
// Breaker exclusion and the no_healthy_route outcome
// ---------------------------------------------------------------------------

test("an open breaker excludes its route", () => {
  const open = candidate({ priority: 900 });
  const spare = candidate({ priority: 100 });
  const health: HealthSnapshot = new Map([
    healthFor(open, { breakerState: "OPEN", admitsTraffic: false }),
    healthFor(spare),
  ]);

  const result = selectHealthyRoute("model-a", [open, spare], health, T0);
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, spare.routeId);
  assert.equal(
    result.decision.evaluations.find((e) => e.routeId === open.routeId)?.rejection,
    "circuit_open"
  );
});

test("every route open is no_healthy_route, NOT no_eligible_route", () => {
  // The distinction is the operator's whole diagnosis: nothing is
  // misconfigured, a provider is failing.
  const one = candidate();
  const two = candidate();
  const health: HealthSnapshot = new Map([
    healthFor(one, { breakerState: "OPEN", admitsTraffic: false }),
    healthFor(two, { breakerState: "OPEN", admitsTraffic: false }),
  ]);

  const result = selectHealthyRoute("model-a", [one, two], health, T0);
  assert.equal(result.outcome, "no_healthy_route");
});

test("no candidates at all is still no_eligible_route", () => {
  assert.equal(selectHealthyRoute("model-a", [], NO_HEALTH, T0).outcome, "no_eligible_route");
  const disabled = candidate({ enabled: false });
  assert.equal(
    selectHealthyRoute("model-a", [disabled], NO_HEALTH, T0).outcome,
    "no_eligible_route"
  );
});

test("an already-attempted route is excluded from a failover selection", () => {
  const first = candidate({ priority: 900 });
  const second = candidate({ priority: 100 });
  const health: HealthSnapshot = new Map([healthFor(first), healthFor(second)]);

  const result = selectHealthyRoute("model-a", [first, second], health, T0, {
    excludeRouteIds: [first.routeId],
  });
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, second.routeId);
  assert.equal(
    result.decision.evaluations.find((e) => e.routeId === first.routeId)?.rejection,
    "already_attempted"
  );
});

// ---------------------------------------------------------------------------
// Unknown health / Redis unavailable
// ---------------------------------------------------------------------------

test("unknown health is neither healthy nor unhealthy — it is selectable and slightly penalized", () => {
  const known = candidate({ priority: 100, providerModelId: "pm-zzz" });
  const unknown = candidate({ priority: 100, providerModelId: "pm-aaa" });

  const health: HealthSnapshot = new Map([
    healthFor(known, { errorRate: 0, averageLatencyMs: 100 }),
    [
      healthKeyFor(unknown.providerId, unknown.providerModelId),
      unknownHealth(unknown.providerId, unknown.providerModelId, T0, true),
    ],
  ]);

  const result = selectHealthyRoute("model-a", [unknown, known], health, T0);
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, known.routeId, "known-good should beat unmeasured");

  // But unmeasured must still be selectable on its own, or a cold Redis takes
  // the platform down.
  const alone = selectHealthyRoute("model-a", [unknown], health, T0);
  assert.equal(alone.outcome, "selected");
});

test("with telemetry entirely unavailable, routing degrades to static priority", () => {
  const low = candidate({ priority: 100 });
  const high = candidate({ priority: 800 });
  const mid = candidate({ priority: 400 });

  // Every route unknown — exactly what an unreachable Redis produces.
  const result = selectHealthyRoute("model-a", [low, high, mid], NO_HEALTH, T0);
  const staticResult = selectRoute("model-a", [low, high, mid]);
  assert.equal(result.outcome, "selected");
  assert.equal(staticResult.outcome, "selected");
  if (result.outcome !== "selected" || staticResult.outcome !== "selected") return;
  assert.equal(result.selection.routeId, staticResult.selection.routeId);
  assert.equal(result.selection.routeId, high.routeId);
});

test("a missing health entry is never treated as healthy-with-data", () => {
  const health = unknownHealth("mock", "pm-1", T0, true);
  assert.equal(health.confidence, "unknown");
  assert.equal(health.errorRate, undefined, "must not fabricate an error rate");
  assert.equal(health.averageLatencyMs, undefined, "must not fabricate a latency");
  assert.equal(health.sampleCount, 0);
});

// ---------------------------------------------------------------------------
// Circuit breaker state machine
// ---------------------------------------------------------------------------

test("CLOSED admits traffic and opens only at the threshold", () => {
  let record = initialBreakerRecord(T0.toISOString());
  assert.equal(record.state, "CLOSED");
  assert.equal(admitsTraffic(record, T0), true);

  for (let i = 1; i < DEFAULT_BREAKER_POLICY.failureThreshold; i += 1) {
    record = recordFailure(record, later(i));
    assert.equal(record.state, "CLOSED", `must not open at ${i} failures`);
    assert.equal(admitsTraffic(record, later(i)), true);
  }

  record = recordFailure(record, later(DEFAULT_BREAKER_POLICY.failureThreshold));
  assert.equal(record.state, "OPEN");
  assert.equal(admitsTraffic(record, later(DEFAULT_BREAKER_POLICY.failureThreshold)), false);
});

test("a success resets the failure count before the threshold is reached", () => {
  let record = initialBreakerRecord(T0.toISOString());
  record = recordFailure(record, later(1));
  record = recordFailure(record, later(2));
  record = recordSuccess(record, later(3));
  assert.equal(record.consecutiveFailures, 0);

  record = recordFailure(record, later(4));
  record = recordFailure(record, later(5));
  assert.equal(record.state, "CLOSED", "the counter must have restarted");
});

test("OPEN becomes HALF_OPEN when the cooldown elapses, and not before", () => {
  let record = initialBreakerRecord(T0.toISOString());
  for (let i = 0; i < DEFAULT_BREAKER_POLICY.failureThreshold; i += 1) {
    record = recordFailure(record, later(i));
  }
  assert.equal(record.state, "OPEN");

  const openedAt = DEFAULT_BREAKER_POLICY.failureThreshold - 1;
  const justBefore = later(openedAt + DEFAULT_BREAKER_POLICY.cooldownSeconds - 1);
  assert.equal(effectiveBreakerState(record, justBefore), "OPEN");
  assert.equal(admitsTraffic(record, justBefore), false);

  const justAfter = later(openedAt + DEFAULT_BREAKER_POLICY.cooldownSeconds + 1);
  assert.equal(effectiveBreakerState(record, justAfter), "HALF_OPEN");
  assert.equal(admitsTraffic(record, justAfter), true);
});

test("HALF_OPEN admits only a bounded number of trial executions", () => {
  let record = initialBreakerRecord(T0.toISOString());
  for (let i = 0; i < DEFAULT_BREAKER_POLICY.failureThreshold; i += 1) {
    record = recordFailure(record, later(i));
  }
  const trialTime = later(
    DEFAULT_BREAKER_POLICY.failureThreshold + DEFAULT_BREAKER_POLICY.cooldownSeconds
  );

  for (let i = 0; i < DEFAULT_BREAKER_POLICY.halfOpenMaxInFlight; i += 1) {
    assert.equal(admitsTraffic(record, trialTime), true);
    record = reserveHalfOpenSlot(record, trialTime);
  }
  assert.equal(
    admitsTraffic(record, trialTime),
    false,
    "a recovering provider must not receive the whole backlog at once"
  );
});

test("enough successful trials close the breaker; one failed trial reopens it", () => {
  let record = initialBreakerRecord(T0.toISOString());
  for (let i = 0; i < DEFAULT_BREAKER_POLICY.failureThreshold; i += 1) {
    record = recordFailure(record, later(i));
  }
  const trialTime = later(
    DEFAULT_BREAKER_POLICY.failureThreshold + DEFAULT_BREAKER_POLICY.cooldownSeconds
  );

  record = reserveHalfOpenSlot(record, trialTime);
  record = recordSuccess(record, trialTime);
  assert.equal(record.state, "HALF_OPEN", "one success must not be enough");

  record = recordSuccess(
    record,
    later(DEFAULT_BREAKER_POLICY.failureThreshold + DEFAULT_BREAKER_POLICY.cooldownSeconds + 1)
  );
  assert.equal(record.state, "CLOSED");
  assert.equal(record.consecutiveFailures, 0);

  // And the reopen path, from a fresh HALF_OPEN.
  let reopening = initialBreakerRecord(T0.toISOString());
  for (let i = 0; i < DEFAULT_BREAKER_POLICY.failureThreshold; i += 1) {
    reopening = recordFailure(reopening, later(i));
  }
  const secondTrial = later(
    DEFAULT_BREAKER_POLICY.failureThreshold + DEFAULT_BREAKER_POLICY.cooldownSeconds
  );
  assert.equal(effectiveBreakerState(reopening, secondTrial), "HALF_OPEN");
  reopening = recordFailure(reopening, secondTrial);
  assert.equal(reopening.state, "OPEN");
  assert.equal(
    effectiveBreakerState(
      reopening,
      later(DEFAULT_BREAKER_POLICY.failureThreshold + DEFAULT_BREAKER_POLICY.cooldownSeconds + 1)
    ),
    "OPEN",
    "the cooldown must restart from the failed trial"
  );
});

test("a stale breaker record stops being authoritative", () => {
  let record = initialBreakerRecord(T0.toISOString());
  for (let i = 0; i < DEFAULT_BREAKER_POLICY.failureThreshold; i += 1) {
    record = recordFailure(record, later(i));
  }
  assert.equal(record.state, "OPEN");

  const wayLater = later(DEFAULT_HEALTH_POLICY.breakerFreshnessSeconds + 60);
  assert.equal(isBreakerFresh(record, wayLater, DEFAULT_HEALTH_POLICY.breakerFreshnessSeconds), false);

  const normalized = normalizeHealth(
    {
      providerId: "mock",
      providerModelId: "pm-1",
      breaker: record,
      errorRate: null,
      latency: null,
      telemetryUnavailable: false,
    },
    wayLater
  );
  assert.equal(normalized.breakerState, "CLOSED", "a stale OPEN must not exclude a route forever");
  assert.equal(normalized.admitsTraffic, true);
});

test("no synthetic provider traffic is generated to probe health", () => {
  // Recovery evidence is ordinary user traffic. A probe would be a billable
  // request Cinefield invented, which is a way to spend money on an outage.
  for (const file of [
    "src/lib/routing/circuit-breaker.ts",
    "src/lib/routing/health-aware-router.ts",
    "src/lib/routing/health-recorder.ts",
    "src/lib/redis/circuit-breaker-store.ts",
  ]) {
    const source = readSource(file);
    assert.ok(!/adapter\.submit\(/.test(source), `${file} must not submit to a provider`);
    assert.ok(!/getProviderAdapter\(/.test(source), `${file} must not resolve a provider adapter`);
    assert.ok(!/\bfetch\(/.test(source), `${file} must not make a network call`);
  }
});

// ---------------------------------------------------------------------------
// Failure classification — what may and may not open a breaker
// ---------------------------------------------------------------------------

test("provider failures are attributable; local ones are not", () => {
  for (const code of [
    "PROVIDER_RATE_LIMIT",
    "PROVIDER_TIMEOUT",
    "PROVIDER_FAILED",
    "PROVIDER_NOT_CONFIGURED",
  ]) {
    assert.equal(isProviderAttributableError(code), true, `${code} should count`);
  }

  for (const code of [
    "CAPABILITY_NOT_SUPPORTED",
    "INVALID_INPUT",
    "UNSUPPORTED_WORKFLOW",
    "REQUIRED_INPUT_MISSING",
    "UNKNOWN_MODEL",
    "AUTH_REQUIRED",
    "FORBIDDEN",
    "DATABASE_UPDATE_FAILED",
    "STORAGE_UPLOAD_FAILED",
    "INTERNAL_ERROR",
  ]) {
    assert.equal(
      isProviderAttributableError(code),
      false,
      `${code} must never open a provider breaker`
    );
  }
});

test("user cancellation never poisons provider health", () => {
  assert.equal(countsAgainstProvider("user_cancellation"), false);
});

test("an unconfirmed submission is not breaker evidence", () => {
  // It may have succeeded entirely and only the acknowledgement was lost.
  assert.equal(classifyFailure("PROVIDER_SUBMISSION_UNKNOWN"), "unknown");
  assert.equal(isProviderAttributableError("PROVIDER_SUBMISSION_UNKNOWN"), false);
});

test("an unknown or missing error code does not open a breaker", () => {
  assert.equal(isProviderAttributableError(undefined), false);
  assert.equal(isProviderAttributableError("SOMETHING_NOBODY_MAPPED"), false);
});

test("auth and quota errors are provider rejections, not provider outages", () => {
  // They will not heal after a cooldown, so a breaker would flap forever
  // while the real fix is an operator updating a credential.
  assert.equal(classifyFailure("PROVIDER_AUTH_ERROR"), "provider_rejection");
  assert.equal(classifyFailure("PROVIDER_QUOTA_EXCEEDED"), "provider_rejection");
  assert.equal(isProviderAttributableError("PROVIDER_AUTH_ERROR"), false);
});

// ---------------------------------------------------------------------------
// Safe failover — AMBIGUOUS != SAFE TO RETRY
// ---------------------------------------------------------------------------

const baseAttempt = {
  submission_evidence: "none" as const,
  provider_job_id: null,
  status: "failed" as const,
};

test("a provably unsubmitted failure may fail over", () => {
  const decision = decideFailover({
    attempt: baseAttempt,
    errorCode: "PROVIDER_NOT_CONFIGURED",
    isMockProvider: false,
    attemptCount: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    alternativeRoutesAvailable: 1,
  });
  assert.equal(decision.decision, "safe_to_failover");
});

test("an AMBIGUOUS submission never fails over", () => {
  const decision = decideFailover({
    attempt: { ...baseAttempt, submission_evidence: "ambiguous" },
    errorCode: "PROVIDER_TIMEOUT",
    isMockProvider: false,
    attemptCount: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    alternativeRoutesAvailable: 5,
  });
  assert.equal(decision.decision, "reconciliation_required");
  assert.equal(decision.reason, "evidence_ambiguous");
});

test("a captured provider job never fails over", () => {
  for (const attempt of [
    { ...baseAttempt, provider_job_id: "job_123" },
    { ...baseAttempt, submission_evidence: "job" as const },
  ]) {
    const decision = decideFailover({
      attempt,
      errorCode: "PROVIDER_FAILED",
      isMockProvider: false,
      attemptCount: 1,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      alternativeRoutesAvailable: 5,
    });
    assert.equal(decision.decision, "reconciliation_required");
  }
});

test("an unproven error fails closed to reconciliation", () => {
  // PROVIDER_FAILED can be raised long after a billable job was created —
  // fal's subscribe() waits on the job inside the same call.
  const decision = decideFailover({
    attempt: baseAttempt,
    errorCode: "PROVIDER_FAILED",
    isMockProvider: false,
    attemptCount: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    alternativeRoutesAvailable: 1,
  });
  assert.equal(decision.decision, "reconciliation_required");
});

test("no error code at all fails closed", () => {
  const decision = decideFailover({
    attempt: baseAttempt,
    errorCode: null,
    isMockProvider: false,
    attemptCount: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    alternativeRoutesAvailable: 1,
  });
  assert.equal(decision.decision, "reconciliation_required");
  assert.equal(decision.reason, "no_error_code_no_proof");
});

test("a local failure is not worth another provider", () => {
  const decision = decideFailover({
    attempt: baseAttempt,
    errorCode: "CAPABILITY_NOT_SUPPORTED",
    isMockProvider: false,
    attemptCount: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    alternativeRoutesAvailable: 3,
  });
  assert.equal(decision.decision, "no_failover_local_failure");
});

test("failover is bounded by attempts and by available routes", () => {
  const exhaustedByAttempts = decideFailover({
    attempt: baseAttempt,
    errorCode: "PROVIDER_NOT_CONFIGURED",
    isMockProvider: false,
    attemptCount: DEFAULT_MAX_ATTEMPTS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    alternativeRoutesAvailable: 5,
  });
  assert.equal(exhaustedByAttempts.decision, "failover_exhausted");

  const exhaustedByRoutes = decideFailover({
    attempt: baseAttempt,
    errorCode: "PROVIDER_NOT_CONFIGURED",
    isMockProvider: false,
    attemptCount: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    alternativeRoutesAvailable: 0,
  });
  assert.equal(exhaustedByRoutes.decision, "failover_exhausted");
});

test("evidence is checked BEFORE bounds, so ambiguity can never be retried away", () => {
  // Ordering is itself the safety property: if bounds were evaluated first, a
  // system with attempts to spare would reach a retry decision for an
  // ambiguous submission.
  const decision = decideFailover({
    attempt: { ...baseAttempt, submission_evidence: "ambiguous" },
    errorCode: "PROVIDER_NOT_CONFIGURED",
    isMockProvider: false,
    attemptCount: 99,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    alternativeRoutesAvailable: 0,
  });
  assert.equal(decision.decision, "reconciliation_required");
});

test("a mock provider is exempt: it cannot create an external job", () => {
  const decision = decideFailover({
    attempt: baseAttempt,
    errorCode: "PROVIDER_FAILED",
    isMockProvider: true,
    attemptCount: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    alternativeRoutesAvailable: 1,
  });
  assert.equal(decision.decision, "safe_to_failover");
});

// ---------------------------------------------------------------------------
// Redis A store
// ---------------------------------------------------------------------------

function fakeRedis(): CircuitBreakerRedisClient & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    async del(key) {
      store.delete(key);
      return 1;
    },
  };
}

test("breaker state round-trips through the store", async () => {
  const client = fakeRedis();
  __setCircuitBreakerClientForTesting(client);
  try {
    assert.deepEqual(await getBreaker("mock", "mock-image"), { outcome: "no_data" });

    const record = recordFailure(initialBreakerRecord(T0.toISOString()), later(1));
    await setBreaker("mock", "mock-image", record);

    const read = await getBreaker("mock", "mock-image");
    assert.equal(read.outcome, "available");
    if (read.outcome !== "available") return;
    assert.equal(read.record.consecutiveFailures, 1);
  } finally {
    __setCircuitBreakerClientForTesting(null);
  }
});

test("three recorded failures open the breaker through the store", async () => {
  const client = fakeRedis();
  __setCircuitBreakerClientForTesting(client);
  try {
    let last: CircuitBreakerRecord | null = null;
    for (let i = 0; i < DEFAULT_BREAKER_POLICY.failureThreshold; i += 1) {
      last = await transitionBreaker(
        "mock",
        "mock-image",
        (record) => recordFailure(record, later(i)),
        later(i)
      );
    }
    assert.equal(last?.state, "OPEN");
  } finally {
    __setCircuitBreakerClientForTesting(null);
  }
});

test("an unavailable Redis yields unavailable, never a fabricated state", async () => {
  __setCircuitBreakerClientForTesting(null);
  // With no client configured in the test environment the store reports
  // unavailable rather than inventing CLOSED or OPEN.
  const outcome = await getBreaker("mock", "mock-image");
  assert.ok(outcome.outcome === "unavailable" || outcome.outcome === "no_data");
  assert.notEqual(outcome.outcome, "available");
});

test("corrupted breaker state is treated as absent, never as OPEN", () => {
  assert.equal(parseBreakerRecord("not json"), null);
  assert.equal(parseBreakerRecord('{"state":"MELTED","updatedAt":"x"}'), null);
  assert.equal(parseBreakerRecord('{"state":"OPEN"}'), null);

  const valid = parseBreakerRecord(
    JSON.stringify({ state: "OPEN", updatedAt: T0.toISOString(), consecutiveFailures: 3 })
  );
  assert.equal(valid?.state, "OPEN");
  assert.equal(valid?.halfOpenInFlight, 0);
});

test("breaker keys are namespaced, versioned and collision-free", () => {
  const key = circuitBreakerKey("fal", "fal-ai/flux/schnell");
  assert.match(key, /^cinefield:v1:circuit-breaker:fal:/);
  assert.notEqual(
    circuitBreakerKey("fal", "a/b"),
    circuitBreakerKey("fal", "a.b"),
    "different provider models must never share a key"
  );
  assert.notEqual(circuitBreakerKey("fal", "x"), circuitBreakerKey("mock", "x"));
  assert.equal(encodeKeySegment("a/b"), "a_2fb");
});

// ---------------------------------------------------------------------------
// Scoring shape — cost and quality are absent, not merely zero
// ---------------------------------------------------------------------------

test("the scorer has no cost and no quality term", () => {
  const source = readSource("src/lib/routing/route-health.ts");
  const scorer = /export function scoreRoute[\s\S]*?\n\}/.exec(source);
  assert.ok(scorer);
  assert.ok(!/cost/i.test(scorer[0]), "cost must not influence routing before Phase 7-D");
  assert.ok(!/quality/i.test(scorer[0]), "quality must not influence routing before Phase 7-D");

  const policy = /export const DEFAULT_HEALTH_POLICY[\s\S]*?\n\};/.exec(source);
  assert.ok(policy);
  assert.ok(!/weightCost|weightQuality/.test(policy[0]));
});

test("missing signals score neutral rather than zero", () => {
  const unmeasured = scoreRoute(100, 100, unknownHealth("mock", "pm", T0, false));
  const perfect = scoreRoute(
    100,
    100,
    { ...unknownHealth("mock", "pm", T0, false), confidence: "observed", errorRate: 0, averageLatencyMs: 0 }
  );
  assert.ok(unmeasured.errorComponent === 1, "an unmeasured route has not been failing");
  assert.ok(unmeasured.latencyComponent === 1, "an unmeasured route has not been slow");
  assert.ok(unmeasured.total < perfect.total, "but it is still ranked below a proven one");
  assert.ok(unmeasured.total > 0, "and it stays selectable");
});

test("scores are bounded even with absurd inputs", () => {
  const wild = scoreRoute(
    999_999,
    100,
    {
      ...unknownHealth("mock", "pm", T0, false),
      confidence: "observed",
      errorRate: 42,
      averageLatencyMs: -5,
    }
  );
  assert.ok(wild.priorityComponent <= 1 && wild.priorityComponent >= 0);
  assert.ok(wild.errorComponent <= 1 && wild.errorComponent >= 0);
  assert.ok(wild.latencyComponent <= 1 && wild.latencyComponent >= 0);
});

// ---------------------------------------------------------------------------
// Security — the browser has no routing authority whatsoever
// ---------------------------------------------------------------------------

test("no client-facing type can carry a score, health or breaker state", () => {
  const createRequest = /export interface GenerationCreateRequest \{[\s\S]*?\n\}/.exec(
    readSource("src/lib/orchestration/generation-create-service.ts")
  );
  assert.ok(createRequest);
  for (const forbidden of ["provider", "route", "health", "score", "breaker", "failover"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(createRequest[0]),
      `the public create request must have no "${forbidden}" field`
    );
  }

  const routeRequest = /export interface RouteRequest \{[\s\S]*?\n\}/.exec(
    readSource("src/lib/routing/route-types.ts")
  );
  assert.ok(routeRequest);
  assert.ok(!/health|score|breaker/i.test(routeRequest[0]));
});

test("health and breaker modules are server-only", () => {
  for (const file of [
    "src/lib/routing/health-aware-router.ts",
    "src/lib/routing/health-recorder.ts",
  ]) {
    assert.match(readSource(file), /^import "server-only";/m, `${file} must be server-only`);
  }
});

test("excludeRouteIds is populated from attempt history, never from a request body", () => {
  const activity = readSource("worker/activities/generation-activities.ts");
  assert.match(activity, /from\("generation_attempts"\)/);
  assert.match(activity, /excludeRouteIds: triedRouteIds/);

  const route = readSource("src/app/api/generate/route.ts");
  assert.ok(
    !/excludeRouteIds|breaker|routeScore/i.test(route),
    "the HTTP boundary must not accept routing internals"
  );
});

test("health state carries no secret, prompt or payload", () => {
  // Asserted against what is actually SERIALIZED, not against the prose in
  // the file: the record is the thing that reaches Redis.
  let record = initialBreakerRecord(T0.toISOString());
  record = recordFailure(record, later(1));
  record = recordSuccess(record, later(2));

  const allowed = new Set([
    "state",
    "consecutiveFailures",
    "lastFailureAt",
    "lastSuccessAt",
    "openedAt",
    "halfOpenSuccesses",
    "halfOpenInFlight",
    "updatedAt",
  ]);
  for (const key of Object.keys(record)) {
    assert.ok(allowed.has(key), `unexpected field in breaker state: ${key}`);
  }

  const serialized = JSON.stringify(record);
  for (const forbidden of ["prompt", "apiKey", "token", "secret", "payload", "url"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(serialized),
      `breaker state must never carry a ${forbidden}`
    );
  }

  // And the observation the recorder accepts carries nothing sensitive either.
  const recorder = readSource("src/lib/routing/health-recorder.ts");
  const observation = /export interface ExecutionObservation \{[\s\S]*?\n\}/.exec(recorder);
  assert.ok(observation);
  assert.ok(!/prompt|payload|apiKey|token|secret|url/i.test(observation[0]));
});

// ---------------------------------------------------------------------------
// Ownership boundaries
// ---------------------------------------------------------------------------

test("the router never calls a provider and never owns a lifecycle", () => {
  for (const file of [
    "src/lib/routing/health-aware-router.ts",
    "src/lib/routing/model-router.ts",
    "src/lib/routing/failover-policy.ts",
  ]) {
    const source = readSource(file);
    assert.ok(!/@temporalio/.test(source), `${file} must not import Temporal`);
    assert.ok(!/aws-sdk|SendMessage/.test(source), `${file} must not talk to SQS`);
    assert.ok(!/adapter\.submit|adapter\.checkStatus/.test(source), `${file} must not execute`);
  }
});

test("the failover loop in the workflow is bounded and obeys the plan", () => {
  const workflow = readSource("worker/workflows/generation-workflow.ts");
  assert.match(workflow, /const MAX_FAILOVER_ATTEMPTS = 1;/);
  assert.match(workflow, /failoverCount < MAX_FAILOVER_ATTEMPTS/);
  assert.match(workflow, /plan\.decision === "reconciliation_required"/);
  assert.ok(
    !/createGeneration|create_generation_tx/.test(workflow),
    "a failover must never create a second generation"
  );
});
