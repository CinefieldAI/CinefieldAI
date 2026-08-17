import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminBillingView } from "@/lib/admin/billing-admin-service";
import type { BillingLookupIdentifierType } from "@/lib/admin/billing-admin-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/billing?identifierType=<clerk_user_id|generation_id>&identifierValue=<id>
 *
 * Phase 16-C Billing / Credits read. Read-only — see
 * `billing-admin-service.ts` for why no RPC is ever called here. Same
 * query-param search shape `/api/admin/risk` already established (a
 * search, not a single-resource fetch by id).
 */

const SUPPORTED_TYPES: readonly BillingLookupIdentifierType[] = ["clerk_user_id", "generation_id"];

function isSupportedType(value: string | null): value is BillingLookupIdentifierType {
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
    return privateJson({ outcome: "LEDGER_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const result = await getAdminBillingView(getSupabaseAdminClient(), identifierType, identifierValue);
  return privateJson(result);
}
