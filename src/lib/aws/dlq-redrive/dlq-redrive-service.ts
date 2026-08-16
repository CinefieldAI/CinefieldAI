import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateDlqRedriveDecision } from "./dlq-redrive-decision-engine";
import { createSupabaseDlqRedriveSource } from "./adapters/supabase-dlq-redrive-source";
import type { DlqRedriveDecision } from "./dlq-redrive-contract";

/**
 * The real, production-shaped entrypoint (Phase 15-D/1).
 *
 * Takes one already-received `cinefield-provider-dlq.fifo` message body and
 * the canonical database, and returns a decision — nothing more.
 *
 * ---------------------------------------------------------------------------
 * NOTHING CALLS THIS AUTOMATICALLY YET, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 * This function does not poll SQS, does not subscribe to anything, and does
 * not call any AWS redrive API (`StartMessageMoveTask` or otherwise). There
 * is no scheduler wired to it in this batch. A DLQ redrive decision is
 * inherently per-message and investigation-driven — unlike Phase 15-C's
 * restore verification, which naturally runs on a timer against a rotating
 * target, a redrive decision is naturally invoked when an operator (or a
 * future 15-D/2 redrive trigger) already has a specific parked message in
 * hand. Wiring a cron job to call this on a schedule, with nothing yet to
 * feed it real DLQ message bodies, would be exactly the "built but never
 * wired" defect this codebase has repeatedly found and removed elsewhere.
 *
 * This function is nonetheless real, not a stub: it reads genuine durable
 * evidence through `createSupabaseDlqRedriveSource`, the same repository
 * shape every other orchestration read in this codebase uses. A future
 * caller — a manual investigation script (in the shape of
 * `scripts/dr-restore-proof-verify.ts`), or a 15-D/2 redrive trigger — wires
 * to this function directly, exactly as `runRestoreVerification` already
 * existed as real logic before anything scheduled called it.
 */
export async function evaluateProviderDlqMessage(
  admin: SupabaseClient,
  rawMessageBody: string
): Promise<DlqRedriveDecision> {
  return evaluateDlqRedriveDecision({
    rawMessageBody,
    source: createSupabaseDlqRedriveSource(admin),
  });
}
