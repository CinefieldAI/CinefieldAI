import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createPrivacyRequest, listPrivacyRequestsForUser } from "@/lib/privacy/privacy-request-store";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { guardPrivilegedMutation } from "@/lib/security/privileged-mutation-guard";

/**
 * POST/GET /api/privacy/requests — Phase 23-B, self-service.
 *
 * Creating or listing a request is UNPRIVILEGED — a user acting on
 * themselves, own `clerk_user_id` only, never a body-supplied one (the
 * classic "wrong authorization turns a DSAR endpoint into a give-all-data
 * API" mistake the roadmap itself names — closed structurally here by never
 * reading a target user from the request at all). Actually FULFILLING the
 * request (export/deletion) is a completely separate, privileged path —
 * see /api/admin/privacy/execute/route.ts — gated by data.export/
 * data.delete's policy + Tier-0 dual control.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const csrfRefusal = guardPrivilegedMutation(request);
  if (csrfRefusal) return csrfRefusal;

  const { userId } = await auth();
  if (!userId) return privateJson({ error: "auth_required" }, { status: 401 });

  const limited = await guardRoute({ routeClass: "durable_write", userId });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: "invalid_body" }, { status: 400 });
  }
  const requestType = (body as { requestType?: unknown })?.requestType;
  if (requestType !== "export" && requestType !== "deletion") {
    return privateJson({ error: "invalid_request_type" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const outcome = await createPrivacyRequest(getSupabaseAdminClient(), userId, requestType);
  return privateJson(outcome, { status: outcome.outcome === "created" ? 201 : 500 });
}

export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "auth_required" }, { status: 401 });

  const limited = await guardRoute({ routeClass: "authenticated_read", userId });
  if (limited) return limited;

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const requests = await listPrivacyRequestsForUser(getSupabaseAdminClient(), userId);
  return privateJson({ outcome: "FOUND", requests });
}
