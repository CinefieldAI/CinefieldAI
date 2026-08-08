import "server-only";
import { OrchestrationError } from "./errors";
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
export async function normalizeOutputs(
  outputs: NormalizedOutput[],
  options?: { signal?: AbortSignal }
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
      bytes = await downloadOutput(output.sourceUrl, options?.signal);
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

async function downloadOutput(sourceUrl: string, signal?: AbortSignal): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new OrchestrationError("OUTPUT_DOWNLOAD_FAILED", {
      context: { reason: "invalid_url" },
    });
  }

  // Only fetch over HTTPS — never file://, data:, or plaintext HTTP.
  if (parsed.protocol !== "https:") {
    throw new OrchestrationError("OUTPUT_DOWNLOAD_FAILED", {
      context: { reason: "unsupported_protocol", protocol: parsed.protocol },
    });
  }

  try {
    const response = await fetch(parsed.toString(), { signal });
    if (!response.ok) {
      throw new OrchestrationError("OUTPUT_DOWNLOAD_FAILED", {
        context: { httpStatus: response.status },
      });
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    if (error instanceof OrchestrationError) throw error;
    throw new OrchestrationError("OUTPUT_DOWNLOAD_FAILED", {
      context: { reason: "fetch_failed" },
    });
  }
}
