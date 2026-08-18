import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { performModerationAction } from "@/lib/admin/moderation-admin-service";
import type { ModerationActionKind } from "@/lib/admin/moderation-admin-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { guardPrivilegedMutation } from "@/lib/security/privileged-mutation-guard";

/**
 * POST /api/admin/moderation/release — Phase 16-C quarantine release action.
 *
 * Body: `{ action: "request" | "approve" | "reject"; assetId: string;
 * reasonCode?: string }`. Wraps `requestMediaRelease`/`approveMediaRelease`/
 * `rejectMediaAsset` (Phase 9-E) UNMODIFIED — see
 * `moderation-admin-service.ts`'s header for why no new authority, policy
 * gate, or two-person mechanism is added here. `durable_write` route
 * class, never reachable via GET.
 */

const VALID_ACTIONS: readonly ModerationActionKind[] = ["request", "approve", "reject"];

function isValidAction(value: unknown): value is ModerationActionKind {
  return typeof value === "string" && (VALID_ACTIONS as readonly string[]).includes(value);
}

export async function POST(request: Request): Promise<NextResponse> {
  const csrfRefusal = guardPrivilegedMutation(request);
  if (csrfRefusal) return csrfRefusal;

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

  const { action, assetId, reasonCode } = (body as { action?: unknown; assetId?: unknown; reasonCode?: unknown }) ?? {};
  if (!isValidAction(action) || typeof assetId !== "string") {
    return privateJson({ outcome: "INVALID_TARGET" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "ACTION_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const result = await performModerationAction(
    getSupabaseAdminClient(),
    access.clerkUserId as string,
    action,
    assetId,
    typeof reasonCode === "string" ? reasonCode : undefined
  );
  return privateJson(result);
}
