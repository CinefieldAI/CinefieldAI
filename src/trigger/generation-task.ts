import { task, AbortTaskRunError } from "@trigger.dev/sdk";
import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import { isRetryable, toOrchestrationError } from "@/lib/orchestration/errors";
import { executeGeneration } from "@/lib/orchestration/orchestrator";
import { resetForRetry } from "@/lib/orchestration/status-manager";
import { asyncContinuationTask } from "./async-continuation-task";

/**
 * ===========================================================================
 * RETIRED GENERATION OWNER — NOT PRODUCTION-REACHABLE (Phase 6R-B)
 * ===========================================================================
 * Per the locked v1.6 architecture, Trigger.dev is an OPERATIONAL platform
 * (reconciliation, audit, health, cleanup — see src/trigger/operational/),
 * NOT the owner of a generation's lifecycle. Temporal's GenerationWorkflow
 * is the owner, and as of Phase 6R-B it is the ONLY one:
 * `/api/orchestration/execute` hands off to
 * src/lib/orchestration/generation-execution-service.ts, which resolves the
 * owner server-side and has no Trigger branch at all.
 *
 * WHAT CHANGED IN 6R-B
 *   - the route's "trigger" dispatch is gone; this task has NO production
 *     caller and cannot acquire one through configuration
 *   - resolveExecutionMode() no longer exists; the resolver returns
 *     "temporal" | "direct-dev" | "unavailable", and production only ever
 *     sees the first or the last
 *   - Temporal unavailable now FAILS CLOSED rather than falling back here
 *
 * THE RUNTIME GUARD BELOW IS THE POINT. The file is kept for dev/test
 * reference rather than deleted, so the guard makes "no production caller"
 * into "cannot run in production even if dispatched" — by a stale queued run
 * from before the cutover, a manual trigger from the dashboard, or a future
 * caller added by mistake. A retired owner that can still be invoked is not
 * retired; it is dormant, and a dormant second owner is how one generation
 * ends up with two provider jobs.
 *
 * DO NOT add callers, do not extend it, and do not weaken the guard. New
 * generation work belongs to the Temporal path.
 * ===========================================================================
 *
 * Cinefield's one generic background generation task.
 *
 * There is deliberately no per-provider or per-model task — every provider
 * (mock, fal.ai, and any future one) is already dispatched generically by
 * `executeGeneration` via the model registry and provider registry. This
 * task is a thin Trigger.dev wrapper around that same call, not a second
 * orchestration path.
 *
 * Payload contains only safe identifiers. `executeGeneration` re-derives the
 * prompt, settings, ownership, and model from the database itself — exactly
 * as the existing direct/HTTP path already does — so nothing about the
 * generation request (including the raw Unicode prompt) is duplicated,
 * translated, or reshaped in transit through Trigger.dev.
 */
export interface GenerationTaskPayload {
  generationId: string;
  clerkUserId: string;
}

/**
 * Refuses to run this retired owner in a production process.
 *
 * Checked at RUN time rather than import time on purpose: the task must stay
 * registered (so a stale run is consumed and fails loudly instead of sitting
 * queued forever), while being incapable of touching a production generation.
 * AbortTaskRunError means no retry — a retry would not change the answer.
 */
function assertNotProductionOwner(generationId: string): void {
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[cinefield:orchestration]",
      JSON.stringify({ generationId, result: "legacy_trigger_owner_refused" })
    );
    throw new AbortTaskRunError(
      "LEGACY_TRIGGER_GENERATION_OWNER_DISABLED: Temporal owns generation lifecycle (Phase 6R-B)"
    );
  }
}

export const generationTask = task({
  id: "cinefield-generation",
  maxDuration: 300,
  run: async (payload: GenerationTaskPayload, { ctx }) => {
    // Before anything else, and above all before executeGeneration could
    // reach a provider.
    assertNotProductionOwner(payload.generationId);

    try {
      const result = await executeGeneration({
        generationId: payload.generationId,
        clerkUserId: payload.clerkUserId,
      });
      // status "completed": the sync path finished, outputs are in Storage.
      //
      // status "processing": an ASYNC provider accepted the job — its external
      // job id and state are persisted on the row (metadata.orchestration
      // .providerJob) and this run ends SUCCESSFULLY on purpose. Returning
      // success (instead of waiting or throwing) is what keeps Trigger.dev's
      // retry machinery from re-running executeGeneration and submitting the
      // same job to the provider a second time.
      //
      // The waiting is handed to a SEPARATE controller run rather than done
      // here, so this run's success (and therefore its "do not retry the
      // submission" meaning) is recorded the moment the provider accepts.
      // The controller can only check, never submit.
      if (result.status === "processing") {
        // idempotencyKey scopes the chain to this generation: a duplicate
        // dispatch (this task retried, a webhook also nudging, a manual
        // re-run) attaches to the existing controller instead of starting a
        // second polling chain against the same provider job.
        //
        // Dispatch failure is swallowed on purpose. The provider job is
        // already running and fully described on the row; throwing here
        // would mark a healthy async generation failed, and — worse — a
        // retry of THIS task would re-enter executeGeneration. The row
        // simply stays "processing" until another transport (a later
        // dispatch, or the Phase 6F webhook route) continues it.
        try {
          await asyncContinuationTask.trigger(
            { generationId: payload.generationId, clerkUserId: payload.clerkUserId },
            {
              idempotencyKey: `continuation-${payload.generationId}`,
              idempotencyKeyTTL: "24h",
            }
          );
        } catch {
          console.warn(
            "[cinefield:orchestration]",
            JSON.stringify({
              generationId: payload.generationId,
              result: "continuation_dispatch_failed",
            })
          );
        }
      }

      return { generationId: result.generationId, status: result.status };
    } catch (caught) {
      const error = toOrchestrationError(caught);

      // executeGeneration already recorded status="failed" with a sanitized
      // message before rethrowing — that part of the contract is untouched.
      // maxAttempts unknown => treat this as the final attempt (never risk
      // leaving a row stuck at "queued" with no further attempt coming).
      const maxAttempts = ctx.run.maxAttempts ?? ctx.attempt.number;
      const isFinalAttempt = ctx.attempt.number >= maxAttempts;

      if (!isRetryable(error) || isFinalAttempt) {
        // Non-retryable (auth/quota/validation/capability/...) or no
        // attempts remain: stop immediately, row stays "failed".
        throw new AbortTaskRunError(error.code);
      }

      // Retryable and another attempt is coming: requeue the row so the
      // next attempt's claimGeneration() can claim it again instead of
      // bouncing off DUPLICATE_EXECUTION (claim requires status="queued").
      //
      // The preparation itself is protected and verified. Rethrowing the
      // retryable error without a confirmed reset would schedule an attempt
      // that is guaranteed to fail on the claim, burning a retry slot and
      // masking the real provider error behind DUPLICATE_EXECUTION.
      let didReset: boolean;
      try {
        const admin = getSupabaseAdminClient();
        const { data } = await admin
          .from("generations")
          .select("metadata")
          .eq("id", payload.generationId)
          .maybeSingle();
        const currentMetadata = (data?.metadata ?? null) as Record<string, unknown> | null;
        didReset = await resetForRetry(admin, payload.generationId, currentMetadata);
      } catch {
        // Retry preparation failed outright (client, read, or write). Stop
        // rather than retry blindly. The message carries only the original
        // error code — never a database payload or environment value.
        throw new AbortTaskRunError(`${error.code}: retry preparation failed`);
      }

      if (!didReset) {
        // No eligible row was reset: the generation completed, was
        // cancelled, is owned by another execution, its failure was not
        // marked retryable, or its persisted evidence says an external
        // provider job may already exist (a providerJob record or an
        // ambiguous-submission marker — Phase 6E). Any of those make a
        // retry incorrect: a requeue would run submit() again, and with job
        // evidence present that could start a second, double-billed
        // provider job. Aborting here IS the duplicate protection working.
        throw new AbortTaskRunError(`${error.code}: generation is not eligible for retry`);
      }

      // Reset confirmed. Rethrow the ORIGINAL provider error (not Abort, and
      // not a substituted one) so Trigger.dev's own backoff schedules the
      // next attempt per trigger.config.ts's retry policy.
      throw error;
    }
  },
});
