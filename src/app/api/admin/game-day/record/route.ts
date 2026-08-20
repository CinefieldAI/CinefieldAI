import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { recordGameDayExercise } from "@/lib/chaos/game-day-execution-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { guardPrivilegedMutation } from "@/lib/security/privileged-mutation-guard";
import type { RecoveryIncidentEvidence } from "@/lib/recovery/recovery-contract";
import type { RestoreValidationState } from "@/lib/dr/restore-evidence-contract";

/**
 * POST /api/admin/game-day/record — Phase 26-D.
 *
 * Records the outcome of a game-day/chaos drill that already happened
 * (local or test today; a real staging environment once one exists — see
 * `chaos-environment-guard.ts`, which refuses `production` unconditionally).
 * The caller submits raw incident evidence, never a verdict — the service
 * always recomputes recovery/outcome server-side via Phase 15-D/2's
 * `measureRecovery()`. `durable_write` route class — this is a durable,
 * append-only write. `chaos.game_day.record` is OPERATOR_MUTATION (Phase
 * 16-E catalogue): recording an already-completed drill's evidence carries
 * far lower risk than a destructive/irreversible action, so it does not
 * require the two-person Tier-0 chain `secret.rotate`/`data.delete` use —
 * see `tier0-action-catalogue.ts` for the classification and why.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const csrfRefusal = guardPrivilegedMutation(request);
  if (csrfRefusal) return csrfRefusal;

  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "durable_write", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: "invalid_body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const { scenarioId, environment, incident, observedDataLossSeconds, restoreValidationState, failedGuardrails, permanentActions, runbookUpdateRef } =
    payload;

  if (
    typeof scenarioId !== "string" ||
    typeof environment !== "string" ||
    typeof incident !== "object" ||
    incident === null ||
    typeof (incident as Record<string, unknown>).incidentId !== "string" ||
    typeof (incident as Record<string, unknown>).recoveryClass !== "string" ||
    typeof (incident as Record<string, unknown>).affectedComponent !== "string" ||
    typeof (incident as Record<string, unknown>).reasonCode !== "string" ||
    typeof (incident as Record<string, unknown>).startedAt !== "string"
  ) {
    return privateJson({ outcome: "INVALID_INPUT", reasonCode: "malformed_request" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const result = await recordGameDayExercise(getSupabaseAdminClient(), {
    scenarioId,
    environment,
    actorClerkUserId: access.clerkUserId as string,
    incident: incident as unknown as RecoveryIncidentEvidence,
    now: new Date(),
    observedDataLossSeconds: typeof observedDataLossSeconds === "number" ? observedDataLossSeconds : undefined,
    restoreValidationState:
      typeof restoreValidationState === "string" ? (restoreValidationState as RestoreValidationState) : undefined,
    failedGuardrails: Array.isArray(failedGuardrails) ? failedGuardrails.filter((v) => typeof v === "string") : undefined,
    permanentActions: Array.isArray(permanentActions) ? permanentActions.filter((v) => typeof v === "string") : undefined,
    runbookUpdateRef: typeof runbookUpdateRef === "string" ? runbookUpdateRef : null,
  });
  return privateJson(result);
}
