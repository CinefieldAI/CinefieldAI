import "server-only";
import { NextResponse } from "next/server";
import { OrchestrationError, toOrchestrationError } from "./errors";
import { executeGenerationRequest } from "./generation-execution-service";

/**
 * Cinefield canonical generation API contract (Phase 5 production
 * convergence).
 *
 * ONE response shape for every production generation entry point, so a
 * client never has to know which route it reached or which transport ran
 * underneath.
 *
 * WHAT THIS REPLACES
 * The old contract leaked its transport: a queued generation was signalled
 * by `mode === "trigger"`, and a client that did not recognise that exact
 * string treated a perfectly healthy queued generation as a failure. That
 * coupling is why enabling Temporal ownership would previously have shown
 * an error for a generation that succeeded. `status` is now the only thing
 * a client branches on, and `queued` means queued regardless of who is
 * carrying the work.
 *
 * WHAT NEVER APPEARS IN A RESPONSE
 * Provider credentials, queue URLs, Temporal addresses, raw provider
 * payloads, internal error messages. `owner` and `workflowId` are safe:
 * the owner is an architectural fact and the workflow id is derived from
 * the generation id the caller already holds.
 */

export type GenerationApiStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface GenerationApiOutput {
  mimeType: string;
  type: string;
  signedUrl: string | null;
}

export interface GenerationApiResponse {
  generationId: string;
  status: GenerationApiStatus;
  /** Which plane owns this generation's lifecycle. Always "temporal" in production. */
  owner: "temporal" | "direct-dev";
  /** Deterministic workflow identity, present once Temporal owns it. */
  workflowId?: string;
  /** Present only for a synchronous completion (the non-production dev path). */
  outputs?: GenerationApiOutput[];
  provider?: string;
  modelId?: string;
  isMock?: boolean;
}

/** A UUID, matching the format every generation id in the system uses. */
export const GENERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the one field a generation request may carry.
 *
 * Deliberately narrow. Ownership, model, provider, settings and output paths
 * are all resolved server-side from the durable row and the model registry —
 * nothing about identity or routing is taken from the request body, and
 * there is no field through which a caller could name an execution owner.
 */
export function readGenerationId(body: unknown): string {
  if (typeof body !== "object" || body === null || !("generationId" in body)) {
    throw new OrchestrationError("INVALID_INPUT", { userMessage: "generationId is required." });
  }
  const candidate = (body as { generationId: unknown }).generationId;
  if (typeof candidate !== "string" || !GENERATION_ID_PATTERN.test(candidate)) {
    throw new OrchestrationError("INVALID_INPUT", {
      userMessage: "generationId must be a valid UUID.",
    });
  }
  return candidate;
}

/**
 * Distinguishes the two body shapes /api/generate accepts.
 *
 * A full request is canonical: the server creates the generation. The
 * `{ generationId }` shape is the execute-only form the compatibility
 * wrappers use for a row that already exists, and it stays supported so one
 * endpoint serves both rather than the behaviours diverging across routes.
 */
export function isExecuteOnlyBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "generationId" in body &&
    !("model" in body)
  );
}

/**
 * THE shared server behaviour behind every generation entry point.
 *
 * Every route that starts a generation calls this and returns what it
 * returns. That is what makes convergence real rather than nominal: there is
 * one ownership decision, one Temporal start, one response shape, and adding
 * a route cannot add a lifecycle owner because a route has nothing to own
 * with.
 */
export async function respondToGenerationRequest(
  generationId: string,
  clerkUserId: string
): Promise<NextResponse> {
  try {
    const outcome = await executeGenerationRequest({ generationId, clerkUserId });

    if (outcome.outcome === "unavailable") {
      // Fail closed. No fallback owner is substituted — that is the whole
      // point of the 6R-B cutover, and a route is not allowed to soften it.
      const error = new OrchestrationError("GENERATION_OWNER_UNAVAILABLE");
      return NextResponse.json(
        { ...error.toResponseBody(), reason: outcome.reason },
        { status: error.status }
      );
    }

    if (outcome.outcome === "started") {
      const body: GenerationApiResponse = {
        generationId: outcome.generationId,
        status: "queued",
        owner: "temporal",
        workflowId: outcome.workflowId,
      };
      // 202: accepted, not finished. The caller observes the row from here.
      return NextResponse.json(body, { status: 202 });
    }

    const { result } = outcome;
    const body: GenerationApiResponse = {
      generationId: result.generationId,
      status: result.status as GenerationApiStatus,
      owner: "direct-dev",
      provider: result.provider,
      modelId: result.modelId,
      isMock: result.isMock,
      outputs: result.outputs.map((output) => ({
        mimeType: output.mimeType,
        type: output.type,
        signedUrl: output.signedUrl,
      })),
    };
    return NextResponse.json(body, { status: 200 });
  } catch (caught) {
    // Only the typed code, safe message and retryable flag reach the browser.
    const error = toOrchestrationError(caught);
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }
}
