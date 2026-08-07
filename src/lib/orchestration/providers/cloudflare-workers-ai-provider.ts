import "server-only";
import {
  CloudflareAiGatewayError,
  runCloudflareAiGatewayBinary,
} from "@/lib/cloudflare/ai-gateway-client";
import { isCloudflareEnabled } from "@/lib/cloudflare/gateway-config";
import { OrchestrationError } from "../errors";
import { findModel } from "../model-registry";
import type { ProviderAdapter } from "./provider-adapter";
import type {
  NormalizedGenerationRequest,
  NormalizedOutput,
  ProviderExecutionContext,
  ProviderStatusResult,
  ProviderSubmission,
} from "../types";

/**
 * Cloudflare Workers AI provider adapter — text-to-speech models
 * (MeloTTS @cf/myshell-ai/melotts, Aura-2 @cf/deepgram/aura-2-en). Generic
 * across both: the endpoint id and its input-schema shape come from the
 * model registry (providerModelId, cloudflareTextField), so adding another
 * Cloudflare TTS endpoint is a registry entry — never a new adapter, route,
 * or handler.
 *
 * providerId is "cloudflare-workers-ai": the actual inference provider of
 * record. Cloudflare AI Gateway ("cloudflare-ai-gateway") is only the
 * transport/routing layer this adapter's requests happen to go through —
 * it is never itself registered as a provider (see provider-registry.ts).
 *
 * Synchronous, single-output, text-to-speech only. The exact user text is
 * sent to the provider unchanged — never translated, rewritten, trimmed, or
 * normalized. Every real request is additionally gated by
 * isCloudflareEnabled(), which itself requires CLOUDFLARE_AI_ENABLED="true"
 * plus every credential present.
 */

const PENDING_RESULTS_TTL_MS = 5 * 60_000; // 5 minutes — crash-protection ceiling only

interface PendingCloudflareResult {
  bytes: Uint8Array;
  storedAt: number;
}

/**
 * Holds MeloTTS bytes between submit() and getResult() for the short
 * request lifetime — the same short-lived hand-off pattern fal-provider.ts
 * and mock-provider.ts already use. getResult() deletes its own entry
 * immediately after reading it. Stale entries (e.g. a run that crashed
 * between submit() and getResult()) are pruned opportunistically on each
 * new insertion, so cleanup stays entirely inside this adapter — no
 * provider-specific branch is added to orchestrator.ts's finally block.
 */
const PENDING_RESULTS = new Map<string, PendingCloudflareResult>();

function pruneStaleResults(now: number): void {
  for (const [key, value] of PENDING_RESULTS) {
    if (now - value.storedAt > PENDING_RESULTS_TTL_MS) {
      PENDING_RESULTS.delete(key);
    }
  }
}

/**
 * Translates a Cloudflare AI Gateway client failure into a typed Cinefield
 * error. Only the HTTP status / Cloudflare error code are inspected — the
 * client itself never surfaces raw bodies, headers, prompts, or tokens.
 */
function mapCloudflareError(error: unknown): OrchestrationError {
  if (error instanceof OrchestrationError) return error;

  if (error instanceof CloudflareAiGatewayError) {
    const status = error.httpStatus;
    if (status === 401 || status === 403) {
      return new OrchestrationError("PROVIDER_AUTH_ERROR", {
        context: { provider: "cloudflare-workers-ai", status },
      });
    }
    if (status === 429) {
      return new OrchestrationError("PROVIDER_RATE_LIMIT", {
        context: { provider: "cloudflare-workers-ai", status },
      });
    }
    if (status === 408 || status === 504) {
      return new OrchestrationError("PROVIDER_TIMEOUT", {
        context: { provider: "cloudflare-workers-ai", status },
      });
    }
    if (status === 400 || status === 422) {
      return new OrchestrationError("INVALID_INPUT", {
        context: { provider: "cloudflare-workers-ai", status },
        userMessage: "The provider rejected these generation settings.",
      });
    }
    return new OrchestrationError("PROVIDER_FAILED", {
      context: { provider: "cloudflare-workers-ai", status },
    });
  }

  return new OrchestrationError("PROVIDER_FAILED", {
    context: { provider: "cloudflare-workers-ai" },
  });
}

class CloudflareWorkersAiProvider implements ProviderAdapter {
  readonly providerId = "cloudflare-workers-ai";

  async submit(
    request: NormalizedGenerationRequest,
    context: ProviderExecutionContext
  ): Promise<ProviderSubmission> {
    if (!isCloudflareEnabled()) {
      throw new OrchestrationError("PROVIDER_NOT_CONFIGURED", {
        context: { providerId: this.providerId },
        userMessage: "The Cloudflare Workers AI provider is not configured.",
      });
    }

    const model = findModel(request.modelId);
    if (!model) {
      throw new OrchestrationError("UNKNOWN_MODEL", { context: { modelId: request.modelId } });
    }

    // Cloudflare's TTS endpoints are not input-schema-uniform — the field
    // the text goes in, and which optional field pairs with it, are
    // registry-driven (see ModelRegistryEntry.cloudflareTextField), never a
    // per-model-id branch. The exact user text is always sent unchanged —
    // never translated, rewritten, trimmed, or normalized.
    const textField = model.cloudflareTextField ?? "prompt";
    const input: Record<string, unknown> = { [textField]: request.prompt };

    if (textField === "text") {
      // Aura-2 schema: optional speaker (voice) selection. Never invented or
      // defaulted here — Cloudflare applies its own documented default
      // ("luna") when omitted.
      if (request.settings.voice) {
        input.speaker = request.settings.voice;
      }
    } else {
      // MeloTTS schema: optional lang field. Never invented or inferred from
      // the text itself.
      if (request.settings.language) {
        input.lang = request.settings.language;
      }
    }

    let result;
    try {
      result = await runCloudflareAiGatewayBinary(
        { model: request.providerModelId, input },
        { signal: context.signal }
      );
    } catch (error) {
      throw mapCloudflareError(error);
    }

    const now = Date.now();
    pruneStaleResults(now);

    const providerJobId = `cloudflare-workers-ai-${request.generationId}`;
    PENDING_RESULTS.set(providerJobId, { bytes: result.bytes, storedAt: now });

    return {
      providerJobId,
      provider: this.providerId,
      status: "completed",
      // Deliberately free of audio bytes and raw Cloudflare response data.
      metadata: { byteLength: result.bytes.byteLength },
    };
  }

  async getStatus(
    submission: ProviderSubmission,
    _context: ProviderExecutionContext
  ): Promise<ProviderStatusResult> {
    void _context;
    return { status: submission.status, progress: submission.status === "completed" ? 100 : 0 };
  }

  async getResult(
    submission: ProviderSubmission,
    context: ProviderExecutionContext
  ): Promise<NormalizedOutput[]> {
    const pending = PENDING_RESULTS.get(submission.providerJobId);
    // Delete immediately after reading — do not wait for the caller to
    // finish consuming the result.
    PENDING_RESULTS.delete(submission.providerJobId);

    if (!pending) {
      throw new OrchestrationError("OUTPUT_MISSING", {
        context: { provider: this.providerId, generationId: context.generationId },
      });
    }

    return [
      {
        type: "audio",
        mimeType: "audio/mpeg",
        fileExtension: "mp3",
        bytes: pending.bytes,
        metadata: {
          provider: this.providerId,
          gateway: "cloudflare-ai-gateway",
          workflow: "text-to-speech",
          outputIndex: 0,
        },
      },
    ];
  }
}

export const cloudflareWorkersAiProvider: ProviderAdapter = new CloudflareWorkersAiProvider();
