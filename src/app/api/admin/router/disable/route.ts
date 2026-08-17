import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { setAdminRouteEnabled } from "@/lib/admin/router-admin-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * POST /api/admin/router/disable — Phase 16-B route enable/disable.
 *
 * Body: `{ routeId: string; enabled: boolean; reason: string }`. `enabled`
 * carries both directions of this one reversible mutation (`false` to
 * disable, `true` to re-enable) — see `router-admin-service.ts`'s header
 * for why this reuses `setRouteEnabled` rather than a separate path per
 * direction. `durable_write` route class, never reachable via GET.
 */
export async function POST(request: Request): Promise<NextResponse> {
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

  const { routeId, enabled, reason } = (body as { routeId?: unknown; enabled?: unknown; reason?: unknown }) ?? {};
  if (typeof routeId !== "string" || typeof enabled !== "boolean") {
    return privateJson({ outcome: "INVALID_TARGET" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const result = await setAdminRouteEnabled(
    getSupabaseAdminClient(),
    access.clerkUserId as string,
    routeId,
    enabled,
    typeof reason === "string" ? reason.trim() : ""
  );
  return privateJson(result);
}
