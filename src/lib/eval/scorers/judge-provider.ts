import type { EvalCase, ScoreDimension } from "../eval-contract";

/**
 * Where an AI-judge score would come from (Phase 22-B).
 *
 * ---------------------------------------------------------------------------
 * ADVISORY EVIDENCE, NEVER EXECUTION AUTHORITY
 * ---------------------------------------------------------------------------
 * Mirrors `route-quality.ts`'s `QualitySignalProvider`/`NO_TRUSTED_QUALITY_SOURCE`
 * seam exactly, for the same reason: the interface a real judge could
 * implement is built now; the real judge is not, because judging
 * prompt-adherence/visual-quality/consistency from an output URL requires a
 * live, paid, vision-capable model call this batch is not authorized to
 * trigger automatically (see docs/security-gates.md's standing "never press
 * Generate, never call a paid provider without explicit authorization"
 * rule, and this project's own established pattern for every other
 * paid-service seam: Glue, Kafka, an OPA sidecar, LaunchDarkly — build the
 * abstraction honestly disabled, defer the live backend).
 *
 * `NO_JUDGE_AVAILABLE` is not a stub awaiting a TODO; it is the correct
 * production answer until a real judge is deliberately wired in, and every
 * caller treats its `inconclusive` verdict as real absence-of-evidence, not
 * a passing or failing score.
 *
 * ---------------------------------------------------------------------------
 * BOUNDED STRUCTURED OUTPUT ONLY — NO CHAIN-OF-THOUGHT
 * ---------------------------------------------------------------------------
 * A real implementation of this interface must return `JudgeVerdict` exactly
 * — a score, a short reason code, nothing else. There is no field for the
 * judge's reasoning text, and none should ever be added: persisting a
 * judge's chain-of-thought is exactly the kind of unbounded evidence this
 * whole eval pipeline's sensitive-data boundary forbids.
 */

export interface JudgeVerdict {
  /** [0,1], or null when the judge could not produce a confident score. */
  readonly score: number | null;
  readonly reasonCode: string;
}

export interface AiJudgeProvider {
  judge(dimension: ScoreDimension, evalCase: EvalCase, outputUrl: string | null): Promise<JudgeVerdict>;
}

export const NO_JUDGE_AVAILABLE: AiJudgeProvider = {
  async judge(): Promise<JudgeVerdict> {
    return { score: null, reasonCode: "no_judge_configured" };
  },
};
