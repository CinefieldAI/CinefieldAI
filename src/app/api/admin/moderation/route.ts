import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminAssetInvestigation } from "@/lib/admin/asset-admin-service";
import { getAdminSafetyAudit, getModerationQueue } from "@/lib/admin/moderation-admin-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/moderation?assetId=<uuid>
 *
 * Phase 16-C Moderation read: the same bounded `media_assets` row
 * `/api/admin/assets` reads (via the identical `getAdminAssetInvestigation`,
 * `asset_id` axis — no second read), plus the real, durable
 * `media_safety_audit` trail for that one asset. Asset-id only, not
 * generation-id: the release action below operates on one specific asset.
 *
 * PHASE 28-D: called with NO assetId it returns the REVIEW QUEUE instead —
 * every decision still waiting on a human, newest first. Extended here rather
 * than given a route of its own: it is the same surface, the same admin
 * authority and the same rate-limit class, and the operator who reads the
 * queue is the one who then reads an item.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "authenticated_read", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  const url = new URL(request.url);
  const assetId = url.searchParams.get("assetId") ?? "";

  if (!isSupabaseAdminConfigured()) {
    return privateJson({
      asset: { outcome: "STORAGE_EVIDENCE_UNAVAILABLE", reasonCode: "not_configured" },
      audit: { outcome: "AUDIT_UNAVAILABLE", reasonCode: "not_configured" },
      queue: { outcome: "QUEUE_UNAVAILABLE", reasonCode: "not_configured" },
    });
  }

  const admin = getSupabaseAdminClient();

  // No asset named: the operator is asking WHAT is waiting, not about one
  // known item. Bounded inside the service — a queue read must never become an
  // unpaged table scan.
  if (assetId.length === 0) {
    return privateJson({ queue: await getModerationQueue(admin) });
  }

  const [asset, audit] = await Promise.all([
    getAdminAssetInvestigation(admin, "asset_id", assetId),
    getAdminSafetyAudit(admin, assetId),
  ]);

  return privateJson({ asset, audit });
}
