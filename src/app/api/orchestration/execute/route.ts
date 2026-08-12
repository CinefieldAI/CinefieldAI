import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError } from "@/lib/orchestration/errors";
import {
  readGenerationId,
  respondToGenerationRequest,
} from "@/lib/orchestration/generation-api-contract";

/**
 * POST /api/orchestration/execute — COMPATIBILITY WRAPPER.
 *
 * Superseded by POST /api/generate (Phase 5 production convergence). Kept
 * because callers use this URL; it now does nothing of its own beyond
 * authenticating and delegating to the same server behaviour, so it cannot
 * drift from the canonical endpoint.
 *
 * Its response is the canonical contract, which means the `mode: "trigger"`
 * field it used to return is GONE. That field was transport leaking into the
 * client: a queued generation was only recognised as queued if the caller
 * matched that exact string, which is why enabling Temporal ownership would
 * previously have surfaced a healthy generation as a failure. Clients branch
 * on `status` now.
 *
 * New callers should use /api/generate.
 */

export async function POST(request: Request): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  let generationId: string;
  try {
    generationId = readGenerationId(await request.json());
  } catch (caught) {
    const error =
      caught instanceof OrchestrationError
        ? caught
        : new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  return respondToGenerationRequest(generationId, userId);
}
