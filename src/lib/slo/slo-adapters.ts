import type { ReadinessReport } from "@/lib/health/health-contract";
import type { SliObservation, SloWindow } from "./slo-snapshot";

/**
 * Input adapters (Phase 15-A).
 *
 * Narrow, pure translations from data that ALREADY EXISTS into an
 * `SliObservation`. Every adapter takes the owning subsystem's own shape as an
 * argument rather than fetching it — that keeps this module free of database
 * access, free of a clock, and free of any opinion about when measurement
 * happens. Collection scheduling belongs to whoever already runs a loop
 * (Trigger.dev cron, a worker tick); Phase 15-A only says what the numbers
 * mean once someone has them.
 *
 * ---------------------------------------------------------------------------
 * NO SECOND COPY OF DURABLE TRUTH
 * ---------------------------------------------------------------------------
 * Nothing here writes anything, and no adapter caches. `generation_attempts`
 * stays the attempt evidence, Phase 13 stays the health authority, the outbox
 * debt RPC stays the debt authority. An adapter that stored its own rolling
 * copy would become a second source of truth that drifts — which is the one
 * outcome the Phase 15 audit said this batch must avoid.
 *
 * ---------------------------------------------------------------------------
 * A FAILED READ IS NOT A ZERO
 * ---------------------------------------------------------------------------
 * Every adapter takes `sourceAvailable` from its caller and passes it through.
 * A query that threw and a window that genuinely had no rows both produce
 * empty input; only the caller knows which happened, and collapsing them would
 * turn a broken connection into a perfect score.
 */

/**
 * Terminal attempt counts for a window.
 *
 * The caller supplies already-aggregated counts — an adapter that received raw
 * rows would be handling exactly the material (prompts, error text, ids) the
 * snapshot boundary exists to exclude. Aggregate at the query, pass counts.
 */
export interface AttemptWindowCounts {
  readonly succeeded: number;
  readonly failed: number;
  /** Failures whose error_code indicated a timeout. Subset of `failed`. */
  readonly timedOut: number;
  /** p95 of latency_ms over SUCCEEDED attempts, or null if not computed. */
  readonly p95LatencyMs: number | null;
  readonly sourceAvailable: boolean;
}

/**
 * Generation success ratio.
 *
 * Denominator is succeeded + failed. Cancelled attempts are excluded from both
 * sides: a user changing their mind is not a reliability failure, and counting
 * it as one would move the indicator when nothing broke.
 */
export function observeGenerationSuccess(
  counts: AttemptWindowCounts,
  window: SloWindow
): SliObservation {
  const total = counts.succeeded + counts.failed;
  return {
    sliId: "generation_success_ratio",
    window,
    sourceAvailable: counts.sourceAvailable,
    goodCount: counts.succeeded,
    totalCount: total,
  };
}

/**
 * Timeout ratio, expressed as a SUCCESS ratio so the budget math is uniform.
 *
 * "At most 2% timeouts" and "at least 98% non-timeout" are the same statement;
 * expressing every ratio SLI in the higher-is-better direction means one
 * budget formula rather than two that must be kept in agreement.
 */
export function observeGenerationTimeouts(
  counts: AttemptWindowCounts,
  window: SloWindow
): SliObservation {
  const total = counts.succeeded + counts.failed;
  const nonTimeout = Math.max(0, total - counts.timedOut);
  return {
    sliId: "generation_timeout_ratio",
    window,
    sourceAvailable: counts.sourceAvailable,
    goodCount: nonTimeout,
    totalCount: total,
  };
}

/** p95 latency over succeeded attempts. */
export function observeGenerationLatency(
  counts: AttemptWindowCounts,
  window: SloWindow
): SliObservation {
  return {
    sliId: "generation_latency_p95",
    window,
    sourceAvailable: counts.sourceAvailable && counts.p95LatencyMs !== null,
    ...(counts.p95LatencyMs !== null ? { observedValue: counts.p95LatencyMs } : {}),
    totalCount: counts.succeeded,
  };
}

/**
 * Dependency readiness, from a Phase 13 readiness report.
 *
 * CRITICAL dependencies only, matching `rollUp()`. DEGRADED counts as good
 * because Phase 13's own `isReady()` treats it as servable; UNKNOWN does not,
 * because UNKNOWN != HEALTHY is a standing rule in this codebase.
 */
export function observeDependencyReadiness(
  report: ReadinessReport | null,
  window: SloWindow
): SliObservation {
  if (!report) {
    return { sliId: "dependency_readiness", window, sourceAvailable: false };
  }
  const critical = report.dependencies.filter((d) => d.criticality === "CRITICAL");
  const good = critical.filter((d) => d.status === "HEALTHY" || d.status === "DEGRADED").length;
  return {
    sliId: "dependency_readiness",
    window,
    sourceAvailable: true,
    goodCount: good,
    totalCount: critical.length,
  };
}

/** Application availability from repeated readiness evaluations. */
export function observeAvailability(
  evaluations: { readonly servable: number; readonly answered: number; readonly sourceAvailable: boolean },
  window: SloWindow
): SliObservation {
  return {
    sliId: "app_availability",
    window,
    sourceAvailable: evaluations.sourceAvailable,
    goodCount: evaluations.servable,
    totalCount: evaluations.answered,
  };
}

/**
 * Realtime delivery debt age, from the existing `realtime_outbox_debt()`
 * aggregate the dispatcher already reads.
 *
 * A null snapshot means the RPC failed. That is UNAVAILABLE, never "zero
 * debt" — the roadmap audit called this out specifically, and it is the
 * difference between "delivery is current" and "we cannot see delivery".
 */
export function observeRealtimeDebtAge(
  debt: { readonly oldestPendingSeconds: number } | null,
  window: SloWindow
): SliObservation {
  if (!debt) {
    return { sliId: "realtime_debt_age", window, sourceAvailable: false };
  }
  return {
    sliId: "realtime_debt_age",
    window,
    sourceAvailable: true,
    observedValue: Math.max(0, debt.oldestPendingSeconds),
  };
}

/**
 * Provider reliability, MAPPED from Phase 7's provider health state.
 *
 * It does not recompute provider health. A second score would eventually
 * disagree with the router's own, and then "is this provider healthy?" would
 * have two answers depending on who was asked.
 */
export function observeProviderReliability(
  providers: { readonly healthy: number; readonly observed: number; readonly sourceAvailable: boolean },
  window: SloWindow
): SliObservation {
  return {
    sliId: "provider_reliability",
    window,
    sourceAvailable: providers.sourceAvailable,
    goodCount: providers.healthy,
    totalCount: providers.observed,
  };
}
