import {
  CancellationScope,
  defineSignal,
  isCancellation,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
// Relative, not the "@/" alias: Temporal bundles this file into its own
// deterministic webpack sandbox, which does not read the Next.js tsconfig
// path mapping. A relative path resolves identically in both.
import {
  FIRST_CHECK_DELAY_SECONDS,
  MAX_CONSECUTIVE_CHECK_FAILURES,
  MAX_STATUS_CHECKS,
  nextCheckDelaySeconds,
} from "../../src/lib/orchestration/async-polling-policy";
import type * as activities from "../activities/generation-activities";

/**
 * Cinefield GenerationWorkflow (Phase 6R.3) — the durable owner of one
 * generation's lifecycle.
 *
 * DETERMINISM
 * Temporal replays this function from history after every failure, restart
 * and deployment, so it must produce identical decisions from identical
 * history. That is why there is no database access, no fetch, no provider
 * SDK, no process.env, no Math.random and no Date.now here: all of it lives
 * behind the activity proxy below. `sleep` and `workflowInfo` are the
 * Temporal-provided, replay-safe equivalents of waiting and reading context.
 *
 * The one non-activity import is the polling policy — a pure constants module
 * with no imports of its own, so replay-safe by construction, and shared with
 * the Phase 6G controller so both transports wait on the same schedule.
 *
 * WHAT THIS WORKFLOW OWNS
 * Sequencing and waiting. It does NOT re-implement generation: submission,
 * status checks and finalization are the unchanged Phase 6 services, reached
 * through activities.
 *
 * SQS IS NOT HERE YET
 * The locked architecture puts provider work behind an SQS command queue
 * (6R.4/6R.5). Until then the submit activity calls the domain service
 * directly. When SQS lands, only the activity body changes — this workflow
 * does not.
 */

export const cancelGenerationSignal = defineSignal("cancelGeneration");

export interface GenerationWorkflowInput {
  generationId: string;
  /** Captured server-side from a verified Clerk session at start time. */
  clerkUserId: string;
}

export type GenerationWorkflowResult = {
  generationId: string;
  outcome: "completed" | "failed" | "cancelled" | "ambiguous" | "abandoned";
  attempts: number;
  errorCode?: string;
};

/**
 * Activity timeouts and retries.
 *
 * `submitGeneration` is deliberately given maximumAttempts: 1. Temporal's own
 * retry must never be what re-enters a provider submission — the attempt
 * claim in the activity already refuses a second submit, and letting Temporal
 * retry on top of that would only produce repeated "skipped" round-trips
 * while obscuring the real failure. Everything else is safely retryable
 * because it only reads or performs compare-and-set writes.
 */
const { submitGeneration } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 1 },
});

const { describeGeneration, ensureAttempt, checkGenerationStatus, recordWorkflowCorrelation } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "2 minutes",
    retry: { maximumAttempts: 5, initialInterval: "2 seconds", backoffCoefficient: 2 },
  });

/**
 * Cancellation cleanup must still run once the workflow is being cancelled,
 * so it is proxied separately and invoked inside a non-cancellable scope.
 */
const { cancelGeneration } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 3 },
});

export async function generationWorkflow(
  input: GenerationWorkflowInput
): Promise<GenerationWorkflowResult> {
  const { workflowId, runId } = workflowInfo();

  let cancelRequested = false;
  setHandler(cancelGenerationSignal, () => {
    cancelRequested = true;
  });

  let attemptId: string | null = null;
  let attempts = 0;

  try {
    const descriptor = await describeGeneration({
      generationId: input.generationId,
      clerkUserId: input.clerkUserId,
    });

    // A generation that already finished is reported, not re-run. This is
    // what makes starting the workflow twice harmless.
    if (descriptor.terminal) {
      return {
        generationId: input.generationId,
        outcome: descriptor.terminal === "completed" ? "completed" : descriptor.terminal,
        attempts: 0,
      };
    }

    await recordWorkflowCorrelation({ generationId: input.generationId, workflowId });

    const attempt = await ensureAttempt({
      generationId: input.generationId,
      provider: descriptor.provider,
      providerModel: descriptor.providerModel,
      workflowId,
      workflowRunId: runId,
    });
    attemptId = attempt.attemptId;
    attempts = attempt.attemptNo;

    if (cancelRequested) {
      return await finishCancelled(input.generationId, attemptId, attempts);
    }

    const submission = await submitGeneration({
      generationId: input.generationId,
      clerkUserId: input.clerkUserId,
      attemptId,
    });

    if (submission.result === "completed") {
      return { generationId: input.generationId, outcome: "completed", attempts };
    }

    if (submission.result === "failed") {
      return {
        generationId: input.generationId,
        outcome: "failed",
        attempts,
        errorCode: submission.errorCode,
      };
    }

    // The submission may have created a billable job but Cinefield cannot
    // prove it. Per the locked decision the workflow stops here: no retry, no
    // failover, evidence preserved for reconciliation.
    if (submission.result === "ambiguous") {
      return {
        generationId: input.generationId,
        outcome: "ambiguous",
        attempts,
        errorCode: submission.errorCode,
      };
    }

    // "skipped" means this activity re-ran after a claim already existed. The
    // provider job is (or may be) live, so fall through to polling rather
    // than submitting again.

    // ---- Async provider: poll until terminal --------------------------------
    let consecutiveFailures = 0;
    let lastErrorCode: string | undefined;

    for (let checkIndex = 0; checkIndex < MAX_STATUS_CHECKS; checkIndex += 1) {
      await sleep(
        (checkIndex === 0 ? FIRST_CHECK_DELAY_SECONDS : nextCheckDelaySeconds(checkIndex)) * 1000
      );

      if (cancelRequested) {
        return await finishCancelled(input.generationId, attemptId, attempts);
      }

      try {
        const status = await checkGenerationStatus({
          generationId: input.generationId,
          clerkUserId: input.clerkUserId,
          attemptId,
        });
        consecutiveFailures = 0;

        if (status.result === "completed") {
          return { generationId: input.generationId, outcome: "completed", attempts };
        }
        if (status.result === "failed") {
          return {
            generationId: input.generationId,
            outcome: "failed",
            attempts,
            errorCode: status.errorCode,
          };
        }
      } catch (caught) {
        if (isCancellation(caught)) throw caught;

        // A failed CHECK is not a failed job: the provider job is presumed
        // live, so keep checking within the failure budget. Never resubmit.
        consecutiveFailures += 1;
        lastErrorCode = caught instanceof Error ? caught.message : "UNKNOWN";
        if (consecutiveFailures >= MAX_CONSECUTIVE_CHECK_FAILURES) {
          return {
            generationId: input.generationId,
            outcome: "abandoned",
            attempts,
            errorCode: lastErrorCode,
          };
        }
      }
    }

    // Polling ceiling reached. The provider job may still be running and may
    // already have been billed, so the workflow abandons its own polling
    // without declaring the job failed. Evidence stays intact.
    return {
      generationId: input.generationId,
      outcome: "abandoned",
      attempts,
      errorCode: lastErrorCode,
    };
  } catch (caught) {
    if (isCancellation(caught)) {
      return await finishCancelled(input.generationId, attemptId, attempts);
    }
    throw caught;
  }
}

/**
 * Runs the cancellation activity in a non-cancellable scope so it completes
 * even though the workflow itself is being cancelled — otherwise the cleanup
 * would be cancelled along with everything else and the row would be stranded
 * in "processing".
 */
async function finishCancelled(
  generationId: string,
  attemptId: string | null,
  attempts: number
): Promise<GenerationWorkflowResult> {
  await CancellationScope.nonCancellable(async () => {
    await cancelGeneration({ generationId, attemptId });
  });
  return { generationId, outcome: "cancelled", attempts };
}
