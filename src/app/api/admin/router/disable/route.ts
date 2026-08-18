import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { setAdminRouteEnabled } from "@/lib/admin/router-admin-service";
import { getCurrentAssuranceEvidence, getCurrentElevationVerdict } from "@/lib/admin/require-step-up";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { guardPrivilegedMutation } from "@/lib/security/privileged-mutation-guard";

/**
 * POST /api/admin/router/disable — Phase 16-B route enable/disable.
 *
 * Body: `{ routeId: string; enabled: boolean; reason: string; requestId?:
 * string }`. `enabled` carries both directions of this one reversible
 * mutation (`false` to disable, `true` to re-enable) — see
 * `router-admin-service.ts`'s header for why this reuses `setRouteEnabled`
 * rather than a separate path per direction. `durable_write` route class,
 * never reachable via GET.
 *
 * PHASE 19 CLOSURE FIX. `requestId` is optional: omitted, a fresh pending
 * two-person request is created and its id returned on
 * `TIER0_AUTHORIZATION_REQUIRED`; supplied, an attempt resumes that SAME
 * pending request (e.g. after a second admin approved it via
 * `POST /api/admin/privileged-actions/decide`) rather than starting a new
 * one. Never trusted for anything but continuity — shape validation and
 * the actual two-person state live entirely server-side in
 * `tier0-authorization.ts`.
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

  const { routeId, enabled, reason, requestId } =
    (body as { routeId?: unknown; enabled?: unknown; reason?: unknown; requestId?: unknown }) ?? {};
  if (typeof routeId !== "string" || typeof enabled !== "boolean") {
    return privateJson({ outcome: "INVALID_TARGET" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const [assurance, elevation] = await Promise.all([
    getCurrentAssuranceEvidence(),
    getCurrentElevationVerdict(access.clerkUserId),
  ]);

  const result = await setAdminRouteEnabled(
    getSupabaseAdminClient(),
    access.clerkUserId as string,
    routeId,
    enabled,
    typeof reason === "string" ? reason.trim() : "",
    { assurance, elevation },
    typeof requestId === "string" && requestId.length > 0 ? requestId : undefined
  );
  return privateJson(result);
}
