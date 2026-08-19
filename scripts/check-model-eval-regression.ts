import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { latestCompletedRun } from "@/lib/eval/eval-store";

/**
 * Cinefield model-eval regression gate (Phase 22-C).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * 22-C's own done-criterion is "Threshold aşan upgrade default route
 * olamıyor" — an upgrade exceeding the regression threshold cannot become
 * the default route. This script is the REAL, structurally-complete gate
 * mechanism: it reads the candidate's and baseline's durable
 * `model_eval_runs`/`model_eval_results` (20260908000000_model_eval.sql)
 * and refuses to pass when the candidate has no real eval evidence, or when
 * its measured quality has regressed past the configured threshold.
 *
 * It does NOT itself run generations against real providers — doing that
 * automatically in CI would mean this script silently spending real
 * provider budget on every PR touching routing, which is exactly the
 * "no live paid generation without explicit authorization" line this whole
 * project holds everywhere else (Phase 8's own "never press Generate"
 * standing rule; Phase 20/21's identical stance on Kafka/LaunchDarkly).
 * Populating a candidate's eval run is a deliberate, separate,
 * explicitly-authorized action (`npm run eval:run`, see eval-runner.ts) —
 * this script only GATES on whatever evidence already exists.
 *
 * ---------------------------------------------------------------------------
 * FAIL CLOSED — MISSING EVIDENCE IS NEVER A PASS
 * ---------------------------------------------------------------------------
 * No completed run for the candidate: NO_EVIDENCE, exit 1. No completed run
 * for the baseline: NOT_CONFIGURED, exit 2 (mirrors check-contract-
 * compatibility.ts's own NOT_CONFIGURED/exit-2 convention for "nothing to
 * compare against" — never a silent pass).
 *
 * ---------------------------------------------------------------------------
 * THE THRESHOLD IS A REQUIRED INPUT, NEVER AN INVENTED DEFAULT
 * ---------------------------------------------------------------------------
 * The roadmap names no specific number for "how much quality regression is
 * tolerable" — that is a real business decision, not something this script
 * invents. `MODEL_EVAL_REGRESSION_THRESHOLD` must be set explicitly; its
 * absence is NOT_CONFIGURED, not a default of 0 or any other number someone
 * might mistake for a considered value.
 */

interface Args {
  candidateProviderId: string;
  candidateProviderModelId: string;
  baselineProviderId: string;
  baselineProviderModelId: string;
}

function parseArgs(): Args | null {
  const candidateProviderId = process.env.EVAL_CANDIDATE_PROVIDER_ID;
  const candidateProviderModelId = process.env.EVAL_CANDIDATE_PROVIDER_MODEL_ID;
  const baselineProviderId = process.env.EVAL_BASELINE_PROVIDER_ID;
  const baselineProviderModelId = process.env.EVAL_BASELINE_PROVIDER_MODEL_ID;
  if (!candidateProviderId || !candidateProviderModelId || !baselineProviderId || !baselineProviderModelId) {
    return null;
  }
  return { candidateProviderId, candidateProviderModelId, baselineProviderId, baselineProviderModelId };
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args) {
    console.error(
      "check-model-eval-regression: NOT_CONFIGURED — EVAL_CANDIDATE_PROVIDER_ID/EVAL_CANDIDATE_PROVIDER_MODEL_ID/" +
        "EVAL_BASELINE_PROVIDER_ID/EVAL_BASELINE_PROVIDER_MODEL_ID must all be set. No comparison was made."
    );
    process.exit(2);
  }

  const thresholdRaw = process.env.MODEL_EVAL_REGRESSION_THRESHOLD;
  const threshold = thresholdRaw === undefined ? NaN : Number(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    console.error(
      "check-model-eval-regression: NOT_CONFIGURED — MODEL_EVAL_REGRESSION_THRESHOLD must be set to a number in [0,1]. " +
        "No default is assumed; this is a business decision, not a code constant."
    );
    process.exit(2);
  }

  if (!isSupabaseAdminConfigured()) {
    console.error("check-model-eval-regression: NOT_CONFIGURED — Supabase admin credentials are unavailable.");
    process.exit(2);
  }
  const admin = getSupabaseAdminClient();

  const baseline = await latestCompletedRun(admin, args.baselineProviderId, args.baselineProviderModelId);
  if (!baseline || baseline.meanScores.quality_score === undefined) {
    console.error(
      `check-model-eval-regression: NOT_CONFIGURED — no completed baseline eval run for ${args.baselineProviderId}/${args.baselineProviderModelId}.`
    );
    process.exit(2);
  }

  const candidate = await latestCompletedRun(admin, args.candidateProviderId, args.candidateProviderModelId);
  if (!candidate || candidate.meanScores.quality_score === undefined) {
    console.error(
      `check-model-eval-regression: NO_EVIDENCE — ${args.candidateProviderId}/${args.candidateProviderModelId} has no completed golden-dataset eval run. ` +
        "A model/provider upgrade may not become the default route without being measured first."
    );
    process.exit(1);
  }

  const baselineQuality = baseline.meanScores.quality_score;
  const candidateQuality = candidate.meanScores.quality_score;
  const regression = baselineQuality - candidateQuality;

  console.log(
    `check-model-eval-regression: baseline=${baselineQuality.toFixed(3)} candidate=${candidateQuality.toFixed(3)} ` +
      `regression=${regression.toFixed(3)} threshold=${threshold}`
  );

  if (regression > threshold) {
    console.error(
      `check-model-eval-regression: REGRESSION DETECTED — candidate quality dropped by ${regression.toFixed(3)}, ` +
        `exceeding the configured threshold of ${threshold}.`
    );
    process.exit(1);
  }

  if (candidate.failedCaseCount > 0) {
    console.error(
      `check-model-eval-regression: ${candidate.failedCaseCount}/${candidate.caseCount} golden-dataset case(s) failed outright for the candidate.`
    );
    process.exit(1);
  }

  console.log("check-model-eval-regression: no regression beyond threshold, no failed cases. PASS.");
}

main().catch((error) => {
  console.error("check-model-eval-regression: unexpected error", error);
  process.exit(1);
});
