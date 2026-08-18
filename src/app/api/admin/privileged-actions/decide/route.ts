import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getCurrentAssuranceEvidence, getCurrentElevationVerdict } from "@/lib/admin/require-step-up";
import { decidePrivilegedAction } from "@/lib/admin/tier0-authorization";
import {
  isValidDecisionRequest,
  PRIVILEGED_ACTION_REASON_PATTERN,
} from "@/lib/admin/privileged-action-decision-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { guardPrivilegedMutation } from "@/lib/security/privileged-mutation-guard";

/**
 * POST /api/admin/privileged-actions/decide — Phase 19 closure fix.
 *
 * The missing half of the Phase 16-E dual-control mechanism:
 * `admin_privileged_action_events` + `record_admin_privileged_action_approval`
 * (the SQL RPC that structurally blocks self-approval) were real and tested
 * since Phase 16-E, but nothing in the application ever called the RPC — a
 * `requiresTwoPerson` action could reach `awaiting_second_approval` and then
 * never be satisfiable, since every attempt minted a fresh `requestId` with
 * zero recorded approvals. This route is the real, second caller: a
 * DIFFERENT admin approves or rejects an EXISTING pending `requestId`
 * (surfaced on the first admin's `TIER0_AUTHORIZATION_REQUIRED` response),
 * gated by the same role/step-up bar as the original request. It never
 * executes the underlying action itself — approval is a durable fact the
 * original caller's retry (with the same `requestId`) later consumes.
 *
 * Body: `{ requestId: string; action: string; targetType: string; targetId?:
 * string; decision: "approve" | "reject"; reasonCode?: string }`.
 * `durable_write` route class, `guardPrivilegedMutation` CSRF guard, opaque
 * 404 on denial — same conventions as every other Phase 16 admin route.
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
    return privateJson({ outcome: "INVALID_REQUEST" }, { status: 400 });
  }

  if (!isValidDecisionRequest(body)) {
    return privateJson({ outcome: "INVALID_REQUEST" }, { status: 400 });
  }
  if (body.reasonCode !== undefined && body.reasonCode !== null && !PRIVILEGED_ACTION_REASON_PATTERN.test(body.reasonCode)) {
    return privateJson({ outcome: "INVALID_REQUEST" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const [assurance, elevation] = await Promise.all([
    getCurrentAssuranceEvidence(),
    getCurrentElevationVerdict(access.clerkUserId),
  ]);

  const result = await decidePrivilegedAction(getSupabaseAdminClient(), {
    requestId: body.requestId,
    action: body.action,
    actorClerkUserId: access.clerkUserId as string,
    target: { type: body.targetType, id: body.targetId ?? null },
    decision: body.decision,
    reasonCode: body.reasonCode ?? null,
    correlationId: null,
    assurance,
    elevation,
  });

  return privateJson(result);
}
