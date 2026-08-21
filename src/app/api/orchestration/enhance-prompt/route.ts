import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { classifyAndEnhancePrompt } from "@/lib/orchestration/prompt-intelligence";
import type { GenerationType } from "@/lib/orchestration/types";

import { guardBrowserMutation } from "@/lib/security/privileged-mutation-guard";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
/**
 * POST /api/orchestration/enhance-prompt
 *
 * Body: { "prompt": string, "generationType": "image" | "video" | "audio" }
 *
 * Optional, best-effort prompt enhancement + task classification. Never
 * called automatically by the generation pipeline — a caller opts in
 * explicitly. For "audio", the response always echoes the prompt unchanged
 * (classifyAndEnhancePrompt's own hard rule: TTS text is never rewritten).
 *
 * This endpoint never fails a generation: any internal classifier problem
 * (Cloudflare disabled, provider error, unparseable output) resolves to a
 * 200 response with classificationApplied: false and the original prompt
 * — it never returns a 5xx for that case, since the classifier is
 * explicitly optional and no caller should have to special-case its
 * failure modes.
 */

const VALID_GENERATION_TYPES: readonly GenerationType[] = ["image", "video", "audio"];

function isGenerationType(value: unknown): value is GenerationType {
  return typeof value === "string" && (VALID_GENERATION_TYPES as readonly string[]).includes(value);
}

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

  let prompt: string;
  let generationType: GenerationType;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    }
    const candidate = body as { prompt?: unknown; generationType?: unknown };
    if (typeof candidate.prompt !== "string" || candidate.prompt.trim().length === 0) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "prompt is required." });
    }
    if (!isGenerationType(candidate.generationType)) {
      throw new OrchestrationError("INVALID_INPUT", {
        userMessage: "generationType must be one of: image, video, audio.",
      });
    }
    prompt = candidate.prompt;
    generationType = candidate.generationType;
  } catch (caught) {
    const error =
      caught instanceof OrchestrationError
        ? caught
        : new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  try {
    const result = await classifyAndEnhancePrompt({ prompt, generationType });
    return privateJson(result, { status: 200 });
  } catch (caught) {
    // classifyAndEnhancePrompt itself never throws, but this stays as a
    // safety net so a future change to it can never turn into a raw 500
    // leaking internals to the browser.
    const error = toOrchestrationError(caught);
    return privateJson(error.toResponseBody(), { status: error.status });
  }
}
