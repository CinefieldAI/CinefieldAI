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

    try {
      const imageSize = mapAspectRatioToFalImageSize(request.settings.aspectRatio);
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
      if (imageSize) input.image_size = imageSize;
      if (typeof request.settings.seed === "number") input.seed = request.settings.seed;

      // `subscribe` waits for the queued job to finish, which keeps this a
      // synchronous adapter from the orchestrator's point of view.
      const result = await client.subscribe(model.providerModelId as never, {
        input: input as never,
        abortSignal: timeoutController.signal,
      });

      const images = extractImages((result as { data?: unknown }).data);
      if (images.length === 0) {
        throw new OrchestrationError("OUTPUT_MISSING", {
          context: { provider: "fal", generationId: context.generationId },
        });
      }

      PENDING_RESULTS.set(`fal-${request.generationId}`, images);

      return {
        providerJobId: `fal-${request.generationId}`,
        provider: this.providerId,
        status: "completed",
        // Deliberately free of provider URLs and raw payloads.
        metadata: { imageCount: images.length },
      };
    } catch (error) {
      throw mapFalError(error);
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
    const images = PENDING_RESULTS.get(submission.providerJobId);
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
