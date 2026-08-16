/**
 * SLI catalogue and SLO target registry (Phase 15-A, code-only).
 *
 * Roadmap 15-A: "SLO/Error Budget metriklerini ve alert eşiklerini tanımla."
 * Done-criterion: availability / success / p95 / timeout / queue-age targets
 * are measurable.
 *
 * Turkish, because the roadmap is:
 *   SLI          = ölçülen hizmet göstergesi
 *   SLO          = hedeflenen hizmet seviyesi
 *   error budget = kabul edilen hata payı
 *   burn rate    = hata payının ne hızla tüketildiği
 *
 * ---------------------------------------------------------------------------
 * DEFINITIONS ONLY. THIS FILE MEASURES NOTHING.
 * ---------------------------------------------------------------------------
 * It declares what an indicator MEANS and what target we hold ourselves to.
 * It reads no database, calls nothing, and imports nothing that could. A
 * target here is a POLICY STATEMENT, not evidence that production meets it —
 * live measurement needs an external metrics backend (Datadog / Better Stack /
 * Sentry), all of which remain deferred. Nothing in Phase 15-A may be read as
 * "the SLO is being met".
 *
 * ---------------------------------------------------------------------------
 * PHASE 15-A OWNS DEFINITIONS, NOT TRUTH
 * ---------------------------------------------------------------------------
 * Every SLI names ONE canonical source that already exists and is owned
 * elsewhere: Phase 13 Health owns readiness, Phase 13-D owns alerts, Temporal
 * owns the generation lifecycle, `generation_attempts` is the durable attempt
 * evidence, and the outbox debt RPC owns delivery debt. This module maps those
 * into indicators. It never computes a second opinion about any of them — a
 * second provider-health score or a second readiness verdict would be a
 * competing source of truth, which is the one thing this phase must not build.
 */

/** Which existing owner supplies the observation. Never a new store. */
export type SliSource =
  | "generation_attempts"
  | "phase13_health"
  | "realtime_outbox_debt"
  | "provider_health_store";

/** Ratio SLIs compare good/total; latency and age SLIs compare a value to a ceiling. */
export type SliKind = "ratio" | "latency_ms" | "age_seconds";

/** For a ratio, higher is better. For latency and age, lower is better. */
export type SliDirection = "higher_is_better" | "lower_is_better";

export type SliId =
  | "app_availability"
  | "generation_success_ratio"
  | "generation_latency_p95"
  | "generation_timeout_ratio"
  | "realtime_debt_age"
  | "provider_reliability"
  | "dependency_readiness";

export interface SliDefinition {
  readonly id: SliId;
  readonly kind: SliKind;
  readonly direction: SliDirection;
  /** The ONE existing owner this indicator reads. */
  readonly source: SliSource;
  /** What counts as good. Prose for humans; the adapter implements it. */
  readonly numerator: string;
  /** What it is measured against. Null for gauge-style indicators. */
  readonly denominator: string | null;
  readonly unit: "ratio" | "milliseconds" | "seconds";
  /**
   * Below this many samples the result is INSUFFICIENT_DATA, never a pass.
   * A 100% success ratio over two attempts is not evidence of reliability.
   */
  readonly minimumSamples: number;
  /**
   * Dimensions this indicator may be broken down by. Bounded catalogues only
   * — see CARDINALITY below. An empty list means the indicator is global.
   */
  readonly allowedDimensions: readonly SliDimension[];
  readonly why: string;
}

/**
 * CARDINALITY.
 *
 * Every allowed dimension is drawn from a closed catalogue that already
 * exists: a provider id from the provider registry, a model id from the model
 * catalogue, a dependency name from the Phase 13 matrix. There is deliberately
 * no user, workspace, tenant, request, generation or error-message dimension.
 *
 * That is not a storage optimisation. A per-user metric label is both an
 * unbounded series count and a way for identity to end up in a metrics
 * backend, which is exactly what Phase 13-E exists to prevent. Correlation
 * ids belong in traces and logs, where they are already allow-listed; they do
 * not belong in metric labels.
 */
export type SliDimension = "provider" | "modelId" | "dependency";

export const SLI_CATALOGUE: Readonly<Record<SliId, SliDefinition>> = {
  app_availability: {
    id: "app_availability",
    kind: "ratio",
    direction: "higher_is_better",
    source: "phase13_health",
    numerator: "readiness evaluations reporting HEALTHY or DEGRADED",
    denominator: "readiness evaluations that returned an answer",
    unit: "ratio",
    minimumSamples: 10,
    allowedDimensions: [],
    why: "DEGRADED counts as available because Phase 13's own isReady() treats it as servable; refusing traffic over a fallback-covered dependency would be the wrong trade.",
  },
  generation_success_ratio: {
    id: "generation_success_ratio",
    kind: "ratio",
    direction: "higher_is_better",
    source: "generation_attempts",
    numerator: "attempts with status 'succeeded'",
    denominator: "attempts that reached a terminal status (succeeded or failed)",
    unit: "ratio",
    minimumSamples: 20,
    allowedDimensions: ["provider", "modelId"],
    why: "Cancelled attempts are excluded from BOTH sides: a user cancelling is not a reliability failure, and counting it as one would make the indicator move when nothing broke.",
  },
  generation_latency_p95: {
    id: "generation_latency_p95",
    kind: "latency_ms",
    direction: "lower_is_better",
    source: "generation_attempts",
    numerator: "95th percentile of latency_ms over succeeded attempts",
    denominator: null,
    unit: "milliseconds",
    minimumSamples: 20,
    allowedDimensions: ["provider", "modelId"],
    why: "Succeeded attempts only. A failed attempt's latency measures how fast we failed, which would flatter the percentile precisely when things are worst.",
  },
  generation_timeout_ratio: {
    id: "generation_timeout_ratio",
    kind: "ratio",
    direction: "lower_is_better",
    source: "generation_attempts",
    numerator: "terminal attempts whose error_code indicates a timeout",
    denominator: "attempts that reached a terminal status",
    unit: "ratio",
    minimumSamples: 20,
    allowedDimensions: ["provider", "modelId"],
    why: "Timeouts are separated from general failure because they usually mean a provider or queue problem rather than a bad request, and they drive different remediation.",
  },
  realtime_debt_age: {
    id: "realtime_debt_age",
    kind: "age_seconds",
    direction: "lower_is_better",
    source: "realtime_outbox_debt",
    numerator: "age of the oldest pending realtime outbox row",
    denominator: null,
    unit: "seconds",
    minimumSamples: 1,
    allowedDimensions: [],
    why: "Reuses the existing realtime_outbox_debt() aggregate. Queue age is what users actually feel when delivery falls behind; a pending COUNT can look calm while the oldest row rots.",
  },
  provider_reliability: {
    id: "provider_reliability",
    kind: "ratio",
    direction: "higher_is_better",
    source: "provider_health_store",
    numerator: "providers observed healthy",
    denominator: "providers with a health observation",
    unit: "ratio",
    minimumSamples: 1,
    allowedDimensions: ["provider"],
    why: "Maps Phase 7's existing provider health state into an indicator. It does NOT recompute provider health — a second score would disagree with the router's own.",
  },
  dependency_readiness: {
    id: "dependency_readiness",
    kind: "ratio",
    direction: "higher_is_better",
    source: "phase13_health",
    numerator: "CRITICAL dependencies reporting HEALTHY or DEGRADED",
    denominator: "CRITICAL dependencies probed",
    unit: "ratio",
    minimumSamples: 1,
    allowedDimensions: ["dependency"],
    why: "Only CRITICAL dependencies count, matching the Phase 13 matrix: an OPTIONAL or DEFERRED dependency being unwell is diagnostic, not a reliability breach.",
  },
};

/**
 * The SLO target registry — one canonical place, no magic numbers in code.
 *
 * These are STARTING POSITIONS, not measured commitments. The roadmap asks
 * for targets to be defined and measurable; it does not assert what
 * production achieves, and neither does this file. Every value is
 * deliberately conservative enough to be honest before real traffic exists.
 */
export interface SloTarget {
  readonly sliId: SliId;
  /** For ratio SLIs: the fraction that must be good, e.g. 0.99. */
  readonly targetRatio?: number;
  /** For latency/age SLIs: the ceiling the observation must stay under. */
  readonly maxValue?: number;
  /** Below this the state is AT_RISK rather than HEALTHY. */
  readonly warnAtBudgetRemaining: number;
  readonly why: string;
}

export const SLO_TARGETS: Readonly<Record<SliId, SloTarget>> = {
  app_availability: {
    sliId: "app_availability",
    targetRatio: 0.99,
    warnAtBudgetRemaining: 0.25,
    why: "Two nines to start. Claiming more before any production traffic exists would be a number with nothing behind it.",
  },
  generation_success_ratio: {
    sliId: "generation_success_ratio",
    targetRatio: 0.95,
    warnAtBudgetRemaining: 0.25,
    why: "Generation depends on third-party providers whose failures we do not control; a target that ignores that would be permanently breached and therefore ignored.",
  },
  generation_latency_p95: {
    sliId: "generation_latency_p95",
    maxValue: 120_000,
    warnAtBudgetRemaining: 0.25,
    why: "Video and image generation are genuinely slow. Two minutes at p95 is a ceiling on OUR overhead plus provider time, not a promise of speed.",
  },
  generation_timeout_ratio: {
    sliId: "generation_timeout_ratio",
    targetRatio: 0.98,
    warnAtBudgetRemaining: 0.25,
    why: "Expressed as 'at most 2% timeouts'. Timeouts cost provider money without producing output, so the ceiling is tighter than general failure.",
  },
  realtime_debt_age: {
    sliId: "realtime_debt_age",
    maxValue: 300,
    warnAtBudgetRemaining: 0.25,
    why: "Matches the existing 13-D realtimeOldestPendingSecondsWarn threshold, so the SLO and the alert agree rather than firing at different moments.",
  },
  provider_reliability: {
    sliId: "provider_reliability",
    targetRatio: 0.9,
    warnAtBudgetRemaining: 0.25,
    why: "One unhealthy provider out of ten is tolerable because the router can route around it; most of the fleet being unwell is not.",
  },
  dependency_readiness: {
    sliId: "dependency_readiness",
    targetRatio: 1.0,
    warnAtBudgetRemaining: 0.25,
    why: "A CRITICAL dependency is by definition one the runtime cannot serve without, so the only honest target is all of them. This is the 100%-target case the budget math handles explicitly.",
  },
};

export const SLI_IDS: readonly SliId[] = Object.keys(SLI_CATALOGUE) as SliId[];

export function sliDefinition(id: SliId): SliDefinition | undefined {
  return SLI_CATALOGUE[id];
}

export function sloTarget(id: SliId): SloTarget | undefined {
  return SLO_TARGETS[id];
}
