import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { analyzeImage } from "@/lib/orchestration/vision-analysis";

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
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

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
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  try {
    const result = await analyzeImage({ imageBytes, question });
    return NextResponse.json(result, { status: 200 });
  } catch (caught) {
    const error = toOrchestrationError(caught);
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }
}
