import {
  SLI_CATALOGUE,
  SLO_TARGETS,
  type SliDimension,
  type SliId,
} from "./sli-catalogue";
import {
  computeBurnRate,
  computeErrorBudget,
  computeThresholdHeadroom,
  type BurnRateBucket,
} from "./error-budget";

/**
 * Bounded SLO snapshot evaluation (Phase 15-A).
 *
 * Turns one window's observation into one bounded verdict. Pure: no I/O, no
 * clock of its own — `evaluatedAt` is supplied, so a snapshot can be recomputed
 * from the same inputs and produce the same answer.
 *
 * ---------------------------------------------------------------------------
 * UNKNOWN IS NEVER HEALTHY
 * ---------------------------------------------------------------------------
 * The states below separate "we measured and it is fine" from "we could not
 * measure". That distinction is the whole point of this file. A query that
 * failed returns UNAVAILABLE, not zero errors; a window with three samples
 * returns INSUFFICIENT_DATA, not 100%. This is the same rule Phase 13 applies
 * to dependency health (UNKNOWN != HEALTHY) and Phase 14-E to artifacts
 * (UNKNOWN blocks), applied to reliability.
 *
 * ---------------------------------------------------------------------------
 * NO RAW DATA CROSSES THIS BOUNDARY
 * ---------------------------------------------------------------------------
 * A snapshot carries counts, ratios, an enum and a short code. There is no
 * field for a row, a prompt, an error message, a provider response, a URL, a
 * user or a workspace — and a snapshot is what any future Phase 16 surface or
 * telemetry sink would read, so the shape is the boundary.
 */

export type SloState =
  | "HEALTHY"
  | "AT_RISK"
  | "BREACHED"
  | "INSUFFICIENT_DATA"
  | "UNAVAILABLE";

/** Bounded measurement windows. This module does not schedule collection. */
export type SloWindow = "short" | "medium" | "long";

export const SLO_WINDOW_SECONDS: Readonly<Record<SloWindow, number>> = {
  short: 300,
  medium: 3_600,
  long: 86_400,
};

export type SloReasonCode =
  | "ok"
  | "budget_low"
  | "budget_exhausted"
  | "threshold_exceeded"
  | "insufficient_samples"
  | "source_unavailable"
  | "invalid_observation"
  | "invalid_target"
  | "unknown_sli";

/**
 * What an adapter hands in.
 *
 * `sourceAvailable` is separate from the counts on purpose. A failed query and
 * a genuinely empty window both produce zero rows, and collapsing them would
 * turn a broken database connection into a perfect score. An adapter that
 * could not read its source sets this false and the evaluation returns
 * UNAVAILABLE regardless of what the other fields say.
 */
export interface SliObservation {
  readonly sliId: SliId;
  readonly window: SloWindow;
  readonly sourceAvailable: boolean;
  /** Ratio SLIs: samples that met the good definition. */
  readonly goodCount?: number;
  /** Ratio SLIs: samples considered. */
  readonly totalCount?: number;
  /** Threshold SLIs: the measured value (ms for latency, seconds for age). */
  readonly observedValue?: number;
  /** Optional bounded dimension. Rejected if not allow-listed for this SLI. */
  readonly dimension?: { readonly kind: SliDimension; readonly value: string };
}

export interface SloSnapshot {
  readonly sliId: SliId;
  readonly window: SloWindow;
  readonly sampleCount: number;
  readonly goodCount: number;
  readonly badCount: number;
  /** Observed good fraction for ratios; null for threshold SLIs. */
  readonly observedRatio: number | null;
  /** Measured value for threshold SLIs; null for ratios. */
  readonly observedValue: number | null;
  /** The target this was judged against, echoed for reproducibility. */
  readonly target: number | null;
  /** 0..1, or null when it could not be computed. */
  readonly budgetRemaining: number | null;
  readonly burnRate: number | null;
  readonly burnRateBucket: BurnRateBucket | null;
  readonly state: SloState;
  readonly reasonCode: SloReasonCode;
  /** ISO-8601, supplied by the caller. */
  readonly evaluatedAt: string;
  /** Bounded dimension, or null for a global measurement. */
  readonly dimension: { readonly kind: SliDimension; readonly value: string } | null;
}

/** Bounded dimension values, mirroring the metric-label discipline. */
const DIMENSION_VALUE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/i;

function unavailable(
  o: SliObservation,
  reasonCode: SloReasonCode,
  evaluatedAt: string,
  state: SloState = "UNAVAILABLE"
): SloSnapshot {
  return {
    sliId: o.sliId,
    window: o.window,
    sampleCount: 0,
    goodCount: 0,
    badCount: 0,
    observedRatio: null,
    observedValue: null,
    target: null,
    budgetRemaining: null,
    burnRate: null,
    burnRateBucket: null,
    state,
    reasonCode,
    evaluatedAt,
    dimension: null,
  };
}

/**
 * Evaluates one observation into one snapshot. Never throws.
 *
 * A thrown evaluator would let a reliability calculation break the thing it
 * measures; every failure path here becomes a state instead, and none of
 * those states is HEALTHY.
 */
export function evaluateSlo(observation: SliObservation, evaluatedAt: string): SloSnapshot {
  try {
    const definition = SLI_CATALOGUE[observation.sliId];
    const target = SLO_TARGETS[observation.sliId];
    if (!definition || !target) return unavailable(observation, "unknown_sli", evaluatedAt);

    // Source could not be read. Checked FIRST: no count is trustworthy when
    // the thing that produced it failed.
    if (!observation.sourceAvailable) {
      return unavailable(observation, "source_unavailable", evaluatedAt);
    }

    // A dimension outside the SLI's allow-list is dropped rather than
    // honoured — this is the cardinality guard, and silently accepting an
    // unknown label is how a metrics backend acquires a user id.
    let dimension: SloSnapshot["dimension"] = null;
    if (observation.dimension) {
      const allowed =
        definition.allowedDimensions.includes(observation.dimension.kind) &&
        DIMENSION_VALUE_PATTERN.test(observation.dimension.value);
      dimension = allowed ? observation.dimension : null;
    }

    if (definition.kind === "ratio") {
      return evaluateRatio(observation, definition.minimumSamples, target.targetRatio, target.warnAtBudgetRemaining, evaluatedAt, dimension);
    }
    return evaluateThreshold(observation, target.maxValue, target.warnAtBudgetRemaining, evaluatedAt, dimension);
  } catch {
    return unavailable(observation, "source_unavailable", evaluatedAt);
  }
}

function evaluateRatio(
  o: SliObservation,
  minimumSamples: number,
  targetRatio: number | undefined,
  warnAt: number,
  evaluatedAt: string,
  dimension: SloSnapshot["dimension"]
): SloSnapshot {
  if (typeof targetRatio !== "number") return unavailable(o, "invalid_target", evaluatedAt);

  const goodCount = o.goodCount ?? 0;
  const totalCount = o.totalCount ?? 0;

  const budget = computeErrorBudget({ targetRatio, goodCount, totalCount, minimumSamples });

  if (!budget.ok) {
    const state: SloState =
      budget.error === "insufficient_samples" ? "INSUFFICIENT_DATA" : "UNAVAILABLE";
    const reason: SloReasonCode =
      budget.error === "insufficient_samples"
        ? "insufficient_samples"
        : budget.error === "invalid_target"
          ? "invalid_target"
          : "invalid_observation";
    return {
      ...unavailable(o, reason, evaluatedAt, state),
      sampleCount: totalCount,
      target: targetRatio,
    };
  }

  const { budgetRemaining, observedBadRatio, allowedBadRatio, exhausted } = budget.value;
  const burn = computeBurnRate({ observedBadRatio, allowedBadRatio });

  const state: SloState = exhausted ? "BREACHED" : budgetRemaining <= warnAt ? "AT_RISK" : "HEALTHY";

  return {
    sliId: o.sliId,
    window: o.window,
    sampleCount: totalCount,
    goodCount,
    badCount: totalCount - goodCount,
    observedRatio: totalCount > 0 ? goodCount / totalCount : null,
    observedValue: null,
    target: targetRatio,
    budgetRemaining,
    burnRate: burn.ok ? burn.value.rate : null,
    burnRateBucket: burn.ok ? burn.value.bucket : null,
    state,
    reasonCode: exhausted ? "budget_exhausted" : state === "AT_RISK" ? "budget_low" : "ok",
    evaluatedAt,
    dimension,
  };
}

function evaluateThreshold(
  o: SliObservation,
  maxValue: number | undefined,
  warnAt: number,
  evaluatedAt: string,
  dimension: SloSnapshot["dimension"]
): SloSnapshot {
  if (typeof maxValue !== "number") return unavailable(o, "invalid_target", evaluatedAt);
  if (typeof o.observedValue !== "number") {
    return { ...unavailable(o, "insufficient_samples", evaluatedAt, "INSUFFICIENT_DATA"), target: maxValue };
  }

  const headroom = computeThresholdHeadroom({ observedValue: o.observedValue, maxValue });
  if (!headroom.ok) {
    return {
      ...unavailable(o, headroom.error === "invalid_target" ? "invalid_target" : "invalid_observation", evaluatedAt),
      target: maxValue,
    };
  }

  const { budgetRemaining, exhausted } = headroom.value;
  const state: SloState = exhausted ? "BREACHED" : budgetRemaining <= warnAt ? "AT_RISK" : "HEALTHY";

  return {
    sliId: o.sliId,
    window: o.window,
    sampleCount: o.totalCount ?? 1,
    goodCount: exhausted ? 0 : 1,
    badCount: exhausted ? 1 : 0,
    observedRatio: null,
    observedValue: o.observedValue,
    target: maxValue,
    budgetRemaining,
    // A threshold SLI has no allocated error budget to consume over time, so
    // it has no burn RATE. Reporting one would invite comparison against
    // ratio burn rates that mean something different.
    burnRate: null,
    burnRateBucket: null,
    state,
    reasonCode: exhausted ? "threshold_exceeded" : state === "AT_RISK" ? "budget_low" : "ok",
    evaluatedAt,
    dimension,
  };
}

/** True only for states that positively demonstrate the objective is met. */
export function isSloHealthy(snapshot: SloSnapshot): boolean {
  return snapshot.state === "HEALTHY";
}
