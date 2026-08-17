import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminSloCost } from "@/lib/admin/slo-cost-admin-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/slo-cost — Phase 16-D SLO/Cost Guard read.
 *
 * Read-only. Feeds real observations into Phase 15-A's unchanged
 * `evaluateSlo()` and calls Phase 15-B's own production entry point
 * (`runEstimatedSpendGuard()`) verbatim. See `slo-cost-admin-contract.ts`.
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

  const result = await getAdminSloCost(getSupabaseAdminClient());
  return privateJson(result);
}
