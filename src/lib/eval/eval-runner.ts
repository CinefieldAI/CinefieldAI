import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostObservation } from "@/lib/finops/cost-contract";
import type { ModerationResult } from "@/lib/media/moderation-contract";
import type { EvalCase, EvalRunIdentity, CaseResult } from "./eval-contract";
import { caseVerdict } from "./eval-contract";
import { scoreLatency } from "./scorers/latency-scorer";
import { scoreCost } from "./scorers/cost-scorer";
import { scoreSafety } from "./scorers/safety-scorer";
import { scoreFailure } from "./scorers/failure-scorer";
import { scoreAdherence, scoreQuality, scoreConsistency } from "./scorers/judge-scorers";
import { NO_JUDGE_AVAILABLE, type AiJudgeProvider } from "./scorers/judge-provider";
import { startEvalRun, recordEvalCaseResult, completeEvalRun } from "./eval-store";
import { enqueueEventStandalone } from "@/lib/events/outbox-repository";
import { buildDomainEvent } from "@/lib/events/domain-event";

/**
 * The eval run orchestrator (Phase 22-A/B).
 *
 * ---------------------------------------------------------------------------
 * PROVIDER-AGNOSTIC BY DEPENDENCY INJECTION — NEVER CALLS A PROVIDER ITSELF
 * ---------------------------------------------------------------------------
 * `runEvalCase()`/`runEval()` never import a `ProviderAdapter` or call a
 * real generation path. The caller supplies `produceOutput`, matching the
 * same offline-first discipline this whole codebase has used since its
 * first real provider integration: the mock provider proves the pipeline at
 * zero cost, and a real provider is a deliberate, separately-authorized
 * substitution — never something a library function reaches for on its own.
 * This is also what makes `runEval()` genuinely unit-testable without a
 * live call or a paid generation of any kind.
 */

export interface ProducedOutput {
  readonly outputUrl: string | null;
  readonly succeeded: boolean;
  readonly latencyMs: number | null;
  readonly cost: CostObservation;
  readonly moderation: ModerationResult | null;
}

export type ProduceOutputFn = (evalCase: EvalCase) => Promise<ProducedOutput>;

export async function runEvalCase(
  evalCase: EvalCase,
  produceOutput: ProduceOutputFn,
  judge: AiJudgeProvider = NO_JUDGE_AVAILABLE
): Promise<CaseResult> {
  const produced = await produceOutput(evalCase);

  const scores = await Promise.all([
    Promise.resolve(scoreFailure(produced.succeeded)),
    Promise.resolve(scoreLatency(evalCase, produced.latencyMs)),
    Promise.resolve(scoreCost(evalCase, produced.cost)),
    Promise.resolve(scoreSafety(produced.moderation)),
    scoreAdherence(judge, evalCase, produced.outputUrl),
    scoreQuality(judge, evalCase, produced.outputUrl),
    scoreConsistency(judge, evalCase, produced.outputUrl),
  ]);

  const { verdict, reasonCode } = caseVerdict(scores);

  return {
    caseKey: evalCase.caseKey,
    scores,
    latencyMs: produced.latencyMs,
    costAmount: produced.cost.state === "known" ? (produced.cost.estimatedCost ?? null) : null,
    costCurrency: produced.cost.state === "known" ? (produced.cost.currency ?? null) : null,
    failed: !produced.succeeded,
    verdict,
    reasonCode,
  };
}

export type RunEvalOutcome =
  | { outcome: "completed"; runId: string; results: readonly CaseResult[] }
  | { outcome: "start_failed"; errorCode: string }
  | { outcome: "no_cases" };

/**
 * Runs a full golden-dataset set against one model/provider pairing, one
 * case at a time, recording each result durably as it completes — a process
 * that dies partway through leaves real, already-durable partial evidence
 * behind rather than an all-or-nothing transaction (deliberately: a real
 * eval run against real providers can span minutes to hours across many
 * cases, unlike `set_feature_flag()`'s single-statement atomic write).
 */
export async function runEval(
  admin: SupabaseClient,
  identity: EvalRunIdentity,
  cases: readonly EvalCase[],
  produceOutput: ProduceOutputFn,
  judge: AiJudgeProvider = NO_JUDGE_AVAILABLE
): Promise<RunEvalOutcome> {
  if (cases.length === 0) return { outcome: "no_cases" };

  const started = await startEvalRun(admin, identity, { caseCount: cases.length });
  if (started.outcome === "failed") return { outcome: "start_failed", errorCode: started.errorCode };

  const results: CaseResult[] = [];
  for (const evalCase of cases) {
    const result = await runEvalCase(evalCase, produceOutput, judge);
    results.push(result);
    await recordEvalCaseResult(admin, started.runId, result);
  }

  const anyHardFailure = results.some((r) => r.failed);
  const status: "completed" | "failed" = anyHardFailure ? "failed" : "completed";
  await completeEvalRun(admin, started.runId, status);

  const qualityScores = results.map((r) => r.scores.find((s) => s.dimension === "quality")?.score).filter((s): s is number => typeof s === "number");
  const meanQualityScore = qualityScores.length > 0 ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : null;

  // Best-effort notification — see feature-flag-admin-service.ts's own
  // header for the identical "durable write already happened, the event is
  // not a reason to report failure" reasoning this batch reuses verbatim.
  try {
    await enqueueEventStandalone(
      buildDomainEvent({
        eventType: "audit.eval-run-completed",
        eventVersion: 1,
        aggregateType: "model_eval_run",
        aggregateId: started.runId,
        payload: {
          runId: started.runId,
          providerId: identity.providerId,
          providerModelId: identity.providerModelId,
          evalSetKey: identity.evalSetKey,
          status,
          caseCount: results.length,
          failedCaseCount: results.filter((r) => r.failed).length,
          meanQualityScore,
        },
      })
    );
  } catch {
    // Deliberately swallowed — see header.
  }

  return { outcome: "completed", runId: started.runId, results };
}
