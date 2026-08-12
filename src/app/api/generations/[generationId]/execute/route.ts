import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError } from "@/lib/orchestration/errors";
import {
  GENERATION_ID_PATTERN,
  respondToGenerationRequest,
} from "@/lib/orchestration/generation-api-contract";

/**
 * POST /api/generations/[generationId]/execute — COMPATIBILITY WRAPPER.
 *
 * WHAT THIS USED TO BE, AND WHY IT HAD TO CHANGE
 * Until Phase 5 convergence this route was a complete, independent
 * generation lifecycle owner. It claimed the row itself with its own
 * compare-and-set, called the Gemini API directly, uploaded the result to
 * Storage, and wrote status='completed' inline — never touching
 * generation_attempts, submission evidence, SQS or Temporal. Every Phase 6R
 * audit reported it as the one remaining second owner, and the binding v1.6
 * rule is that Temporal is the ONLY generation lifecycle owner.
 *
 * It could not simply be deleted: this URL is called by frozen /generate UI
 * code. So the fix went the other way round. Gemini was migrated INTO the
 * orchestration core as a registered ProviderAdapter
 * (src/lib/orchestration/providers/gemini-provider.ts) with its three models
 * added to the registry, which is what finally allowed this route to
 * delegate rather than execute. The URL and the caller are untouched; what
 * changed is who owns the work behind it.
 *
 * It now does exactly what /api/generate does. It has no provider client, no
 * claim, no upload, and no way to write a terminal state.
 *
 * RESPONSE SHAPE CHANGED. It returns the canonical contract, so a Temporal-
 * owned generation answers 202 { status: "queued" } instead of a synchronous
 * { status: "completed", signedUrl }. Callers must observe the row — which
 * is what useGeneration now does for every status.
 */

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ generationId: string }> }
): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  const { generationId } = await params;
  if (typeof generationId !== "string" || !GENERATION_ID_PATTERN.test(generationId)) {
    const error = new OrchestrationError("INVALID_INPUT", {
      userMessage: "generationId must be a valid UUID.",
    });
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  return respondToGenerationRequest(generationId, userId);
}
