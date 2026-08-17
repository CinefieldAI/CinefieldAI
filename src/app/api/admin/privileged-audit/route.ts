import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { queryPrivilegedActionAudit } from "@/lib/admin/privileged-action-audit";
import { isPrivilegedActionEvent } from "@/lib/admin/privileged-audit-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/privileged-audit — Phase 16-E durable Tier-0 audit read
 * (Section 14).
 *
 * Read-only, same `requireAdminAccess()` boundary every Phase 16 route uses.
 * Bounded query params only: `actor`, `actionType`, `targetId`, `event`,
 * `since`, `until` — see `privileged-action-audit.ts`'s
 * `queryPrivilegedActionAudit` for the bounded row ceiling. No free-text
 * search parameter exists; there is nothing here a client can turn into an
 * unbounded scan.
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
  const eventParam = url.searchParams.get("event");

  const result = await queryPrivilegedActionAudit(getSupabaseAdminClient(), {
    actorClerkUserId: url.searchParams.get("actor")?.slice(0, 255) || undefined,
    actionType: url.searchParams.get("actionType")?.slice(0, 80) || undefined,
    targetId: url.searchParams.get("targetId")?.slice(0, 200) || undefined,
    event: isPrivilegedActionEvent(eventParam) ? eventParam : undefined,
    sinceIso: url.searchParams.get("since") || undefined,
    untilIso: url.searchParams.get("until") || undefined,
  });

  return privateJson(result);
}
