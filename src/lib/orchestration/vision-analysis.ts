import "server-only";
import { runCloudflareAiGateway } from "@/lib/cloudflare/ai-gateway-client";
import { isCloudflareEnabled } from "@/lib/cloudflare/gateway-config";

/**
 * Cinefield vision analysis — optional image understanding via a verified
 * Cloudflare Workers AI vision-language model (@cf/meta/llama-3.2-11b-vision-instruct).
 *
 * Cloudflare's own docs page does not render its collapsed raw-schema
 * accordion through static fetching, so the `image` field's exact wire type
 * could not be confirmed from documentation alone. It was confirmed instead
 * against the live API itself (the same verification standard used
 * throughout this codebase — real behavior over assumed docs): a real
 * request with `image` as a plain array of byte values succeeded, so that
 * is the format used here — never guessed and shipped unverified.
 *
 * Standalone and read-only: never called by the generation pipeline, never
 * persists anything. This function never throws — an unavailable or broken
 * vision model must never break a caller; every failure mode degrades to
 * `available: false`.
 */

const VISION_MODEL_ID = "@cf/meta/llama-3.2-11b-vision-instruct";

export interface VisionAnalysisResult {
  available: boolean;
  description: string | null;
}

export async function analyzeImage(params: {
  imageBytes: Uint8Array;
  question?: string;
}): Promise<VisionAnalysisResult> {
  const fallback: VisionAnalysisResult = { available: false, description: null };
  if (!isCloudflareEnabled()) return fallback;
  if (params.imageBytes.byteLength === 0) return fallback;

  let envelope;
  try {
    envelope = await runCloudflareAiGateway({
      model: VISION_MODEL_ID,
      input: {
        image: Array.from(params.imageBytes),
        prompt: params.question?.trim() || "Describe this image in detail.",
        max_tokens: 512,
      },
    });
  } catch {
    return fallback;
  }

  const rawResult = envelope.result;
  const description =
    typeof rawResult === "object" &&
    rawResult !== null &&
    "response" in rawResult &&
    typeof (rawResult as { response: unknown }).response === "string"
      ? (rawResult as { response: string }).response
      : null;

  return { available: description !== null, description };
}
