import type { EvalCase, ScoreResult } from "../eval-contract";
import { verdictForScore } from "../eval-contract";
import type { AiJudgeProvider } from "./judge-provider";

/**
 * The three judgment-requiring dimensions (Phase 22-B): prompt adherence,
 * visual/output quality, and character/temporal consistency. All three go
 * through the same `AiJudgeProvider` seam — see judge-provider.ts's header
 * for why no real judge is wired in this batch.
 */
async function judgeDimension(
  dimension: "adherence" | "quality" | "consistency",
  judge: AiJudgeProvider,
  evalCase: EvalCase,
  outputUrl: string | null
): Promise<ScoreResult> {
  const verdict = await judge.judge(dimension, evalCase, outputUrl);
  return { dimension, score: verdict.score, verdict: verdictForScore(verdict.score), reasonCode: verdict.reasonCode };
}

export function scoreAdherence(judge: AiJudgeProvider, evalCase: EvalCase, outputUrl: string | null): Promise<ScoreResult> {
  return judgeDimension("adherence", judge, evalCase, outputUrl);
}

export function scoreQuality(judge: AiJudgeProvider, evalCase: EvalCase, outputUrl: string | null): Promise<ScoreResult> {
  return judgeDimension("quality", judge, evalCase, outputUrl);
}

export function scoreConsistency(judge: AiJudgeProvider, evalCase: EvalCase, outputUrl: string | null): Promise<ScoreResult> {
  return judgeDimension("consistency", judge, evalCase, outputUrl);
}
