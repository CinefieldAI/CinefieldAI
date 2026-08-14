import "server-only";
import { getTemporalClient } from "./client";
import { generationWorkflowId } from "./workflow-ids";
import { createFieldLogger } from "@/lib/observability/logger";

/**
 * Cinefield provider-event → Temporal signal transport (Phase 6R.10).
 *
 * The single place a verified provider callback reaches the workflow that
 * owns a generation. Deliberately thin: it resolves the deterministic
 * workflow id, sends one signal, and classifies the outcome. It performs
 * no correlation, no state change, and no decision about whether the event
 * was legitimate — all of that has already happened by the time this is
 * called (see webhook-temporal-bridge.ts).
 *
 * NEVER signalWithStart
 * `signalWithStart` would CREATE a workflow when none exists. For a
 * provider callback that is exactly the wrong behavior: a webhook arriving
 * for a generation whose workflow already finished (or was never started
 * under Temporal ownership) must not conjure a second workflow for work
 * that is already done. The workflow id is a pure function of the
 * generation id precisely so Temporal itself rejects a duplicate — using
 * signalWithStart here would defeat that guard. A missing workflow is
 * reported as `workflow_not_found` and handled by the caller.
 */

export type ProviderEventSignalOutcome =
  | { outcome: "signalled" }
  | { outcome: "workflow_not_found" }
  | { outcome: "unavailable"; errorCode: string };

export interface ProviderEventSignalPayload {
  attemptId: string;
  providerJobId: string;
  status: "processing" | "completed" | "failed";
}

/**
 * Phase 13-E: delegates to the Sensitive Data Guard.
 *
 * The call sites below are unchanged — the difference is that every field
 * now passes the telemetry allow-list before it reaches console or any
 * future sink. An unknown or unsafe field is dropped, not printed.
 */
const emit = createFieldLogger("provider-event-signal");

function log(fields: Record<string, unknown>): void {
  emit(fields);
}

/**
 * Signals the GenerationWorkflow that owns `generationId`.
 *
 * `unavailable` explicitly means "the observation is durable but the
 * workflow was not told" — the caller must surface that as retryable so a
 * provider redelivery, or reconciliation, can try again. It must never be
 * reported as success.
 */
export async function signalProviderEvent(
  generationId: string,
  payload: ProviderEventSignalPayload
): Promise<ProviderEventSignalOutcome> {
  const workflowId = generationWorkflowId(generationId);

  try {
    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal("providerEvent", payload);
    return { outcome: "signalled" };
  } catch (caught) {
    const errorName = caught instanceof Error ? caught.name : "UnknownError";

    // Temporal reports a missing/closed workflow distinctly from a
    // transport failure. The former is a normal, non-retryable outcome (the
    // work is already over); the latter must stay retryable.
    if (errorName === "WorkflowNotFoundError" || errorName === "NotFoundError") {
      log({ generationId, result: "workflow_not_found" });
      return { outcome: "workflow_not_found" };
    }

    log({ generationId, result: "unavailable", error: errorName });
    return { outcome: "unavailable", errorCode: errorName };
  }
}
