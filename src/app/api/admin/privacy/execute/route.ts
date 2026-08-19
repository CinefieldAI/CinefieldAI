import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { executePrivacyRequest } from "@/lib/privacy/privacy-execution-service";
import { getCurrentAssuranceEvidence, getCurrentElevationVerdict } from "@/lib/admin/require-step-up";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { guardPrivilegedMutation } from "@/lib/security/privileged-mutation-guard";

/**
 * POST /api/admin/privacy/execute — Phase 23-B/23-C, the privileged path.
 *
 * Body: `{ privacyRequestId: string; requestId?: string }`. `requestId` is
 * the SAME optional-resume contract `/api/admin/router/disable` already
 * uses: omitted, a fresh pending two-person request is created and its id
 * returned on `TIER0_AUTHORIZATION_REQUIRED`; supplied, an attempt resumes
 * that pending request after a second admin approved it via
 * `POST /api/admin/privileged-actions/decide`. `durable_write` route class,
 * never reachable via GET — this mutates (executes an export or a
 * deletion), it does not merely read.
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
  const { privacyRequestId, requestId } = (body as { privacyRequestId?: unknown; requestId?: unknown }) ?? {};
  if (typeof privacyRequestId !== "string") {
    return privateJson({ outcome: "INVALID_REQUEST" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const [assurance, elevation] = await Promise.all([
    getCurrentAssuranceEvidence(),
    getCurrentElevationVerdict(access.clerkUserId),
  ]);

  const result = await executePrivacyRequest(getSupabaseAdminClient(), {
    privacyRequestId,
    actorClerkUserId: access.clerkUserId as string,
    stepUp: { assurance, elevation },
    requestId: typeof requestId === "string" && requestId.length > 0 ? requestId : undefined,
  });
  return privateJson(result);
}
