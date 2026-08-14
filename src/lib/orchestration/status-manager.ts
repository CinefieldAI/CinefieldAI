import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrchestrationError } from "./errors";
import type {
  OrchestrationStage,
  PersistedAmbiguousSubmission,
  PersistedContinuationHalt,
  PersistedProviderJob,
  SubmissionEvidence,
} from "./types";

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
  /** Async provider job state — present only while/after a provider ran async. */
  providerJob?: PersistedProviderJob;
  /**
   * Present only while a submit attempt's outcome is unknown (Phase 6E).
   * Blocks resetForRetry until Phase 7 reconciliation clears it.
   */
  ambiguousSubmission?: PersistedAmbiguousSubmission | null;
  /**
   * Single-flight lease on the finalization tail (download → upload →
   * complete). Holds an ISO timestamp while one checker finalizes; null or
   * absent when free. Prevents two concurrent "provider says completed"
   * observations from uploading the same outputs twice (Phase 6F).
   */
  finalizeClaimedAt?: string | null;
  /**
   * Present only when automatic continuation stopped polling a job that had
   * not reached a terminal state (Phase 6G). Purely informational: it never
   * changes `status` and never clears providerJob.
   */
  continuation?: PersistedContinuationHalt | null;
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
 * The compare-and-set is unchanged in meaning: whichever concurrent request
 * moves the row out of "queued" first wins, and every other request receives
 * DUPLICATE_EXECUTION. What changed in Phase 11-A is WHERE it runs.
 *
 * It used to be a Supabase update issued from here. That made the claim and
 * its `generation.processing` event a dual write: the claim could commit and
 * the process die before the event existed, or — worse — an event could be
 * written for a claim that lost. Neither is recoverable from the outside,
 * because nothing durable records that the pair was ever meant to be atomic.
 *
 * `claim_generation_tx` performs the same `AND status = 'queued'` predicate
 * and emits the event inside one transaction, so the state change and the
 * fact about it commit together or not at all — matching every other
 * lifecycle producer in the system.
 */
export async function claimGeneration(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null
): Promise<void> {
  // The stage label is all this call still contributes to metadata; the SQL
  // function merges it under `orchestration` exactly as the update did.
  void existingMetadata;

  const { data, error } = await admin.rpc("claim_generation_tx", {
    p_generation_id: generationId,
    p_stage: "validating",
    p_trace_id: null,
  });

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "claim" },
    });
  }

  const result = data as { claimed?: boolean; reason?: string } | null;

  if (!result?.claimed) {
    // Not queued: already processing, already terminal, or gone. Same outcome
    // the compare-and-set produced, for the same reason.
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
  result: {
    outputUrl: string;
    thumbnailUrl?: string | null;
    provider: string;
    workflow: string;
    isMock: boolean;
    /** Observability only; travels in the domain event, never a cost figure. */
    durationMs?: number;
    traceId?: string;
    /** Supply to keep ONE event identity across an application-level retry. */
    eventId?: string;
  }
): Promise<void> {
  // PHASE 6R-E GATE 0: transactional. The compare-and-set from "processing"
  // and the generation.completed outbox row commit together inside one
  // PL/pgSQL body, so there is no window in which a generation is completed
  // but the fact was never recorded. The predicate itself is unchanged: the
  // sync path always arrives here in "processing", but an async continuation
  // may race a cancellation or a second checker, and cancelled → completed /
  // completed → completed must lose.
  //
  // The Storage upload has already happened, outside this transaction and on
  // purpose — see the migration header.
  //
  // `existingMetadata` is no longer sent: the SQL merges only the
  // orchestration keys it owns, instead of replacing the whole JSON from a
  // possibly-stale snapshot. Kept in the signature for call-site
  // compatibility and documented as ignored.
  void existingMetadata;

  const { data, error } = await admin.rpc("complete_generation_tx", {
    p_generation_id: generationId,
    p_output_url: result.outputUrl,
    p_thumbnail_url: result.thumbnailUrl ?? null,
    p_provider: result.provider,
    p_workflow: result.workflow,
    p_is_mock: result.isMock,
    p_duration_ms: result.durationMs ?? null,
    p_trace_id: result.traceId ?? null,
    p_event_id: result.eventId ?? null,
  });

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "markCompleted" },
    });
  }

  if (!(data as { applied?: boolean } | null)?.applied) {
    // The row left "processing" under us (completed elsewhere, cancelled, or
    // requeued). Completing it now would be an invalid transition — and no
    // event was emitted for the completion that did not happen.
    throw new OrchestrationError("DUPLICATE_EXECUTION", {
      context: { generationId, operation: "markCompleted" },
    });
  }
}

/**
 * Records that a provider accepted the job and is working on it
 * asynchronously. `status` stays "processing" (already set by
 * claimGeneration); what changes is the persisted orchestration metadata:
 * stage becomes "waiting-provider" and the provider-neutral job state
 * (external job id, last observed provider state) is stored so a later
 * status check can find and continue this exact job.
 *
 * Guarded on status = "processing" so a cancelled or finished row can never
 * be pulled back into a waiting state.
 */
export async function markProcessingAsync(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null,
  job: { providerJob: PersistedProviderJob; provider: string; workflow: string; isMock: boolean }
): Promise<Record<string, unknown>> {
  const merged = mergeOrchestrationMetadata(existingMetadata, {
    stage: "waiting-provider",
    provider: job.provider,
    workflow: job.workflow,
    isMock: job.isMock,
    providerJob: job.providerJob,
  });

  const { data, error } = await admin
    .from("generations")
    .update({ metadata: merged })
    .eq("id", generationId)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "markProcessingAsync" },
    });
  }

  if (!data) {
    throw new OrchestrationError("DUPLICATE_EXECUTION", {
      context: { generationId, operation: "markProcessingAsync" },
    });
  }

  return merged;
}

/**
 * Persists the ambiguous-submission marker: a submit attempt ran but no
 * reliable answer arrived, so an external provider job may or may not exist
 * (Phase 6E.2 case C). Guarded on status = "processing" — the executor still
 * holds the claim when this is written. While the marker is present,
 * resetForRetry refuses to requeue the row, so no automatic path can submit
 * a possible duplicate; Phase 7 reconciliation is the only thing allowed to
 * clear it after proving with the provider that no job was created.
 */
export async function recordAmbiguousSubmission(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null,
  attempt: PersistedAmbiguousSubmission
): Promise<Record<string, unknown>> {
  const merged = mergeOrchestrationMetadata(existingMetadata, {
    ambiguousSubmission: attempt,
  });

  const { data, error } = await admin
    .from("generations")
    .update({ metadata: merged })
    .eq("id", generationId)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "recordAmbiguousSubmission" },
    });
  }

  if (!data) {
    throw new OrchestrationError("DUPLICATE_EXECUTION", {
      context: { generationId, operation: "recordAmbiguousSubmission" },
    });
  }

  return merged;
}

/**
 * How long one finalization attempt may hold the single-flight lease before
 * a later checker may assume it crashed and take over. Deliberately longer
 * than any legitimate download+upload (the Trigger.dev task itself is capped
 * at 300s), so a live finalizer is never preempted — while a hard-crashed
 * one cannot deadlock the job forever.
 */
const FINALIZATION_LEASE_MS = 10 * 60 * 1000;

/**
 * Reads the finalization lease out of a metadata snapshot. Returns null for
 * an absent, null, or non-string value — the same three cases the `->>`
 * SQL extraction maps to NULL, so the read and the predicate agree.
 */
function readFinalizeClaimedAt(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const orchestration = (metadata as Record<string, unknown>).orchestration;
  if (!orchestration || typeof orchestration !== "object") return null;
  const value = (orchestration as Record<string, unknown>).finalizeClaimedAt;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Single-flight claim on the finalization tail (Phase 6F.4). Exactly one of
 * several concurrent "provider says completed" observations may run
 * download → upload → complete; the others fail this compare-and-set and
 * must report the row as still processing instead of uploading a second
 * copy of the same outputs.
 *
 * The predicate admits a claim only when the row is still "processing" AND
 * no live lease exists: finalizeClaimedAt absent, null, or older than the
 * lease window. `->>` extraction maps both a missing key and a JSON null to
 * SQL NULL, and ISO-8601 UTC timestamps compare correctly as strings.
 */
export async function claimFinalization(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  const cutoff = new Date(Date.now() - FINALIZATION_LEASE_MS).toISOString();
  const merged = mergeOrchestrationMetadata(existingMetadata, {
    finalizeClaimedAt: new Date().toISOString(),
  });

  const { data, error } = await admin
    .from("generations")
    .update({ metadata: merged })
    .eq("id", generationId)
    .eq("status", "processing")
    .or(
      `metadata->orchestration->>finalizeClaimedAt.is.null,metadata->orchestration->>finalizeClaimedAt.lt.${cutoff}`
    )
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "claimFinalization" },
    });
  }

  if (!data) {
    // Another checker holds a live lease, or the row left "processing".
    throw new OrchestrationError("DUPLICATE_EXECUTION", {
      context: { generationId, operation: "claimFinalization" },
    });
  }

  return merged;
}

/**
 * Updates the persisted provider-job state after one status check —
 * observed provider state, check timestamp, check count. Status and stage
 * are untouched; the row must still be "processing".
 *
 * `releaseFinalizeClaim` additionally clears the finalization lease in the
 * same write — used when a finalization attempt failed and the next checker
 * must be allowed to claim the tail again. Callers may pass it ONLY when
 * they themselves hold the lease; releasing another finalizer's live lease
 * would reopen the duplicate-upload window.
 */
export async function recordAsyncStatusCheck(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null,
  providerJob: PersistedProviderJob,
  options?: { releaseFinalizeClaim?: boolean }
): Promise<Record<string, unknown>> {
  const merged = mergeOrchestrationMetadata(
    existingMetadata,
    options?.releaseFinalizeClaim
      ? { providerJob, finalizeClaimedAt: null }
      : { providerJob }
  );

  // Lease compare-and-set. PostgREST replaces the whole metadata JSON with
  // the value built above, and that value comes from the CALLER'S snapshot —
  // so without this predicate a checker whose snapshot predates a
  // concurrent finalizer's claim would silently erase that live lease, let a
  // third checker claim the tail, and produce exactly the duplicate
  // download/upload the lease exists to prevent. Requiring the stored lease
  // to still match what the caller saw makes a stale write lose instead of
  // clobber; the caller reports the row as still processing and checks again.
  const seenLease = readFinalizeClaimedAt(existingMetadata);

  let query = admin
    .from("generations")
    .update({ metadata: merged })
    .eq("id", generationId)
    .eq("status", "processing");

  query =
    seenLease === null
      ? query.is("metadata->orchestration->>finalizeClaimedAt", null)
      : query.eq("metadata->orchestration->>finalizeClaimedAt", seenLease);

  const { data, error } = await query.select("id").maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "recordAsyncStatusCheck" },
    });
  }

  if (!data) {
    throw new OrchestrationError("DUPLICATE_EXECUTION", {
      context: { generationId, operation: "recordAsyncStatusCheck" },
    });
  }

  return merged;
}

/**
 * Records that automatic continuation stopped polling an async job that had
 * not reached a terminal state (Phase 6G.5).
 *
 * Deliberately conservative about what it does NOT do: it does not change
 * `status`, does not touch providerJob or ambiguousSubmission, and does not
 * mark the generation failed. Cinefield giving up on polling says nothing
 * about the external job, which may still be running and may already have
 * been billed — declaring it failed would be a lie about the provider and
 * would destroy the very evidence Phase 7 reconciliation needs. The row
 * therefore stays in the safest existing state ("processing") and gains only
 * a safe marker; no new DB status is introduced for this.
 *
 * Guarded on status = "processing" plus the finalization-lease compare-and-
 * set, for the same reason as recordAsyncStatusCheck: the metadata column is
 * replaced wholesale, so a stale write must lose rather than erase another
 * worker's live lease. Returns false instead of throwing when the write does
 * not apply — the caller is already stopping and has nothing to recover.
 */
export async function recordContinuationHalt(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null,
  halt: PersistedContinuationHalt
): Promise<boolean> {
  const merged = mergeOrchestrationMetadata(existingMetadata, { continuation: halt });
  const seenLease = readFinalizeClaimedAt(existingMetadata);

  let query = admin
    .from("generations")
    .update({ metadata: merged })
    .eq("id", generationId)
    .eq("status", "processing");

  query =
    seenLease === null
      ? query.is("metadata->orchestration->>finalizeClaimedAt", null)
      : query.eq("metadata->orchestration->>finalizeClaimedAt", seenLease);

  try {
    const { data } = await query.select("id").maybeSingle();
    return data !== null;
  } catch {
    return false;
  }
}

/**
 * Cancels a generation that has not finished. Atomic compare-and-set from
 * the only two states cancellation is legal from — queued (never submitted)
 * and processing (possibly waiting on a provider job). Terminal rows are
 * untouchable: completed/failed/cancelled all fail the predicate, and the
 * matching guards on markCompleted/markFailed mean a stale provider
 * completion arriving AFTER a cancellation can never overwrite it.
 *
 * No UI calls this yet; it exists so the future cancel flow (user cancels →
 * row cancelled → transport may call provider.cancel()) has a safe writer.
 * Returns true when this call performed the cancellation.
 */
export async function markCancelled(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null,
  options?: { reason?: string; traceId?: string; eventId?: string }
): Promise<boolean> {
  // PHASE 6R-E: this is the first TRANSACTIONAL writer in the codebase.
  //
  // It used to be a PostgREST .update(). That was a correct compare-and-set,
  // but emitting the matching domain event would have meant a SECOND HTTP
  // request and therefore a second transaction — and the crash between them
  // is precisely the window the outbox pattern exists to close. Calling two
  // Supabase requests in a row and describing it as transactional would have
  // been a fiction. cancel_generation_tx performs the guarded UPDATE and the
  // outbox insert in ONE PL/pgSQL body, so they commit together or not at
  // all. Proven on real PostgreSQL in supabase/tests/test_transactional_outbox.sql.
  //
  // `existingMetadata` is no longer sent, deliberately. The old version
  // rebuilt the whole metadata JSON from the caller's snapshot and wrote it
  // wholesale, which silently discarded any concurrent metadata write. The
  // SQL uses jsonb_set to touch only orchestration.stage. The parameter stays
  // for call-site compatibility and is documented as ignored rather than
  // quietly removed.
  void existingMetadata;

  const { data, error } = await admin.rpc("cancel_generation_tx", {
    p_generation_id: generationId,
    // A short reason CODE only; the function rejects anything else. Never a
    // user-supplied message — this value is copied into a retained event.
    p_reason: options?.reason ?? null,
    p_trace_id: options?.traceId ?? null,
    // Supplying an id is how an application-level retry keeps ONE event
    // identity instead of announcing the same cancellation twice.
    p_event_id: options?.eventId ?? null,
  });

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "markCancelled" },
    });
  }

  return Boolean((data as { applied?: boolean } | null)?.applied);
}

/**
 * Typed read of the persisted provider-job state out of a generations
 * metadata JSON. Returns null when the row never ran an async provider (or
 * the state is malformed) — callers must treat that as "nothing to continue".
 */
export function readPersistedProviderJob(
  metadata: Record<string, unknown> | null | undefined
): PersistedProviderJob | null {
  if (!metadata || typeof metadata !== "object") return null;
  const orchestration = (metadata as Record<string, unknown>).orchestration;
  if (!orchestration || typeof orchestration !== "object") return null;
  const job = (orchestration as Record<string, unknown>).providerJob;
  if (!job || typeof job !== "object") return null;

  const candidate = job as Record<string, unknown>;
  const id = candidate.id;
  const provider = candidate.provider;
  const state = candidate.state;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof provider !== "string" || provider.length === 0) return null;
  if (
    state !== "queued" &&
    state !== "processing" &&
    state !== "completed" &&
    state !== "failed"
  ) {
    return null;
  }

  return {
    id,
    provider,
    state,
    lastCheckedAt:
      typeof candidate.lastCheckedAt === "string"
        ? candidate.lastCheckedAt
        : new Date(0).toISOString(),
    checkCount:
      typeof candidate.checkCount === "number" && Number.isFinite(candidate.checkCount)
        ? candidate.checkCount
        : 0,
    lastCheckSource:
      candidate.lastCheckSource === "poll" ||
      candidate.lastCheckSource === "webhook" ||
      candidate.lastCheckSource === "websocket"
        ? candidate.lastCheckSource
        : undefined,
    lastCheckError:
      typeof candidate.lastCheckError === "string" && candidate.lastCheckError.length > 0
        ? candidate.lastCheckError
        : undefined,
    resume:
      candidate.resume && typeof candidate.resume === "object"
        ? (candidate.resume as Record<string, unknown>)
        : undefined,
  };
}

/**
 * Finds the generation that owns an external provider job, by matching the
 * PERSISTED (provider, providerJobId) pair on the row itself.
 *
 * This is the correlation step a webhook or WebSocket event needs: an
 * inbound event names an external job, and only Cinefield's own persisted
 * evidence can say which generation — and therefore which user — that job
 * belongs to. The owner is returned FROM THE ROW and must never be taken
 * from the event, so an event can never nominate a user or reach a
 * generation whose stored job id does not match.
 *
 * Returns null when nothing matches: the event is then for a job Cinefield
 * does not know about and must be rejected, not acted upon.
 */
export async function findGenerationByProviderJob(
  admin: SupabaseClient,
  provider: string,
  providerJobId: string
): Promise<{ generationId: string; clerkUserId: string; status: string } | null> {
  const { data, error } = await admin
    .from("generations")
    .select("id, clerk_user_id, status")
    .eq("metadata->orchestration->providerJob->>provider", provider)
    .eq("metadata->orchestration->providerJob->>id", providerJobId)
    .limit(2);

  if (error || !data || data.length !== 1) {
    // Zero matches (unknown job) and — defensively — more than one match
    // (ambiguous correlation) are both refusals rather than guesses.
    return null;
  }

  const row = data[0] as { id: string; clerk_user_id: string; status: string };
  return { generationId: row.id, clerkUserId: row.clerk_user_id, status: row.status };
}

/**
 * Answers the one question duplicate/double-billing protection needs: what
 * does Cinefield already know about an external provider job for this
 * generation (Phase 6E.1)?
 *
 * A persisted provider job is the strongest evidence and always wins; an
 * ambiguous-submission marker means an attempt's outcome is unknown; only
 * when neither exists is there provably nothing. Phase 7 failover reads
 * this same evidence to ask "did provider A already start this job?" before
 * it may ever try provider B.
 */
export function readSubmissionEvidence(
  metadata: Record<string, unknown> | null | undefined
): SubmissionEvidence {
  const job = readPersistedProviderJob(metadata);
  if (job) return { kind: "job", job };

  if (metadata && typeof metadata === "object") {
    const orchestration = (metadata as Record<string, unknown>).orchestration;
    if (orchestration && typeof orchestration === "object") {
      const attempt = (orchestration as Record<string, unknown>).ambiguousSubmission;
      if (attempt && typeof attempt === "object") {
        const candidate = attempt as Record<string, unknown>;
        if (typeof candidate.provider === "string" && candidate.provider.length > 0) {
          return {
            kind: "ambiguous",
            attempt: {
              provider: candidate.provider,
              attemptedAt:
                typeof candidate.attemptedAt === "string"
                  ? candidate.attemptedAt
                  : new Date(0).toISOString(),
              errorCode:
                typeof candidate.errorCode === "string" && candidate.errorCode.length > 0
                  ? candidate.errorCode
                  : "PROVIDER_SUBMISSION_UNKNOWN",
            },
          };
        }
      }
    }
  }

  return { kind: "none" };
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
 *
 * Phase 6E.3 adds the safe-resubmission proof directly to the predicate: a
 * requeue leads to a NEW provider submit, so it is allowed only when the
 * row's own persisted evidence proves no external job can exist — no
 * providerJob (a persisted job id is strong evidence the job is real) and
 * no ambiguousSubmission marker (an unanswered attempt may have created
 * one). The retryable flag alone is no longer sufficient: even if some
 * future writer set it incorrectly, the evidence predicates keep a
 * double-billed resubmission impossible. `->>` maps a missing key to SQL
 * NULL, which is what `.is(..., null)` matches.
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
    .is("metadata->orchestration->>providerJob", null)
    .is("metadata->orchestration->>ambiguousSubmission", null)
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
 *
 * Guarded on status = "processing": every legitimate failure happens while an
 * execution holds the claim. Without the guard, a failure raised BECAUSE the
 * row already reached a terminal state (e.g. claimGeneration's
 * DUPLICATE_EXECUTION on an already-completed generation, or an async checker
 * losing a race to a concurrent completion) would drag completed/cancelled
 * back to failed — exactly the invalid transitions this module must prevent.
 * A zero-row match is silent success by design.
 */
export async function markFailed(
  admin: SupabaseClient,
  generationId: string,
  existingMetadata: Record<string, unknown> | null,
  failure: {
    userMessage: string;
    errorCode: string;
    retryable: boolean;
    /**
     * Provider-job evidence to persist alongside the failure when the caller
     * learned of an external job that is NOT yet in the metadata — e.g. a
     * sync submission whose later download/upload failed. Callers pass this
     * only when nothing richer is persisted, so it never overwrites the
     * continuation's own job state. This is what lets Phase 7 see "a job
     * already exists" on a failed row before considering another provider.
     */
    providerJob?: PersistedProviderJob;
    traceId?: string;
    /** Supply to keep ONE event identity across an application-level retry. */
    eventId?: string;
  }
): Promise<void> {
  // PHASE 6R-E GATE 0: transactional. The failure transition and the
  // generation.failed outbox row commit together, on the same
  // status='processing' predicate this function has always used — so a
  // failure raised BECAUSE the row already went terminal still cannot drag
  // completed or cancelled back to failed, and a lost transition emits
  // nothing.
  //
  // Metadata is merged in place by the SQL rather than replaced from the
  // caller's snapshot; the parameter is kept for call-site compatibility.
  void existingMetadata;

  try {
    await admin.rpc("fail_generation_tx", {
      p_generation_id: generationId,
      // User-facing prose: stored on the row, deliberately NOT put in the
      // event, which carries the normalized code only.
      p_error_message: failure.userMessage,
      p_error_code: failure.errorCode,
      p_retryable: failure.retryable,
      p_provider: null,
      p_provider_job: failure.providerJob ?? null,
      p_trace_id: failure.traceId ?? null,
      p_event_id: failure.eventId ?? null,
    });
  } catch {
    // Swallowed, exactly as before: this runs inside a catch block and must
    // not mask the original error. The swallow lives HERE rather than in the
    // SQL on purpose — a function that hid a failed write would also hide a
    // failed event, and silently losing the event is precisely what the
    // outbox exists to prevent.
  }
}
