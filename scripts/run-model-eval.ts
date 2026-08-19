import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { GOLDEN_EVAL_CASES, GOLDEN_EVAL_SET_KEY } from "@/lib/eval/golden-dataset";
import { runEval, type ProducedOutput } from "@/lib/eval/eval-runner";
import type { EvalCase, EvalRunIdentity } from "@/lib/eval/eval-contract";
import { parseScorePassThreshold } from "@/lib/eval/eval-contract";
import type { CostObservation } from "@/lib/finops/cost-contract";

/**
 * Cinefield model-eval CLI (Phase 22-A).
 *
 * ---------------------------------------------------------------------------
 * A PIPELINE SMOKE TEST, NOT A REAL QUALITY MEASUREMENT
 * ---------------------------------------------------------------------------
 * The `produceOutput` below is SYNTHETIC — no provider is called, no
 * generation happens, no money is spent. It proves the eval PIPELINE end to
 * end (start_model_eval_run -> per-case scoring -> durable results ->
 * complete_model_eval_run -> a real quality_score row `eval-quality-
 * provider.ts` can read) with real database writes and 22-A's own done
 * criterion ("the first model/provider experiment record is created with
 * immutable metadata") genuinely satisfied by running this once.
 *
 * A REAL measurement — wiring `produceOutput` to an actual `ProviderAdapter`
 * call — is a deliberate, separately-authorized action for whoever operates
 * this script locally to make, exactly like every other "never trigger paid
 * generation automatically" boundary this project holds (docs/security-
 * gates.md's standing rule, cited in eval-runner.ts's own header). This CLI
 * intentionally does not do that substitution itself.
 *
 * Usage: MODEL_VERSION_ID=<uuid> PROVIDER_ID=mock PROVIDER_MODEL_ID=mock-v1 \
 *        npx tsx --conditions=react-server scripts/run-model-eval.ts
 */

function syntheticCostObservation(providerId: string, modelId: string): CostObservation {
  return {
    provider: providerId,
    modelId,
    basis: "ESTIMATE_BASED",
    state: "known",
    estimatedCost: 0.01,
    currency: "USD",
    reasonCode: "synthetic_smoke_test",
    observedAt: new Date().toISOString(),
  };
}

async function synthesizeOutput(evalCase: EvalCase, providerId: string, providerModelId: string): Promise<ProducedOutput> {
  return {
    outputUrl: `https://synthetic-eval.invalid/${evalCase.caseKey}`,
    succeeded: true,
    latencyMs: 1500,
    cost: syntheticCostObservation(providerId, providerModelId),
    moderation: null,
  };
}

async function main(): Promise<void> {
  const modelVersionId = process.env.MODEL_VERSION_ID;
  const providerId = process.env.PROVIDER_ID;
  const providerModelId = process.env.PROVIDER_MODEL_ID;

  if (!modelVersionId || !providerId || !providerModelId) {
    console.error(
      "run-model-eval: NOT_CONFIGURED — MODEL_VERSION_ID, PROVIDER_ID, and PROVIDER_MODEL_ID must all be set."
    );
    process.exit(2);
  }
  if (!isSupabaseAdminConfigured()) {
    console.error("run-model-eval: NOT_CONFIGURED — Supabase admin credentials are unavailable.");
    process.exit(2);
  }

  const identity: EvalRunIdentity = {
    modelVersionId,
    providerId,
    providerModelId,
    evalSetKey: GOLDEN_EVAL_SET_KEY,
    evaluator: "cinefield-eval",
    evaluatorVersion: "1.0.0",
  };

  // No default. A missing/malformed threshold means every threshold-driven
  // dimension records "inconclusive", never a fabricated pass — see
  // eval-contract.ts's parseScorePassThreshold header.
  const scorePassThreshold = parseScorePassThreshold(process.env.MODEL_EVAL_SCORE_PASS_THRESHOLD);
  if (scorePassThreshold === null) {
    console.log(
      "run-model-eval: NOTE — MODEL_EVAL_SCORE_PASS_THRESHOLD is not set (or not a number in [0,1]). " +
        "Per-case pass/fail verdicts will be recorded as inconclusive; this does not block the run — " +
        "evidence is still written durably. Set it to opt into pass/fail labeling."
    );
  }

  const admin = getSupabaseAdminClient();
  const outcome = await runEval(
    admin,
    identity,
    GOLDEN_EVAL_CASES,
    (evalCase) => synthesizeOutput(evalCase, providerId, providerModelId),
    undefined,
    scorePassThreshold
  );

  if (outcome.outcome !== "completed") {
    console.error(`run-model-eval: ${outcome.outcome}`);
    process.exit(1);
  }

  const failedCount = outcome.results.filter((r) => r.failed).length;
  console.log(
    `run-model-eval: run ${outcome.runId} completed — ${outcome.results.length} case(s), ${failedCount} failed. ` +
      "SYNTHETIC data — see this script's own header."
  );
}

main().catch((error) => {
  console.error("run-model-eval: unexpected error", error);
  process.exit(1);
});
