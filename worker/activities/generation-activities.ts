/**
 * Cinefield Temporal activities for GenerationWorkflow (Phase 6R.3).
 *
 * Everything non-deterministic lives here: database reads and writes, the
 * provider adapter, storage, secrets. The workflow (../workflows/
 * generation-workflow.ts) contains none of it.
 *
 * REUSE, NOT REIMPLEMENTATION
 * These are thin wrappers. The generation logic itself is still the Phase 6
 * code, unchanged and uncopied:
 *   executeGeneration()       claim → normalize → route → validate → submit →
 *                             finalize (src/lib/orchestration/orchestrator.ts)
 *   checkAsyncGeneration()    one transport-neutral status check + the shared
 *                             finalization tail
 *   markCancelled()           the cancellation compare-and-set
 * What is new is the attempt bookkeeping around them, which is what makes an
 * at-least-once activity retry safe.
 *
 * AT-LEAST-ONCE
 * Temporal may run any of these twice. None of them assumes single execution:
 * every state change is a compare-and-set, and the one that can cost money —
 * submission — is gated by claimAttemptForSubmission().
 */

import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import { toOrchestrationError } from "@/lib/orchestration/errors";
import { findModel } from "@/lib/orchestration/model-registry";
import { checkAsyncGeneration } from "@/lib/orchestration/orchestrator";
import { markCancelled } from "@/lib/orchestration/status-manager";
import { submitAttempt } from "@/lib/orchestration/attempt-submission-service";
import {
  cancelPendingAttempt,
  createAttempt,
  markAttemptTerminal,
  readActiveAttempt,
  readAttempt,
} from "@/lib/orchestration/attempt-repository";
import { getCommandBus } from "@/lib/contracts/command-bus";
import { commandIdFor } from "@/lib/contracts/command-wire";
import { isSqsCommandBusEnabled } from "@/lib/aws/sqs-config";
import type { Generation } from "@/types/database";

/** What the workflow learns about a generation before doing anything. */
export interface GenerationDescriptor {
  generationId: string;
  clerkUserId: string;
  provider: string;
  providerModel: string;
  /** Terminal rows are reported so the workflow can finish without acting. */
  terminal: "completed" | "failed" | "cancelled" | null;
}

export interface SubmitOutcome {
  /**
   * "completed" only for synchronous providers that finish inside submit().
   * "dispatched" means the command went to the SQS provider queue and the
   * provider worker owns the actual submission — the workflow then observes
   * the attempt row until it moves.
   */
  result: "completed" | "processing" | "failed" | "ambiguous" | "skipped" | "dispatched";
  attemptId: string;
  errorCode?: string;
}

export interface StatusOutcome {
  result: "completed" | "processing" | "failed";
  errorCode?: string;
}

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:activity]", JSON.stringify(fields));
}

/**
 * Loads the generation and resolves its provider from the SERVER-SIDE model
 * registry — never from the workflow argument, so a workflow started with a
 * stale or forged provider cannot redirect execution.
 */
export async function describeGeneration(params: {
  generationId: string;
  clerkUserId: string;
}): Promise<GenerationDescriptor> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("generations")
    .select("*")
    .eq("id", params.generationId)
    .maybeSingle();

  if (error || !data) {
    throw toOrchestrationError(
      new Error("GENERATION_NOT_FOUND")
    );
  }

  const generation = data as Generation;
  // Ownership is verified here as well as inside executeGeneration: an
  // activity must never widen what the workflow may touch.
  if (generation.clerk_user_id !== params.clerkUserId) {
    throw toOrchestrationError(new Error("FORBIDDEN"));
  }

  const model = findModel(generation.model);
  if (!model) {
    throw toOrchestrationError(new Error("UNKNOWN_MODEL"));
  }

  const terminal =
    generation.status === "completed" ||
    generation.status === "failed" ||
    generation.status === "cancelled"
      ? generation.status
      : null;

  return {
    generationId: generation.id,
    clerkUserId: generation.clerk_user_id,
    provider: model.providerId,
    providerModel: model.providerModelId,
    terminal,
  };
}

/**
 * Returns the attempt the workflow should drive: the one already active, or a
 * freshly opened one.
 *
 * Reusing an active attempt rather than always inserting is what makes this
 * activity safe to retry — a second run finds the attempt its predecessor
 * created instead of opening a parallel submission. The "one active attempt"
 * partial unique index is the backstop if two runs race here.
 */
export async function ensureAttempt(params: {
  generationId: string;
  provider: string;
  providerModel: string;
  workflowId: string;
  workflowRunId: string;
}): Promise<{ attemptId: string; attemptNo: number; reused: boolean }> {
  const admin = getSupabaseAdminClient();

  const active = await readActiveAttempt(admin, params.generationId);
  if (active) {
    log({ generationId: params.generationId, attemptId: active.id, result: "attempt_reused" });
    return { attemptId: active.id, attemptNo: active.attempt_no, reused: true };
  }

  const created = await createAttempt(admin, {
    generationId: params.generationId,
    provider: params.provider,
    providerModel: params.providerModel,
    workflowId: params.workflowId,
    workflowRunId: params.workflowRunId,
  });

  log({ generationId: params.generationId, attemptId: created.id, result: "attempt_created" });
  return { attemptId: created.id, attemptNo: created.attempt_no, reused: false };
}

/**
 * Submits the generation to its provider — or, in SQS dispatch mode, hands
 * the command to the queue and lets the provider worker own the submission.
 *
 * The submission logic itself lives in ONE place either way:
 * `submitAttempt` in attempt-submission-service.ts, whose atomic claim is
 * the B3 gate. This activity is a transport decision, nothing more:
 *
 *   SQS disabled (default)  → call submitAttempt directly (in-process)
 *   SQS enabled             → enqueue provider.submit; the worker calls the
 *                             SAME submitAttempt on receive
 *
 * Enqueueing is safe to retry: the command id is deterministic
 * (`provider.submit:<attemptId>`), so a redispatch deduplicates inside the
 * FIFO queue, and even a delivered duplicate dies on the attempt claim.
 * Temporal workflow code never talks to SQS — this activity is exactly the
 * "Temporal → activity → CommandBus → SQS" boundary the architecture locks.
 */
export async function submitGeneration(params: {
  generationId: string;
  clerkUserId: string;
  attemptId: string;
}): Promise<SubmitOutcome> {
  if (isSqsCommandBusEnabled()) {
    await getCommandBus().enqueue({
      queue: "provider",
      command: {
        type: "provider.submit",
        generationId: params.generationId,
        attemptId: params.attemptId,
      },
      idempotencyKey: commandIdFor("provider.submit", params.attemptId),
    });
    log({
      generationId: params.generationId,
      attemptId: params.attemptId,
      result: "dispatched",
    });
    return { result: "dispatched", attemptId: params.attemptId };
  }

  return await submitAttempt(params);
}

/**
 * One status check of an async provider job, delegating to the unchanged
 * Phase 6C continuation entry point — the same function a webhook or a
 * WebSocket listener calls. Completion runs the shared Phase 6F finalization
 * tail, including its single-flight lease, so a duplicate activity cannot
 * upload the output twice.
 *
 * A thrown check is a CHECK failure, not a job failure: the row stays
 * processing and the workflow simply checks again. Nothing here resubmits.
 */
export async function checkGenerationStatus(params: {
  generationId: string;
  clerkUserId: string;
  attemptId: string;
}): Promise<StatusOutcome> {
  const admin = getSupabaseAdminClient();

  const outcome = await checkAsyncGeneration({
    generationId: params.generationId,
    clerkUserId: params.clerkUserId,
    source: "poll",
  });

  if (outcome.status === "completed") {
    await markAttemptTerminal(admin, params.attemptId, { status: "succeeded" });
    return { result: "completed" };
  }
  if (outcome.status === "failed") {
    await markAttemptTerminal(admin, params.attemptId, { status: "failed" });
    return { result: "failed" };
  }
  return { result: "processing" };
}

export interface CancelOutcome {
  /**
   * false means an attempt is currently claimed/submitting — a handler (this
   * same generation's in-process submit, or the SQS provider worker) may be
   * talking to the provider RIGHT NOW. Nothing was written; the caller must
   * wait and retry rather than force it. true means the race is resolved:
   * the caller should re-read the attempt to learn what actually happened
   * (it may have completed, failed, or genuinely have nothing left to send).
   */
  settled: boolean;
}

/**
 * Cancels a generation, but ONLY once it is safe to do so.
 *
 * THE FIX for a Phase 6R Package B review finding: the previous version
 * unconditionally force-closed the attempt via markAttemptTerminal, whose
 * predicate matches claimed/submitting — exactly the window in which a
 * handler may be mid-flight with a provider. Doing that let the handler's
 * own terminal write (recordProviderJob / recordFailedWithJobEvidence /
 * recordAmbiguousSubmission, all guarded on claimed/submitting) silently
 * no-op once the row left that set, erasing every trace of a job that may
 * already be billed — the exact failure this whole architecture exists to
 * prevent, and reachable in the mainline cancel path for both in-process and
 * SQS-dispatched submissions.
 *
 * `markCancelled` is the unchanged Phase 6 compare-and-set: it only applies
 * from queued/processing, so a completion that already won cannot be undone.
 * Below that, only a 'pending' attempt (nothing ever sent) is force-closed —
 * any other resolved state is left exactly as the submission machinery
 * wrote it, since that row is the truthful record of what happened at the
 * provider.
 */
export async function cancelGeneration(params: {
  generationId: string;
  attemptId: string | null;
}): Promise<CancelOutcome> {
  const admin = getSupabaseAdminClient();

  if (params.attemptId) {
    const attempt = await readAttempt(admin, params.attemptId);
    if (attempt && (attempt.status === "claimed" || attempt.status === "submitting")) {
      log({
        generationId: params.generationId,
        attemptId: params.attemptId,
        result: "cancel_deferred",
        attemptStatus: attempt.status,
      });
      return { settled: false };
    }
  }

  const { data } = await admin
    .from("generations")
    .select("metadata")
    .eq("id", params.generationId)
    .maybeSingle();

  const cancelled = await markCancelled(
    admin,
    params.generationId,
    (data?.metadata ?? null) as Record<string, unknown> | null
  );

  if (params.attemptId) {
    await cancelPendingAttempt(admin, params.attemptId);
  }

  log({ generationId: params.generationId, result: "cancel_settled", applied: cancelled });
  return { settled: true };
}

/** Records the workflow's deterministic id on the generation row. */
export async function recordWorkflowCorrelation(params: {
  generationId: string;
  workflowId: string;
}): Promise<void> {
  const admin = getSupabaseAdminClient();
  // Only sets it when absent, so a re-run cannot repoint an existing
  // correlation at a different workflow.
  await admin
    .from("generations")
    .update({ temporal_workflow_id: params.workflowId })
    .eq("id", params.generationId)
    .is("temporal_workflow_id", null);
}

/** Fetches an attempt for workflow decisions that need its evidence. */
export async function getAttempt(params: { attemptId: string }) {
  const admin = getSupabaseAdminClient();
  return await readAttempt(admin, params.attemptId);
}
