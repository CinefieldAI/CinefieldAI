import type { Generation } from "@/types/database";

type GenerationType = Generation["generation_type"];

/**
 * Maps Cinema Studio's UI mode to the generations.generation_type column.
 * Cinema Studio currently only exposes image/video modes.
 */
export function mapCinemaModeToGenerationType(
  mode: "image" | "video"
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
