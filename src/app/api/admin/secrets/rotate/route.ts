import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { executeSecretRotation } from "@/lib/secrets/rotation-execution-service";
import { getCurrentAssuranceEvidence, getCurrentElevationVerdict } from "@/lib/admin/require-step-up";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { guardPrivilegedMutation } from "@/lib/security/privileged-mutation-guard";

/**
 * POST /api/admin/secrets/rotate — Phase 25-C, the privileged path.
 *
 * Body: `{ secretName: string; requestId?: string }`. `requestId` is the
 * SAME optional-resume contract `/api/admin/privacy/execute` and
 * `/api/admin/router/disable` already use: omitted, a fresh pending
 * two-person request is created and its id returned on
 * `TIER0_AUTHORIZATION_REQUIRED`; supplied, an attempt resumes that
 * pending request after a second admin approved it via
 * `POST /api/admin/privileged-actions/decide`. `durable_write` route
 * class — this mutates a live credential.
 *
 * NEVER returns a secret value. `RotationExecutionOutcome`'s
 * `ROTATION_COMPLETED` case carries only `newVersionRef` — an opaque
 * provider-assigned identifier, matching `secret-registry.ts`'s own
 * "names and version references, never values" discipline.
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
  const { secretName, requestId } = (body as { secretName?: unknown; requestId?: unknown }) ?? {};
  if (typeof secretName !== "string" || secretName.length === 0) {
    return privateJson({ outcome: "SECRET_NOT_REGISTERED" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const [assurance, elevation] = await Promise.all([
    getCurrentAssuranceEvidence(),
    getCurrentElevationVerdict(access.clerkUserId),
  ]);

  const result = await executeSecretRotation(getSupabaseAdminClient(), {
    secretName,
    actorClerkUserId: access.clerkUserId as string,
    stepUp: { assurance, elevation },
    requestId: typeof requestId === "string" && requestId.length > 0 ? requestId : undefined,
  });
  return privateJson(result);
}
