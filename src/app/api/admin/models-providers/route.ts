import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminModelProviderView } from "@/lib/admin/model-provider-admin-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/models-providers — Phase 16-B Models / Providers read.
 *
 * Read-only. Same authorization convention as every other Phase 16 admin
 * route (opaque 404 on denial).
 */
export async function GET(): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "authenticated_read", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const result = await getAdminModelProviderView(getSupabaseAdminClient());
  return privateJson(result);
}
