import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrchestrationError } from "./errors";
import type { OrchestrationStage } from "./types";

/**
 * Cinefield status manager — the single place protected generation fields
 * are written.
 *
 * The database schema is unchanged: `status` keeps using the existing
 * allowed values, and the richer OrchestrationStage is persisted only inside
 * the existing `metadata` JSON under an `orchestration` key. Unrelated
 * metadata keys are always preserved.
 *
 * Only server-side callers holding the privileged Supabase client may use
 * this. Browser code cannot (and must not) write these fields.
 */

export type GenerationStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

interface OrchestrationMetadata {
  stage: OrchestrationStage;
  provider?: string;
  workflow?: string;
  isMock?: boolean;
  errorCode?: string;
  retryable?: boolean;
  updatedAt: string;
}

function mergeOrchestrationMetadata(
  existing: Record<string, unknown> | null | undefined,
  patch: Partial<OrchestrationMetadata>
): Record<string, unknown> {
  const base = existing ?? {};
  const previous =
    typeof base.orchestration === "object" && base.orchestration !== null
      ? (base.orchestration as Record<string, unknown>)
      : {};

  return {
    ...base,
    orchestration: {
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Atomically claims a queued generation for execution.
 *
 * The `.eq("status", "queued")` predicate makes this a compare-and-set:
 * whichever concurrent request updates the row first wins, and every other
 * request sees zero matched rows and receives DUPLICATE_EXECUTION. This is
 * the strongest guard available without adding a schema column.
 */
export async function claimGeneration(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null
): Promise<void> {
  const { data, error } = await admin
    .from("generations")
    .update({
      status: "processing",
      metadata: mergeOrchestrationMetadata(existingMetadata, { stage: "validating" }),
    })
    .eq("id", generationId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "claim" },
    });
  }

  if (!data) {
    // Row exists but was not in "queued" — already processing/completed/failed.
    throw new OrchestrationError("DUPLICATE_EXECUTION", { context: { generationId } });
  }
}

/** Records an intermediate orchestration stage. Never changes `status`. */
export async function setStage(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null,
  patch: Partial<OrchestrationMetadata> & { stage: OrchestrationStage }
): Promise<Record<string, unknown>> {
  const merged = mergeOrchestrationMetadata(existingMetadata, patch);

  const { error } = await admin
    .from("generations")
    .update({ metadata: merged })
    .eq("id", generationId);

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "setStage", stage: patch.stage },
    });
  }

  return merged;
}

export async function markCompleted(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null,
  result: { outputUrl: string; thumbnailUrl?: string | null; provider: string; workflow: string; isMock: boolean }
): Promise<void> {
  const { error } = await admin
    .from("generations")
    .update({
      status: "completed",
      output_url: result.outputUrl,
      thumbnail_url: result.thumbnailUrl ?? null,
      error_message: null,
      completed_at: new Date().toISOString(),
      metadata: mergeOrchestrationMetadata(existingMetadata, {
        stage: "completed",
        provider: result.provider,
        workflow: result.workflow,
        isMock: result.isMock,
      }),
    })
    .eq("id", generationId);

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "markCompleted" },
    });
  }
}

/**
 * Requeues a row that `executeGeneration` already marked "failed" so a
 * Trigger.dev-scheduled retry attempt can claim it again.
 *
 * `executeGeneration` always calls `markFailed` before rethrowing, which sets
 * status = "failed" — a terminal state as far as `claimGeneration`'s
 * `.eq("status", "queued")` compare-and-set is concerned. Without this reset,
 * a second Trigger.dev attempt would immediately bounce off
 * DUPLICATE_EXECUTION instead of actually retrying the provider call. Only
 * the Trigger.dev task path calls this; the direct/HTTP path has no
 * automatic retry loop and never touches it, so its behavior is unchanged.
 *
 * Eligibility is enforced atomically inside the UPDATE itself, so a row can
 * never be revived by a check that raced ahead of the write:
 *   - status must still be exactly "failed" (never completed, cancelled,
 *     processing, or already requeued)
 *   - metadata.orchestration.retryable must be exactly true, which
 *     `markFailed` writes from the same `isRetryable()` classification the
 *     caller uses. A missing flag yields SQL NULL, matches nothing, and is
 *     therefore rejected rather than assumed retryable.
 *
 * Returns true only when exactly one eligible row was actually reset. A
 * zero-row UPDATE is NOT success: PostgREST reports `error: null` when
 * nothing matches, so without the `.select()` round-trip below this would
 * silently no-op and the next attempt would fail with DUPLICATE_EXECUTION —
 * which is precisely the defect this contract exists to prevent.
 */
export async function resetForRetry(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null
): Promise<boolean> {
  const { data, error } = await admin
    .from("generations")
    .update({
      status: "queued",
      error_message: null,
      // markFailed stamps completed_at; a requeued generation is no longer
      // terminal, and the generations_completed_at_check constraint requires
      // completed_at to be NULL outside completed/failed/cancelled anyway.
      completed_at: null,
      metadata: mergeOrchestrationMetadata(existingMetadata, { stage: "validating" }),
    })
    .eq("id", generationId)
    .eq("status", "failed")
    .eq("metadata->orchestration->>retryable", "true")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "resetForRetry" },
    });
  }

  return data !== null;
}

/**
 * Best-effort failure recording. Never throws — it runs inside a catch block
 * and must not mask the original error.
 */
export async function markFailed(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null,
  failure: { userMessage: string; errorCode: string; retryable: boolean }
): Promise<void> {
  try {
    await admin
      .from("generations")
      .update({
        status: "failed",
        error_message: failure.userMessage,
        completed_at: new Date().toISOString(),
        metadata: mergeOrchestrationMetadata(existingMetadata, {
          stage: "failed",
          errorCode: failure.errorCode,
          retryable: failure.retryable,
        }),
      })
      .eq("id", generationId);
  } catch {
    // Swallow: the caller is already reporting the original failure.
  }
}
