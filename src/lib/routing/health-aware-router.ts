import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBreaker } from "@/lib/redis/circuit-breaker-store";
import { getProviderErrorRate } from "@/lib/redis/provider-error-rate-store";
import { getProviderLatency } from "@/lib/redis/provider-latency-store";
import { compareRoutes, listRouteCandidates } from "./route-repository";
import { rejectionFor } from "./model-router";
import {
  DEFAULT_HEALTH_POLICY,
  normalizeHealth,
  scoreRoute,
  unknownHealth,
  type HealthPolicy,
  type HealthScoreBreakdown,
  type RouteHealth,
} from "./route-health";
import type {
  RouteCandidate,
  RouteRejectionReason,
  RouteRequest,
  RouteSelection,
} from "./route-types";

/**
 * Health-aware route selection (Phase 7-C).
 *
 * The question this answers is narrow: among the routes Phase 7-B has ALREADY
 * declared eligible, which one is safe enough to run right now?
 *
 * ELIGIBILITY IS NOT NEGOTIABLE, AND IT COMES FIRST.
 * Health can only ever reorder or exclude. It can never admit a route that
 * hard eligibility rejected — a disabled provider stays disabled no matter how
 * healthy it looks, and a route with no adapter in this deployment stays
 * unusable no matter how good its latency was yesterday. The same
 * `rejectionFor` the static router uses runs first, unchanged.
 *
 * DETERMINISTIC. Same candidates plus same health plus same excluded set
 * yields the same route, every time. No randomness, no round-robin, no
 * weighted sampling. Scores are computed, then sorted with an explicit total
 * order whose final tie-break is the Phase 7-B comparator — so when health
 * says nothing, this degrades exactly to static priority routing.
 *
 * NOT A WORKFLOW ENGINE. It selects. Temporal owns the lifecycle, retry and
 * cancellation; SQS carries the command; the provider worker executes. This
 * module never calls a provider.
 */

export type HealthRejectionReason =
  | RouteRejectionReason
  /** The breaker for this provider model is OPEN, or HALF_OPEN and saturated. */
  | "circuit_open"
  /** Excluded by the caller — usually an attempt already failed on it. */
  | "already_attempted";

/** Everything that went into one route's evaluation. Safe to log. */
export interface RouteEvaluation {
  routeId: string;
  providerId: string;
  providerModelId: string;
  priority: number;
  eligible: boolean;
  rejection?: HealthRejectionReason;
  health?: RouteHealth;
  score?: HealthScoreBreakdown;
}

export interface RoutingDecision {
  cinefieldModelId: string;
  evaluations: RouteEvaluation[];
  decidedAt: string;
}

export type HealthAwareResolution =
  | { outcome: "selected"; selection: RouteSelection; decision: RoutingDecision }
  /** Nothing passed hard eligibility. Configuration, not health. */
  | { outcome: "no_eligible_route"; decision: RoutingDecision }
  /**
   * Routes exist and are eligible, but every one is currently excluded by a
   * breaker or by the caller. Distinct from no_eligible_route on purpose: one
   * is "this model is not configured to run anywhere", the other is "it is,
   * and everywhere is on fire". They need different operator responses.
   */
  | { outcome: "no_healthy_route"; decision: RoutingDecision };

export interface HealthAwareRouteRequest extends RouteRequest {
  /**
   * Routes already tried for this generation. A failover must not re-select
   * the route that just failed, however good its score still looks — the
   * telemetry that would have degraded it may not have landed yet.
   */
  excludeRouteIds?: string[];
}

/** Health for every candidate, keyed by `providerId::providerModelId`. */
export type HealthSnapshot = ReadonlyMap<string, RouteHealth>;

export function healthKeyFor(providerId: string, providerModelId: string): string {
  return `${providerId}::${providerModelId}`;
}

/**
 * The pure selection rule.
 *
 * Split from the I/O for the same reason Phase 7-B split its own: policy that
 * needs a database and a Redis to test is policy that does not get tested
 * exhaustively.
 */
export function selectHealthyRoute(
  cinefieldModelId: string,
  candidates: RouteCandidate[],
  health: HealthSnapshot,
  now: Date,
  options?: { excludeRouteIds?: readonly string[]; policy?: HealthPolicy }
): HealthAwareResolution {
  const policy = options?.policy ?? DEFAULT_HEALTH_POLICY;
  const excluded = new Set(options?.excludeRouteIds ?? []);
  const evaluations: RouteEvaluation[] = [];

  const eligible: RouteCandidate[] = [];
  let anyEligibleBeforeHealth = false;

  for (const candidate of candidates) {
    // --- Hard eligibility, Phase 7-B, unchanged --------------------------
    const hardRejection = rejectionFor(candidate);
    if (hardRejection) {
      evaluations.push({
        routeId: candidate.routeId,
        providerId: candidate.providerId,
        providerModelId: candidate.providerModelId,
        priority: candidate.priority,
        eligible: false,
        rejection: hardRejection,
      });
      continue;
    }

    anyEligibleBeforeHealth = true;

    if (excluded.has(candidate.routeId)) {
      evaluations.push({
        routeId: candidate.routeId,
        providerId: candidate.providerId,
        providerModelId: candidate.providerModelId,
        priority: candidate.priority,
        eligible: true,
        rejection: "already_attempted",
      });
      continue;
    }

    // --- Health, second, and only ever subtractive -----------------------
    const routeHealth =
      health.get(healthKeyFor(candidate.providerId, candidate.providerModelId)) ??
      unknownHealth(candidate.providerId, candidate.providerModelId, now, true);

    if (!routeHealth.admitsTraffic) {
      evaluations.push({
        routeId: candidate.routeId,
        providerId: candidate.providerId,
        providerModelId: candidate.providerModelId,
        priority: candidate.priority,
        eligible: true,
        rejection: "circuit_open",
        health: routeHealth,
      });
      continue;
    }

    eligible.push(candidate);
  }

  const decidedAt = now.toISOString();

  if (eligible.length === 0) {
    const decision = { cinefieldModelId, evaluations, decidedAt };
    return anyEligibleBeforeHealth
      ? { outcome: "no_healthy_route", decision }
      : { outcome: "no_eligible_route", decision };
  }

  const maxPriority = eligible.reduce((max, c) => Math.max(max, c.priority), 0);

  const scored = eligible.map((candidate) => {
    const routeHealth =
      health.get(healthKeyFor(candidate.providerId, candidate.providerModelId)) ??
      unknownHealth(candidate.providerId, candidate.providerModelId, now, true);
    const score = scoreRoute(candidate.priority, maxPriority, routeHealth, policy);
    evaluations.push({
      routeId: candidate.routeId,
      providerId: candidate.providerId,
      providerModelId: candidate.providerModelId,
      priority: candidate.priority,
      eligible: true,
      health: routeHealth,
      score,
    });
    return { candidate, score, health: routeHealth };
  });

  // Highest score wins. Ties fall through to the Phase 7-B comparator, which
  // is a total order — so equal health degrades to exactly static routing
  // rather than to whatever order the database happened to return.
  const winner = [...scored].sort((a, b) => {
    if (a.score.total !== b.score.total) return b.score.total - a.score.total;
    return compareRoutes(a.candidate, b.candidate);
  })[0];

  const contested = scored.filter((s) => s.score.total === winner.score.total).length > 1;
  const healthInfluenced = scored.some(
    (s) => s.health.confidence !== "unknown" || s.health.breakerState !== "CLOSED"
  );

  return {
    outcome: "selected",
    selection: {
      cinefieldModelId: winner.candidate.cinefieldModelId,
      modelVersionId: winner.candidate.modelVersionId,
      modelVersion: winner.candidate.modelVersion,
      providerId: winner.candidate.providerId,
      providerModelId: winner.candidate.providerModelId,
      routeId: winner.candidate.routeId,
      priority: winner.candidate.priority,
      selectionReason: buildReason(winner.candidate.priority, healthInfluenced, contested),
    },
    decision: { cinefieldModelId, evaluations, decidedAt },
  };
}

function buildReason(priority: number, healthInfluenced: boolean, contested: boolean): string {
  const base = healthInfluenced ? `health_weighted_priority_${priority}` : `static_priority_${priority}`;
  return contested ? `${base}_stable_tie_break` : base;
}

/**
 * Loads health for every candidate from Redis A.
 *
 * Every read is independently fail-soft. A provider whose telemetry cannot be
 * read becomes UNKNOWN — never healthy-by-default, never unhealthy-by-default.
 * Unknown is a real answer here: it costs the route a small confidence factor
 * and nothing else, so a Redis outage degrades routing to static priority
 * instead of taking generation down with it.
 */
export async function loadRouteHealth(
  candidates: RouteCandidate[],
  now: Date,
  policy: HealthPolicy = DEFAULT_HEALTH_POLICY
): Promise<HealthSnapshot> {
  const snapshot = new Map<string, RouteHealth>();

  const unique = new Map<string, { providerId: string; providerModelId: string }>();
  for (const candidate of candidates) {
    unique.set(healthKeyFor(candidate.providerId, candidate.providerModelId), {
      providerId: candidate.providerId,
      providerModelId: candidate.providerModelId,
    });
  }

  await Promise.all(
    [...unique.entries()].map(async ([key, { providerId, providerModelId }]) => {
      const [breaker, errorRate, latency] = await Promise.all([
        getBreaker(providerId, providerModelId),
        getProviderErrorRate(providerId),
        getProviderLatency(providerId),
      ]);

      // "Unavailable" from every source means the backend is gone; empty
      // windows mean it is there and quiet. Only the first should make the
      // router more conservative.
      const telemetryUnavailable =
        breaker.outcome === "unavailable" &&
        errorRate.outcome === "unavailable" &&
        latency.outcome === "unavailable";

      snapshot.set(
        key,
        normalizeHealth(
          {
            providerId,
            providerModelId,
            breaker: breaker.outcome === "available" ? breaker.record : null,
            errorRate:
              errorRate.outcome === "available"
                ? { errorRate: errorRate.errorRate, totalCount: errorRate.totalCount }
                : null,
            latency:
              latency.outcome === "available"
                ? {
                    averageLatencyMs: latency.averageLatencyMs,
                    sampleCount: latency.sampleCount,
                  }
                : null,
            telemetryUnavailable,
          },
          now,
          policy
        )
      );
    })
  );

  return snapshot;
}

function log(fields: Record<string, unknown>): void {
  // Identifiers, states and numbers. Never a prompt, a payload or a secret.
  console.info("[cinefield:health-router]", JSON.stringify(fields));
}

/**
 * Resolves where a generation should run, health included.
 *
 * The request still carries a Cinefield model id and nothing that names a
 * destination — `HealthAwareRouteRequest` extends `RouteRequest`, which has no
 * provider field, and `excludeRouteIds` is populated server-side from attempt
 * history rather than by any client.
 */
export async function resolveHealthyRoute(
  admin: SupabaseClient,
  request: HealthAwareRouteRequest,
  now: Date = new Date(),
  policy: HealthPolicy = DEFAULT_HEALTH_POLICY
): Promise<HealthAwareResolution> {
  const candidates = await listRouteCandidates(
    admin,
    request.cinefieldModelId,
    request.modelVersion
  );

  const health = await loadRouteHealth(candidates, now, policy);
  const resolution = selectHealthyRoute(request.cinefieldModelId, candidates, health, now, {
    excludeRouteIds: request.excludeRouteIds,
    policy,
  });

  if (resolution.outcome === "selected") {
    log({
      modelId: request.cinefieldModelId,
      result: "selected",
      routeId: resolution.selection.routeId,
      providerId: resolution.selection.providerId,
      reason: resolution.selection.selectionReason,
    });
  } else {
    log({
      modelId: request.cinefieldModelId,
      result: resolution.outcome,
      rejected: resolution.decision.evaluations
        .filter((e) => e.rejection)
        .map((e) => `${e.routeId}:${e.rejection}`),
    });
  }

  return resolution;
}
