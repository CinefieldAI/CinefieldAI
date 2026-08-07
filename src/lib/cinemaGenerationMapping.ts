import type { Generation } from "@/types/database";

type GenerationType = Generation["generation_type"];

/**
 * Maps a page's UI mode to the generations.generation_type column. Cinema
 * Studio only exposes image/video; "audio" was added for /audio/create
 * (Phase 5F.3), which has no image/video mode at all.
 */
export function mapCinemaModeToGenerationType(
  mode: "image" | "video" | "audio"
): GenerationType {
  return mode;
}

/**
 * Derives a provider label from a Cinema Studio model id
 * (e.g. "kling-3.0-turbo" -> "kling"). The model catalog does not carry a
 * separate provider field, so the first hyphen-delimited segment is used as
 * a stable, dynamically-derived provider value instead of a hardcoded one.
 */
export function deriveProviderFromModelId(modelId: string): string {
  const [first] = modelId.split("-");
  return first || "cinema-studio";
}
