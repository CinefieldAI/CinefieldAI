import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { setFeatureFlagAdmin } from "@/lib/admin/feature-flag-admin-service";
import { getCurrentAssuranceEvidence, getCurrentElevationVerdict } from "@/lib/admin/require-step-up";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { guardPrivilegedMutation } from "@/lib/security/privileged-mutation-guard";

/**
 * POST /api/admin/feature-flags/set — Phase 21-B/C.
 *
 * Body: `{ key: string; value: boolean | string; reason: string; ticketRef?:
 * string; expiresAt?: string | null; requestId?: string }`. `durable_write`
 * route class, never reachable via GET — same pattern as
 * `POST /api/admin/router/disable`.
 *
 * `requestId` is optional: omitted, a fresh pending request is created
 * (returned on `TIER0_AUTHORIZATION_REQUIRED` for two-person actions like
 * `release_stage.activate_public`); supplied, an attempt resumes that SAME
 * pending request after a second admin approves it via
 * `POST /api/admin/privileged-actions/decide`.
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

  const { key, value, reason, ticketRef, expiresAt, requestId } =
    (body as {
      key?: unknown;
      value?: unknown;
      reason?: unknown;
      ticketRef?: unknown;
      expiresAt?: unknown;
      requestId?: unknown;
    }) ?? {};

  if (typeof key !== "string" || (typeof value !== "boolean" && typeof value !== "string")) {
    return privateJson({ outcome: "INVALID_TARGET" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const [assurance, elevation] = await Promise.all([
    getCurrentAssuranceEvidence(),
    getCurrentElevationVerdict(access.clerkUserId),
  ]);

  const result = await setFeatureFlagAdmin(
    getSupabaseAdminClient(),
    access.clerkUserId as string,
    key,
    value,
    typeof reason === "string" ? reason.trim() : "",
    typeof ticketRef === "string" && ticketRef.length > 0 ? ticketRef : undefined,
    typeof expiresAt === "string" && expiresAt.length > 0 ? expiresAt : null,
    { assurance, elevation },
    typeof requestId === "string" && requestId.length > 0 ? requestId : undefined
  );
  return privateJson(result);
}
