import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GENERATION_ID_PATTERN } from "@/lib/orchestration/generation-api-contract";
import { readCancelIntent, recordCancelIntent } from "@/lib/orchestration/cancel-intent";
import { describeGenerationWorkflow } from "@/lib/temporal/workflow-inspection";
import { requestGenerationCancellation } from "@/lib/temporal/generation-starter";
import { isTemporalGenerationEnabled } from "@/lib/temporal/config";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { createLogger } from "@/lib/observability/logger";
import { authorizeTier0Action, recordTier0Execution } from "./tier0-authorization";
import type { AssuranceEvidence, ElevationVerdict } from "./step-up-auth";
import {
  ADMIN_CANCEL_REASON_PATTERN,
  CANCELLABLE_GENERATION_STATES,
  type CancelIntentView,
  type TemporalAdminCancelResult,
  type TemporalInspectionResult,
  type WorkflowInspectionState,
} from "./temporal-admin-contract";

/**
 * Phase 16-D Temporal/Workflows admin read + cancel service.
 *
 * See `temporal-admin-contract.ts`'s header for the ownership boundary. Two
 * exports: `getAdminTemporalInspection` (read-only, no side effect) and
 * `performAdminTemporalCancel` (the one guarded mutation this whole 16-D
 * package allows — see AGENTS.md/the 16-D spec's Action Authority section).
 */

const auditLog = createLogger("admin-temporal");

interface GenerationRow {
  id: string;
  status: string;
  clerk_user_id: string;
  metadata: Record<string, unknown> | null;
}

async function readGenerationRow(admin: SupabaseClient, generationId: string): Promise<GenerationRow | null> {
  const { data, error } = await admin
    .from("generations")
    .select("id, status, clerk_user_id, metadata")
    .eq("id", generationId)
    .maybeSingle();
  if (error) throw new OrchestrationError("DATABASE_UPDATE_FAILED", { context: { generationId, operation: "admin_temporal_read" } });
  return (data as GenerationRow | null) ?? null;
}

function projectCancelIntent(metadata: Record<string, unknown> | null): CancelIntentView | null {
  const intent = readCancelIntent(metadata);
  if (!intent) return null;
  return {
    requestedAt: intent.requestedAt,
    reason: intent.reason,
    recordedByAdmin: intent.actorClerkUserId ?? null,
  };
}

/**
 * Read-only inspection: the durable generation summary plus a live Temporal
 * `describe()`. Never mutates anything, never signals Temporal.
 */
export async function getAdminTemporalInspection(
  admin: SupabaseClient,
  generationId: string
): Promise<TemporalInspectionResult> {
  if (!GENERATION_ID_PATTERN.test(generationId)) {
    return { outcome: "INVALID_GENERATION_ID" };
  }

  let row: GenerationRow | null;
  try {
    row = await readGenerationRow(admin, generationId);
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "generation_read_failed" };
  }
  if (!row) return { outcome: "GENERATION_NOT_FOUND" };

  const workflowOutcome = await describeGenerationWorkflow(generationId);
  const workflow: WorkflowInspectionState =
    workflowOutcome.outcome === "FOUND"
      ? { state: "FOUND", view: workflowOutcome.workflow }
      : workflowOutcome.outcome === "TEMPORAL_NOT_CONFIGURED"
        ? { state: "TEMPORAL_NOT_CONFIGURED" }
        : workflowOutcome.outcome === "WORKFLOW_NOT_FOUND"
          ? { state: "WORKFLOW_NOT_FOUND" }
          : { state: "UNAVAILABLE", reasonCode: workflowOutcome.reasonCode };

  return {
    outcome: "FOUND",
    generation: {
      generationId: row.id,
      status: row.status,
      cancelIntent: projectCancelIntent(row.metadata),
    },
    workflow,
  };
}

/**
 * The one guarded mutation: an admin-initiated cancel of a generation's
 * workflow.
 *
 * ORDER, same discipline as the user-facing route and as Phase 9-E:
 *   1. fresh current-state re-read (this function's own, not the caller's)
 *   2. fail closed on a terminal generation — CANCEL_NOT_ALLOWED, not an error
 *   3. record the durable intent through the UNCHANGED canonical function,
 *      passing the REAL owner id (never the admin's) plus the admin's own id
 *      as `adminActorId` so the trail can tell the two apart
 *   4. only then signal Temporal
 *
 * Route-level `requireAdminAccess()` + `guardRoute({ routeClass:
 * "durable_write" })` already happened before this is called — this
 * function additionally validates its own inputs so it fails closed even if
 * ever called from anywhere else.
 */
export async function performAdminTemporalCancel(
  admin: SupabaseClient,
  params: {
    generationId: string;
    adminActorId: string;
    reasonCode: string;
    // Phase 16-E. Resolved by the route layer (`require-step-up.ts`) and
    // passed in — see `dlq-admin-service.ts`'s identical comment for why
    // this file never imports `require-step-up.ts` directly. Omitted (the
    // pre-16-E test calls) defaults to the honest fail-closed state.
    stepUp?: { assurance: AssuranceEvidence; elevation: ElevationVerdict };
  }
): Promise<TemporalAdminCancelResult> {
  const { generationId, adminActorId, reasonCode } = params;
  const stepUp = params.stepUp ?? {
    assurance: { state: "NOT_CONFIGURED" as const, verifiedAt: null },
    elevation: { elevated: false as const, reasonCode: "no_elevation" as const },
  };

  if (
    !GENERATION_ID_PATTERN.test(generationId) ||
    !ADMIN_CANCEL_REASON_PATTERN.test(reasonCode) ||
    typeof adminActorId !== "string" ||
    adminActorId.length === 0
  ) {
    return { outcome: "INVALID_INPUT" };
  }

  const requestId = randomUUID();
  const decision = await authorizeTier0Action(admin, {
    requestId,
    action: "temporal.workflow.cancel",
    actorClerkUserId: adminActorId,
    target: { type: "generation", id: generationId },
    reasonCode: null,
    correlationId: null,
    assurance: stepUp.assurance,
    elevation: stepUp.elevation,
  });
  if (!decision.allowed) {
    auditLog.info("admin_temporal_cancel_attempted", { adminActorId, generationId, reasonCode, outcome: "TIER0_AUTHORIZATION_REQUIRED", tier0ReasonCode: decision.reasonCode });
    return { outcome: "TIER0_AUTHORIZATION_REQUIRED", reasonCode: decision.reasonCode };
  }

  let row: GenerationRow | null;
  try {
    row = await readGenerationRow(admin, generationId);
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "generation_read_failed" };
  }
  if (!row) return { outcome: "GENERATION_NOT_FOUND" };

  if (!CANCELLABLE_GENERATION_STATES.includes(row.status)) {
    return { outcome: "CANCEL_NOT_ALLOWED", status: row.status };
  }

  let intent;
  try {
    intent = await recordCancelIntent(admin, generationId, row.clerk_user_id, `admin_cancel:${reasonCode}`, {
      adminActorId,
    });
  } catch (caught) {
    auditLog.info("admin_temporal_cancel_attempted", { adminActorId, generationId, reasonCode, outcome: "failed" });
    if (caught instanceof OrchestrationError && caught.code === "GENERATION_NOT_FOUND") {
      return { outcome: "GENERATION_NOT_FOUND" };
    }
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "cancel_intent_write_failed" };
  }

  if (intent.outcome === "already_terminal") {
    auditLog.info("admin_temporal_cancel_attempted", {
      adminActorId,
      generationId,
      reasonCode,
      outcome: "already_terminal",
    });
    return { outcome: "CANCEL_NOT_ALLOWED", status: intent.status };
  }

  let signalled = false;
  if (isTemporalGenerationEnabled()) {
    signalled = await requestGenerationCancellation(generationId);
  }

  auditLog.info("admin_temporal_cancel_attempted", {
    adminActorId,
    generationId,
    reasonCode,
    outcome: "cancel_requested",
    workflowSignalled: signalled,
  });

  await recordTier0Execution(admin, {
    requestId,
    action: "temporal.workflow.cancel",
    actorClerkUserId: adminActorId,
    target: { type: "generation", id: generationId },
    outcome: "executed",
    outcomeDetail: signalled ? "workflow_signalled" : "workflow_not_signalled",
  });

  return {
    outcome: "CANCEL_REQUESTED",
    generationId,
    alreadyRequested: intent.alreadyRequested === true,
    workflowSignalled: signalled,
  };
}
