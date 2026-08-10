import "server-only";
import { WorkflowIdConflictPolicy } from "@temporalio/client";
import { isTemporalConfigured } from "./config";
import { getTemporalClient } from "./client";
import { TASK_QUEUES } from "./task-queues";
import { generationWorkflowId } from "./workflow-ids";

/**
 * Starts the Temporal GenerationWorkflow for one generation (Phase 6R.3).
 *
 * OFF BY DEFAULT. Temporal ownership activates only when
 * TEMPORAL_GENERATION_ENABLED is exactly "true" AND a namespace is actually
 * configured — the same two-key pattern `resolveExecutionMode()` already uses
 * for Trigger.dev. Credentials alone never switch ownership, so an
 * environment that merely has a Temporal namespace keeps running the proven
 * direct/trigger paths.
 *
 * The workflow argument set is deliberately tiny: a generation id and the
 * clerk user id captured from a verified server-side session. Everything else
 * — provider, model, settings, ownership — is re-derived inside activities
 * from the database and the model registry. Nothing secret is passed, because
 * a workflow argument is written into Temporal's durable history.
 */

export function isTemporalGenerationEnabled(): boolean {
  return process.env.TEMPORAL_GENERATION_ENABLED === "true" && isTemporalConfigured();
}

export interface StartGenerationWorkflowResult {
  workflowId: string;
  /**
   * Run id of the workflow this call is bound to. With USE_EXISTING this may
   * be a run that was already in progress — the SDK does not report which,
   * and nothing here guesses.
   */
  runId: string;
}

/**
 * Starts (or joins) the workflow that owns this generation.
 *
 * The workflow id is the deterministic `gen:<generationId>` from
 * workflow-ids.ts, and the conflict policy is USE_EXISTING: a duplicate
 * dispatch — a double-clicked button, a retried request, a second transport —
 * attaches to the running workflow instead of starting a second one. That is
 * the outermost of the duplicate-work guards, enforced by the Temporal server
 * before any Cinefield code runs.
 */
export async function startGenerationWorkflow(params: {
  generationId: string;
  clerkUserId: string;
}): Promise<StartGenerationWorkflowResult> {
  const client = await getTemporalClient();
  const workflowId = generationWorkflowId(params.generationId);

  const handle = await client.workflow.start("generationWorkflow", {
    taskQueue: TASK_QUEUES.generation,
    workflowId,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    args: [{ generationId: params.generationId, clerkUserId: params.clerkUserId }],
  });

  return { workflowId, runId: handle.firstExecutionRunId };
}

/**
 * Requests cancellation of a generation's workflow.
 *
 * Sends the workflow's own signal rather than a hard Temporal cancel so the
 * workflow can run its cleanup activity (which performs the Phase 6
 * `markCancelled` compare-and-set) instead of being torn down mid-flight.
 * A missing workflow is not an error: the generation may predate Temporal
 * ownership or have already finished.
 */
export async function requestGenerationCancellation(generationId: string): Promise<boolean> {
  const client = await getTemporalClient();
  try {
    const handle = client.workflow.getHandle(generationWorkflowId(generationId));
    await handle.signal("cancelGeneration");
    return true;
  } catch {
    return false;
  }
}
