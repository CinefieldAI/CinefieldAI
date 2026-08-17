import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrchestrationError } from "./errors";
import type { CancelIntentOutcome } from "./cancellation";

/**
 * Durable USER CANCEL INTENT (Phase 6R-H closure).
 *
 * The first of the three cancellation concepts, made durable before anything
 * else happens. "I no longer want this" is a Cinefield fact the moment an
 * authenticated owner says it — true regardless of whether any provider can
 * be stopped, and it must survive a workflow that is mid-poll, a Temporal
 * outage, and the request that recorded it.
 *
 * WHY IT IS RECORDED BEFORE THE SIGNAL, AND SEPARATELY FROM THE TRANSITION
 * The same ordering rule the verified-webhook bridge follows: durable first,
 * transport second. If the Temporal signal then fails, the intent is still on
 * the row and a later retry — or reconciliation — can act on it. The reverse
 * order would risk telling the workflow about an intent that was never
 * persisted.
 *
 * It is deliberately NOT the cancelled transition. A generation whose
 * provider job is mid-flight must not be marked cancelled while a handler may
 * still be writing evidence; Temporal decides when the transition is safe
 * (settleCancellation). This records only that the user asked.
 *
 * STORED IN metadata.orchestration.cancelRequested, merged in place by the
 * SQL below rather than replacing the JSON from a caller's snapshot, so a
 * concurrent providerJob write is not lost.
 */

export interface CancelIntentRecord {
  requestedAt: string;
  /** Short reason code only — never user prose. */
  reason: string;
  /**
   * Phase 16-D. Present only when an admin operator recorded this intent on
   * the owner's behalf (`recordCancelIntent`'s `adminActorId` option) —
   * absent for the ordinary owner-initiated path, so a reader can tell the
   * two apart without a second field to keep in sync.
   */
  actorClerkUserId?: string;
}

export interface RecordCancelIntentOptions {
  /**
   * Phase 16-D admin-initiated cancel (`src/lib/admin/temporal-admin-service.ts`).
   *
   * The ownership check below is UNCHANGED — the caller still passes the
   * generation's REAL owner as `clerkUserId` (looked up fresh, the same
   * re-read every admin mutation in this codebase already does before
   * acting). This option only ADDS the admin's own id to the durable
   * record, so the trail can tell "the owner cancelled their own
   * generation" from "an operator cancelled it for them" without a second
   * cancellation model, a second table, or a relaxed ownership check.
   */
  adminActorId?: string;
}

/**
 * Records the intent idempotently.
 *
 * Guarded on a non-terminal generation: asking to cancel something that
 * already finished is not an error, it simply has no effect, and the caller
 * is told which state won. A repeat request returns the ORIGINAL
 * requestedAt, so "cancel" is safe to click twice and the audit trail keeps
 * the first moment the user asked rather than the last.
 */
export async function recordCancelIntent(
  admin: SupabaseClient,
  generationId: string,
  clerkUserId: string,
  reason = "user_requested",
  options: RecordCancelIntentOptions = {}
): Promise<CancelIntentOutcome & { alreadyRequested?: boolean }> {
  const { data, error } = await admin
    .from("generations")
    .select("id, status, clerk_user_id, metadata")
    .eq("id", generationId)
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "recordCancelIntent" },
    });
  }

  // FORBIDDEN and GENERATION_NOT_FOUND both surface as 404 so the API does
  // not confirm the existence of another user's generation. Unchanged for
  // the admin path too: the admin caller is required to pass the real owner
  // id it already looked up, never its own — see `RecordCancelIntentOptions`.
  if (!data || (data as { clerk_user_id: string }).clerk_user_id !== clerkUserId) {
    throw new OrchestrationError("GENERATION_NOT_FOUND", { context: { generationId } });
  }

  const row = data as { status: string; metadata: Record<string, unknown> | null };

  if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
    return { outcome: "already_terminal", generationId, status: row.status };
  }

  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const orchestration =
    typeof metadata.orchestration === "object" && metadata.orchestration !== null
      ? (metadata.orchestration as Record<string, unknown>)
      : {};

  const existing = orchestration.cancelRequested as CancelIntentRecord | undefined;
  if (existing && typeof existing.requestedAt === "string") {
    // Idempotent: the intent is already durable. Do not restamp it.
    return { outcome: "cancelled", generationId, alreadyRequested: true };
  }

  const intent: CancelIntentRecord = {
    requestedAt: new Date().toISOString(),
    reason,
    ...(options.adminActorId ? { actorClerkUserId: options.adminActorId } : {}),
  };

  // Compare-and-set on a non-terminal status, so a generation that reaches a
  // terminal state between the read above and this write does not acquire a
  // cancel intent it can no longer act on.
  const { data: applied, error: writeError } = await admin
    .from("generations")
    .update({ metadata: { ...metadata, orchestration: { ...orchestration, cancelRequested: intent } } })
    .eq("id", generationId)
    .in("status", ["queued", "processing"])
    .select("id")
    .maybeSingle();

  if (writeError) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "recordCancelIntent" },
    });
  }

  if (!applied) {
    // Lost the race to a terminal transition. Report what actually won.
    const { data: current } = await admin
      .from("generations")
      .select("status")
      .eq("id", generationId)
      .maybeSingle();
    return {
      outcome: "already_terminal",
      generationId,
      status: (current as { status?: string } | null)?.status ?? "unknown",
    };
  }

  return { outcome: "cancelled", generationId, alreadyRequested: false };
}

/** Reads a recorded intent, or null. Used by the workflow's reflection rule. */
export function readCancelIntent(
  metadata: Record<string, unknown> | null | undefined
): CancelIntentRecord | null {
  if (!metadata || typeof metadata !== "object") return null;
  const orchestration = (metadata as Record<string, unknown>).orchestration;
  if (!orchestration || typeof orchestration !== "object") return null;
  const intent = (orchestration as Record<string, unknown>).cancelRequested;
  if (!intent || typeof intent !== "object") return null;
  const record = intent as Partial<CancelIntentRecord>;
  if (typeof record.requestedAt !== "string") return null;
  return {
    requestedAt: record.requestedAt,
    reason: record.reason ?? "user_requested",
    ...(typeof record.actorClerkUserId === "string" ? { actorClerkUserId: record.actorClerkUserId } : {}),
  };
}
