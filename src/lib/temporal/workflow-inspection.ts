import "server-only";
import { WorkflowNotFoundError } from "@temporalio/client";
import { getTemporalClient, TemporalNotConfiguredError } from "./client";
import { generationWorkflowId } from "./workflow-ids";

/**
 * Read-only Temporal workflow inspection (Phase 16-D).
 *
 * ---------------------------------------------------------------------------
 * THE EXISTING TEMPORAL OWNER, NOT A SECOND WORKFLOW ENGINE
 * ---------------------------------------------------------------------------
 * This calls the SAME cached client `getTemporalClient()` (`./client.ts`,
 * Phase 6R.2) and the SAME deterministic id derivation
 * `generationWorkflowId()` (`./workflow-ids.ts`) every other Temporal caller
 * in this repository already uses. It adds exactly one new capability this
 * repository did not have before: `WorkflowHandle.describe()`, a standard,
 * read-only Temporal SDK call. Nothing here starts, signals, queries, or
 * cancels a workflow — inspection is a strict subset of what
 * `generation-starter.ts` already does.
 *
 * ---------------------------------------------------------------------------
 * NO RAW HISTORY, NO RAW PAYLOAD
 * ---------------------------------------------------------------------------
 * `describe()` returns `WorkflowExecutionDescription`, which carries no
 * workflow input/result payload by construction — those require a SEPARATE
 * SDK call (`fetchHistory()`/`result()`) that this module never makes. Of
 * the fields `describe()` does return, this projects a fixed allow-list only
 * (id, run id, status name, three timestamps, a task queue name, and a
 * history LENGTH count) and explicitly drops `memo`, `searchAttributes`, and
 * the `raw` protobuf response — none of which Cinefield's own workflow start
 * ever populates with anything beyond the generation id and clerk user id
 * arguments, but all of which are excluded on principle rather than by
 * inspection, matching the sensitive-data boundary every other Phase 16
 * surface holds.
 */

/** Mirrors `@temporalio/client`'s `WorkflowExecutionStatusName`, narrowed to what this repo's workflow can reach. */
export type WorkflowLifecycleStatus =
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TERMINATED"
  | "CONTINUED_AS_NEW"
  | "TIMED_OUT"
  | "UNKNOWN";

export interface WorkflowInspectionView {
  readonly workflowId: string;
  readonly runId: string;
  readonly taskQueue: string;
  readonly status: WorkflowLifecycleStatus;
  readonly startedAt: string;
  readonly executionTimeAt: string | null;
  readonly closedAt: string | null;
  /** Count only — never the events themselves. */
  readonly historyLength: number;
}

export type WorkflowInspectionOutcome =
  | { readonly outcome: "TEMPORAL_NOT_CONFIGURED" }
  | { readonly outcome: "WORKFLOW_NOT_FOUND" }
  | { readonly outcome: "UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly workflow: WorkflowInspectionView };

function normalizeStatus(name: string): WorkflowLifecycleStatus {
  const known: readonly WorkflowLifecycleStatus[] = [
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "TERMINATED",
    "CONTINUED_AS_NEW",
    "TIMED_OUT",
  ];
  return (known as readonly string[]).includes(name) ? (name as WorkflowLifecycleStatus) : "UNKNOWN";
}

/**
 * Describes the workflow that owns one generation, or reports honestly why
 * it could not.
 *
 * `generationId` is expected pre-validated by the caller (the admin service
 * re-uses `GENERATION_ID_PATTERN`, the same pattern every other 16-A/16-D
 * generation lookup already validates against) — this function only derives
 * the workflow id from it and asks Temporal.
 */
export async function describeGenerationWorkflow(generationId: string): Promise<WorkflowInspectionOutcome> {
  let client;
  try {
    client = await getTemporalClient();
  } catch (caught) {
    if (caught instanceof TemporalNotConfiguredError) return { outcome: "TEMPORAL_NOT_CONFIGURED" };
    return { outcome: "UNAVAILABLE", reasonCode: "temporal_connect_failed" };
  }

  try {
    const handle = client.workflow.getHandle(generationWorkflowId(generationId));
    const description = await handle.describe();

    return {
      outcome: "FOUND",
      workflow: {
        workflowId: description.workflowId,
        runId: description.runId,
        taskQueue: description.taskQueue,
        status: normalizeStatus(description.status.name),
        startedAt: description.startTime.toISOString(),
        executionTimeAt: description.executionTime ? description.executionTime.toISOString() : null,
        closedAt: description.closeTime ? description.closeTime.toISOString() : null,
        historyLength: description.historyLength,
      },
    };
  } catch (caught) {
    if (caught instanceof WorkflowNotFoundError) return { outcome: "WORKFLOW_NOT_FOUND" };
    return { outcome: "UNAVAILABLE", reasonCode: "workflow_describe_failed" };
  }
}
