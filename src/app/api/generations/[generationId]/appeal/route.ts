import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { GENERATION_ID_PATTERN } from "@/lib/orchestration/generation-api-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { requestMediaAppeal } from "@/lib/media/quarantine-release";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * POST /api/generations/[generationId]/appeal — the human-review path (28-D).
 *
 * ---------------------------------------------------------------------------
 * WHAT AN APPEAL IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * 28-D's done-criterion is deliberately modest: "False-positive case insan
 * incelemesine gidebiliyor" — a false positive can REACH human review. Not
 * "is released", not "is re-classified", not "is re-run".
 *
 * So this records a request and returns. It changes no quarantine status, no
 * moderation status, and has no path to `released`; Phase 9-E's two-person
 * lane remains the only way anything leaves quarantine by hand. Everything
 * that could release is in SQL, and none of it is reachable from here.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER IS THE SECURITY PROPERTY, AS IN THE ASSET-URL ROUTE
 * ---------------------------------------------------------------------------
 *   1. authenticate
 *   2. rate limit BEFORE any read — an appeal is a durable write
 *   3. resolve the asset from the DURABLE ROW by (generation, output index)
 *   4. ownership re-verified in SQL, inside `request_media_appeal`
 *
 * A non-owner gets `not_found` rather than `forbidden`, matching the asset-url
 * and cancel routes: whether a generation id exists is itself information.
 *
 * ---------------------------------------------------------------------------
 * THE RESPONSE TELLS THE APPELLANT NOTHING ABOUT THE DECISION
 * ---------------------------------------------------------------------------
 * No category, no reason code, no classifier name, no score. REFERANS M.1's
 * rule about not teaching the bypass applies here more than anywhere: an
 * appeal endpoint that returned "blocked for: real_person" would be a free
 * oracle for probing the policy one request at a time.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ generationId: string }> }
): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  // `durable_write`: this appends an audit row. Reusing the existing class
  // rather than inventing one — a new class would change the pinned
  // open/closed membership Phase 12's rate-limit test asserts by design.
  const limited = await guardRoute({ routeClass: "durable_write", userId });
  if (limited) return limited;

  const { generationId } = await params;
  if (typeof generationId !== "string" || !GENERATION_ID_PATTERN.test(generationId)) {
    const error = new OrchestrationError("INVALID_INPUT", {
      userMessage: "generationId must be a valid UUID.",
    });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  if (!isSupabaseAdminConfigured()) {
    return privateJson({ recorded: false, reason: "not_configured" }, { status: 503 });
  }

  // Which output. Bounded and integer-only, exactly as the asset-url route
  // does — an out-of-range index resolves to no asset and is refused, never
  // coerced to 0.
  const rawIndex = new URL(request.url).searchParams.get("index");
  let outputIndex = 0;
  if (rawIndex !== null) {
    const parsed = Number(rawIndex);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 99) {
      return privateJson({ recorded: false, reason: "invalid_output_index" }, { status: 400 });
    }
    outputIndex = parsed;
  }

  const admin = getSupabaseAdminClient();

  const { data } = await admin
    .from("media_assets")
    .select("id")
    .eq("generation_id", generationId)
    .eq("output_index", outputIndex)
    .eq("role", "original")
    .maybeSingle();

  const assetId = (data as { id?: string } | null)?.id;
  if (!assetId) return privateJson({ error: "not_found" }, { status: 404 });

  // Ownership is checked inside the SQL against the durable row, not here and
  // not from the request. A non-owner is answered `not_found` by the function
  // itself, so this route cannot leak existence by branching differently.
  //
  // The reason code is FIXED, never accepted from the body. A caller-supplied
  // code would let an appellant write arbitrary short strings into the safety
  // audit trail, which is evidence rather than a message box.
  const result = await requestMediaAppeal(admin, {
    assetId,
    ownerClerkUserId: userId,
    reasonCode: "owner_disputes_decision",
  });

  return privateJson(result);
}
