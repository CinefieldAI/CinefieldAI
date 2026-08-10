import "server-only";
import { createFalClient, ApiError, type FalClient } from "@fal-ai/client";
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
 * Cinefield fal.ai provider adapter.
 *
 * Generic across every fal image endpoint: the endpoint id and its
 * capabilities come from the model registry, so adding another fal model is
 * a registry entry — never a new adapter, route, or handler.
 *
 * FAL_KEY is read server-side only. It is never logged, never returned in a
 * response, never written to Supabase, and never exposed via NEXT_PUBLIC_.
 */

const FAL_REQUEST_TIMEOUT_MS = 90_000;

/** fal's documented image_size presets. */
type FalImageSize =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9";

/**
 * Maps Cinefield's provider-neutral aspect ratio onto fal's image_size
 * preset. Unmapped ratios return undefined so fal applies its own default
 * rather than receiving an invalid value.
 */
export function mapAspectRatioToFalImageSize(aspectRatio?: string): FalImageSize | undefined {
  switch (aspectRatio) {
    case "1:1":
      return "square_hd";
    case "4:3":
      return "landscape_4_3";
    case "3:4":
      return "portrait_4_3";
    case "16:9":
      return "landscape_16_9";
    case "9:16":
      return "portrait_16_9";
    default:
      return undefined;
  }
}

export function isFalConfigured(): boolean {
  const key = process.env.FAL_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

let cachedClient: FalClient | null = null;

function getFalClient(): FalClient {
  if (!isFalConfigured()) {
    throw new OrchestrationError("PROVIDER_NOT_CONFIGURED", {
      context: { providerId: "fal" },
      userMessage: "The fal.ai provider is not configured.",
    });
  }
  if (!cachedClient) {
    // Credentials are passed explicitly rather than relying on ambient env
    // lookup, so the source of the key is unambiguous and server-bound.
    cachedClient = createFalClient({ credentials: process.env.FAL_KEY });
  }
  return cachedClient;
}

/**
 * Translates a fal failure into a typed Cinefield error. Only the HTTP
 * status is inspected — the raw provider body is never surfaced, logged, or
 * persisted, since it can contain temporary URLs and request internals.
 */
function mapFalError(error: unknown): OrchestrationError {
  if (error instanceof OrchestrationError) return error;

  if (error instanceof ApiError) {
    const status = error.status;
    if (status === 401 || status === 403) {
      return new OrchestrationError("PROVIDER_AUTH_ERROR", { context: { provider: "fal", status } });
    }
    if (status === 429) {
      return new OrchestrationError("PROVIDER_RATE_LIMIT", { context: { provider: "fal", status } });
    }
    if (status === 402) {
      return new OrchestrationError("PROVIDER_QUOTA_EXCEEDED", {
        context: { provider: "fal", status },
      });
    }
    if (status === 408 || status === 504) {
      return new OrchestrationError("PROVIDER_TIMEOUT", { context: { provider: "fal", status } });
    }
    if (status === 422 || status === 400) {
      return new OrchestrationError("INVALID_INPUT", {
        context: { provider: "fal", status },
        userMessage: "The provider rejected these generation settings.",
      });
    }
    return new OrchestrationError("PROVIDER_FAILED", { context: { provider: "fal", status } });
  }

  // AbortController firing on our own timeout.
  if (error instanceof Error && error.name === "AbortError") {
    return new OrchestrationError("PROVIDER_TIMEOUT", { context: { provider: "fal" } });
  }

  return new OrchestrationError("PROVIDER_FAILED", { context: { provider: "fal" } });
}

/** A fal image entry, narrowed to the fields Cinefield consumes. */
interface FalImage {
  url: string;
  content_type?: string;
  width?: number;
  height?: number;
}

function extractImages(data: unknown): FalImage[] {
  if (typeof data !== "object" || data === null || !("images" in data)) return [];
  const images = (data as { images: unknown }).images;
  if (!Array.isArray(images)) return [];

  const result: FalImage[] = [];
  for (const entry of images) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as { url?: unknown; content_type?: unknown; width?: unknown; height?: unknown };
    if (typeof candidate.url !== "string") continue;
    result.push({
      url: candidate.url,
      content_type: typeof candidate.content_type === "string" ? candidate.content_type : undefined,
      width: typeof candidate.width === "number" ? candidate.width : undefined,
      height: typeof candidate.height === "number" ? candidate.height : undefined,
    });
  }
  return result;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/**
 * Holds the images produced by submit() until getResult() runs. In-memory
 * only for the lifetime of the request — never persisted, so the temporary
 * fal URLs never reach Supabase.
 */
const PENDING_RESULTS = new Map<string, FalImage[]>();

export function releaseFalResult(generationId: string): void {
  PENDING_RESULTS.delete(`fal-${generationId}`);
}

class FalProvider implements ProviderAdapter {
  readonly providerId = "fal";

  async submit(
    request: NormalizedGenerationRequest,
    context: ProviderExecutionContext
  ): Promise<ProviderSubmission> {
    const model = findModel(request.modelId);
    if (!model) {
      throw new OrchestrationError("UNKNOWN_MODEL", { context: { modelId: request.modelId } });
    }

    const client = getFalClient();

    // Cinefield-owned timeout, independent of any provider-side limit.
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), FAL_REQUEST_TIMEOUT_MS);

    // Captured by onEnqueue below; read by the catch, so declared outside it.
    let enqueuedRequestId: string | null = null;

    try {
      const requestedCount = request.settings.outputCount ?? model.defaults.outputCount;
      const numImages = Math.min(
        Math.max(requestedCount, model.capabilities.minOutputCount),
        model.capabilities.maxOutputCount
      );

      const input: Record<string, unknown> = {
        prompt: request.prompt,
        num_images: numImages,
        output_format: "png",
      };

      // fal's image endpoints are not input-schema-uniform: most map onto a
      // fixed `image_size` preset, but some (e.g. nano-banana) take the
      // aspect ratio directly as `aspect_ratio`. Registry-driven, never a
      // per-model-id branch — see ModelRegistryEntry.falSizeParam.
      if (model.falSizeParam === "aspect-ratio-string") {
        const ratio = request.settings.aspectRatio;
        // fal spells the automatic option "auto"; the /image composer
        // renders it as "Auto". Lowercasing only this one value keeps every
        // real ratio ("3:4", "16:9", …) byte-identical.
        if (ratio) input.aspect_ratio = ratio === "Auto" ? "auto" : ratio;
      } else {
        const imageSize = mapAspectRatioToFalImageSize(request.settings.aspectRatio);
        if (imageSize) input.image_size = imageSize;
      }

      // Only endpoints that actually document a `resolution` input receive
      // one — see ModelRegistryEntry.falSupportsResolution.
      if (model.falSupportsResolution && request.settings.resolution) {
        input.resolution = request.settings.resolution;
      }

      if (typeof request.settings.seed === "number") input.seed = request.settings.seed;

      // `subscribe` waits for the queued job to finish, which keeps this a
      // synchronous adapter from the orchestrator's point of view.
      //
      // `onEnqueue` is the officially documented client hook that fires the
      // moment fal accepts the job, BEFORE the wait for completion. Capturing
      // the request id here closes the Phase 6R.1 audit window: any failure
      // after this point (network drop mid-poll, timeout, unparseable
      // result) previously lost the id and forced fail-closed ambiguity —
      // now the error carries it, so the orchestrator records precise JOB
      // evidence that reconciliation can query fal about directly.
      const result = await client.subscribe(model.providerModelId as never, {
        input: input as never,
        abortSignal: timeoutController.signal,
        onEnqueue: (requestId: string) => {
          enqueuedRequestId = requestId;
        },
      } as never);

      const images = extractImages((result as { data?: unknown }).data);
      if (images.length === 0) {
        throw new OrchestrationError("OUTPUT_MISSING", {
          context: {
            provider: "fal",
            generationId: context.generationId,
            // The job COMPLETED at fal (and was billed) — only its payload
            // was unusable. The id makes that provable later.
            ...(enqueuedRequestId ? { providerJobId: enqueuedRequestId } : {}),
          },
        });
      }

      // Keyed by generationId — an internal handoff key for the in-memory
      // submit()→getResult() round trip within one process, independent of
      // whatever this adapter reports as providerJobId (see getResult below,
      // which looks the images up the same way).
      PENDING_RESULTS.set(`fal-${request.generationId}`, images);

      return {
        // The real fal request id, not a Cinefield-internal key. This is
        // what gets persisted as "job" evidence if a later step in the sync
        // tail (upload, normalization) fails — reconciliation must be able
        // to query fal by this id directly; a synthetic `fal-<generationId>`
        // string means nothing to fal's own status endpoint and would let a
        // reconciler that treats "provider doesn't recognize this id" as
        // proof-of-no-job clear the block and resubmit a job that already
        // exists (Phase 6R Package B review). Falls back to the synthetic
        // key only in the defensive case onEnqueue never fired.
        providerJobId: enqueuedRequestId ?? `fal-${request.generationId}`,
        provider: this.providerId,
        status: "completed",
        // Deliberately free of provider URLs and raw payloads.
        metadata: { imageCount: images.length },
      };
    } catch (error) {
      const mapped = mapFalError(error);
      // Attach the enqueued request id (an identifier, never a payload or a
      // URL) to the typed error's safe context. The orchestrator reads it to
      // record job evidence instead of ambiguity. mapFalError may have
      // already carried context from an inner OrchestrationError — preserved,
      // never overwritten.
      if (enqueuedRequestId && mapped.context?.providerJobId === undefined) {
        throw new OrchestrationError(mapped.code, {
          userMessage: mapped.userMessage,
          context: { ...mapped.context, provider: "fal", providerJobId: enqueuedRequestId },
        });
      }
      throw mapped;
    } finally {
      clearTimeout(timeoutHandle);
    }
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
    // Looked up by generationId, NOT submission.providerJobId: that field is
    // now the real fal request id (see submit() above), which no longer
    // matches PENDING_RESULTS' internal `fal-<generationId>` key.
    void submission;
    const images = PENDING_RESULTS.get(`fal-${context.generationId}`);
    if (!images || images.length === 0) {
      throw new OrchestrationError("OUTPUT_MISSING", {
        context: { provider: "fal", generationId: context.generationId },
      });
    }

    // sourceUrl is handed to the output normalizer, which performs the
    // server-side HTTPS download. The URL itself is never persisted.
    return images.map((image, index) => {
      const mimeType = image.content_type ?? "image/png";
      return {
        type: "image" as const,
        mimeType,
        fileExtension: extensionForMimeType(mimeType),
        sourceUrl: image.url,
        width: image.width,
        height: image.height,
        metadata: {
          provider: "fal",
          outputIndex: index,
        },
      };
    });
  }
}

export const falProvider: ProviderAdapter = new FalProvider();
