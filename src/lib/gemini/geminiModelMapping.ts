/**
 * Gemini image-generation model mapping for the three Nano Banana UI models
 * on /generate (Image mode). Server-only concern — never imported by client
 * components.
 *
 * Model IDs verified 2026-08-05 against official Google documentation:
 * - https://ai.google.dev/gemini-api/docs/image-generation
 * - https://ai.google.dev/gemini-api/docs/models
 * and cross-checked against the installed @google/genai@2.15.0 SDK's own
 * `Model` string-union type (node_modules/@google/genai/dist/genai.d.ts),
 * which explicitly includes "gemini-3-pro-image" and "gemini-3.1-flash-image".
 * "gemini-3.1-flash-lite-image" is not yet present in that SDK-internal
 * union (likely lagging the newest release) but is accepted at compile time
 * via the union's `(string & {})` fallback, and matches both official docs
 * pages consistently.
 */

export const NANO_BANANA_GEMINI_MODEL_MAP = {
  "nano-banana-pro": "gemini-3-pro-image",
  "nano-banana-2": "gemini-3.1-flash-image",
  "nano-banana-2-lite": "gemini-3.1-flash-lite-image",
} as const;

export type SupportedNanoBananaModelId = keyof typeof NANO_BANANA_GEMINI_MODEL_MAP;

export function isSupportedNanoBananaModel(
  modelId: string
): modelId is SupportedNanoBananaModelId {
  return Object.prototype.hasOwnProperty.call(NANO_BANANA_GEMINI_MODEL_MAP, modelId);
}

export function getGeminiModelId(modelId: SupportedNanoBananaModelId): string {
  return NANO_BANANA_GEMINI_MODEL_MAP[modelId];
}

/**
 * Valid `response_format.image_size` values per model, verified from
 * official docs. Gemini 3 image models default to "1K" when omitted.
 */
export const IMAGE_SIZE_SUPPORT: Record<SupportedNanoBananaModelId, readonly string[]> = {
  "nano-banana-pro": ["1K", "2K", "4K"],
  "nano-banana-2": ["512", "1K", "2K", "4K"],
  "nano-banana-2-lite": ["1K"],
};

/**
 * `generation_config.thinking_level` is documented only for
 * gemini-3.1-flash-image (Nano Banana 2). The app's UI currently exposes
 * the Thinking control on Nano Banana 2 Lite instead — since that model
 * does not document thinking_level support, the value is captured in the
 * generation row's metadata but intentionally NOT sent to Gemini for that
 * model, to avoid sending an unsupported parameter. See final report for
 * this documented limitation.
 */
export const SUPPORTS_THINKING_LEVEL: Record<SupportedNanoBananaModelId, boolean> = {
  "nano-banana-pro": false,
  "nano-banana-2": true,
  "nano-banana-2-lite": false,
};

/** Valid `response_format.aspect_ratio` values, verified from official docs. */
export const SUPPORTED_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

/**
 * The installed SDK's ImageResponseFormat.mime_type type is currently
 * restricted to "image/jpeg" only (see genai.d.ts ImageResponseFormatMimeType).
 */
export const GEMINI_OUTPUT_MIME_TYPE = "image/jpeg";
