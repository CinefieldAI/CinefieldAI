import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminSecurityCenter } from "@/lib/admin/security-center-service";
import { isSecuritySeverity } from "@/lib/admin/security-center-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/security-center?severity=<info|low|medium|high> — Phase
 * 16-D Security Center read. Read-only: most-recent `security_events` rows
 * plus the alert router's currently-open `source: "security"` alerts.
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
  const severityParam = url.searchParams.get("severity");
  const severity = isSecuritySeverity(severityParam) ? severityParam : undefined;

  const result = await getAdminSecurityCenter(getSupabaseAdminClient(), severity);
  return privateJson(result);
}
