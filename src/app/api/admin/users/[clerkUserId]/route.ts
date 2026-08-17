import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminUserInvestigation } from "@/lib/admin/user-investigation-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/users/[clerkUserId] — Phase 16-A/3 admin user investigation
 * read.
 *
 * Same authorization convention as `/api/admin/health` (Phase 16/1) and
 * `/api/admin/generations/[generationId]` (Phase 16-A/2): admin denial and
 * "not found" return the identical opaque 404, so a prober learns nothing
 * either way. Read-only — the only calls this handler makes are the admin
 * check and `getAdminUserInvestigation`, itself two bounded, independent
 * SELECTs and nothing else.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clerkUserId: string }> }
): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "authenticated_read", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  const { clerkUserId } = await params;

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "EVIDENCE_UNAVAILABLE", reasonCode: "not_configured" }, { status: 200 });
  }

  const result = await getAdminUserInvestigation(getSupabaseAdminClient(), clerkUserId);

  if (result.outcome === "USER_NOT_FOUND") {
    return privateJson(result, { status: 404 });
  }

  return privateJson(result);
}
