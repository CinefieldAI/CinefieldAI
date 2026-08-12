import "server-only";
import { getGeminiClient, isGeminiConfigured } from "@/lib/gemini/geminiClient";
import {
  getGeminiModelId,
  isSupportedNanoBananaModel,
  IMAGE_SIZE_SUPPORT,
  SUPPORTS_THINKING_LEVEL,
  SUPPORTED_ASPECT_RATIOS,
  GEMINI_OUTPUT_MIME_TYPE,
  type SupportedNanoBananaModelId,
} from "@/lib/gemini/geminiModelMapping";
import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import { OrchestrationError } from "../errors";
import type { ProviderAdapter } from "./provider-adapter";
import type { ProviderCapabilityMatrix } from "./provider-capabilities";
import type {
  NormalizedGenerationRequest,
  NormalizedOutput,
  ProviderExecutionContext,
  ProviderStatusResult,
  ProviderSubmission,
} from "../types";

/**
 * Cinefield Gemini provider adapter (Phase 5 production convergence).
 *
 * WHY THIS EXISTS — AND WHY IT IS A MIGRATION, NOT A NEW INTEGRATION
 * Gemini image generation ("Nano Banana") has been live since long before
 * the orchestration core, executed inline by
 * src/app/api/generations/[generationId]/execute/route.ts. That route claimed
 * the row itself, called Gemini, uploaded the output and wrote
 * status='completed' — a complete generation lifecycle owned outside
 * Temporal, which every Phase 6R audit has correctly reported as the one
 * remaining second owner.
 *
 * It could not simply be deleted: its URL is called by frozen /generate UI
 * code. And it could not be turned into a thin wrapper while Gemini was
 * unknown to the model registry, because delegating would have failed with
 * UNKNOWN_MODEL. So the provider had to move INTO the core first. That is
 * what this file is: the same Gemini call the route already made, expressed
 * as a ProviderAdapter so the existing chain — Temporal → SQS → provider
 * worker → adapter → the shared finalization tail — can run it.
 *
 * No new capability is introduced. Same client, same three models, same
 * request shape, same output MIME type. What changes is who owns the
 * lifecycle around it.
 *
 * SYNCHRONOUS BY NATURE
 * `interactions.create` returns the finished image, so submit() completes
 * inline and reports "completed". There is no job to poll and no webhook to
 * receive, which is why getStatus simply echoes the submission's own state.
 *
 * The in-memory handoff between submit() and getResult() mirrors the mock
 * adapter's: the orchestrator calls them in that order within one execution,
 * and the entry is released in executeGeneration's `finally`.
 */

/** Result bytes held between submit() and getResult() within one execution. */
const PENDING_RESULTS = new Map<string, { bytes: Uint8Array; mimeType: string }>();

function geminiJobId(generationId: string): string {
  return `gemini-${generationId}`;
}

/** Releases the in-memory handoff. Called by the orchestrator's finally block. */
export function releaseGeminiResult(generationId: string): void {
  PENDING_RESULTS.delete(geminiJobId(generationId));
}

/**
 * Reads the settings Gemini accepts, validating each against the SAME
 * per-model support tables the legacy route used. An unsupported value is
 * dropped rather than forwarded, exactly as before — Gemini rejects unknown
 * combinations and a dropped optional is better than a failed generation.
 */
function buildResponseFormat(
  modelId: SupportedNanoBananaModelId,
  request: NormalizedGenerationRequest
): Record<string, unknown> {
  const aspectRatio =
    request.settings.aspectRatio &&
    (SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(request.settings.aspectRatio)
      ? request.settings.aspectRatio
      : undefined;

  const resolution = request.settings.resolution ?? "";
  const imageSize = IMAGE_SIZE_SUPPORT[modelId].includes(resolution) ? resolution : undefined;

  return {
    type: "image",
    mime_type: GEMINI_OUTPUT_MIME_TYPE,
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    ...(imageSize ? { image_size: imageSize } : {}),
  };
}

/** Supported input image types, unchanged from the legacy route. */
const SUPPORTED_INPUT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

type InputPart =
  | { type: "text"; text: string }
  | { type: "image"; mime_type: string; data: string };

/**
 * Loads an attached input image from private Storage and base64-encodes it.
 *
 * Returns null for an unsupported or unreadable attachment rather than
 * failing the generation — the legacy route surfaced that as a warning and
 * continued, and silently changing it to a hard failure would regress a
 * working behaviour.
 */
async function loadInputImage(
  request: NormalizedGenerationRequest
): Promise<InputPart | null> {
  const input = request.inputs[0];
  if (!input) return null;
  if (!SUPPORTED_INPUT_IMAGE_MIME_TYPES.includes(input.mimeType)) return null;

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.storage.from("generation-inputs").download(input.storagePath);
  if (error || !data) return null;

  const bytes = Buffer.from(await data.arrayBuffer());
  return { type: "image", mime_type: input.mimeType, data: bytes.toString("base64") };
}

/**
 * Gemini image generation, migrated into the orchestration core in Phase 5.
 *
 * It ran in production before that migration, but through a route that owned
 * its own lifecycle — so "it has worked" is not evidence about THIS adapter's
 * behaviour under the current contract, and the honest status is
 * implemented-but-not-live-validated here.
 */
export const GEMINI_CAPABILITIES: ProviderCapabilityMatrix = {
  submit: "implemented_not_live_validated",
  // interactions.create returns the image inline; there is no job handle.
  status: "unsupported_by_adapter",
  result: "unsupported_by_adapter",
  polling: "unsupported_by_adapter",
  webhook: "unknown_provider_capability",
  webhookAuthentication: "unknown_provider_capability",
  cancel: "unsupported_by_adapter",
  reconcileAmbiguousSubmission: "unknown_provider_capability",
  nativeIdempotency: "unknown_provider_capability",
  executionShape: "synchronous",
};

class GeminiProvider implements ProviderAdapter {
  readonly capabilities = GEMINI_CAPABILITIES;

  readonly providerId = "gemini";

  async submit(
    request: NormalizedGenerationRequest,
    _context: ProviderExecutionContext
  ): Promise<ProviderSubmission> {
    void _context;

    if (!isGeminiConfigured()) {
      // Proves no job was created: the request never left Cinefield, so the
      // orchestrator's evidence ladder can classify this as "none".
      throw new OrchestrationError("PROVIDER_NOT_CONFIGURED", {
        context: { provider: "gemini" },
        userMessage: "Image generation is not configured.",
      });
    }

    const modelId = request.modelId;
    if (!isSupportedNanoBananaModel(modelId)) {
      throw new OrchestrationError("UNKNOWN_MODEL", {
        context: { provider: "gemini", modelId },
      });
    }

    const thinking = request.settings.extra?.thinking;
    const thinkingLevel =
      SUPPORTS_THINKING_LEVEL[modelId] && typeof thinking === "string"
        ? thinking.toLowerCase()
        : undefined;

    const inputParts: InputPart[] = [{ type: "text", text: request.prompt }];
    const inputImage = await loadInputImage(request);
    if (inputImage) inputParts.push(inputImage);

    const ai = getGeminiClient();
    const interaction = await ai.interactions.create({
      model: getGeminiModelId(modelId),
      input: inputParts,
      response_format: buildResponseFormat(modelId, request),
      ...(thinkingLevel ? { generation_config: { thinking_level: thinkingLevel } } : {}),
    });

    if (interaction.status !== "completed" || !interaction.output_image?.data) {
      // The provider answered and did not produce an image. This IS a
      // provider failure, and the orchestrator's fail-closed ambiguity rule
      // correctly treats it as possibly-billable — the request reached
      // Gemini.
      throw new OrchestrationError("PROVIDER_FAILED", {
        context: { provider: "gemini", reason: "interaction_not_completed" },
        userMessage: "Image generation did not complete successfully.",
      });
    }

    const jobId = geminiJobId(request.generationId);
    PENDING_RESULTS.set(jobId, {
      bytes: Buffer.from(interaction.output_image.data, "base64"),
      mimeType: interaction.output_image.mime_type || GEMINI_OUTPUT_MIME_TYPE,
    });

    return {
      providerJobId: jobId,
      provider: this.providerId,
      status: "completed",
      // Identifiers only — never the image, never a credential.
      metadata: { provider: "gemini", model: getGeminiModelId(modelId) },
    };
  }

  async getStatus(
    submission: ProviderSubmission,
    _context: ProviderExecutionContext
  ): Promise<ProviderStatusResult> {
    void _context;
    // Synchronous: the submission already carries its final state. A status
    // check only ever arrives here for a row whose generation crossed a
    // process boundary, and there is nothing further to ask Gemini.
    return {
      status: submission.status,
      progress: submission.status === "completed" ? 100 : 0,
    };
  }

  async getResult(
    submission: ProviderSubmission,
    _context: ProviderExecutionContext
  ): Promise<NormalizedOutput[]> {
    void _context;
    const held = PENDING_RESULTS.get(submission.providerJobId);

    if (!held) {
      // The bytes lived only in the process that ran submit(). A different
      // process asking for them cannot reconstruct the image, and inventing
      // one would be worse than failing honestly — the shared finalization
      // tail treats this as a retryable Cinefield-side problem and leaves
      // the provider job evidence intact.
      throw new OrchestrationError("OUTPUT_MISSING", {
        context: { provider: "gemini", reason: "result_not_held_in_this_process" },
      });
    }

    return [
      {
        type: "image",
        mimeType: held.mimeType,
        fileExtension: held.mimeType === "image/png" ? "png" : "jpg",
        bytes: held.bytes,
        metadata: { provider: "gemini" },
      },
    ];
  }
}

export const geminiProvider: ProviderAdapter = new GeminiProvider();
