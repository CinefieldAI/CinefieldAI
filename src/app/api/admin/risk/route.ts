import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminRiskInvestigation } from "@/lib/admin/risk-investigation-service";
import type { RiskLookupIdentifierType } from "@/lib/admin/risk-investigation-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/risk?identifierType=<clerk_user_id|generation_id|trace_id>&identifierValue=<id>
 *
 * Phase 16-A admin Risk investigation read. A search, not a single-resource
 * fetch by id, hence query params rather than a dynamic path segment — the
 * same reason every other 16-A investigation route uses a path param while
 * this one does not: there is no single canonical "risk resource" to name in
 * the URL, only an identifier and which column it is matched against.
 *
 * Same authorization convention as every other Phase 16 admin route: admin
 * denial returns an opaque 404. A malformed/unsupported identifier is NOT
 * treated as "not found" — it is `INVALID_IDENTIFIER`, returned 200, because
 * it is not evidence of anything, just a bad query the operator can correct
 * (mirrors `USER_NOT_FOUND`/`GENERATION_NOT_FOUND` structurally but is
 * deliberately a different state: this surface never claims a single
 * resource "does not exist," only that no bounded evidence was found for a
 * valid identifier). Read-only — the only calls this handler makes are the
 * admin check and `getAdminRiskInvestigation`, itself narrow, bounded,
 * independent SELECTs and nothing else.
 */

const SUPPORTED_TYPES: readonly RiskLookupIdentifierType[] = ["clerk_user_id", "generation_id", "trace_id"];

function isSupportedType(value: string | null): value is RiskLookupIdentifierType {
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
    return privateJson({ outcome: "RISK_SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const result = await getAdminRiskInvestigation(getSupabaseAdminClient(), identifierType, identifierValue);
  return privateJson(result);
}
