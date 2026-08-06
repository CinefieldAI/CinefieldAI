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
 * Scoped to `.eq("status", "failed")` so this is itself a safe compare-and-
 * set — it only ever moves a row that is genuinely in the terminal state
 * `markFailed` just put it in.
 */
export async function resetForRetry(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null
): Promise<void> {
  const { error } = await admin
    .from("generations")
    .update({
      status: "queued",
      error_message: null,
      metadata: mergeOrchestrationMetadata(existingMetadata, { stage: "validating" }),
    })
    .eq("id", generationId)
    .eq("status", "failed");

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "resetForRetry" },
    });
  }
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
