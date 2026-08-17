import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminQueueHealth } from "@/lib/admin/queue-health-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/queue-health — Phase 16-B SQS command health + BullMQ
 * auxiliary health, combined.
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

  const result = await getAdminQueueHealth(getSupabaseAdminClient());
  return privateJson(result);
}
