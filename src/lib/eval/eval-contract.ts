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
}

export const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;
export const EVAL_SET_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,80}$/;
export const CASE_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,80}$/;

/** [0,1]. Below this a dimension's own score counts as a failure for that dimension. */
export const SCORE_PASS_THRESHOLD = 0.7;

export function verdictForScore(score: number | null): Verdict {
  if (score === null) return "inconclusive";
  if (!Number.isFinite(score) || score < 0 || score > 1) return "inconclusive";
  return score >= SCORE_PASS_THRESHOLD ? "pass" : "fail";
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
