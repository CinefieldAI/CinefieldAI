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
import { checkAsyncGeneration, executeGeneration } from "@/lib/orchestration/orchestrator";
import {
  markCancelled,
  readPersistedProviderJob,
} from "@/lib/orchestration/status-manager";
import {
  claimAttemptForSubmission,
  createAttempt,
  markAttemptSubmitting,
  markAttemptTerminal,
  readActiveAttempt,
  readAttempt,
  recordAmbiguousSubmission,
  recordProviderJob,
} from "@/lib/orchestration/attempt-repository";
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
  /** "completed" only for synchronous providers that finish inside submit(). */
  result: "completed" | "processing" | "failed" | "ambiguous" | "skipped";
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
 * Submits the generation to its provider — the only activity that can cost
 * money, and therefore the one with the strictest guard.
 *
 * Order of operations, and why:
 *   1. claimAttemptForSubmission — a conditional UPDATE requiring
 *      pending + evidence 'none' + no job id. A retry of this activity fails
 *      it and returns "skipped" WITHOUT calling the provider. This is the
 *      locked B3 rule.
 *   2. markAttemptSubmitting — written BEFORE the provider call, so a crash
 *      during the call leaves durable proof that a request may be in flight.
 *   3. executeGeneration — the unchanged Phase 6 chain.
 *   4. Record the outcome against the attempt.
 *
 * On failure the Phase 6 orchestrator has already classified the error
 * fail-closed (Phase 6E: ambiguous unless the code proves no job was
 * created). That classification is mirrored onto the attempt here, so the
 * relational evidence and the metadata evidence agree.
 */
export async function submitGeneration(params: {
  generationId: string;
  clerkUserId: string;
  attemptId: string;
}): Promise<SubmitOutcome> {
  const admin = getSupabaseAdminClient();

  const claimed = await claimAttemptForSubmission(admin, params.attemptId);
  if (!claimed) {
    // Already claimed, already submitted, or already carries evidence. A
    // second provider call here is exactly the duplicate charge this whole
    // package exists to prevent.
    log({ generationId: params.generationId, attemptId: params.attemptId, result: "submit_skipped" });
    return { result: "skipped", attemptId: params.attemptId };
  }

  await markAttemptSubmitting(admin, params.attemptId);

  const startedAt = Date.now();
  try {
    const outcome = await executeGeneration({
      generationId: params.generationId,
      clerkUserId: params.clerkUserId,
    });

    // The orchestrator persists the provider job into generations.metadata
    // for async providers. Mirror it onto the attempt so the relational row
    // becomes the correlation source for webhooks and reconciliation.
    const { data } = await admin
      .from("generations")
      .select("metadata")
      .eq("id", params.generationId)
      .maybeSingle();
    const job = readPersistedProviderJob(
      (data?.metadata ?? null) as Record<string, unknown> | null
    );

    if (job) {
      await recordProviderJob(
        admin,
        params.attemptId,
        job.id,
        outcome.status === "processing" ? "processing" : "submitted"
      );
    }

    if (outcome.status === "completed") {
      await markAttemptTerminal(admin, params.attemptId, {
        status: "succeeded",
        latencyMs: Date.now() - startedAt,
      });
      return { result: "completed", attemptId: params.attemptId };
    }

    return { result: "processing", attemptId: params.attemptId };
  } catch (caught) {
    const error = toOrchestrationError(caught);

    // Phase 6E already decided, fail-closed, whether this failure could have
    // left a billable job behind, and wrote an ambiguousSubmission marker if
    // so. Read that decision rather than re-deriving it, so the two records
    // can never disagree.
    const { data } = await admin
      .from("generations")
      .select("metadata")
      .eq("id", params.generationId)
      .maybeSingle();
    const orchestration = ((data?.metadata ?? {}) as Record<string, unknown>).orchestration;
    const ambiguous =
      typeof orchestration === "object" &&
      orchestration !== null &&
      (orchestration as Record<string, unknown>).ambiguousSubmission !== undefined &&
      (orchestration as Record<string, unknown>).ambiguousSubmission !== null;

    if (ambiguous) {
      await recordAmbiguousSubmission(admin, params.attemptId, error.code);
      log({
        generationId: params.generationId,
        attemptId: params.attemptId,
        result: "submit_ambiguous",
        errorCode: error.code,
      });
      return { result: "ambiguous", attemptId: params.attemptId, errorCode: error.code };
    }

    await markAttemptTerminal(admin, params.attemptId, {
      status: "failed",
      errorCode: error.code,
      latencyMs: Date.now() - startedAt,
    });
    return { result: "failed", attemptId: params.attemptId, errorCode: error.code };
  }
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

/**
 * Cancels a generation and closes its attempt.
 *
 * `markCancelled` is the unchanged Phase 6 compare-and-set: it only applies
 * from queued/processing, so a completion that already won cannot be undone.
 * The attempt is closed regardless, since no workflow will drive it further.
 */
export async function cancelGeneration(params: {
  generationId: string;
  attemptId: string | null;
}): Promise<{ cancelled: boolean }> {
  const admin = getSupabaseAdminClient();

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
    await markAttemptTerminal(admin, params.attemptId, { status: "cancelled" });
  }

  log({ generationId: params.generationId, result: "cancelled", applied: cancelled });
  return { cancelled };
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
