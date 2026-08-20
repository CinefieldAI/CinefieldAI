import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { GENERATION_ID_PATTERN } from "@/lib/orchestration/generation-api-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { mintCanonicalAssetUrl } from "@/lib/orchestration/output-storage";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/generations/[generationId]/asset-url — the delivery seam (Phase 27).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ROUTE EXISTS
 * ---------------------------------------------------------------------------
 * The generated artifact used to be stored twice: the C2PA-signed canonical
 * object in R2, and a copy in the Supabase Storage `generation-outputs`
 * bucket that the browser signed for itself. Two physical copies meant two
 * storage truths and, before the signing fix, a marked archive alongside an
 * unmarked download. There is now ONE artifact, and the browser cannot reach
 * R2 directly — so it asks here.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER IS THE SECURITY PROPERTY
 * ---------------------------------------------------------------------------
 *   1. authenticate
 *   2. rate limit BEFORE any read
 *   3. resolve the owner from the DURABLE ROW, never from the request
 *   4. Phase 9-E quarantine gate, answered by the database immediately
 *      before minting
 *   5. only then mint a short-lived presigned R2 URL
 *
 * A non-owner gets `not_found` rather than `forbidden`: whether a generation
 * id exists is itself information, and the cancel route already sets that
 * precedent. Nothing here mints a URL for media that has not left quarantine,
 * because `mintCanonicalAssetUrl` re-asks that question itself rather than
 * trusting this route to have checked.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ generationId: string }> }
): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  const limited = await guardRoute({ routeClass: "authenticated_read", userId });
  if (limited) return limited;

  const { generationId } = await params;
  if (typeof generationId !== "string" || !GENERATION_ID_PATTERN.test(generationId)) {
    const error = new OrchestrationError("INVALID_INPUT", {
      userMessage: "generationId must be a valid UUID.",
    });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ signedUrl: null, reasonCode: "not_configured" }, { status: 503 });
  }

  const admin = getSupabaseAdminClient();

  // Ownership from the durable row. A browser claim is never trusted.
  const { data: row } = await admin
    .from("generations")
    .select("clerk_user_id")
    .eq("id", generationId)
    .maybeSingle();

  if (!row || (row as { clerk_user_id?: string }).clerk_user_id !== userId) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const result = await mintCanonicalAssetUrl(admin, generationId);
  return privateJson(result);
}
