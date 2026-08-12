import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError } from "@/lib/orchestration/errors";
import {
  readGenerationId,
  respondToGenerationRequest,
} from "@/lib/orchestration/generation-api-contract";

/**
 * POST /api/generate — THE canonical production generation entry point
 * (Phase 5 production convergence).
 *
 * Body: { "generationId": "<uuid>" }
 *
 * Every production generation surface converges here or on a compatibility
 * wrapper that delegates to the same server behaviour:
 *
 *   POST /api/generate                              canonical
 *   POST /api/orchestration/execute                 wrapper, kept for callers
 *   POST /api/generations/[generationId]/execute    wrapper, kept for the
 *                                                   frozen /generate UI
 *
 * All three call respondToGenerationRequest(), so there is exactly one
 * ownership decision and one response contract. A route cannot become a
 * lifecycle owner because a route has nothing to own with.
 *
 * WHAT THIS ROUTE DOES NOT DO
 * It does not call a provider, does not touch Trigger.dev, does not compute
 * a price and does not reserve credits. Pricing and the credit lifecycle are
 * Phase 10 and are deliberately not wired here — see the report's Phase 10
 * dependency note rather than assuming silence means they are handled.
 *
 * WHY THE BODY IS ONLY AN ID
 * The durable generation row is created by the authenticated browser client
 * under RLS, which is the architecture that predates this phase; this
 * endpoint takes ownership of the row's EXECUTION. Accepting a full
 * generation request and creating the row server-side is the remaining
 * increment of Phase 5 and is called out in the report — it is not implied
 * by this route existing.
 */

export async function POST(request: Request): Promise<NextResponse> {
  // ---- Authentication (server-side Clerk session only) --------------------
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

  // Ownership of the row is verified server-side inside the execution
  // service's activities against the durable row — this route never widens
  // what the caller may touch.
  return respondToGenerationRequest(generationId, userId);
}
