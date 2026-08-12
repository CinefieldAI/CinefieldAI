import type { GenerationSettings, NormalizedGenerationInput } from "./types";

/**
 * The ONE mapping from raw UI metadata to typed generation settings
 * (Phase 7-F).
 *
 * WHY IT WAS EXTRACTED
 * This mapping lived inside `normalizeRequest` in the orchestrator, which runs
 * deep inside execution — after the generation row exists, after the workflow
 * starts, after an attempt is claimed. Phase 7-F needs the SAME reading of
 * `aspect_ratio`, `resolution` and the `image_count` fraction at the creation
 * boundary, so the capability check that rejects a request rejects it before
 * any of that happens.
 *
 * Copying the mapping would have been the mistake: two readings of
 * `image_count` that disagree by one produce a request the creation boundary
 * accepts and execution refuses, which is worse than no early check at all.
 * So both call sites use this.
 *
 * Pure. No I/O, no database, no registry lookup.
 */

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * `image_count` arrives from the UI as a fraction string such as "3/4"; the
 * numerator is the requested output count. Kept here rather than duplicated
 * because the off-by-one risk is exactly what this module exists to prevent.
 */
export function readOutputCount(metadata: Record<string, unknown>): number | undefined {
  const imageCount = readString(metadata, "image_count");
  if (!imageCount) return undefined;
  const parsed = Number.parseInt(imageCount.split("/")[0] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Maps UI metadata onto the typed settings the capability validator reads. */
export function mapMetadataToSettings(
  metadata: Record<string, unknown> | null | undefined
): GenerationSettings {
  const source = metadata ?? {};
  return {
    aspectRatio: readString(source, "aspect_ratio"),
    resolution: readString(source, "resolution"),
    durationSeconds: readNumber(source, "duration_seconds"),
    outputCount: readOutputCount(source),
    thinking: readString(source, "thinking"),
    voice: readString(source, "voice"),
    language: readString(source, "language"),
    // Carries provider-neutral extras (e.g. mock_mode) without leaking
    // provider-specific concepts into the typed surface.
    extra: source,
  };
}

/**
 * Describes an attached input from the same metadata, for the creation-time
 * check.
 *
 * Mirrors the orchestrator exactly, including its one important subtlety: an
 * input whose MIME type is unknown is NOT counted as an input. The UI records
 * `mime_type` alongside the upload, and treating a typeless attachment as
 * present would let an image-to-image request past a check that cannot
 * actually see what was attached.
 */
export function mapMetadataToInputs(
  inputUrl: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined
): NormalizedGenerationInput[] {
  if (!inputUrl) return [];
  const source = metadata ?? {};
  const mimeType = readString(source, "mime_type");
  if (!mimeType) return [];

  return [
    {
      storagePath: inputUrl,
      mimeType,
      originalFileName: readString(source, "original_file_name") ?? "input",
      sizeBytes: readNumber(source, "file_size") ?? 0,
      role: "source",
    },
  ];
}
