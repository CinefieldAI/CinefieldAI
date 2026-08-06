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
 * Calls Cloudflare's universal AI Gateway run endpoint:
 *
 *   POST https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run
 *
 * Not called anywhere in this codebase yet — this function exists as
 * inactive foundation only. A future caller (a later, separate phase) must
 * continue to respect the "never log payload/headers/tokens" rule this
 * function itself already follows.
 */
export async function runCloudflareAiGateway(
  request: CloudflareAiRunRequest,
  options?: { signal?: AbortSignal }
): Promise<CloudflareAiRunEnvelope> {
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

  let response: Response;
  try {
    response = await fetch(url, {
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
