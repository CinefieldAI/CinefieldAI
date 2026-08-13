import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generationWorkflowId } from "@/lib/temporal/workflow-ids";
import { startGenerationWorkflow } from "@/lib/temporal/generation-starter";
import { isTemporalGenerationEnabled } from "@/lib/temporal/config";
import {
  claimWorkflowStartIntents,
  markWorkflowStartDelivered,
  markWorkflowStartFailed,
  type WorkflowStartIntent,
} from "./workflow-start-intent";

/**
 * Workflow-start relay (M6) — the thing that makes "committed" mean
 * "somebody is obliged to start this".
 *
 * WHAT IT IS ALLOWED TO DO, EXHAUSTIVELY
 * Call `startGenerationWorkflow` for a generation that already exists. That
 * is the entire mandate. It does not submit provider work, does not touch
 * credits, does not write generation state, does not choose a route, and
 * cannot create a generation. Temporal remains the only lifecycle owner —
 * this is a delivery mechanism sitting in front of it, not a second owner.
 * A relay that could do more would be exactly the duplicate-owner hazard
 * Phase 6R removed.
 *
 * WHY REDELIVERY IS SAFE
 * The workflow id is a pure function of the generation id and the starter
 * passes WorkflowIdConflictPolicy.USE_EXISTING, so Temporal itself refuses a
 * second workflow. At-least-once delivery therefore costs at most a
 * redundant API call. The dangerous direction — never starting — is the one
 * this removes.
 *
 * WHY IT NEVER GIVES UP
 * `markWorkflowStartFailed` returns a row to pending with backoff rather
 * than to a terminal state. An intent that cannot be delivered stays owed.
 * Abandoning it would recreate the stranded generation this exists to
 * prevent, just with a tidier-looking table.
 */

export interface RelayResult {
  claimed: number;
  delivered: number;
  failed: number;
  /** True when the relay declined to run because Temporal does not own generations here. */
  skipped: boolean;
}

export interface RelayDeps {
  claim: typeof claimWorkflowStartIntents;
  start: typeof startGenerationWorkflow;
  markDelivered: typeof markWorkflowStartDelivered;
  markFailed: typeof markWorkflowStartFailed;
  temporalEnabled: typeof isTemporalGenerationEnabled;
}

const defaultDeps: RelayDeps = {
  claim: claimWorkflowStartIntents,
  start: startGenerationWorkflow,
  markDelivered: markWorkflowStartDelivered,
  markFailed: markWorkflowStartFailed,
  temporalEnabled: isTemporalGenerationEnabled,
};

/**
 * Backoff by attempt count, capped. Deliberately coarse: this retries a
 * control-plane API call, not a user-visible operation, and a Temporal
 * outage is measured in minutes rather than milliseconds.
 */
function retryDelaySeconds(attempts: number): number {
  const delay = 30 * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, 900);
}

async function deliverOne(intent: WorkflowStartIntent, admin: SupabaseClient, deps: RelayDeps) {
  // The stored id is re-derived rather than trusted. They can only disagree
  // if something wrote this table outside create_generation_tx(), and in that
  // case starting the stored id would open a workflow nothing can correlate
  // back to the generation.
  const expected = generationWorkflowId(intent.generationId);
  if (intent.workflowId !== expected) {
    await deps.markFailed(admin, intent.generationId, intent.claimToken, "workflow_id_mismatch", 3600);
    return false;
  }

  try {
    await deps.start({
      generationId: intent.generationId,
      clerkUserId: intent.clerkUserId,
    });
    // USE_EXISTING means an already-running workflow returns here normally.
    // That is a delivered intent — the obligation was to have a workflow, not
    // to be the caller that created it.
    return await deps.markDelivered(admin, intent.generationId, intent.claimToken);
  } catch (caught) {
    const errorCode = caught instanceof Error ? caught.name : "UnknownError";
    await deps.markFailed(
      admin,
      intent.generationId,
      intent.claimToken,
      errorCode,
      retryDelaySeconds(intent.attempts)
    );
    return false;
  }
}

/**
 * Runs one relay pass. Intended to be called by an operations dispatcher on
 * a schedule — Trigger.dev may call it, as a dispatcher only; it owns no part
 * of the generation lifecycle by doing so.
 *
 * Returns counts rather than throwing, so a scheduler sees a result it can
 * log instead of a stack trace it has to interpret.
 */
export async function runWorkflowStartRelay(
  admin: SupabaseClient,
  options: { limit?: number; leaseSeconds?: number } = {},
  deps: RelayDeps = defaultDeps
): Promise<RelayResult> {
  // No Temporal ownership means no workflow to start. Claiming intents here
  // would mark them `starting` and then fail every one of them, burning the
  // attempt counter for a deployment shape that simply is not running
  // Temporal.
  if (!deps.temporalEnabled()) {
    return { claimed: 0, delivered: 0, failed: 0, skipped: true };
  }

  const intents = await deps.claim(admin, options);
  let delivered = 0;

  for (const intent of intents) {
    if (await deliverOne(intent, admin, deps)) delivered += 1;
  }

  return {
    claimed: intents.length,
    delivered,
    failed: intents.length - delivered,
    skipped: false,
  };
}
