import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { executeGenerationRequest } from "@/lib/orchestration/generation-execution-service";

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
 * PHASE 6R-B — TEMPORAL IS THE PRODUCTION OWNER
 * This route no longer decides anything about execution. It authenticates,
 * validates the one input, and hands off to the production execution service
 * (src/lib/orchestration/generation-execution-service.ts), which resolves the
 * owner server-side. In production that owner is Temporal's
 * GenerationWorkflow or nothing at all:
 *
 *   started      202  Temporal owns the generation; nothing has finished yet,
 *                     so the caller must observe the row, not this response
 *   completed    200  non-production dev path only
 *   unavailable  503  no owner — fail closed, nothing was dispatched
 *
 * THERE IS NO TRIGGER BRANCH, AND NO FALLBACK. Trigger.dev is operational
 * infrastructure (reconciliation, audit, health, cleanup); it is not a
 * generation owner and cannot be selected here by configuration or by the
 * request. Nothing in this file imports a Trigger task.
 *
 * CLIENT CONTRACT NOTE: the 202 response is deliberately not a result. A
 * caller that treats a non-"completed" status as failure will misread it —
 * the browser hook still keys its polling off the retired `mode: "trigger"`
 * field, which is why enabling Temporal ownership requires that client
 * contract to be generalized first (Phase 5 convergence on /api/generate).
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
  // generationId and nothing else. Any other field in the body is ignored
  // outright — in particular there is no way to name an execution owner,
  // which is the simplest guarantee that a client cannot choose one.
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

  // ---- Hand off to the owner ----------------------------------------------
  try {
    const outcome = await executeGenerationRequest({ generationId, clerkUserId: userId });

    if (outcome.outcome === "unavailable") {
      // Fail closed. The reason is a stable, non-sensitive classification;
      // the user-facing message comes from the typed error, not from here.
      const error = new OrchestrationError("GENERATION_OWNER_UNAVAILABLE");
      return NextResponse.json(
        { ...error.toResponseBody(), reason: outcome.reason },
        { status: error.status }
      );
    }

    if (outcome.outcome === "started") {
      return NextResponse.json(
        {
          generationId: outcome.generationId,
          status: "queued",
          owner: "temporal",
          // Safe to expose: a deterministic id derived from the generation id
          // the caller already holds. Carries no secret and grants nothing.
          workflowId: outcome.workflowId,
        },
        { status: 202 }
      );
    }

    const { result } = outcome;
    return NextResponse.json(
      {
        generationId: result.generationId,
        status: result.status,
        owner: "direct-dev",
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
