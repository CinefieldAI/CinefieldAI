import "server-only";
import { getCloudflareConfig, isCloudflareEnabled } from "./gateway-config";

/**
 * Cloudflare AI Gateway REST client.
 *
 * This is a gateway/transport client, NOT a Cinefield ProviderAdapter. Per
 * the architecture contract, Cloudflare AI Gateway is a gateway/control
 * layer, not a generation provider — this file must never be registered in
 * provider-registry.ts and must never move under
 * src/lib/orchestration/providers/.
 *
 * Inactive in this phase: nothing in the codebase calls runCloudflareAiGateway()
 * yet. No retries, caching, fallback, or rate-limit handling are implemented
 * — a later phase adds those deliberately, not as a side effect of this one.
 *
 * Never logs request headers, request payloads, response payloads, prompts,
 * tokens, signed URLs, or authorization data. Never persists a raw
 * Cloudflare response.
 */

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/** Narrow, provider-agnostic request shape for the universal AI Gateway run endpoint. */
export interface CloudflareAiRunRequest {
  model: string;
  input: Record<string, unknown>;
}

/** A single safe error entry from Cloudflare's response envelope. */
export interface CloudflareApiErrorEntry {
  code: number;
  message: string;
}

/**
 * Cloudflare's standard API envelope, narrowed to the fields Cinefield
 * reads. `result` is intentionally `unknown` — callers must narrow it
 * themselves; this client never inspects, logs, or persists it.
 */
export interface CloudflareAiRunEnvelope {
  success: boolean;
  result: unknown;
  errors: CloudflareApiErrorEntry[];
  messages: unknown[];
}

/**
 * Thrown on any Cloudflare AI Gateway request failure. Deliberately carries
 * only an HTTP status and, if present, Cloudflare's own numeric error code —
 * never the raw response body, never request/response headers, never the
 * prompt or input payload.
 */
export class CloudflareAiGatewayError extends Error {
  readonly httpStatus: number;
  readonly cloudflareErrorCode?: number;

  constructor(message: string, options: { httpStatus: number; cloudflareErrorCode?: number }) {
    super(message);
    this.name = "CloudflareAiGatewayError";
    this.httpStatus = options.httpStatus;
    this.cloudflareErrorCode = options.cloudflareErrorCode;
  }
}

/**
 * Centralized request construction. Both the JSON function and the binary
 * function call this exact same helper, so the endpoint, headers,
 * feature-flag enforcement, cache policy, and AbortSignal support can never
 * drift apart between them — a future call site cannot accidentally omit
 * the privacy header or the enablement gate by going around this function,
 * since there is no other way to reach Cloudflare from this module.
 *
 * Returns the raw, unread Response — callers decide how to read the body
 * (JSON envelope vs. binary audio).
 */
async function performCloudflareRequest(
  request: CloudflareAiRunRequest,
  options?: { signal?: AbortSignal }
): Promise<Response> {
  // Credential presence alone must never be enough to fire a request —
  // CLOUDFLARE_AI_ENABLED must also explicitly be "true". This check must
  // stay first: it must run before any config is even read.
  if (!isCloudflareEnabled()) {
    throw new CloudflareAiGatewayError(
      "Cloudflare AI Gateway is disabled (CLOUDFLARE_AI_ENABLED is not \"true\").",
      { httpStatus: 0 }
    );
  }

  let config;
  try {
    config = getCloudflareConfig();
  } catch (error) {
    throw new CloudflareAiGatewayError(
      error instanceof Error ? error.message : "Cloudflare AI Gateway is not configured.",
      { httpStatus: 0 }
    );
  }

  const url = `${CLOUDFLARE_API_BASE}/accounts/${config.accountId}/ai/run`;

  try {
    return await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: options?.signal,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
        "cf-aig-gateway-id": config.gatewayId,
        "cf-aig-collect-log-payload": "false",
      },
      body: JSON.stringify(request),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new CloudflareAiGatewayError("Cloudflare AI Gateway request was aborted.", {
        httpStatus: 0,
      });
    }
    throw new CloudflareAiGatewayError("Cloudflare AI Gateway request failed.", { httpStatus: 0 });
  }
}

/**
 * Calls Cloudflare's universal AI Gateway run endpoint and reads the
 * response as the standard JSON envelope:
 *
 *   POST https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run
 *
 * Preserved exactly as before — its contract is unchanged by the addition
 * of runCloudflareAiGatewayBinary() below. Not called anywhere in this
 * codebase yet.
 */
export async function runCloudflareAiGateway(
  request: CloudflareAiRunRequest,
  options?: { signal?: AbortSignal }
): Promise<CloudflareAiRunEnvelope> {
  const response = await performCloudflareRequest(request, options);

  let envelope: CloudflareAiRunEnvelope;
  try {
    envelope = (await response.json()) as CloudflareAiRunEnvelope;
  } catch {
    throw new CloudflareAiGatewayError("Cloudflare AI Gateway returned an unreadable response.", {
      httpStatus: response.status,
    });
  }

  if (!response.ok || !envelope.success) {
    const firstError = envelope.errors?.[0];
    throw new CloudflareAiGatewayError("Cloudflare AI Gateway request was not successful.", {
      httpStatus: response.status,
      cloudflareErrorCode: firstError?.code,
    });
  }

  return envelope;
}

export interface CloudflareAiRunBinaryResult {
  bytes: Uint8Array;
  mimeType: string;
}

const EXPECTED_AUDIO_MIME_TYPE = "audio/mpeg";

/**
 * Calls the same universal AI Gateway run endpoint via the same centralized
 * request helper, but expects a binary audio response instead of the JSON
 * envelope — for models (e.g. text-to-speech) that return raw audio bytes.
 *
 * Per Cloudflare's own documentation, a model like this can return either a
 * JSON object or raw binary audio depending on account/endpoint behavior
 * that is not fully specified. This function never guesses: if a
 * "successful" (2xx) response is not audio/mpeg, it fails explicitly rather
 * than attempting to invent or locate a base64 audio field inside a JSON
 * body. Non-success responses only ever expose an HTTP status and, best
 * effort, a Cloudflare numeric error code — never a raw body.
 */
export async function runCloudflareAiGatewayBinary(
  request: CloudflareAiRunRequest,
  options?: { signal?: AbortSignal }
): Promise<CloudflareAiRunBinaryResult> {
  const response = await performCloudflareRequest(request, options);
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

  if (!response.ok) {
    // Best-effort safe error code extraction from a JSON error envelope.
    // Never surfaces the raw body either way.
    let cloudflareErrorCode: number | undefined;
    if (contentType.includes("application/json")) {
      try {
        const envelope = (await response.json()) as CloudflareAiRunEnvelope;
        cloudflareErrorCode = envelope.errors?.[0]?.code;
      } catch {
        // Body unreadable/not JSON — fall through with status only.
      }
    }
    throw new CloudflareAiGatewayError("Cloudflare AI Gateway request was not successful.", {
      httpStatus: response.status,
      cloudflareErrorCode,
    });
  }

  if (!contentType.startsWith(EXPECTED_AUDIO_MIME_TYPE)) {
    // A successful response that isn't audio is unexpected — most likely
    // Cloudflare returned its JSON envelope shape instead of binary for
    // this model/account. Fail explicitly rather than guessing at a JSON
    // audio/base64 structure that may not exist. Reports only the observed
    // content type, never the body.
    throw new CloudflareAiGatewayError(
      `Cloudflare AI Gateway returned content type "${contentType || "unknown"}" (expected ${EXPECTED_AUDIO_MIME_TYPE}).`,
      { httpStatus: response.status }
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new CloudflareAiGatewayError("Cloudflare AI Gateway returned an empty audio response.", {
      httpStatus: response.status,
    });
  }

  return { bytes, mimeType: EXPECTED_AUDIO_MIME_TYPE };
}
