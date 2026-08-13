import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Durable workflow-start intent, repository side (M6).
 *
 * Thin on purpose. The table is described in
 * supabase/migrations/20260818000000_workflow_start_outbox.sql and every
 * concurrency guarantee lives there — claim leases, token verification,
 * SKIP LOCKED — because a guarantee that lives in TypeScript is a guarantee
 * two processes can disagree about. This module only speaks to those
 * functions.
 *
 * NOTE ON WHAT AN INTENT IS. It records that a workflow OUGHT to be started,
 * not that one was. Reading a pending row tells you nothing about whether
 * Temporal already has the workflow — the relay finds that out by asking
 * Temporal, and an already-running workflow is a delivered intent, not a
 * conflict.
 */

export interface WorkflowStartIntent {
  generationId: string;
  workflowId: string;
  clerkUserId: string;
  /** Delivery attempts so far, including the one that produced this claim. */
  attempts: number;
  /** Proves ownership of the lease when resolving the row. */
  claimToken: string;
}

interface ClaimedRow {
  generation_id: string;
  workflow_id: string;
  clerk_user_id: string;
  attempts: number;
  claim_token: string;
}

/**
 * Claims a batch of due intents, marking them `starting` under a lease.
 *
 * Returns an empty array rather than throwing when the claim fails: a relay
 * that cannot reach the database has nothing useful to do and must not turn
 * a transient outage into an exception that stops the dispatcher loop.
 */
export async function claimWorkflowStartIntents(
  admin: SupabaseClient,
  options: { limit?: number; leaseSeconds?: number } = {}
): Promise<WorkflowStartIntent[]> {
  const { data, error } = await admin.rpc("claim_workflow_start_intents", {
    p_limit: options.limit ?? 50,
    p_lease_seconds: options.leaseSeconds ?? 120,
  });

  if (error || !Array.isArray(data)) return [];

  return (data as ClaimedRow[]).map((row) => ({
    generationId: row.generation_id,
    workflowId: row.workflow_id,
    clerkUserId: row.clerk_user_id,
    attempts: row.attempts,
    claimToken: row.claim_token,
  }));
}

/**
 * Marks an intent delivered. False means the lease was lost — another relay
 * reclaimed the row — and the caller must not treat its own work as
 * authoritative.
 */
export async function markWorkflowStartDelivered(
  admin: SupabaseClient,
  generationId: string,
  claimToken: string
): Promise<boolean> {
  const { data, error } = await admin.rpc("mark_workflow_start_delivered", {
    p_generation_id: generationId,
    p_claim_token: claimToken,
  });
  return !error && data === true;
}

/**
 * Returns an intent to pending with backoff. Deliberately never terminal —
 * an undeliverable start stays owed, because the failure mode this whole
 * mechanism exists to prevent is a generation nobody is obliged to start.
 */
export async function markWorkflowStartFailed(
  admin: SupabaseClient,
  generationId: string,
  claimToken: string,
  errorCode?: string,
  retryDelaySeconds = 30
): Promise<boolean> {
  const { data, error } = await admin.rpc("mark_workflow_start_failed", {
    p_generation_id: generationId,
    p_claim_token: claimToken,
    p_error_code: errorCode ?? null,
    p_retry_delay_seconds: retryDelaySeconds,
  });
  return !error && data === true;
}

/**
 * Resolves an intent that the request path already delivered, without going
 * through a claim.
 *
 * The inline start in `executeGenerationRequest` is the fast path: it starts
 * the workflow milliseconds after the row commits, so the relay should not
 * also have to. This marks that row delivered directly.
 *
 * Safe because it is not the correctness mechanism — if this write is lost,
 * the row stays pending and the relay redelivers, which Temporal absorbs via
 * USE_EXISTING. Losing it costs one redundant start call, never a second
 * workflow.
 */
export async function resolveIntentStartedInline(
  admin: SupabaseClient,
  generationId: string
): Promise<void> {
  await admin
    .from("workflow_start_outbox")
    .update({
      status: "delivered",
      delivered_at: new Date().toISOString(),
      claim_token: null,
      claimed_at: null,
      last_error_code: null,
    })
    .eq("generation_id", generationId)
    .eq("status", "pending");
}
