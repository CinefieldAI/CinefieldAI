import "server-only";
import { runCloudflareAiGateway } from "@/lib/cloudflare/ai-gateway-client";
import { isCloudflareEnabled } from "@/lib/cloudflare/gateway-config";

/**
 * Cinefield text embeddings — optional vector generation via a verified
 * Cloudflare Workers AI embedding model (@cf/baai/bge-base-en-v1.5).
 *
 * Schema verified against Cloudflare's own documentation before coding:
 * input is `{ text: string | string[] }`, output is `data[]` (one 768-
 * dimension vector per input string, same order) plus a `shape[]` array.
 *
 * Deliberately generation-only, with no persistence layer: this codebase's
 * one migration (supabase/migrations/20260805132704_remote_schema.sql)
 * defines only the three existing tables and has no vector/pgvector
 * column anywhere. Inventing one here would be exactly the kind of
 * unrequested schema change the architecture rules forbid — a caller that
 * wants to store these vectors needs a real migration added as its own,
 * separate, deliberate change.
 *
 * Standalone and read-only: never called by the generation pipeline. This
 * function never throws — an unavailable or broken embeddings model must
 * never break a caller; every failure mode degrades to `available: false`.
 */

const EMBEDDING_MODEL_ID = "@cf/baai/bge-base-en-v1.5";
const EMBEDDING_DIMENSIONS = 768;

export interface TextEmbeddingsResult {
  available: boolean;
  vectors: number[][];
  dimensions: number | null;
}

export async function embedText(texts: string[]): Promise<TextEmbeddingsResult> {
  const fallback: TextEmbeddingsResult = { available: false, vectors: [], dimensions: null };
  if (!isCloudflareEnabled()) return fallback;

  const nonEmpty = texts.map((t) => t.trim()).filter((t) => t.length > 0);
  if (nonEmpty.length === 0) return fallback;

  let envelope;
  try {
    envelope = await runCloudflareAiGateway({
      model: EMBEDDING_MODEL_ID,
      input: { text: nonEmpty },
    });
  } catch {
    return fallback;
  }

  const rawResult = envelope.result;
  const data =
    typeof rawResult === "object" && rawResult !== null && "data" in rawResult
      ? (rawResult as { data: unknown }).data
      : undefined;

  if (!Array.isArray(data) || data.length === 0) return fallback;
  const vectors: number[][] = [];
  for (const entry of data) {
    if (!Array.isArray(entry) || !entry.every((n) => typeof n === "number")) return fallback;
    vectors.push(entry);
  }

  return { available: true, vectors, dimensions: vectors[0]?.length ?? EMBEDDING_DIMENSIONS };
}
