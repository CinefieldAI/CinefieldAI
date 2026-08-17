import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminTemporalInspection } from "@/lib/admin/temporal-admin-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/temporal/[generationId] — Phase 16-D Temporal inspection.
 *
 * Read-only. Same admin boundary and opaque-404 convention every other
 * Phase 16 admin route uses. See `temporal-admin-contract.ts`'s header.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ generationId: string }> }
): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "authenticated_read", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const { generationId } = await params;
  const result = await getAdminTemporalInspection(getSupabaseAdminClient(), generationId);
  return privateJson(result);
}
