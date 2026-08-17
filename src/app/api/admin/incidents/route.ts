import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminIncidents } from "@/lib/admin/incidents-admin-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/incidents — Phase 16-D Incidents/Audit read.
 *
 * Read-only. Combines the alert router's live (ephemeral) tracked state
 * with the durable policy-decision and media-safety audit trails. See
 * `incidents-admin-contract.ts`'s header.
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

  const result = await getAdminIncidents(getSupabaseAdminClient());
  return privateJson(result);
}
