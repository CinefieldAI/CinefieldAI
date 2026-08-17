import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminAssetInvestigation } from "@/lib/admin/asset-admin-service";
import type { AssetLookupIdentifierType } from "@/lib/admin/asset-admin-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/assets?identifierType=<asset_id|generation_id>&identifierValue=<id>
 *
 * Phase 16-C Assets / Storage read. Read-only.
 */

const SUPPORTED_TYPES: readonly AssetLookupIdentifierType[] = ["asset_id", "generation_id"];

function isSupportedType(value: string | null): value is AssetLookupIdentifierType {
  return value !== null && (SUPPORTED_TYPES as readonly string[]).includes(value);
}

export async function GET(request: Request): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "authenticated_read", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  const url = new URL(request.url);
  const identifierType = url.searchParams.get("identifierType");
  const identifierValue = url.searchParams.get("identifierValue") ?? "";

  if (!isSupportedType(identifierType)) {
    return privateJson({ outcome: "INVALID_IDENTIFIER" });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "STORAGE_EVIDENCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const result = await getAdminAssetInvestigation(getSupabaseAdminClient(), identifierType, identifierValue);
  return privateJson(result);
}
