import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { embedText } from "@/lib/orchestration/text-embeddings";

/**
 * POST /api/orchestration/embed-text
 *
 * Body: { "texts": string[] }
 *
 * Optional, best-effort embedding generation. Vectors are returned to the
 * caller and never persisted — this codebase has no vector column, and one
 * is deliberately not invented here (see text-embeddings.ts).
 */

const MAX_TEXTS = 100;

export async function POST(request: Request): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  let texts: string[];
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    }
    const candidate = (body as { texts?: unknown }).texts;
    if (
      !Array.isArray(candidate) ||
      candidate.length === 0 ||
      !candidate.every((t) => typeof t === "string")
    ) {
      throw new OrchestrationError("INVALID_INPUT", {
        userMessage: "texts must be a non-empty array of strings.",
      });
    }
    if (candidate.length > MAX_TEXTS) {
      throw new OrchestrationError("INVALID_INPUT", {
        userMessage: `texts accepts at most ${MAX_TEXTS} entries per request.`,
      });
    }
    texts = candidate;
  } catch (caught) {
    const error =
      caught instanceof OrchestrationError
        ? caught
        : new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  const result = await embedText(texts);
  return NextResponse.json(result, { status: 200 });
}
