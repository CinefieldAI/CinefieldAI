/**
 * Cinefield model evaluation contract (Phase 22-A/B).
 *
 * The bounded shapes every scorer, the eval store, and the regression gate
 * share. Mirrors the discipline `route-quality.ts` already established for
 * the signal this whole module ultimately feeds: no chain-of-thought, no
 * raw provider payload, no secret, every score either a real [0,1] number
 * or explicitly absent — never a fabricated stand-in for "not measured."
 */

export type TaskType = "image" | "video" | "audio";

/** A golden-dataset case — source-controlled, never a database row. See golden-dataset.ts. */
export interface EvalCase {
  readonly caseKey: string;
  readonly evalSetKey: string;
  readonly taskType: TaskType;
  /** Synthetic, non-sensitive by construction — never a real user's prompt. */
  readonly prompt: string;
  readonly criteria: {
    readonly mustContain?: readonly string[];
    readonly mustNotContain?: readonly string[];
    readonly maxLatencyMs?: number;
    readonly maxCost?: number;
  };
}

export type ScoreDimension =
  | "adherence"
  | "quality"
  | "consistency"
  | "safety"
  | "latency"
  | "cost"
  | "failure";

export type Verdict = "pass" | "fail" | "inconclusive";

/**
 * One scorer's output for one case. `score` is null when the dimension
 * could not be measured (e.g. no live AI judge configured) — a null score
 * is what makes the caller's own reason honest, distinct from "measured
 * and scored zero."
 */
export interface ScoreResult {
  readonly dimension: ScoreDimension;
  readonly score: number | null;
  readonly verdict: Verdict;
  readonly reasonCode: string;
}

export interface CaseResult {
  readonly caseKey: string;
  readonly scores: readonly ScoreResult[];
  readonly latencyMs: number | null;
  readonly costAmount: number | null;
  readonly costCurrency: string | null;
  readonly failed: boolean;
  readonly verdict: Verdict;
  readonly reasonCode: string;
}

export interface EvalRunIdentity {
  readonly modelVersionId: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly evalSetKey: string;
  readonly evaluator: string;
  readonly evaluatorVersion: string;
  /**
   * Read from `generations.metadata.semanticVersion` (compatibility-seam.ts),
   * never recomputed — absent when the run's evidence did not originate
   * from a generation admitted through the manifest/compiler path (e.g. the
   * synthetic CLI smoke run, or a sample whose generation used the primary
   * POST /api/generate path, which carries no manifest at all).
   */
  readonly manifestVersion?: string;
  readonly compilerVersion?: string;
}

export const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;
export const EVAL_SET_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,80}$/;
export const CASE_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,80}$/;

/**
 * PHASE 22 CORRECTIVE BATCH — THRESHOLD GOVERNANCE
 *
 * There used to be a hardcoded `SCORE_PASS_THRESHOLD = 0.7` here. The
 * Phase 22 closure audit found it had no roadmap source and no prior
 * repository authority — the Phase 22 roadmap section names no numeric
 * threshold anywhere, for any purpose. It coincidentally matched
 * `route-quality.ts`'s pre-existing `DEFAULT_QUALITY_POLICY.minConfidence`,
 * but that gates a different question (is a route's quality SIGNAL trusted
 * enough to move routing) than this one (did a single case's own score
 * clear the bar for "pass"). Retaining an invented number as if it were
 * settled business policy would keep giving every stored `verdict` an
 * authority nobody actually granted it.
 *
 * The per-case pass/fail cutoff is now a REQUIRED, explicit, validated
 * input — the same discipline check-model-eval-regression.ts's own
 * `MODEL_EVAL_REGRESSION_THRESHOLD` already established for the (different)
 * candidate-vs-baseline regression tolerance. The two thresholds answer
 * different business questions and are never merged into one constant or
 * one env var.
 *
 * Fail-safe by construction: `threshold === null` (missing/malformed —
 * see `parseScorePassThreshold`) means every dimension using it is
 * INCONCLUSIVE, never a fabricated pass.
 *
 * PHASE 22 FINAL NARROW CORRECTIVE BATCH — an empty or whitespace-only
 * string must NOT reach `Number(...)` directly: `Number("") === 0` and
 * `Number("   ") === 0` in JavaScript, so a blank env value would silently
 * parse as a valid, maximally-permissive threshold of `0` instead of
 * "not configured" — exactly the fabricated-pass hole this function exists
 * to prevent. The empty-string case is rejected explicitly, before any
 * numeric conversion is attempted, so this can never depend on `Number`'s
 * own coercion rules for blank input.
 */
export function parseScorePassThreshold(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const normalized = raw.trim();
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

export function verdictForScore(score: number | null, threshold: number | null): Verdict {
  if (threshold === null) return "inconclusive";
  if (score === null) return "inconclusive";
  if (!Number.isFinite(score) || score < 0 || score > 1) return "inconclusive";
  return score >= threshold ? "pass" : "fail";
}

/**
 * A case's own verdict: FAIL if any dimension failed, INCONCLUSIVE if
 * nothing failed but something could not be measured, PASS only if every
 * dimension that WAS measured passed. Never PASS on missing evidence — the
 * same "fail closed" rule the regression gate (check-model-eval-regression.ts)
 * applies one level up.
 */
export function caseVerdict(scores: readonly ScoreResult[]): { verdict: Verdict; reasonCode: string } {
  const failed = scores.find((s) => s.verdict === "fail");
  if (failed) return { verdict: "fail", reasonCode: `${failed.dimension}_failed` };

  const inconclusive = scores.find((s) => s.verdict === "inconclusive");
  if (inconclusive) return { verdict: "inconclusive", reasonCode: `${inconclusive.dimension}_unmeasured` };

  return { verdict: "pass", reasonCode: "all_dimensions_passed" };
}
