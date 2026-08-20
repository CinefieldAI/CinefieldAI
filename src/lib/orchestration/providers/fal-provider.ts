import "server-only";
import { createFalClient, ApiError, type FalClient } from "@fal-ai/client";
import { OrchestrationError } from "../errors";
import { findModel } from "../model-registry";
import { providerSafetyMetadata } from "@/lib/safety/provider-native-safety";
import type { ProviderAdapter, ProviderReconciliation } from "./provider-adapter";
import type { ProviderCapabilityMatrix } from "./provider-capabilities";
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
let testClient: FalClient | null = null;

/**
 * Injects a fal client for tests.
 *
 * The ONLY way this adapter is exercised without a credential or a paid call.
 * Production never reaches it: `getFalClient()` prefers the injected client
 * only when one has been set, and nothing outside a test sets one.
 */
export function __setFalClientForTesting(client: FalClient | null): void {
  testClient = client;
}

function getFalClient(): FalClient {
  if (testClient) return testClient;
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

/**
 * fal's own NSFW flags, one per image (Phase 28, §7).
 *
 * ---------------------------------------------------------------------------
 * A REAL SIGNAL THAT WAS BEING DROPPED
 * ---------------------------------------------------------------------------
 * `has_nsfw_concepts` is a sibling key of `images` on the same `data` object,
 * and the installed SDK declares it for the enabled endpoints — see
 * `@fal-ai/client`'s `unoOutput`, which both `FluxDevOutput` and
 * `FluxSchnellOutput` alias: "Whether the generated images contain NSFW
 * concepts." It arrives index-aligned with `images`, and `extractImages`
 * stepped straight over it.
 *
 * ---------------------------------------------------------------------------
 * CAPTURED AS EVIDENCE, NEVER AS A DECISION
 * ---------------------------------------------------------------------------
 * REFERANS M.1 calls the provider's own moderation "Kapı A" and says outright
 * not to trust it: "GÜVENME: açık ağırlıklı modeller (SDXL, Wan) daha
 * gevşektir." So this is normalized into Phase 28 evidence and nothing more.
 * A `true` sends that output to human review; a `false` grants nothing at all
 * and cannot bypass Cinefield's own output gate.
 *
 * Returns an empty array when the field is absent or the wrong shape — a
 * missing flag is SILENCE, not a clean bill of health, and the difference is
 * preserved by emitting no signal rather than a negative one.
 */
function extractNsfwFlags(data: unknown): boolean[] {
  if (typeof data !== "object" || data === null || !("has_nsfw_concepts" in data)) return [];
  const flags = (data as { has_nsfw_concepts: unknown }).has_nsfw_concepts;
  if (!Array.isArray(flags)) return [];
  return flags.map((flag) => flag === true);
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/**
 * NO PROCESS-LOCAL RESULT STATE.
 *
 * This adapter used to hold submit()'s images in a module-level Map keyed by
 * generation id, and getResult() read them back out. That worked only while
 * one Node process handled the whole generation. A crash between fal
 * finishing and Cinefield storing the output lost a job that had ALREADY been
 * billed, and a continuation resumed on another worker found nothing — the
 * memory was the only copy.
 *
 * fal's queue is the durable copy. `queue.result(endpointId, { requestId })`
 * returns a completed request's output to anyone holding those two
 * identifiers, both of which live in PostgreSQL on the attempt and the
 * submission. So the Map is gone rather than kept as a fast path: a fallback
 * would hide exactly the defect this removal fixes, passing in the process
 * that submitted and failing everywhere else.
 *
 * `releaseFalResult` is intentionally retained as a no-op export — the
 * orchestrator's `finally` block calls it for every provider, and a
 * provider-shaped hole there would be a worse artifact than one honest
 * no-op. It is documented, not dead by accident.
 */
export function releaseFalResult(_generationId: string): void {
  void _generationId;
}

/**
 * fal.ai capabilities, each traced to the evidence that justifies it
 * (Phase 8).
 *
 * The source of truth for every "implemented" below is the INSTALLED SDK's
 * own type surface — node_modules/@fal-ai/client/src/queue.d.ts declares
 * `submit`, `status`, `result` and `cancel` on QueueClient. That is
 * verifiable in this repository today, which is why those may be
 * implemented. Nothing here is inferred from a blog post or from what a
 * provider "probably" does.
 *
 * NOTHING IS "proven": proven means exercised against the live provider, and
 * this batch makes no paid call. Every implemented capability is therefore
 * `implemented_not_live_validated`, which is the honest state.
 */
export const FAL_CAPABILITIES: ProviderCapabilityMatrix = {
  submit: "implemented_not_live_validated",
  // queue.status(endpointId, { requestId })
  status: "implemented_not_live_validated",
  // queue.result(endpointId, { requestId })
  result: "implemented_not_live_validated",
  polling: "implemented_not_live_validated",
  // The SDK exposes a `webhookUrl` submit option, so fal can call back. But
  // Cinefield does not use it, and there is no ingress route for it.
  webhook: "unsupported_by_adapter",
  // AND THIS IS WHY. The SDK ships no signature verifier, no documented
  // header, and no timestamp/nonce scheme that can be checked from this
  // repository. Without a way to prove a callback came from fal, a webhook
  // endpoint is an unauthenticated way for anyone to claim a job finished.
  // Inventing a scheme would be worse than having none, so the capability
  // stays unverified and the ingress stays unbuilt.
  webhookAuthentication: "unknown_provider_capability",
  // queue.cancel(endpointId, { requestId }) — declared to throw if the
  // request cannot be cancelled.
  cancel: "implemented_not_live_validated",
  // Reconciliation rides on queue.status: asking fal about a request id is
  // exactly the question an ambiguous submission needs answered.
  reconcileAmbiguousSubmission: "implemented_not_live_validated",
  // No caller-supplied idempotency key appears anywhere in the SDK's submit
  // options. Cinefield's own idempotency is unaffected — it never depended on
  // the provider having this.
  nativeIdempotency: "unknown_provider_capability",
  // submit() enqueues and returns; Temporal owns the observation.
  executionShape: "asynchronous",
  // Restart-safe IN CODE, not in the field. Everything needed to finish a job
  // after the submitting process dies is durable: fal names the request in the
  // submit response, the orchestrator persists it before anything waits, and
  // status/result/cancel are all addressed by (endpointId, requestId) from the
  // attempt row. Proven with doubles across separate client instances; never
  // once against the live API, which is why this is not "restart_safe".
  productionExecutionDurability: "implemented_not_live_validated",
};

class FalProvider implements ProviderAdapter {
  readonly providerId = "fal";
  readonly capabilities = FAL_CAPABILITIES;

  async submit(
    request: NormalizedGenerationRequest,
    context: ProviderExecutionContext
  ): Promise<ProviderSubmission> {
    const model = findModel(request.modelId);
    if (!model) {
      throw new OrchestrationError("UNKNOWN_MODEL", { context: { modelId: request.modelId } });
    }

    const client = getFalClient();

    // Cinefield-owned timeout on the ENQUEUE call only. It no longer bounds
    // a generation — it bounds one short POST — so a slow model may take as
    // long as fal needs without any Cinefield timer being involved.
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), FAL_REQUEST_TIMEOUT_MS);

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

      // ENQUEUE ONLY. `queue.submit` returns the moment fal accepts the
      // request, carrying fal's own `request_id`.
      //
      // THIS REPLACED `subscribe()`, AND THE REASON IS DURABILITY.
      // subscribe() held the connection open until the job finished, and for
      // that entire window — often a minute or more — the request id existed
      // only in a local variable. A worker that died there left a job fal was
      // running, and billing, that Cinefield could no longer name: the attempt
      // row carried no provider_job_id, so reconciliation had nothing to ask
      // about and the output was unrecoverable.
      //
      // Now acceptance and identification happen in one short POST. The
      // orchestrator persists the id before anything waits, and the waiting
      // belongs to Temporal.
      const accepted = await client.queue.submit(model.providerModelId as never, {
        input: input as never,
        abortSignal: timeoutController.signal,
      } as never);

      const requestId = (accepted as { request_id?: unknown }).request_id;
      if (typeof requestId !== "string" || requestId.length === 0) {
        // fal answered but named nothing. A job may exist and could never be
        // addressed — ambiguous by definition. Reported as such rather than
        // as a failure, so no retry is authorized.
        throw new OrchestrationError("PROVIDER_SUBMISSION_UNKNOWN", {
          context: { provider: "fal", generationId: context.generationId },
        });
      }

      return {
        // fal's own request id, durable from this moment: the orchestrator's
        // async branch writes it into the row's provider job before returning,
        // and the attempt row mirrors it.
        providerJobId: requestId,
        provider: this.providerId,
        // "queued", never "completed" — the work has not been done yet, and
        // claiming otherwise would send the generation into the finalization
        // tail before any output exists.
        status: "queued",
        // Deliberately free of provider URLs and raw payloads. The endpoint id
        // is needed to address this request later — fal's queue API is keyed
        // by (endpointId, requestId), not by requestId alone — and it is a
        // public model identifier, not a secret. Persisted as the job's resume
        // data, which is what makes status, result and cancel work from any
        // process.
        metadata: { endpointId: model.providerModelId },
      };
    } catch (error) {
      // No id can be captured here: `queue.submit` either returns one or
      // throws. That is a NARROWER ambiguity window than subscribe() had — the
      // uncertain interval is one POST rather than a whole generation — and
      // the fail-closed classification in errors.ts still decides whether the
      // failure proves no job was created.
      throw mapFalError(error);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Asks fal for a request's current state.
   *
   * Used to echo the submission's own status, which made it useless to any
   * process that had not just performed the submission. It now asks fal, via
   * `queue.status(endpointId, { requestId })`, so a status check works from
   * another worker or after a restart.
   *
   * A failed lookup does NOT become a failed job. fal's status union carries
   * no failure state at all, and a transport error says nothing about the
   * work — so an unanswerable check reports the status the caller already
   * had rather than inventing a terminal one. Temporal's polling loop already
   * treats a failed check as "keep checking", never as "the job died".
   */
  async getStatus(
    submission: ProviderSubmission,
    context: ProviderExecutionContext
  ): Promise<ProviderStatusResult> {
    const endpointId = endpointIdFor(submission);
    if (!endpointId || isSyntheticJobId(submission.providerJobId, context.generationId)) {
      return { status: submission.status };
    }

    try {
      const client = getFalClient();
      const status = await client.queue.status(endpointId, {
        requestId: submission.providerJobId,
      });
      const mapped = mapFalQueueStatus(status.status);
      return { status: mapped, progress: mapped === "completed" ? 100 : undefined };
    } catch {
      // Unanswerable, not terminal.
      return { status: submission.status };
    }
  }

  /**
   * Fetches a completed request's output from fal.
   *
   * DURABLE BY CONSTRUCTION. Everything this needs — the request id and the
   * endpoint id — is persisted with the attempt, so any process holding the
   * attempt row can call it: the worker that submitted, a different worker,
   * or the same worker after a restart. There is no in-memory handoff and no
   * fallback to one.
   *
   * Built on `queue.result(endpointId, { requestId })`, declared by the
   * installed SDK (@fal-ai/client 1.10.1, src/queue.d.ts).
   */
  async getResult(
    submission: ProviderSubmission,
    context: ProviderExecutionContext
  ): Promise<NormalizedOutput[]> {
    const endpointId = endpointIdFor(submission);
    if (!endpointId) {
      // Without the endpoint id the request cannot be addressed. Reported as
      // missing output rather than guessed at — the job may well exist, and
      // saying otherwise would be the invented answer.
      throw new OrchestrationError("OUTPUT_MISSING", {
        context: { provider: "fal", generationId: context.generationId, reason: "unknown_endpoint" },
      });
    }
    if (isSyntheticJobId(submission.providerJobId, context.generationId)) {
      throw new OrchestrationError("OUTPUT_MISSING", {
        context: {
          provider: "fal",
          generationId: context.generationId,
          reason: "no_provider_request_id",
        },
      });
    }

    let images: FalImage[];
    let nsfwFlags: boolean[];
    try {
      const client = getFalClient();
      const result = await client.queue.result(endpointId as never, {
        requestId: submission.providerJobId,
      });
      const payload = (result as { data?: unknown }).data;
      images = extractImages(payload);
      // Phase 28: read alongside the images, from the same payload, so the
      // index alignment fal guarantees is preserved.
      nsfwFlags = extractNsfwFlags(payload);
    } catch (error) {
      throw mapFalError(error);
    }

    if (images.length === 0) {
      throw new OrchestrationError("OUTPUT_MISSING", {
        context: {
          provider: "fal",
          generationId: context.generationId,
          providerJobId: submission.providerJobId,
        },
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
          // Phase 28 evidence. Emitted ONLY when fal actually returned a flag
          // for this index: an absent flag means the provider said nothing,
          // and recording that as `flagged: false` would manufacture a clean
          // verdict fal never gave.
          ...(index < nsfwFlags.length
            ? providerSafetyMetadata({
                provider: "fal",
                flagged: nsfwFlags[index],
                category: nsfwFlags[index] ? "sexual_content" : null,
                reasonCode: "fal_has_nsfw_concepts",
              })
            : {}),
        },
      };
    });
  }

  /**
   * Asks fal to stop a queued or running request.
   *
   * Built on `queue.cancel(endpointId, { requestId })`, which the installed
   * SDK declares and documents as throwing when the request cannot be
   * cancelled.
   *
   * WHAT THIS DOES NOT CLAIM. A resolved promise means fal accepted the
   * cancellation, not that the job was free or that no work was performed —
   * the SDK's own subscribe() documentation warns the server may be unable to
   * stop a request already running. The caller records "the provider
   * confirmed the stop"; deciding what that costs is Phase 10's, from the
   * settlement evidence, and this adapter deliberately supplies no opinion.
   *
   * A throw is reported by the CALLER as a failed cancel with unknown
   * outcome. This method never converts a failure into a success — an
   * uncancelled job reported as cancelled is how a running provider job stops
   * being tracked while it continues to bill.
   */
  async cancel(
    submission: ProviderSubmission,
    context: ProviderExecutionContext
  ): Promise<void> {
    const endpointId = endpointIdFor(submission);
    if (!endpointId) {
      // Without the endpoint id there is no call to make. Throwing lets the
      // caller record "failed / unknown" rather than a false confirmation.
      throw new OrchestrationError("PROVIDER_FAILED", {
        context: { provider: "fal", reason: "unknown_endpoint" },
      });
    }

    if (isSyntheticJobId(submission.providerJobId, context.generationId)) {
      // The synthetic fallback id means onEnqueue never fired, so fal never
      // acknowledged a request and there is nothing it could identify.
      throw new OrchestrationError("PROVIDER_FAILED", {
        context: { provider: "fal", reason: "no_provider_request_id" },
      });
    }

    const client = getFalClient();
    await client.queue.cancel(endpointId, { requestId: submission.providerJobId });
  }

  /**
   * Asks fal whether an unconfirmed submission actually produced a job.
   *
   * `queue.status` answers precisely the question an AMBIGUOUS submission
   * leaves open. A status — IN_QUEUE, IN_PROGRESS, COMPLETED — proves the job
   * exists and must never be duplicated.
   *
   * A FAILING STATUS CALL IS NOT PROOF OF ABSENCE, and this is the trap the
   * method is written to avoid. A 404 from a queue endpoint could mean "no
   * such request" or could mean a wrong endpoint id, an expired record, a
   * transient routing failure, or a shape this code does not recognize.
   * Returning "no_such_job" for any of those would clear the reconciliation
   * block and let Cinefield submit a job fal is already running. So every
   * error becomes "unknown" and the generation stays blocked — the outcome
   * that costs a manual look instead of a duplicate charge.
   */
  async reconcileSubmission(
    providerJobId: string,
    request: NormalizedGenerationRequest,
    context: ProviderExecutionContext
  ): Promise<ProviderReconciliation> {
    if (isSyntheticJobId(providerJobId, context.generationId)) {
      // A synthetic id was never known to fal; asking about it would produce
      // a "not found" that proves nothing.
      return { outcome: "unknown", errorCode: "no_provider_request_id" };
    }

    const model = findModel(request.modelId);
    if (!model) return { outcome: "unknown", errorCode: "UNKNOWN_MODEL" };

    try {
      const client = getFalClient();
      const status = await client.queue.status(model.providerModelId, {
        requestId: providerJobId,
      });
      return { outcome: "job_exists", status: mapFalQueueStatus(status.status) };
    } catch (error) {
      const mapped = mapFalError(error);
      return { outcome: "unknown", errorCode: mapped.code };
    }
  }
}

/**
 * fal's queue vocabulary, mapped onto Cinefield's.
 *
 * Note what is absent: fal's QueueStatus union is IN_QUEUE | IN_PROGRESS |
 * COMPLETED and carries no failure state — a failed request surfaces as an
 * error when the result is fetched, not as a status. So this never produces
 * "failed", and anything unrecognized becomes "processing" rather than a
 * terminal guess.
 */
export function mapFalQueueStatus(status: string): ProviderStatusResult["status"] {
  switch (status) {
    case "IN_QUEUE":
      return "queued";
    case "IN_PROGRESS":
      return "processing";
    case "COMPLETED":
      return "completed";
    default:
      return "processing";
  }
}

/**
 * The fal endpoint a submission belongs to.
 *
 * fal's queue API is keyed by (endpointId, requestId), so the endpoint is as
 * necessary as the request id. It travels in the submission's own metadata,
 * which the core persists verbatim as the job's resume data — durable, and
 * handed back to every later call. A public model identifier, never a secret.
 */
export function endpointIdFor(submission: ProviderSubmission): string | null {
  const fromMetadata = submission.metadata?.endpointId;
  return typeof fromMetadata === "string" && fromMetadata.length > 0 ? fromMetadata : null;
}

/**
 * True for the synthetic `fal-<generationId>` id the OLD adapter fell back to
 * when `onEnqueue` never fired.
 *
 * Nothing writes one any more — `queue.submit` either returns a real request
 * id or throws — but rows written before that change still carry them, and
 * they must never be sent to fal: it has never seen the string, so a
 * "not found" would prove nothing while looking like proof.
 */
export function isSyntheticJobId(providerJobId: string, generationId: string): boolean {
  return providerJobId === `fal-${generationId}`;
}

export const falProvider: ProviderAdapter = new FalProvider();
