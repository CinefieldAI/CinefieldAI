import "server-only";
import { OrchestrationError } from "./errors";
import { reportOutboundFetchBlocked } from "@/lib/security/security-signals";
import {
  fetchUntrustedMedia,
  OutboundFetchError,
} from "@/lib/media/outbound-fetch-gateway";
import type { NormalizedOutput } from "./types";

/**
 * Cinefield output normalizer.
 *
 * Providers may return raw bytes or a URL. This layer guarantees that by the
 * time output reaches the storage manager it has usable bytes, a MIME type,
 * and a safe file extension — regardless of which provider produced it.
 */

const SAFE_EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

function deriveExtension(output: NormalizedOutput): string {
  const declared = output.fileExtension?.toLowerCase();
  if (declared && SAFE_EXTENSION_PATTERN.test(declared)) return declared;

  const fromMime = MIME_TO_EXTENSION[output.mimeType];
  if (fromMime) return fromMime;

  const subtype = output.mimeType.split("/")[1]?.toLowerCase() ?? "";
  return SAFE_EXTENSION_PATTERN.test(subtype) ? subtype : "bin";
}

export interface ResolvedOutput extends NormalizedOutput {
  bytes: Uint8Array;
  fileExtension: string;
}

/**
 * Ensures every output carries bytes. Outputs that supply only a sourceUrl
 * are downloaded here; outputs with neither are rejected.
 */
/**
 * Who the download belonged to, for the Phase 12-C security signal.
 *
 * Opaque server-side ids only. There is no field a URL, a host or a prompt
 * could travel in, which is the point: an SSRF refusal must be attributable
 * without the thing that was refused being written down.
 */
export interface OutputDownloadContext {
  generationId?: string;
  /** The generation's owner — the CONTEXT of the event, not its actor. */
  clerkUserId?: string;
}

export async function normalizeOutputs(
  outputs: NormalizedOutput[],
  options?: { signal?: AbortSignal; context?: OutputDownloadContext }
): Promise<ResolvedOutput[]> {
  if (outputs.length === 0) {
    throw new OrchestrationError("OUTPUT_MISSING");
  }

  const resolved: ResolvedOutput[] = [];

  for (const output of outputs) {
    if (!output.mimeType || typeof output.mimeType !== "string") {
      throw new OrchestrationError("OUTPUT_VALIDATION_FAILED", {
        context: { reason: "missing_mime_type" },
      });
    }

    let bytes: Uint8Array;

    if (output.bytes && output.bytes.byteLength > 0) {
      bytes = output.bytes;
    } else if (output.sourceUrl) {
      bytes = await downloadOutput(output.sourceUrl, options?.signal, options?.context);
    } else {
      throw new OrchestrationError("OUTPUT_MISSING", {
        context: { reason: "no_bytes_and_no_source_url" },
      });
    }

    if (bytes.byteLength === 0) {
      throw new OrchestrationError("OUTPUT_VALIDATION_FAILED", {
        context: { reason: "empty_output" },
      });
    }

    resolved.push({ ...output, bytes, fileExtension: deriveExtension(output) });
  }

  return resolved;
}

/**
 * Downloads a provider result through the Outbound Fetch Security Gateway.
 *
 * This function used to call `fetch(url)` directly behind a lone `https:`
 * check. A provider result URL is untrusted input, and that check let it
 * address anything the process could reach — including cloud metadata. The
 * gateway now owns scheme policy, DNS resolution, IP screening, redirect
 * re-validation, byte bounds and timeouts; nothing here re-implements any of
 * it, because a second copy is a second thing to get wrong.
 *
 * The refusal CLASS is carried into the orchestration error context. The URL
 * is not: a signed provider URL is a credential, and an error string is
 * exactly where it would leak.
 */
async function downloadOutput(
  sourceUrl: string,
  signal?: AbortSignal,
  context?: OutputDownloadContext
): Promise<Uint8Array> {
  try {
    const result = await fetchUntrustedMedia(sourceUrl, { signal });
    return result.bytes;
  } catch (error) {
    if (error instanceof OutboundFetchError) {
      // Phase 12-C. A destination-policy refusal — a provider result aimed at
      // a private or metadata address — is a security event, and this is the
      // only place in the system that observes one. Detached and non-throwing
      // by contract: the download has already failed, and a logging outage
      // must not change that into something else.
      //
      // The failure CLASS travels. The URL does not, and cannot: the reporter
      // has no parameter for one.
      reportOutboundFetchBlocked({
        failure: error.failure,
        detail: error.detail,
        generationId: context?.generationId ?? null,
        tenantId: context?.clerkUserId ?? null,
      });

      throw new OrchestrationError("OUTPUT_DOWNLOAD_FAILED", {
        context: { reason: error.failure, detail: error.detail },
      });
    }
    throw new OrchestrationError("OUTPUT_DOWNLOAD_FAILED", {
      context: { reason: "fetch_failed" },
    });
  }
}
