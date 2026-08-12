import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBreaker } from "@/lib/redis/circuit-breaker-store";
import { getProviderErrorRate } from "@/lib/redis/provider-error-rate-store";
import { getProviderLatency } from "@/lib/redis/provider-latency-store";
import { compareRoutes, listRouteCandidates } from "./route-repository";
import { tryAcquireProbe } from "./half-open-probe";
import { rejectionFor } from "./model-router";
import {
  DEFAULT_HEALTH_POLICY,
  normalizeHealth,
  unknownHealth,
  type HealthPolicy,
  type RouteHealth,
} from "./route-health";
import { scoreRouteComposite, type CompositeScoreBreakdown } from "./route-scoring";
import { DEFAULT_ROUTING_POLICY, type RoutingPolicy } from "./routing-policy";
import {
  normalizeRoutingCost,
  unknownCost,
  type CostRequestShape,
  type RouteCost,
} from "./routing-cost";
import { costKeyFor, readActiveRouteCosts } from "./routing-cost-repository";
import {
  NO_TRUSTED_QUALITY_SOURCE,
  normalizeQuality,
  unknownQuality,
  type QualitySignalProvider,
  type RouteQuality,
} from "./route-quality";
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
  /** Phase 7-D. Provider execution cost, never a customer price. */
  cost?: RouteCost;
  quality?: RouteQuality;
  score?: CompositeScoreBreakdown;
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
  /**
   * Phase 7-D. What the request costs in billing units — output count today.
   * Derived server-side from the validated request, never accepted as a
   * price: a client can say "four images", it cannot say what four images
   * cost.
   */
  costShape?: CostRequestShape;
}

/** Health for every candidate, keyed by `providerId::providerModelId`. */
export type HealthSnapshot = ReadonlyMap<string, RouteHealth>;

/** Phase 7-D optimization inputs, same keying. Both default to unknown. */
export interface OptimizationSnapshot {
  cost?: ReadonlyMap<string, RouteCost>;
  quality?: ReadonlyMap<string, RouteQuality>;
}

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
  options?: {
    excludeRouteIds?: readonly string[];
    policy?: HealthPolicy;
    /** Phase 7-D. Absent means every route is unpriced and unevaluated. */
    optimization?: OptimizationSnapshot;
    routingPolicy?: RoutingPolicy;
  }
): HealthAwareResolution {
  const policy = options?.policy ?? DEFAULT_HEALTH_POLICY;
  const routingPolicy = options?.routingPolicy ?? DEFAULT_ROUTING_POLICY;
  const costs = options?.optimization?.cost;
  const qualities = options?.optimization?.quality;
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

    // "deny" is an OPEN breaker: excluded outright.
    //
    // "probe_required" is HALF_OPEN, and this pure function deliberately does
    // NOT decide it. Whether the single recovery slot is free is a question
    // only an atomic operation can answer, so the candidate stays in the race
    // and `resolveHealthyRoute` claims the lease before letting it win. A
    // boolean here is exactly what let every waiting request through at once.
    if (routeHealth.admission === "deny") {
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
    const key = healthKeyFor(candidate.providerId, candidate.providerModelId);
    const routeHealth =
      health.get(key) ??
      unknownHealth(candidate.providerId, candidate.providerModelId, now, true);
    // Phase 7-D: absent optimization data is UNKNOWN, never a default value.
    // An unpriced route is not free and an unevaluated one is not bad.
    const routeCost =
      costs?.get(key) ?? unknownCost(candidate.providerId, candidate.providerModelId);
    const routeQuality =
      qualities?.get(key) ?? unknownQuality(candidate.providerId, candidate.providerModelId);

    const score = scoreRouteComposite(
      candidate.priority,
      maxPriority,
      routeHealth,
      routeCost,
      routeQuality,
      { ...routingPolicy, health: policy }
    );

    evaluations.push({
      routeId: candidate.routeId,
      providerId: candidate.providerId,
      providerModelId: candidate.providerModelId,
      priority: candidate.priority,
      eligible: true,
      health: routeHealth,
      cost: routeCost,
      quality: routeQuality,
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

/**
 * Loads the Phase 7-D optimization inputs.
 *
 * Both are fail-soft and both default to UNKNOWN rather than to a value.
 * A pricing read that fails leaves every route unpriced; a quality source
 * that has nothing leaves every route unevaluated. Neither can stop a
 * generation, and neither can invent a number.
 */
export async function loadOptimizationInputs(
  admin: SupabaseClient,
  candidates: RouteCandidate[],
  costShape: CostRequestShape,
  now: Date,
  routingPolicy: RoutingPolicy = DEFAULT_ROUTING_POLICY,
  qualitySource: QualitySignalProvider = NO_TRUSTED_QUALITY_SOURCE
): Promise<OptimizationSnapshot> {
  const cost = new Map<string, RouteCost>();
  const quality = new Map<string, RouteQuality>();

  const unique = new Map<string, { providerId: string; providerModelId: string }>();
  for (const candidate of candidates) {
    unique.set(healthKeyFor(candidate.providerId, candidate.providerModelId), {
      providerId: candidate.providerId,
      providerModelId: candidate.providerModelId,
    });
  }
  if (unique.size === 0) return { cost, quality };

  const pricing = await readActiveRouteCosts(admin, [...unique.values()]);

  await Promise.all(
    [...unique.entries()].map(async ([key, { providerId, providerModelId }]) => {
      cost.set(
        key,
        normalizeRoutingCost(
          providerId,
          providerModelId,
          pricing.get(costKeyFor(providerId, providerModelId)) ?? null,
          costShape,
          now,
          routingPolicy.cost
        )
      );

      const signal = await qualitySource.read(providerId, providerModelId);
      quality.set(
        key,
        normalizeQuality(providerId, providerModelId, signal, now, routingPolicy.quality)
      );
    })
  );

  return { cost, quality };
}

function log(fields: Record<string, unknown>): void {
  // Identifiers, states and numbers. Never a prompt, a payload, a secret —
  // and never a provider unit cost, which is internal commercial detail.
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
  policy: HealthPolicy = DEFAULT_HEALTH_POLICY,
  routingPolicy: RoutingPolicy = DEFAULT_ROUTING_POLICY,
  qualitySource: QualitySignalProvider = NO_TRUSTED_QUALITY_SOURCE
): Promise<HealthAwareResolution> {
  const candidates = await listRouteCandidates(
    admin,
    request.cinefieldModelId,
    request.modelVersion
  );

  const health = await loadRouteHealth(candidates, now, policy);
  const optimization = await loadOptimizationInputs(
    admin,
    candidates,
    request.costShape ?? { outputCount: 1 },
    now,
    routingPolicy,
    qualitySource
  );

  // ---- Atomic HALF_OPEN admission -----------------------------------------
  //
  // A winner whose breaker is HALF_OPEN has to claim the single recovery
  // probe before it may be used. Exactly one caller can, because the claim is
  // a Redis SET NX. Everyone else re-selects with that route excluded and
  // takes the next best one — so a recovering provider receives one trial
  // request while the rest of the traffic goes somewhere healthy, instead of
  // the entire backlog arriving at once.
  //
  // Bounded by the candidate count: each pass either succeeds or removes one
  // route from consideration, so this cannot loop.
  const deniedProbes: string[] = [];
  let resolution = selectHealthyRoute(request.cinefieldModelId, candidates, health, now, {
    excludeRouteIds: [...(request.excludeRouteIds ?? []), ...deniedProbes],
    policy,
    optimization,
    routingPolicy,
  });

  for (let pass = 0; pass < candidates.length; pass += 1) {
    if (resolution.outcome !== "selected") break;

    const winner = resolution.selection;
    const winnerHealth = health.get(healthKeyFor(winner.providerId, winner.providerModelId));
    if (winnerHealth?.admission !== "probe_required") break;

    const probe = await tryAcquireProbe(winner.providerId, winner.providerModelId);
    if (probe.granted) {
      // NOTE: the lease is intentionally NOT released here. It expires on its
      // own TTL, which is what makes it a rate limit on trials rather than a
      // mutex around one function call — releasing it on the way out of
      // selection would let the next request in immediately, before the first
      // trial has produced any evidence at all.
      log({
        modelId: request.cinefieldModelId,
        result: "half_open_probe_granted",
        routeId: winner.routeId,
      });
      break;
    }

    log({
      modelId: request.cinefieldModelId,
      result: "half_open_probe_denied",
      routeId: winner.routeId,
      reason: probe.reason,
    });
    deniedProbes.push(winner.routeId);
    resolution = selectHealthyRoute(request.cinefieldModelId, candidates, health, now, {
      excludeRouteIds: [...(request.excludeRouteIds ?? []), ...deniedProbes],
      policy,
      optimization,
      routingPolicy,
    });
  }

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
