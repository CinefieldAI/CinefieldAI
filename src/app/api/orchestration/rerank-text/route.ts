import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { rerankTexts } from "@/lib/orchestration/text-reranking";

import { guardRoute, privateJson } from "@/lib/security/response-headers";
/**
 * POST /api/orchestration/rerank-text
 *
 * Body: { "query": string, "contexts": string[], "topK"?: number }
 *
 * Optional, best-effort relevance reranking. Results carry the original
 * context `index` because the provider may return them reordered by score.
 */

const MAX_CONTEXTS = 100;

export async function POST(request: Request): Promise<NextResponse> {
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

  let query: string;
  let contexts: string[];
  let topK: number | undefined;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    }
    const candidate = body as { query?: unknown; contexts?: unknown; topK?: unknown };

    if (typeof candidate.query !== "string" || candidate.query.trim().length === 0) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "query is required." });
    }
    if (
      !Array.isArray(candidate.contexts) ||
      candidate.contexts.length === 0 ||
      !candidate.contexts.every((c) => typeof c === "string")
    ) {
      throw new OrchestrationError("INVALID_INPUT", {
        userMessage: "contexts must be a non-empty array of strings.",
      });
    }
    if (candidate.contexts.length > MAX_CONTEXTS) {
      throw new OrchestrationError("INVALID_INPUT", {
        userMessage: `contexts accepts at most ${MAX_CONTEXTS} entries per request.`,
      });
    }
    if (candidate.topK !== undefined) {
      if (!Number.isInteger(candidate.topK) || (candidate.topK as number) < 1) {
        throw new OrchestrationError("INVALID_INPUT", {
          userMessage: "topK must be a positive integer.",
        });
      }
      topK = candidate.topK as number;
    }

    query = candidate.query;
    contexts = candidate.contexts;
  } catch (caught) {
    const error =
      caught instanceof OrchestrationError
        ? caught
        : new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  const result = await rerankTexts({ query, contexts, topK });
  return privateJson(result, { status: 200 });
}
