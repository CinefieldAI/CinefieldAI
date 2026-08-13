import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Administrative retirement of stale generations.
 *
 * WHAT THIS IS FOR
 * A generation that Cinefield accepted, never submitted to any provider, and
 * is no longer going to execute. The live database held 91 of these: rows
 * left `queued` on 4–7 August when the legacy execute route was retired,
 * carrying models that mostly never existed server-side at all.
 *
 * THEY ARE NOT HARMLESS CLUTTER. Anything that scans for unfinished work sees
 * them as work. The M6 backfill had to be corrected precisely because it
 * marked them as owed a workflow, which would have had the relay start 91
 * workflows for abandoned rows.
 *
 * IT OWNS NO NEW SEMANTICS
 * The transition is `cancel_generation_tx` — the same guarded, outbox-emitting
 * transaction every other cancellation uses. This module adds a reason code
 * and a safety gate in front of it, nothing else. There is no new status
 * (`generations_status_check` allows exactly queued/processing/completed/
 * failed/cancelled, and inventing a sixth would be a schema change made to
 * flatter a cleanup script).
 *
 * WHY `cancelled` AND NOT `failed`
 * Nothing failed. The system never tried. `failed` would assert an execution
 * that never happened and would pollute every error-rate and reliability
 * measurement that reads terminal states. `completed` would assert output
 * that does not exist. `cancelled` is the honest one: the request was
 * abandoned, and the reason code says by whom and why.
 *
 * IT CANNOT: start a workflow, submit to a provider, create an attempt,
 * touch credits, delete a row, or retire anything the gate below rejects.
 */

/** Persisted at metadata.orchestration.cancelReason. Matches the SQL validator. */
export const STALE_RETIREMENT_REASON = "stale_retired_never_submitted";

export interface RetirementCandidate {
  generationId: string;
  status: string;
  hasAttempt: boolean;
  hasProviderJob: boolean;
  hasOutput: boolean;
  hasTemporalWorkflow: boolean;
}

export type RetirementRefusal =
  | "not_stale"
  | "has_attempt"
  | "has_provider_job"
  | "has_output"
  | "has_temporal_workflow";

/**
 * THE GATE. Fails closed: every reason to hesitate is a refusal.
 *
 * Each check maps to something that would be destroyed or misrepresented by
 * retiring the row:
 *   - an attempt means Cinefield reached the provider boundary at all
 *   - a provider job id means an external system may still be working, and
 *     may still bill for it
 *   - an output means bytes exist that a terminal-cancelled row would orphan
 *   - a Temporal workflow means something is actively running
 */
export function refusalFor(candidate: RetirementCandidate): RetirementRefusal | null {
  if (candidate.status !== "queued" && candidate.status !== "processing") return "not_stale";
  if (candidate.hasTemporalWorkflow) return "has_temporal_workflow";
  if (candidate.hasProviderJob) return "has_provider_job";
  if (candidate.hasAttempt) return "has_attempt";
  if (candidate.hasOutput) return "has_output";
  return null;
}

export interface RetirementOutcome {
  generationId: string;
  /** true only when THIS call performed the transition. */
  retired: boolean;
  /** Set when the gate refused; the row is untouched. */
  refusal?: RetirementRefusal;
  /** Set when the row was already terminal — a replay, not a failure. */
  alreadyTerminal?: string;
}

/**
 * Retires one candidate. Idempotent: `cancel_generation_tx` only transitions
 * from queued/processing, so a second run reports `applied: false` with the
 * existing status and emits no second event.
 */
export async function retireStaleGeneration(
  admin: SupabaseClient,
  candidate: RetirementCandidate
): Promise<RetirementOutcome> {
  const refusal = refusalFor(candidate);
  if (refusal) return { generationId: candidate.generationId, retired: false, refusal };

  const { data, error } = await admin.rpc("cancel_generation_tx", {
    p_generation_id: candidate.generationId,
    p_reason: STALE_RETIREMENT_REASON,
    p_trace_id: null,
    p_event_id: null,
  });

  if (error) return { generationId: candidate.generationId, retired: false };

  const result = data as { applied: boolean; status: string | null };
  if (result.applied) return { generationId: candidate.generationId, retired: true };

  return {
    generationId: candidate.generationId,
    retired: false,
    alreadyTerminal: result.status ?? undefined,
  };
}
