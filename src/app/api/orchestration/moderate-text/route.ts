import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { moderateText } from "@/lib/orchestration/content-moderation";

/**
 * POST /api/orchestration/moderate-text
 *
 * Body: { "text": string }
 *
 * Optional, best-effort text safety classification. Never called
 * automatically by the generation pipeline. Any internal problem
 * (Cloudflare disabled, provider error, unparseable output) resolves to a
 * 200 response with available: false and flagged: null — never silently
 * treated as "safe", and never a 5xx for that case.
 */

export async function POST(request: Request): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  let text: string;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    }
    const candidate = body as { text?: unknown };
    if (typeof candidate.text !== "string" || candidate.text.trim().length === 0) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "text is required." });
    }
    text = candidate.text;
  } catch (caught) {
    const error =
      caught instanceof OrchestrationError
        ? caught
        : new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  const result = await moderateText(text);
  return NextResponse.json(result, { status: 200 });
}
