import "server-only";
import { runCloudflareAiGateway } from "@/lib/cloudflare/ai-gateway-client";
import { isCloudflareEnabled } from "@/lib/cloudflare/gateway-config";

/**
 * Cinefield content moderation — optional text safety classification via a
 * verified Cloudflare Workers AI safety model (@cf/meta/llama-guard-3-8b).
 *
 * Input schema (messages chat array, `response` output field) matches the
 * same Llama chat pattern already confirmed twice elsewhere in this
 * codebase (prompt-intelligence.ts, vision-analysis.ts). The output
 * *content* format — "safe" or "unsafe" followed by violated category
 * codes on a second line — is Meta's own publicly documented Llama Guard
 * convention, confirmed against a real request during testing.
 *
 * Standalone and read-only: never called by the generation pipeline, never
 * persists anything, never blocks a request on its own. This function
 * never throws — an unavailable or broken moderation model must never
 * break a caller; every failure mode degrades to `available: false` with
 * no verdict (never silently treated as "safe").
 */

const MODERATION_MODEL_ID = "@cf/meta/llama-guard-3-8b";

export interface ModerationResult {
  available: boolean;
  /** null when unavailable — never defaulted to a verdict that wasn't actually produced. */
  flagged: boolean | null;
  categories: string[];
  rawVerdict: string | null;
}

export async function moderateText(text: string): Promise<ModerationResult> {
  const fallback: ModerationResult = {
    available: false,
    flagged: null,
    categories: [],
    rawVerdict: null,
  };
  if (!isCloudflareEnabled()) return fallback;
  if (text.trim().length === 0) return fallback;

  let envelope;
  try {
    envelope = await runCloudflareAiGateway({
      model: MODERATION_MODEL_ID,
      input: {
        messages: [{ role: "user", content: text }],
      },
    });
  } catch {
    return fallback;
  }

  const rawResult = envelope.result;
  const raw =
    typeof rawResult === "object" &&
    rawResult !== null &&
    "response" in rawResult &&
    typeof (rawResult as { response: unknown }).response === "string"
      ? (rawResult as { response: string }).response.trim()
      : null;
  if (raw === null) return fallback;

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const verdict = lines[0]?.toLowerCase();

  if (verdict === "safe") {
    return { available: true, flagged: false, categories: [], rawVerdict: raw };
  }
  if (verdict === "unsafe") {
    return { available: true, flagged: true, categories: lines.slice(1), rawVerdict: raw };
  }

  // Model output didn't match the documented "safe"/"unsafe" convention —
  // never guess a verdict from unrecognized text.
  return { available: true, flagged: null, categories: [], rawVerdict: raw };
}
