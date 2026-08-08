import { task, AbortTaskRunError } from "@trigger.dev/sdk";
import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import { isRetryable, toOrchestrationError } from "@/lib/orchestration/errors";
import { executeGeneration } from "@/lib/orchestration/orchestrator";
import { resetForRetry } from "@/lib/orchestration/status-manager";

/**
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

export const generationTask = task({
  id: "cinefield-generation",
  maxDuration: 300,
  run: async (payload: GenerationTaskPayload, { ctx }) => {
    try {
      const result = await executeGeneration({
        generationId: payload.generationId,
        clerkUserId: payload.clerkUserId,
      });
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
        // cancelled, is owned by another execution, or its failure was not
        // marked retryable. Any of those make a retry incorrect.
        throw new AbortTaskRunError(`${error.code}: generation is not eligible for retry`);
      }

      // Reset confirmed. Rethrow the ORIGINAL provider error (not Abort, and
      // not a substituted one) so Trigger.dev's own backoff schedules the
      // next attempt per trigger.config.ts's retry policy.
      throw error;
    }
  },
});
