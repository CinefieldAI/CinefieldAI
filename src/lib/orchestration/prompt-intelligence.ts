import "server-only";
import { runCloudflareAiGateway } from "@/lib/cloudflare/ai-gateway-client";
import { isCloudflareEnabled } from "@/lib/cloudflare/gateway-config";
import { listModels } from "./model-registry";
import type { GenerationType, WorkflowType } from "./types";

/**
 * Cinefield prompt intelligence — prompt enhancement and task classification
 * via a verified Cloudflare Workers AI text-generation model.
 *
 * Schema verified against Cloudflare's own documentation before coding:
 * @cf/meta/llama-3.1-8b-instruct-fast accepts a `messages` chat array and
 * returns generated text in the response envelope's `result.response`
 * field. (The non-"-fast" @cf/meta/llama-3.1-8b-instruct id was tried
 * first and confirmed deprecated — a real request returned HTTP 410 Gone —
 * so this is the currently-active sibling with the identical schema.) No
 * structured-output mode is documented for this model, so the output is
 * requested as a JSON object via prompt instructions and parsed defensively
 * — never trusted as already-valid JSON.
 *
 * Hard rule, never bypassed: text-to-speech prompts are NEVER enhanced,
 * rewritten, or classified. TTS text must reach the provider byte-for-byte,
 * exactly as every other part of this codebase already guarantees.
 *
 * This function never throws. A broken or disabled classifier must never
 * block a real generation request — every failure mode (Cloudflare
 * disabled, request failure, unparseable output, an LLM-proposed workflow
 * no enabled model actually supports) degrades to the original prompt with
 * no classification applied.
 */

const CLASSIFIER_MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fast";

const CLASSIFIABLE_WORKFLOWS: readonly WorkflowType[] = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
  "video-to-video",
  "audio-to-video",
  "image-upscale",
  "video-upscale",
  "background-remove",
  "lip-sync",
  // text-to-speech is deliberately excluded — see the hard rule above.
];

export interface PromptIntelligenceResult {
  enhancedPrompt: string;
  suggestedWorkflow: WorkflowType | null;
  /** False whenever the result is just the original prompt passed through untouched. */
  classificationApplied: boolean;
}

function isClassifiableWorkflow(value: unknown): value is WorkflowType {
  return (
    typeof value === "string" &&
    (CLASSIFIABLE_WORKFLOWS as readonly string[]).includes(value)
  );
}

/**
 * True only when at least one currently enabled registry model actually
 * supports this workflow. The LLM's own claim is never sufficient on its
 * own — this is the "validate any LLM-proposed workflow against the
 * registry" requirement.
 */
function isWorkflowRegistered(workflow: WorkflowType): boolean {
  return listModels().some((model) => model.enabled && model.supportedWorkflows.includes(workflow));
}

function buildSystemPrompt(): string {
  return (
    "You classify and lightly improve prompts for an AI image/video generation tool. " +
    "Reply with ONLY a single JSON object and nothing else — no prose, no code fences. " +
    'The object must match exactly: {"enhancedPrompt": string, "workflow": string}. ' +
    `"workflow" must be exactly one of: ${CLASSIFIABLE_WORKFLOWS.join(", ")}. ` +
    "\"enhancedPrompt\" must preserve the user's original subject and intent exactly — " +
    "add visual clarity and detail only, never change what is being requested, never add " +
    "new subjects, never remove anything the user asked for."
  );
}

/** Extracts the first top-level {...} block, defensively, from model output that may include stray prose despite instructions. */
function extractJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : text);
}

export async function classifyAndEnhancePrompt(params: {
  prompt: string;
  generationType: GenerationType;
}): Promise<PromptIntelligenceResult> {
  const { prompt, generationType } = params;
  const fallback: PromptIntelligenceResult = {
    enhancedPrompt: prompt,
    suggestedWorkflow: null,
    classificationApplied: false,
  };

  // Hard rule: TTS text is never translated, rewritten, or enhanced.
  if (generationType === "audio") return fallback;
  if (prompt.trim().length === 0) return fallback;
  if (!isCloudflareEnabled()) return fallback;

  let envelope;
  try {
    envelope = await runCloudflareAiGateway({
      model: CLASSIFIER_MODEL_ID,
      input: {
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: prompt },
        ],
        max_tokens: 512,
        temperature: 0.3,
      },
    });
  } catch {
    return fallback;
  }

  const rawResult = envelope.result;
  const rawResponse =
    typeof rawResult === "object" && rawResult !== null && "response" in rawResult
      ? (rawResult as { response: unknown }).response
      : undefined;

  // Confirmed via a real controlled test: Cloudflare's gateway sometimes
  // auto-parses JSON-shaped model output straight into an object here
  // instead of returning it as a string — both shapes are handled, neither
  // is assumed without the other having been actually observed.
  let parsed: unknown;
  if (typeof rawResponse === "string") {
    try {
      parsed = extractJsonObject(rawResponse);
    } catch {
      return fallback;
    }
  } else if (typeof rawResponse === "object" && rawResponse !== null) {
    parsed = rawResponse;
  } else {
    return fallback;
  }
  if (typeof parsed !== "object" || parsed === null) return fallback;

  const candidate = parsed as Record<string, unknown>;

  const enhancedPrompt =
    typeof candidate.enhancedPrompt === "string" && candidate.enhancedPrompt.trim().length > 0
      ? candidate.enhancedPrompt
      : prompt;

  let suggestedWorkflow: WorkflowType | null = null;
  if (isClassifiableWorkflow(candidate.workflow) && isWorkflowRegistered(candidate.workflow)) {
    suggestedWorkflow = candidate.workflow;
  }

  return { enhancedPrompt, suggestedWorkflow, classificationApplied: true };
}
