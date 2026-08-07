import "server-only";
import { runCloudflareAiGateway } from "@/lib/cloudflare/ai-gateway-client";
import { isCloudflareEnabled } from "@/lib/cloudflare/gateway-config";

/**
 * Cinefield text reranking — optional relevance scoring via a verified,
 * genuinely available Cloudflare Workers AI reranking model
 * (@cf/baai/bge-reranker-base).
 *
 * Schema verified against Cloudflare's own documentation before coding:
 * input is `{ query: string, contexts: [{ text: string }], top_k?: number }`,
 * output is a `response[]` array of `{ id, score }` — `id` is the input
 * context's index, `score` a sigmoid-mapped [0,1] relevance value. Results
 * are not guaranteed to preserve input order (top_k truncates and Cloudflare
 * may return them sorted by score), so callers must key off `index`, not
 * array position.
 *
 * Standalone and read-only: never called by the generation pipeline. This
 * function never throws — an unavailable or broken reranker must never
 * break a caller; every failure mode degrades to `available: false`.
 */

const RERANKER_MODEL_ID = "@cf/baai/bge-reranker-base";

export interface RerankedResult {
  index: number;
  score: number;
}

export interface TextRerankingResult {
  available: boolean;
  results: RerankedResult[];
}

export async function rerankTexts(params: {
  query: string;
  contexts: string[];
  topK?: number;
}): Promise<TextRerankingResult> {
  const fallback: TextRerankingResult = { available: false, results: [] };
  if (!isCloudflareEnabled()) return fallback;
  if (params.query.trim().length === 0 || params.contexts.length === 0) return fallback;

  let envelope;
  try {
    envelope = await runCloudflareAiGateway({
      model: RERANKER_MODEL_ID,
      input: {
        query: params.query,
        contexts: params.contexts.map((text) => ({ text })),
        ...(params.topK !== undefined ? { top_k: params.topK } : {}),
      },
    });
  } catch {
    return fallback;
  }

  const rawResult = envelope.result;
  const response =
    typeof rawResult === "object" && rawResult !== null && "response" in rawResult
      ? (rawResult as { response: unknown }).response
      : undefined;

  if (!Array.isArray(response)) return fallback;

  const results: RerankedResult[] = [];
  for (const entry of response) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { id?: unknown }).id !== "number" ||
      typeof (entry as { score?: unknown }).score !== "number"
    ) {
      return fallback;
    }
    results.push({ index: (entry as { id: number }).id, score: (entry as { score: number }).score });
  }

  return { available: true, results };
}
