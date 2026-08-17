import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminDlqInvestigation } from "@/lib/admin/dlq-admin-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/dlq — Phase 16-B Failed Jobs / DLQ inspection.
 *
 * Read-only. Peeks at most one message from the provider DLQ
 * (`VisibilityTimeout: 0`, never claims it) and evaluates it through the
 * unmodified Phase 15-D/1 decision engine — the exact same read
 * `scripts/dlq-investigate.ts` already performs. Same authorization
 * convention as every other Phase 16 admin route: denial returns an opaque
 * 404.
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

  const result = await getAdminDlqInvestigation(getSupabaseAdminClient());
  return privateJson(result);
}
