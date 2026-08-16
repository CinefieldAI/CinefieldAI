/**
 * Error budget and burn-rate mathematics (Phase 15-A).
 *
 *   error budget = kabul edilen hata payı
 *   burn rate    = hata payının ne hızla tüketildiği
 *
 * Pure functions. No I/O, no clock, no randomness — the same inputs always
 * produce the same outputs, which is what makes a reliability number
 * auditable months later.
 *
 * ---------------------------------------------------------------------------
 * NaN AND Infinity ARE NOT POSSIBLE HERE, BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 * Every division guards its denominator, every input is validated before use,
 * and every return path is either a finite number or an explicit
 * "cannot compute" result. That matters more than it sounds: a NaN burn rate
 * compares false against every threshold, so a broken calculation would
 * silently read as "not breaching" — failing open on exactly the signal meant
 * to tell you something is wrong.
 */

/** A computation that could not produce a number, and why. */
export type BudgetError =
  | "invalid_target"
  | "invalid_observation"
  | "insufficient_samples"
  | "not_applicable";

export interface BudgetResult {
  /** Fraction of the allowed error budget still unspent, clamped to [0,1]. */
  readonly budgetRemaining: number;
  /** Observed bad fraction, clamped to [0,1]. */
  readonly observedBadRatio: number;
  /** Allowed bad fraction, i.e. 1 - target. Zero when the target is 100%. */
  readonly allowedBadRatio: number;
  readonly exhausted: boolean;
}

export type BudgetOutcome =
  | { readonly ok: true; readonly value: BudgetResult }
  | { readonly ok: false; readonly error: BudgetError };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Error budget for a ratio SLO.
 *
 *   allowed_bad = 1 - target
 *   remaining   = (allowed_bad - observed_bad) / allowed_bad
 *
 * THE 100% TARGET IS A REAL CASE, NOT AN EDGE CASE. `dependency_readiness`
 * targets 1.0, which makes `allowed_bad` exactly zero and the division above
 * undefined. It is handled explicitly rather than guarded against: with no
 * budget to spend, any bad observation at all is total exhaustion, and a
 * perfect observation is a full budget. Computing 0/0 here would produce NaN,
 * which compares false against every threshold and would therefore report a
 * breach as healthy.
 */
export function computeErrorBudget(params: {
  targetRatio: number;
  goodCount: number;
  totalCount: number;
  minimumSamples: number;
}): BudgetOutcome {
  const { targetRatio, goodCount, totalCount, minimumSamples } = params;

  if (!isFiniteNumber(targetRatio) || targetRatio < 0 || targetRatio > 1) {
    return { ok: false, error: "invalid_target" };
  }
  if (
    !isFiniteNumber(goodCount) ||
    !isFiniteNumber(totalCount) ||
    goodCount < 0 ||
    totalCount < 0 ||
    goodCount > totalCount
  ) {
    // A good count above the total is not a large budget; it is a broken
    // caller, and treating it as a pass would hide the bug.
    return { ok: false, error: "invalid_observation" };
  }
  if (totalCount === 0 || totalCount < Math.max(1, minimumSamples)) {
    return { ok: false, error: "insufficient_samples" };
  }

  const observedBadRatio = clamp01((totalCount - goodCount) / totalCount);
  const allowedBadRatio = clamp01(1 - targetRatio);

  if (allowedBadRatio === 0) {
    // 100% target: no budget exists to partially consume.
    return {
      ok: true,
      value: {
        budgetRemaining: observedBadRatio > 0 ? 0 : 1,
        observedBadRatio,
        allowedBadRatio: 0,
        exhausted: observedBadRatio > 0,
      },
    };
  }

  const budgetRemaining = clamp01((allowedBadRatio - observedBadRatio) / allowedBadRatio);
  return {
    ok: true,
    value: {
      budgetRemaining,
      observedBadRatio,
      allowedBadRatio,
      exhausted: budgetRemaining <= 0,
    },
  };
}

/**
 * Burn rate buckets.
 *
 * A bucket rather than a raw float, because the raw number is the input to a
 * decision and buckets are what a decision can be written against. The
 * roadmap defines no multi-window paging policy, so none is invented here:
 * these describe consumption speed and nothing more. Whether a given bucket
 * pages anyone is Phase 13-D's routing decision and, later, Phase 16's.
 */
export type BurnRateBucket = "none" | "slow" | "elevated" | "fast" | "critical";

export interface BurnRateResult {
  /** Finite, non-negative. Capped so a pathological ratio stays comparable. */
  readonly rate: number;
  readonly bucket: BurnRateBucket;
}

export type BurnRateOutcome =
  | { readonly ok: true; readonly value: BurnRateResult }
  | { readonly ok: false; readonly error: BudgetError };

/** Above this the rate is reported as the cap; it is already "as bad as it gets". */
export const BURN_RATE_CAP = 100;

/**
 * burn_rate = observed_bad_ratio / allowed_bad_ratio
 *
 * A rate of 1 means the budget is being consumed exactly as fast as it was
 * allocated; 10 means ten times faster.
 *
 * The 100%-target case has no denominator and therefore no meaningful rate —
 * it returns `not_applicable` rather than Infinity. "Infinitely fast" is not
 * a number a threshold can be written against, and `dependency_readiness`
 * already expresses that condition through `exhausted`.
 */
export function computeBurnRate(params: {
  observedBadRatio: number;
  allowedBadRatio: number;
}): BurnRateOutcome {
  const { observedBadRatio, allowedBadRatio } = params;

  if (!isFiniteNumber(observedBadRatio) || observedBadRatio < 0 || observedBadRatio > 1) {
    return { ok: false, error: "invalid_observation" };
  }
  if (!isFiniteNumber(allowedBadRatio) || allowedBadRatio < 0 || allowedBadRatio > 1) {
    return { ok: false, error: "invalid_target" };
  }
  if (allowedBadRatio === 0) return { ok: false, error: "not_applicable" };

  const raw = observedBadRatio / allowedBadRatio;
  const rate = Math.min(BURN_RATE_CAP, Math.max(0, raw));

  return { ok: true, value: { rate, bucket: bucketFor(rate) } };
}

function bucketFor(rate: number): BurnRateBucket {
  if (rate <= 0) return "none";
  if (rate < 1) return "slow";
  if (rate < 2) return "elevated";
  if (rate < 10) return "fast";
  return "critical";
}

/**
 * Budget for a threshold SLI (latency p95, queue age) rather than a ratio.
 *
 * There is no "error budget" in the ratio sense here — the observation either
 * sits under the ceiling or it does not. Remaining headroom is reported on the
 * same 0..1 scale so a caller can treat every SLI uniformly, but the meaning
 * is different and the name says so.
 */
export function computeThresholdHeadroom(params: {
  observedValue: number;
  maxValue: number;
}): BudgetOutcome {
  const { observedValue, maxValue } = params;

  if (!isFiniteNumber(maxValue) || maxValue <= 0) return { ok: false, error: "invalid_target" };
  if (!isFiniteNumber(observedValue) || observedValue < 0) {
    return { ok: false, error: "invalid_observation" };
  }

  const usedFraction = clamp01(observedValue / maxValue);
  const remaining = clamp01(1 - usedFraction);

  return {
    ok: true,
    value: {
      budgetRemaining: remaining,
      observedBadRatio: usedFraction,
      allowedBadRatio: 1,
      exhausted: observedValue > maxValue,
    },
  };
}
