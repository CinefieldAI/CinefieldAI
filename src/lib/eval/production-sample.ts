/**
 * Online feedback sampling (Phase 22-D).
 *
 * "Production sample'larını online evaluation/feedback pipeline'a gönder" —
 * send production samples into the online eval/feedback pipeline. This is
 * a PURE selection function, the same honest shape
 * `src/lib/feature-flags/canary-guardrail.ts` already established for this
 * exact class of concern: a real, tested decision layer with no automated,
 * unattended caller, because (confirmed during Phase 21's own research and
 * still true) no `schedules.task()`/cron exists anywhere in this repository
 * to invoke anything on a schedule. Wiring a live periodic sampler is
 * `LIVE_DEFERRED`, not fabricated here.
 *
 * WHAT IT SELECTS, AND WHY THIS SHAPE
 * A completed `generation_attempts` row already carries `model_version_id`/
 * `model_route_id` (Phase 7-A) and `latency_ms`/`cost_amount` — real
 * production evidence a scorer can operate on without a golden-dataset
 * fixture. Failed attempts are sampled too, deliberately: "kötü örnekleri
 * golden dataset'e ekle" (add bad examples to the golden dataset) is the
 * roadmap's own instruction, and a sampler that only ever saw successes
 * could never surface a regression production users actually hit.
 */

export interface AttemptSampleCandidate {
  readonly attemptId: string;
  readonly generationId: string;
  readonly modelVersionId: string | null;
  readonly modelRouteId: string | null;
  readonly status: string;
  readonly latencyMs: number | null;
  readonly outputUrl: string | null;
}

export interface SampleSelection {
  readonly attemptId: string;
  readonly reasonCode: "failed_attempt" | "random_success_sample";
}

export interface SamplePolicy {
  /** Every failed attempt is sampled — this is not subject to the rate. */
  readonly successSampleRate: number;
}

export const DEFAULT_SAMPLE_POLICY: SamplePolicy = { successSampleRate: 0.01 };

/**
 * Deterministic given the same `randomValue` sequence — a caller supplies
 * randomness explicitly (never `Math.random()` internally) so this stays a
 * pure, seed-testable function, the same discipline
 * `feature-flags/flag-evaluation.ts` already applies.
 */
export function selectProductionSamples(
  attempts: readonly AttemptSampleCandidate[],
  randomValues: readonly number[],
  policy: SamplePolicy = DEFAULT_SAMPLE_POLICY
): SampleSelection[] {
  const selections: SampleSelection[] = [];
  attempts.forEach((attempt, index) => {
    if (!attempt.modelVersionId || !attempt.modelRouteId) return; // unroutable evidence, same reasoning as Phase 11-A's own "unroutable" refusal
    if (attempt.status === "failed" || attempt.status === "failed_retryable") {
      selections.push({ attemptId: attempt.attemptId, reasonCode: "failed_attempt" });
      return;
    }
    if (attempt.status !== "completed") return;
    const roll = randomValues[index % randomValues.length] ?? 1;
    if (roll < policy.successSampleRate) {
      selections.push({ attemptId: attempt.attemptId, reasonCode: "random_success_sample" });
    }
  });
  return selections;
}
