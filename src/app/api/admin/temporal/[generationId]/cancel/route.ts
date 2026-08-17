import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { performAdminTemporalCancel } from "@/lib/admin/temporal-admin-service";
import { getCurrentAssuranceEvidence, getCurrentElevationVerdict } from "@/lib/admin/require-step-up";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * POST /api/admin/temporal/[generationId]/cancel — Phase 16-D admin-initiated
 * cancel.
 *
 * Body: `{ reasonCode: string }`. `durable_write` route class — never
 * reachable via GET. The ONE mutation this whole 16-D package allows (Action
 * Authority, spec section 16); every other 16-D surface is read-only. See
 * `temporal-admin-service.ts`'s `performAdminTemporalCancel` for the full
 * order of operations: fresh re-read, fail closed on a terminal generation,
 * then (and only then) the existing canonical cancel-intent write and
 * Temporal signal.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ generationId: string }> }
): Promise<NextResponse> {
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
    return privateJson({ outcome: "INVALID_INPUT" }, { status: 400 });
  }

  const reasonCode = (body as { reasonCode?: unknown } | null)?.reasonCode;
  if (typeof reasonCode !== "string") {
    return privateJson({ outcome: "INVALID_INPUT" }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ outcome: "SOURCE_UNAVAILABLE", reasonCode: "not_configured" });
  }

  const { generationId } = await params;
  const [assurance, elevation] = await Promise.all([
    getCurrentAssuranceEvidence(),
    getCurrentElevationVerdict(access.clerkUserId),
  ]);
  const result = await performAdminTemporalCancel(getSupabaseAdminClient(), {
    generationId,
    adminActorId: access.clerkUserId as string,
    reasonCode,
    stepUp: { assurance, elevation },
  });
  return privateJson(result);
}
