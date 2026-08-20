import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getProvenanceAdminView } from "@/lib/admin/provenance-admin-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/provenance — Phase 27-D read-only marking-coverage view.
 *
 * Never returns a signature, an object key, a bucket, or a prompt — see
 * `provenance-admin-contract.ts`. Read-only by construction: there is no
 * POST here, because recording provenance belongs to the media ingest path
 * (Phase 9-B seam), not to an admin clicking a button.
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

  const result = await getProvenanceAdminView(getSupabaseAdminClient());
  return privateJson(result);
}
