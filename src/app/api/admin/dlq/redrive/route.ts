import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { executeAdminDlqRedrive } from "@/lib/admin/dlq-admin-service";
import { isValidDlqRedriveReason } from "@/lib/admin/dlq-admin-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * POST /api/admin/dlq/redrive — Phase 16-B real DLQ redrive execution.
 *
 * ---------------------------------------------------------------------------
 * OPERATOR-INITIATED ONLY. NO SCHEDULER. NO BULK REDRIVE.
 * ---------------------------------------------------------------------------
 * Exactly one message per call, and the safety decision is recomputed here,
 * server-side, against the message this call itself receives — a client
 * cannot pass a previously-fetched decision to authorize execution. Body:
 * `{ reason: string }` (1–500 chars) — required, never defaulted. A
 * non-GET mutation, per this repository's convention that a mutation is
 * never reachable through a query-string GET.
 *
 * Same authorization convention as every other Phase 16 admin route
 * (opaque 404 on denial), plus the `durable_write` route class (closed on
 * rate-limiter unavailability, unlike the `authenticated_read` class every
 * read-only 16-A/16-B route uses) — appropriate for a route that mutates
 * durable AWS/queue state.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "durable_write", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: "invalid_body" }, { status: 400 });
  }

  const reason = (body as { reason?: unknown } | null)?.reason;
  if (!isValidDlqRedriveReason(reason)) {
    return privateJson({ error: "invalid_reason" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const result = await executeAdminDlqRedrive(getSupabaseAdminClient(), access.clerkUserId as string, reason.trim());
  return privateJson(result);
}
