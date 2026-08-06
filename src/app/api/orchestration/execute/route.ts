import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { resolveExecutionMode } from "@/lib/orchestration/execution-mode";
import { executeGeneration } from "@/lib/orchestration/orchestrator";
import { generationTask } from "@/trigger/generation-task";

/**
 * POST /api/orchestration/execute
 *
 * Body: { "generationId": "<uuid>" }
 *
 * The generation id is the ONLY accepted input. Ownership, model, provider,
 * settings, and output paths are all resolved server-side from the database
 * and the model registry — nothing about identity or routing is taken from
 * the request body.
 *
 * Execution mode ("direct" vs "trigger") is resolved server-side via
 * resolveExecutionMode() and defaults to "direct" — the exact synchronous
 * path already proven by the mock and fal.ai end-to-end tests — unless
 * GENERATION_EXECUTION_MODE=trigger is set AND TRIGGER_SECRET_KEY is
 * present. In "trigger" mode this route only dispatches the job; the browser
 * response reflects "queued", not a finished result, since the generic
 * generationTask (src/trigger/generation-task.ts) calls the exact same
 * executeGeneration() in the background.
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

  // ---- Trigger mode: dispatch and return immediately -----------------------
  if (resolveExecutionMode() === "trigger") {
    try {
      // idempotencyKey scopes duplicate-dispatch protection to this
      // generation id: a second POST for the same id within the TTL returns
      // the existing run instead of starting a second one. This is in
      // addition to, not instead of, claimGeneration()'s own compare-and-set
      // inside executeGeneration once the task actually runs.
      const handle = await generationTask.trigger(
        { generationId, clerkUserId: userId },
        { idempotencyKey: generationId, idempotencyKeyTTL: "1h" }
      );

      return NextResponse.json(
        { generationId, status: "queued", mode: "trigger", triggerRunId: handle.id },
        { status: 202 }
      );
    } catch (caught) {
      const error =
        caught instanceof OrchestrationError
          ? caught
          : new OrchestrationError("TRIGGER_DISPATCH_FAILED");
      return NextResponse.json(error.toResponseBody(), { status: error.status });
    }
  }

  // ---- Direct mode: synchronous execution (unchanged from prior phases) ---
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
