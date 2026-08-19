import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvalRunIdentity, CaseResult } from "./eval-contract";
import type { QualitySignal } from "@/lib/routing/route-quality";

/**
 * The durable eval store (Phase 22-A). Server-only, service-role only —
 * `model_eval_runs`/`model_eval_results` have RLS enabled with no
 * `authenticated` policy, matching every other durable-audit table in this
 * repo (20260908000000_model_eval.sql).
 */

export type StartRunOutcome = { outcome: "started"; runId: string } | { outcome: "failed"; errorCode: string };

export async function startEvalRun(
  admin: SupabaseClient,
  identity: EvalRunIdentity,
  metadata: Record<string, unknown> = {}
): Promise<StartRunOutcome> {
  const { data, error } = await admin.rpc("start_model_eval_run", {
    p_model_version_id: identity.modelVersionId,
    p_provider_id: identity.providerId,
    p_provider_model_id: identity.providerModelId,
    p_eval_set_key: identity.evalSetKey,
    p_evaluator: identity.evaluator,
    p_evaluator_version: identity.evaluatorVersion,
    p_metadata: metadata,
  });
  if (error || !data) return { outcome: "failed", errorCode: "start_run_failed" };
  return { outcome: "started", runId: String(data) };
}

export type RecordResultOutcome = { outcome: "recorded" } | { outcome: "failed"; errorCode: string };

/** One row per case — never batched into the run's own metadata, so a partial run's results are already durable if the process dies partway through. */
export async function recordEvalCaseResult(
  admin: SupabaseClient,
  runId: string,
  result: CaseResult
): Promise<RecordResultOutcome> {
  const byDimension = new Map(result.scores.map((s) => [s.dimension, s]));
  const { error } = await admin.from("model_eval_results").insert({
    run_id: runId,
    case_key: result.caseKey,
    adherence_score: byDimension.get("adherence")?.score ?? null,
    quality_score: byDimension.get("quality")?.score ?? null,
    consistency_score: byDimension.get("consistency")?.score ?? null,
    safety_score: byDimension.get("safety")?.score ?? null,
    latency_ms: result.latencyMs,
    cost_amount: result.costAmount,
    cost_currency: result.costCurrency,
    failed: result.failed,
    verdict: result.verdict,
    reason_code: result.reasonCode,
  });
  if (error) return { outcome: "failed", errorCode: "record_result_failed" };
  return { outcome: "recorded" };
}

export type CompleteRunOutcome = { outcome: "completed" } | { outcome: "not_found_or_already_terminal" } | { outcome: "failed"; errorCode: string };

export async function completeEvalRun(
  admin: SupabaseClient,
  runId: string,
  status: "completed" | "failed"
): Promise<CompleteRunOutcome> {
  const { data, error } = await admin.rpc("complete_model_eval_run", { p_run_id: runId, p_status: status });
  if (error) return { outcome: "failed", errorCode: "complete_run_failed" };
  return data === true ? { outcome: "completed" } : { outcome: "not_found_or_already_terminal" };
}

export interface EvalRunSummary {
  readonly runId: string;
  readonly modelVersionId: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly evalSetKey: string;
  readonly evaluator: string;
  readonly evaluatorVersion: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  /** Mean of each case's non-null dimension scores actually measured — never a default. */
  readonly meanScores: Readonly<Record<string, number>>;
  readonly caseCount: number;
  readonly failedCaseCount: number;
}

/** The latest COMPLETED run for one provider/model pair — what the regression gate and the admin dashboard both read as "the current measurement." */
export async function latestCompletedRun(
  admin: SupabaseClient,
  providerId: string,
  providerModelId: string
): Promise<EvalRunSummary | null> {
  const { data: run, error } = await admin
    .from("model_eval_runs")
    .select("id, model_version_id, provider_id, provider_model_id, eval_set_key, evaluator, evaluator_version, status, started_at, completed_at")
    .eq("provider_id", providerId)
    .eq("provider_model_id", providerModelId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !run) return null;

  const { data: results } = await admin
    .from("model_eval_results")
    .select("adherence_score, quality_score, consistency_score, safety_score, failed")
    .eq("run_id", run.id);

  const rows = (results ?? []) as Record<string, unknown>[];
  const meanScores = meanByDimension(rows);
  const failedCaseCount = rows.filter((r) => r.failed === true).length;

  return {
    runId: String(run.id),
    modelVersionId: String(run.model_version_id),
    providerId: String(run.provider_id),
    providerModelId: String(run.provider_model_id),
    evalSetKey: String(run.eval_set_key),
    evaluator: String(run.evaluator),
    evaluatorVersion: String(run.evaluator_version),
    status: String(run.status),
    startedAt: String(run.started_at),
    completedAt: run.completed_at ? String(run.completed_at) : null,
    meanScores,
    caseCount: rows.length,
    failedCaseCount,
  };
}

function meanByDimension(rows: Record<string, unknown>[]): Record<string, number> {
  const dimensions = ["adherence_score", "quality_score", "consistency_score", "safety_score"] as const;
  const means: Record<string, number> = {};
  for (const dim of dimensions) {
    const values = rows.map((r) => r[dim]).filter((v): v is number => typeof v === "number");
    if (values.length > 0) means[dim] = values.reduce((a, b) => a + b, 0) / values.length;
  }
  return means;
}

/**
 * The `QualitySignalProvider`-shaped read (Phase 7-D's own interface,
 * route-quality.ts) — built here rather than in a separate file so the
 * mapping from a durable run summary to the exact signal shape the router
 * seam expects has one, reviewable definition. See
 * eval-quality-provider.ts for the wiring into `QualitySignalProvider`
 * itself.
 */
export async function qualitySignalFor(
  admin: SupabaseClient,
  providerId: string,
  providerModelId: string
): Promise<QualitySignal | null> {
  const run = await latestCompletedRun(admin, providerId, providerModelId);
  if (!run || run.caseCount === 0) return null;

  const quality = run.meanScores.quality_score;
  if (quality === undefined) return null;

  return {
    providerId: run.providerId,
    providerModelId: run.providerModelId,
    score: quality,
    // Confidence is NOT the judge's own confidence (no live judge exists
    // yet — see judge-provider.ts) — it is derived from how much of the
    // golden dataset this run actually measured without failing, a real,
    // computable signal in the meantime.
    confidence: run.caseCount > 0 ? (run.caseCount - run.failedCaseCount) / run.caseCount : 0,
    sampleCount: run.caseCount,
    evaluatedAt: run.completedAt ?? run.startedAt,
    evaluator: run.evaluator,
    evaluatorVersion: run.evaluatorVersion,
  };
}
