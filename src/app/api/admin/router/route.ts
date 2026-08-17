import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminRouterView } from "@/lib/admin/router-admin-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/router?modelId=<id> — Phase 16-B Router Controls read.
 *
 * `requireAdminAccess()` gates entry (opaque 404 on denial); the wrapped
 * `listRoutesForAdmin` (Phase 7-B) then applies its OWN separate
 * `ROUTE_ADMIN_CLERK_USER_IDS` gate — a Phase 16 admin who is not also a
 * route admin sees `ROUTE_AUTHORITY_DENIED`, not fabricated route data.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "authenticated_read", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const url = new URL(request.url);
  const modelId = url.searchParams.get("modelId") ?? undefined;

  const result = await getAdminRouterView(getSupabaseAdminClient(), access.clerkUserId as string, modelId);
  return privateJson(result);
}
