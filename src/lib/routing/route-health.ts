import type { BreakerState, CircuitBreakerRecord } from "./circuit-breaker";
import {
  DEFAULT_BREAKER_POLICY,
  admitsTraffic,
  effectiveBreakerState,
  isBreakerFresh,
  type CircuitBreakerPolicy,
} from "./circuit-breaker";

/**
 * The ONE health contract the router is allowed to see (Phase 7-C).
 *
 * Routing policy must never read a provider's raw error payload. Two reasons,
 * and the second is the one that bites: raw payloads are provider-shaped, so
 * every policy that touches one becomes provider-specific and has to be
 * rewritten per integration; and they carry request context — prompts, ids,
 * occasionally credentials in a message — which has no business inside a
 * scoring function that gets logged.
 *
 * So the stores produce numbers and states, this module normalizes them into
 * one shape, and the router reads only this.
 *
 * Pure. Assembly from Redis lives in health-aware-router.ts.
 */

/** How much the router should trust what it is looking at. */
export type HealthConfidence =
  /** Fresh observations, enough samples to mean something. */
  | "observed"
  /** Real data, but thin — a handful of samples, or nearing its TTL. */
  | "sparse"
  /** Nothing usable: no data, expired data, or Redis unavailable. */
  | "unknown";

export interface RouteHealth {
  providerId: string;
  providerModelId: string;
  /** Breaker state AFTER cooldown is applied — what is true right now. */
  breakerState: BreakerState;
  /** False when the breaker says this route must not be selected. */
  admitsTraffic: boolean;
  /** Fraction in [0,1]. Undefined when unknown — never defaulted to 0. */
  errorRate?: number;
  /** Rolling average in ms. Undefined when unknown. */
  averageLatencyMs?: number;
  /** Observations behind errorRate. Zero means the window is empty. */
  sampleCount: number;
  /** Qualifying consecutive failures the breaker has counted. */
  consecutiveFailures: number;
  lastFailureAt?: string;
  /** ISO-8601. When this snapshot was assembled. */
  observedAt: string;
  confidence: HealthConfidence;
  /**
   * True when the telemetry backend could not be reached at all, as opposed
   * to being reachable and empty. The difference matters: empty means "no
   * incidents recorded", unreachable means "we know nothing", and only the
   * second one should make routing more conservative.
   */
  telemetryUnavailable: boolean;
}

/** Tuning for how health becomes a score. Deliberately small and explicit. */
export interface HealthPolicy {
  breaker: CircuitBreakerPolicy;
  /** Older than this and a breaker record stops being authoritative. */
  breakerFreshnessSeconds: number;
  /** Below this many samples, error rate is "sparse" rather than "observed". */
  minSamplesForConfidence: number;
  /** Latency at or above this scores zero on the latency axis. */
  latencyCeilingMs: number;
  /** Weights. They do not need to sum to 1; the score is comparative. */
  weightPriority: number;
  weightErrorRate: number;
  weightLatency: number;
  /**
   * Multiplier applied when confidence is "unknown". Below 1 so a route
   * nobody has observed loses to an equal route that is known-good, and wins
   * against one that is known-bad. Not zero: an unobserved route must stay
   * selectable, or a cold Redis would take the whole platform offline.
   */
  unknownConfidenceFactor: number;
}

export const DEFAULT_HEALTH_POLICY: HealthPolicy = {
  breaker: DEFAULT_BREAKER_POLICY,
  breakerFreshnessSeconds: 900,
  minSamplesForConfidence: 5,
  latencyCeilingMs: 120_000,
  // Static priority stays dominant. Health is a tie-breaker and a safety
  // valve, not a replacement for the operator's ordering — an operator who
  // sets priority 900 means it, and one slow response should not overturn it.
  weightPriority: 1.0,
  weightErrorRate: 0.35,
  weightLatency: 0.15,
  unknownConfidenceFactor: 0.9,
};

/** Health for a route nothing is known about. Explicitly unknown, never fake. */
export function unknownHealth(
  providerId: string,
  providerModelId: string,
  now: Date,
  telemetryUnavailable: boolean
): RouteHealth {
  return {
    providerId,
    providerModelId,
    // No breaker record means no breaker has tripped. That is CLOSED by
    // absence, not by assumption — the store writes on every qualifying
    // failure, so silence is genuine evidence of no recent failures.
    breakerState: "CLOSED",
    admitsTraffic: true,
    sampleCount: 0,
    consecutiveFailures: 0,
    observedAt: now.toISOString(),
    confidence: "unknown",
    telemetryUnavailable,
  };
}

export interface HealthInputs {
  providerId: string;
  providerModelId: string;
  breaker: CircuitBreakerRecord | null;
  /** Reachable-but-empty is null with `telemetryUnavailable: false`. */
  errorRate: { errorRate: number; totalCount: number } | null;
  latency: { averageLatencyMs: number; sampleCount: number } | null;
  telemetryUnavailable: boolean;
}

/**
 * Folds the separate Redis A signals into one normalized snapshot.
 *
 * A breaker record older than the freshness window is DISCARDED rather than
 * obeyed. An OPEN verdict from twenty minutes ago describes an incident that
 * has very likely ended, and continuing to exclude a route on that basis is
 * how a brief outage becomes a permanent capacity loss nobody notices.
 */
export function normalizeHealth(
  inputs: HealthInputs,
  now: Date,
  policy: HealthPolicy = DEFAULT_HEALTH_POLICY
): RouteHealth {
  const { providerId, providerModelId } = inputs;

  const breaker =
    inputs.breaker && isBreakerFresh(inputs.breaker, now, policy.breakerFreshnessSeconds)
      ? inputs.breaker
      : null;

  const breakerState = breaker
    ? effectiveBreakerState(breaker, now, policy.breaker)
    : ("CLOSED" as BreakerState);

  const sampleCount = inputs.errorRate?.totalCount ?? inputs.latency?.sampleCount ?? 0;

  let confidence: HealthConfidence;
  if (inputs.telemetryUnavailable) confidence = "unknown";
  else if (sampleCount === 0 && !breaker) confidence = "unknown";
  else if (sampleCount < policy.minSamplesForConfidence) confidence = "sparse";
  else confidence = "observed";

  return {
    providerId,
    providerModelId,
    breakerState,
    admitsTraffic: breaker ? admitsTraffic(breaker, now, policy.breaker) : true,
    errorRate: inputs.errorRate?.errorRate,
    averageLatencyMs: inputs.latency?.averageLatencyMs,
    sampleCount,
    consecutiveFailures: breaker?.consecutiveFailures ?? 0,
    lastFailureAt: breaker?.lastFailureAt,
    observedAt: now.toISOString(),
    confidence,
    telemetryUnavailable: inputs.telemetryUnavailable,
  };
}

/** The per-axis breakdown behind a score, kept for the decision record. */
export interface HealthScoreBreakdown {
  priorityComponent: number;
  errorComponent: number;
  latencyComponent: number;
  confidenceFactor: number;
  total: number;
}

/**
 * Scores one route. Deterministic, bounded, and explainable.
 *
 * Every axis is normalized to [0,1] before weighting, so no single signal can
 * dominate through its units — a latency of 90,000 must not outweigh an error
 * rate of 0.9 simply because the number is bigger.
 *
 * Missing data scores NEUTRAL (1.0 on that axis), not zero. A route with no
 * latency samples has not been slow; it has been unmeasured, and punishing it
 * for that would mean a freshly enabled route could never win.
 *
 * COST AND QUALITY ARE ABSENT. Not weighted at zero — absent. There is no
 * cost term and no quality term in this function; adding them is Phase 7-D,
 * and the shape of the breakdown is what makes that a widening rather than a
 * rewrite.
 */
export function scoreRoute(
  priority: number,
  maxPriority: number,
  health: RouteHealth,
  policy: HealthPolicy = DEFAULT_HEALTH_POLICY
): HealthScoreBreakdown {
  const priorityComponent =
    maxPriority > 0 ? Math.min(1, Math.max(0, priority / maxPriority)) : 1;

  const errorComponent = health.errorRate === undefined ? 1 : 1 - clamp01(health.errorRate);

  const latencyComponent =
    health.averageLatencyMs === undefined
      ? 1
      : 1 - clamp01(health.averageLatencyMs / policy.latencyCeilingMs);

  const confidenceFactor =
    health.confidence === "unknown" ? policy.unknownConfidenceFactor : 1;

  const total =
    (policy.weightPriority * priorityComponent +
      policy.weightErrorRate * errorComponent +
      policy.weightLatency * latencyComponent) *
    confidenceFactor;

  return { priorityComponent, errorComponent, latencyComponent, confidenceFactor, total };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
