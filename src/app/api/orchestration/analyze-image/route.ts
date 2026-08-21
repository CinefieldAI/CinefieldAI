import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { analyzeImage } from "@/lib/orchestration/vision-analysis";

import { guardBrowserMutation } from "@/lib/security/privileged-mutation-guard";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
/**
 * POST /api/orchestration/analyze-image
 *
 * Body: { "imageBase64": string, "question"?: string }
 *
 * Optional, best-effort image analysis. Never called automatically by the
 * generation pipeline. Any internal problem (Cloudflare disabled, provider
 * error, invalid image) resolves to a 200 response with available: false —
 * this endpoint never returns a 5xx for that case, matching
 * enhance-prompt's contract.
 */

export async function POST(request: Request): Promise<NextResponse> {
  // SECURITY_FINDINGS_9751bd11, finding 3. Same-origin check BEFORE any
  // side effect: this route mutates durable state or spends compute under an
  // ambient Clerk session, so a cross-site request must be refused before it
  // reaches auth, not after. Additive — auth and the rate-limit class below
  // are unchanged.
  const crossOrigin = guardBrowserMutation(request);
  if (crossOrigin) return crossOrigin;

  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  // Phase 12-A (application half). BEFORE any side effect: the handler
  // has not begun, so a refusal cannot have called a provider or written
  // anything durable.
  const limited = await guardRoute({ routeClass: "paid_compute", userId });
  if (limited) return limited;

  let imageBytes: Uint8Array;
  let question: string | undefined;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    }
    const candidate = body as { imageBase64?: unknown; question?: unknown };
    if (typeof candidate.imageBase64 !== "string" || candidate.imageBase64.trim().length === 0) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "imageBase64 is required." });
    }
    try {
      imageBytes = new Uint8Array(Buffer.from(candidate.imageBase64, "base64"));
    } catch {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "imageBase64 is not valid base64." });
    }
    question = typeof candidate.question === "string" ? candidate.question : undefined;
  } catch (caught) {
    const error =
      caught instanceof OrchestrationError
        ? caught
        : new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  try {
    const result = await analyzeImage({ imageBytes, question });
    return privateJson(result, { status: 200 });
  } catch (caught) {
    const error = toOrchestrationError(caught);
    return privateJson(error.toResponseBody(), { status: error.status });
  }
}
