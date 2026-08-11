import {
  CancellationScope,
  condition,
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
  CANCEL_SETTLE_MAX_ATTEMPTS,
  CANCEL_SETTLE_INTERVAL_SECONDS,
  FIRST_CHECK_DELAY_SECONDS,
  MAX_CONSECUTIVE_CHECK_FAILURES,
  MAX_DISPATCH_PICKUP_CHECKS,
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

/**
 * Sent by the VERIFIED provider webhook boundary (Phase 6R.10) after it has
 * durably recorded what an authenticated provider callback observed.
 *
 * WHY THE PAYLOAD IS ONLY A HINT
 * The workflow does NOT act on `status` as authority. A signal payload is
 * whatever the sender put in it; treating it as truth would let a
 * mis-normalized (or, if verification ever regressed, forged) callback
 * drive finalization. Instead the signal only WAKES the existing polling
 * loop early, and that loop still calls checkGenerationStatus, which
 * re-reads the provider through the normal adapter path and runs the
 * shared, lease-guarded finalization tail. So a webhook makes the workflow
 * react in seconds instead of at the next poll, without becoming a second
 * source of truth or a second finalization path.
 *
 * That design is also what makes duplicate and out-of-order signals free:
 * waking an already-awake loop is a no-op, and a signal arriving after the
 * workflow finished is delivered to nobody. `providerJobId`/`attemptId` are
 * carried for correlation logging only — never to select a different
 * attempt than the one this workflow already owns.
 */
export interface ProviderEventSignalInput {
  attemptId: string;
  providerJobId: string;
  /** Normalized observation, used as a wake hint only — never as authority. */
  status: "processing" | "completed" | "failed";
}

export const providerEventSignal = defineSignal<[ProviderEventSignalInput]>("providerEvent");

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
 * `submitGeneration` IS safe to retry, at every one of its two transport
 * shapes:
 *   - in-process: the activity's own atomic claim (claimAttemptForSubmission,
 *     the B3 gate) refuses a second submit outright, AND executeGeneration's
 *     own claimGeneration on the generations row provides a second,
 *     independent guard — a retry that races ahead of a still-running first
 *     attempt fails at one of those two claims before ever reaching
 *     adapter.submit(). It never reaches the provider twice.
 *   - SQS dispatch: the command id is deterministic
 *     (`provider.submit:<attemptId>`), so a redispatch collapses inside the
 *     FIFO queue's own deduplication, and even a delivered duplicate still
 *     dies on the same attempt claim once the worker calls submitAttempt.
 *
 * A previous version pinned this to maximumAttempts: 1 specifically to keep
 * Temporal's retry from re-entering a submission — but that protection was
 * already provided by the claims above, and the side effect was that a
 * single transient SQS SendMessage failure (throttling, a brief network
 * blip) permanently stranded the generation in "queued" with no code path
 * that ever marked it failed (Phase 6R Package B review). A small retryable
 * policy fixes that stranding without reopening any double-submit risk.
 */
const { submitGeneration } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3, initialInterval: "2 seconds", backoffCoefficient: 2 },
});

const {
  describeGeneration,
  ensureAttempt,
  checkGenerationStatus,
  recordWorkflowCorrelation,
  getAttempt,
} = proxyActivities<typeof activities>({
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

/**
 * Attempts to finalize cancellation right now. Returns the workflow's final
 * result once the race is resolved, or null when an attempt is currently
 * claimed/submitting — a handler may be talking to a provider RIGHT NOW, and
 * forcing cancellation into that window would let its own evidence-
 * persisting write silently no-op, erasing proof of a job that may already
 * be billed (Phase 6R Package B review). Callers must not force it: the two
 * poll/dispatch-observe loops just fall through and retry on their own
 * existing cadence; the two checkpoints that lack a natural loop of their
 * own use waitForCancellationToSettle below instead.
 */
async function settleCancellation(
  generationId: string,
  attemptId: string | null,
  attempts: number
): Promise<GenerationWorkflowResult | null> {
  const outcome = await cancelGeneration({ generationId, attemptId });
  if (!outcome.settled) return null;

  if (!attemptId) {
    return { generationId, outcome: "cancelled", attempts };
  }

  // cancelGeneration only settles once the attempt is no longer
  // claimed/submitting, so it is now safe to read its true resting state —
  // never assume "cancelled": a cancel request can lose to a generation
  // that already finished, and the attempt itself is the truthful record.
  const attempt = await getAttempt({ attemptId });
  if (!attempt || attempt.status === "cancelled" || attempt.status === "pending") {
    return { generationId, outcome: "cancelled", attempts };
  }
  if (attempt.status === "succeeded") {
    return { generationId, outcome: "completed", attempts };
  }
  if (attempt.status === "failed") {
    return {
      generationId,
      outcome: attempt.submission_evidence === "ambiguous" ? "ambiguous" : "failed",
      attempts,
      errorCode: attempt.error_code ?? undefined,
    };
  }
  if (attempt.status === "claimed" || attempt.status === "submitting") {
    // Should be unreachable: cancelGeneration only reports settled=true once
    // the attempt has left this window. If a fresh claim raced in during the
    // narrow gap between that check and this read, do not falsely report
    // "cancelled" while a submission may be starting — report "abandoned" so
    // nothing downstream treats this generation as safely done.
    return { generationId, outcome: "abandoned", attempts };
  }
  // submitted/processing: a real job exists and generations.status was
  // cancelled (or was already terminal) above — the attempt keeps its true
  // evidence rather than being overwritten to hide that a job may exist.
  return { generationId, outcome: "cancelled", attempts };
}

/**
 * Loops settleCancellation with a short backoff until it resolves or the
 * grace window elapses. Used at the two checkpoints that have no loop of
 * their own to retry on (before the first submission, and a hard Temporal
 * cancellation's cleanup) — the dispatch/poll loops elsewhere just retry on
 * their own existing cadence instead of calling this.
 */
async function waitForCancellationToSettle(
  generationId: string,
  attemptId: string | null,
  attempts: number
): Promise<GenerationWorkflowResult> {
  for (let i = 0; i < CANCEL_SETTLE_MAX_ATTEMPTS; i += 1) {
    const settled = await settleCancellation(generationId, attemptId, attempts);
    if (settled) return settled;
    await sleep(CANCEL_SETTLE_INTERVAL_SECONDS * 1000);
  }
  // Exhausted the grace window: the attempt is still claimed/submitting
  // somewhere. Do not force a "cancelled" outcome and do not force the
  // attempt terminal — leave both exactly as the live handler will
  // eventually write them, for generation-reconcile (Phase 6R.11) to
  // resolve. The row stays "processing", never falsely "cancelled".
  return { generationId, outcome: "abandoned", attempts };
}

export async function generationWorkflow(
  input: GenerationWorkflowInput
): Promise<GenerationWorkflowResult> {
  const { workflowId, runId } = workflowInfo();

  let cancelRequested = false;
  setHandler(cancelGenerationSignal, () => {
    cancelRequested = true;
  });

  // Bumped by every provider webhook signal. The wait loops below watch it
  // and cut their sleep short when it changes, so a webhook shortens the
  // time to the next status check rather than performing any work itself.
  // A monotonic counter (not a boolean) means two signals arriving during
  // one sleep cannot lose the second one.
  let providerEventCount = 0;
  setHandler(providerEventSignal, () => {
    providerEventCount += 1;
  });

  /**
   * Sleeps up to `seconds`, returning early if a provider webhook signal
   * arrives. Idempotent by construction: an extra signal only ends a sleep
   * sooner, and the loop that follows re-checks authoritative state through
   * checkGenerationStatus either way, so no duplicate or reordered signal
   * can produce a different outcome than the poll alone would have.
   */
  async function sleepOrProviderEvent(seconds: number): Promise<void> {
    const seen = providerEventCount;
    await condition(() => providerEventCount !== seen, seconds * 1000);
  }

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
      return await waitForCancellationToSettle(input.generationId, attemptId, attempts);
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

    // ---- SQS dispatch mode: observe the attempt row, never the queue --------
    // The provider worker owns the submission now. The workflow watches the
    // attempt row — the durable truth the worker writes — and reacts to
    // whatever it becomes. It never reads SQS and never resubmits.
    if (submission.result === "dispatched") {
      let providerJobLive = false;

      for (let waitIndex = 0; waitIndex < MAX_DISPATCH_PICKUP_CHECKS; waitIndex += 1) {
        await sleepOrProviderEvent(
          waitIndex === 0 ? FIRST_CHECK_DELAY_SECONDS : nextCheckDelaySeconds(waitIndex)
        );

        if (cancelRequested) {
          const settled = await settleCancellation(input.generationId, attemptId, attempts);
          if (settled) return settled;
          // Not yet safe (attempt claimed/submitting) — fall through and let
          // this loop's own sleep above be the backoff before retrying.
        }

        const attempt = await getAttempt({ attemptId });
        if (!attempt) break;

        if (attempt.status === "succeeded") {
          return { generationId: input.generationId, outcome: "completed", attempts };
        }
        if (attempt.status === "cancelled") {
          return await finishCancelled(input.generationId, attemptId, attempts);
        }
        if (attempt.status === "failed") {
          return {
            generationId: input.generationId,
            outcome: attempt.submission_evidence === "ambiguous" ? "ambiguous" : "failed",
            attempts,
            errorCode: attempt.error_code ?? undefined,
          };
        }
        if (attempt.status === "submitted" || attempt.status === "processing") {
          providerJobLive = true;
          break;
        }
        // pending/claimed: the worker has not finished the submission yet.
      }

      if (!providerJobLive) {
        // Worker down, queue stalled, or the command parked in the DLQ. The
        // attempt row still holds whatever evidence exists — abandoning the
        // wait never destroys it and never resubmits.
        return { generationId: input.generationId, outcome: "abandoned", attempts };
      }
    }

    // "skipped" means this activity re-ran after a claim already existed. The
    // provider job is (or may be) live, so fall through to polling rather
    // than submitting again.

    // ---- Async provider: poll until terminal --------------------------------
    let consecutiveFailures = 0;
    let lastErrorCode: string | undefined;

    for (let checkIndex = 0; checkIndex < MAX_STATUS_CHECKS; checkIndex += 1) {
      await sleepOrProviderEvent(
        checkIndex === 0 ? FIRST_CHECK_DELAY_SECONDS : nextCheckDelaySeconds(checkIndex)
      );

      if (cancelRequested) {
        const settled = await settleCancellation(input.generationId, attemptId, attempts);
        if (settled) return settled;
        // Not yet safe — fall through and let this loop's own sleep above
        // be the backoff before retrying.
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
 * Runs cancellation settlement in a non-cancellable scope so it completes
 * even though the workflow itself is being torn down by a HARD Temporal
 * cancellation (workflow.cancel(), as opposed to the cancelGeneration
 * signal) — otherwise the cleanup would be cancelled along with everything
 * else and the row would be stranded in "processing". Still waits out the
 * claimed/submitting window via waitForCancellationToSettle rather than
 * forcing it, for the same reason every other cancellation path does: Wall-
 * clock inside nonCancellable is not itself cancellable, so `sleep` here is
 * safe and still bounded by CANCEL_SETTLE_MAX_ATTEMPTS.
 */
async function finishCancelled(
  generationId: string,
  attemptId: string | null,
  attempts: number
): Promise<GenerationWorkflowResult> {
  return await CancellationScope.nonCancellable(() =>
    waitForCancellationToSettle(generationId, attemptId, attempts)
  );
}
