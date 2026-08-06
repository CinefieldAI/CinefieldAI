import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { executeGeneration } from "@/lib/orchestration/orchestrator";

/**
 * POST /api/orchestration/execute
 *
 * Body: { "generationId": "<uuid>" }
 *
 * The generation id is the ONLY accepted input. Ownership, model, provider,
 * settings, and output paths are all resolved server-side from the database
 * and the model registry — nothing about identity or routing is taken from
 * the request body.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  // ---- Authentication (server-side Clerk session only) --------------------
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  // ---- Request body validation -------------------------------------------
  let generationId: string;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("generationId" in body)) {
      throw new OrchestrationError("INVALID_INPUT", {
        userMessage: "generationId is required.",
      });
    }
    const candidate = (body as { generationId: unknown }).generationId;
    if (typeof candidate !== "string" || !UUID_PATTERN.test(candidate)) {
      throw new OrchestrationError("INVALID_INPUT", {
        userMessage: "generationId must be a valid UUID.",
      });
    }
    generationId = candidate;
  } catch (caught) {
    const error =
      caught instanceof OrchestrationError
        ? caught
        : new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  // ---- Orchestrate --------------------------------------------------------
  try {
    const result = await executeGeneration({ generationId, clerkUserId: userId });

    return NextResponse.json(
      {
        generationId: result.generationId,
        status: result.status,
        workflow: result.workflow,
        provider: result.provider,
        modelId: result.modelId,
        isMock: result.isMock,
        outputs: result.outputs.map((output) => ({
          mimeType: output.mimeType,
          type: output.type,
          signedUrl: output.signedUrl,
        })),
      },
      { status: 200 }
    );
  } catch (caught) {
    // Never leak internals: only the typed code, safe message, and retryable
    // flag reach the browser. No stack traces, no provider payloads.
    const error = toOrchestrationError(caught);
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }
}
