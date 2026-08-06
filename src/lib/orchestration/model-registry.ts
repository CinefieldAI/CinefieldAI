import type { GenerationType, WorkflowType } from "./types";

/**
 * Cinefield model registry — the single server-side source of truth for
 * orchestration.
 *
 * IMPORTANT: this registry is intentionally NOT a mirror of the model picker
 * in the UI. It contains only models the orchestration chain is allowed to
 * execute — the explicit mock entries below, plus real provider entries
 * (fal.ai, and Cloudflare Workers AI — currently disabled). Other
 * visible-catalog models (Gemini/Nano Banana, Kling, Seedance, Veo, …) are
 * deliberately absent, so the orchestrator refuses to run them rather than
 * silently redirecting them to a provider.
 */

export interface ModelCapabilities {
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  supportedDurationsSeconds: number[];
  minOutputCount: number;
  maxOutputCount: number;
  supportsThinking: boolean;
  supportedThinkingValues: string[];
  requiresPrompt: boolean;
  /**
   * For audio models, this is the TTS input-text character limit. Optional:
   * omit it entirely when no documented limit exists rather than guessing a
   * number — the validator only enforces this when it is actually defined.
   */
  maxPromptLength?: number;
  /** Audio-only capabilities. Omitted entirely for image/video models. */
  supportedAudioFormats?: string[];
  requiresVoice?: boolean;
  /** e.g. ["en", "de", "tr"], or ["any"] for provider-agnostic multilingual support. */
  supportedLanguages?: string[];
  /** Descriptive ceiling on synthesized output length; not validated against a user setting. */
  maxAudioDurationSeconds?: number;
}

export interface ModelRegistryEntry {
  /** Stable Cinefield-side model id. Matches generations.model. */
  id: string;
  label: string;
  providerId: string;
  /** The id this provider itself uses. Kept separate from the Cinefield id. */
  providerModelId: string;
  generationType: GenerationType;
  supportedWorkflows: WorkflowType[];
  /** Synchronous providers return output from submit(); async ones poll. */
  executionMode: "sync" | "async";
  acceptedInputMimeTypes: string[];
  maxInputs: number;
  capabilities: ModelCapabilities;
  defaults: {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    outputCount: number;
  };
  enabled: boolean;
  /** True for development-only entries that never call an external API. */
  isMock: boolean;
}

const MOCK_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * The mock entries accept the full set of aspect ratios and resolutions the
 * existing /generate UI can emit in either Image or Video mode. Being
 * permissive here keeps the mock focused on proving the orchestration chain
 * rather than failing on a legitimate UI value; the capability validator is
 * still exercised by the deliberately narrower duration/output/thinking rules.
 */
const UI_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "4:5", "5:4", "2:3", "3:2"];
const UI_RESOLUTIONS = ["512p", "720p", "768p", "1080p", "1K", "2K", "4K"];

const MOCK_MODELS: ModelRegistryEntry[] = [
  {
    id: "mock-image",
    label: "Cinefield Mock Image",
    providerId: "mock",
    providerModelId: "mock-image-v1",
    generationType: "image",
    supportedWorkflows: ["text-to-image"],
    executionMode: "sync",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      supportedAspectRatios: UI_ASPECT_RATIOS,
      supportedResolutions: UI_RESOLUTIONS,
      supportedDurationsSeconds: [],
      minOutputCount: 1,
      // Image mode's batch stepper ranges up to n/10, so accept the full
      // range rather than failing validation on a legitimate UI value.
      maxOutputCount: 10,
      supportsThinking: false,
      supportedThinkingValues: [],
      requiresPrompt: true,
      maxPromptLength: 10_000,
    },
    defaults: { aspectRatio: "16:9", resolution: "1K", outputCount: 1 },
    enabled: true,
    isMock: true,
  },
  {
    id: "mock-image-edit",
    label: "Cinefield Mock Image Edit",
    providerId: "mock",
    providerModelId: "mock-image-edit-v1",
    generationType: "image",
    supportedWorkflows: ["text-to-image", "image-to-image"],
    executionMode: "sync",
    acceptedInputMimeTypes: MOCK_IMAGE_MIME_TYPES,
    maxInputs: 2,
    capabilities: {
      supportedAspectRatios: UI_ASPECT_RATIOS,
      supportedResolutions: UI_RESOLUTIONS,
      supportedDurationsSeconds: [],
      minOutputCount: 1,
      maxOutputCount: 2,
      supportsThinking: true,
      supportedThinkingValues: ["High", "Minimal"],
      requiresPrompt: true,
      maxPromptLength: 10_000,
    },
    defaults: { aspectRatio: "1:1", resolution: "1K", outputCount: 1 },
    enabled: true,
    isMock: true,
  },
  {
    id: "mock-video",
    label: "Cinefield Mock Video",
    providerId: "mock",
    providerModelId: "mock-video-v1",
    generationType: "video",
    supportedWorkflows: ["text-to-video", "image-to-video"],
    executionMode: "sync",
    acceptedInputMimeTypes: MOCK_IMAGE_MIME_TYPES,
    maxInputs: 1,
    capabilities: {
      supportedAspectRatios: UI_ASPECT_RATIOS,
      supportedResolutions: UI_RESOLUTIONS,
      supportedDurationsSeconds: [4, 6, 8, 10],
      minOutputCount: 1,
      maxOutputCount: 1,
      supportsThinking: false,
      supportedThinkingValues: [],
      requiresPrompt: true,
      maxPromptLength: 10_000,
    },
    defaults: { aspectRatio: "16:9", resolution: "720p", durationSeconds: 8, outputCount: 1 },
    enabled: true,
    isMock: true,
  },
  {
    id: "mock-tts",
    label: "Cinefield Mock TTS",
    providerId: "mock",
    providerModelId: "mock-tts-v1",
    generationType: "audio",
    supportedWorkflows: ["text-to-speech"],
    executionMode: "sync",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      // Audio has no aspect ratio / resolution / thinking concept, but the
      // browser unconditionally sends aspect_ratio/resolution in metadata
      // regardless of generation type. Permissive (not empty) here for the
      // same reason as every other mock entry above: an irrelevant-but-
      // inevitable UI value must never fail validation on its own.
      supportedAspectRatios: UI_ASPECT_RATIOS,
      supportedResolutions: UI_RESOLUTIONS,
      supportedDurationsSeconds: [],
      // Unlike aspect ratio/resolution, one-output-per-request is a real
      // constraint for TTS (one text in, one audio file out) — left at 1
      // deliberately, not loosened for UI permissiveness.
      minOutputCount: 1,
      maxOutputCount: 1,
      supportsThinking: false,
      supportedThinkingValues: [],
      requiresPrompt: true,
      // Doubles as the TTS input-text character limit, matching common
      // real-provider per-request limits (order of magnitude, not exact).
      maxPromptLength: 5_000,
      supportedAudioFormats: ["audio/wav"],
      requiresVoice: false,
      supportedLanguages: ["any"],
      maxAudioDurationSeconds: 300,
    },
    defaults: { outputCount: 1 },
    enabled: true,
    isMock: true,
  },
];

/**
 * Real provider models. Adding another fal endpoint is an entry here — no
 * new adapter, route, or handler is required.
 *
 * `fal-flux-schnell` uses an id that deliberately does not collide with any
 * id in the visible model catalog, so no existing model card can be routed
 * to fal by accident.
 */
const FAL_MODELS: ModelRegistryEntry[] = [
  {
    id: "fal-flux-schnell",
    label: "FLUX.1 [schnell] (fal.ai)",
    providerId: "fal",
    providerModelId: "fal-ai/flux/schnell",
    generationType: "image",
    supportedWorkflows: ["text-to-image"],
    executionMode: "sync",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      // Only ratios that map onto a documented fal image_size preset.
      supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
      supportedResolutions: UI_RESOLUTIONS,
      supportedDurationsSeconds: [],
      minOutputCount: 1,
      maxOutputCount: 4,
      supportsThinking: false,
      supportedThinkingValues: [],
      requiresPrompt: true,
      maxPromptLength: 10_000,
    },
    defaults: { aspectRatio: "16:9", resolution: "1K", outputCount: 1 },
    enabled: true,
    isMock: false,
  },
];

/**
 * Real Cloudflare Workers AI models, routed through Cloudflare AI Gateway.
 * `providerId` names the actual inference provider ("cloudflare-workers-ai")
 * — the gateway itself ("cloudflare-ai-gateway") is never a provider value
 * anywhere in this registry; it is recorded only in output metadata by the
 * adapter (cloudflare-workers-ai-provider.ts).
 *
 * `enabled: true` here does NOT by itself allow a real Cloudflare request.
 * The adapter (cloudflare-workers-ai-provider.ts) and the shared client
 * (ai-gateway-client.ts) both separately require isCloudflareEnabled() —
 * CLOUDFLARE_AI_ENABLED="true" plus every credential present — before any
 * fetch is attempted. Registry `enabled` only controls whether the
 * orchestrator's existing MODEL_DISABLED check lets a request reach the
 * adapter at all; it stays true so a controlled real test (a later, separate
 * step) only needs the env var flipped, not a code change.
 */
const CLOUDFLARE_MODELS: ModelRegistryEntry[] = [
  {
    id: "cloudflare-melotts",
    label: "MeloTTS (Cloudflare Workers AI)",
    providerId: "cloudflare-workers-ai",
    providerModelId: "@cf/myshell-ai/melotts",
    generationType: "audio",
    supportedWorkflows: ["text-to-speech"],
    executionMode: "sync",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      // Audio has no aspect ratio / resolution concept for this model, but
      // the browser unconditionally sends aspect_ratio/resolution in
      // metadata regardless of generation type. Permissive here for the
      // same reason as mock-tts above (see its own comment) — this is a UI
      // transport workaround, not a real MeloTTS capability.
      supportedAspectRatios: UI_ASPECT_RATIOS,
      supportedResolutions: UI_RESOLUTIONS,
      supportedDurationsSeconds: [],
      // One text in, one audio file out — a real MeloTTS constraint, not a
      // UI compatibility loosening.
      minOutputCount: 1,
      maxOutputCount: 1,
      supportsThinking: false,
      supportedThinkingValues: [],
      requiresPrompt: true,
      // maxPromptLength intentionally omitted: Cloudflare does not publish
      // a MeloTTS-specific character limit anywhere. maxPromptLength is
      // optional precisely so this can stay unset instead of guessing a
      // number — the validator simply does not enforce a ceiling here.
      supportedAudioFormats: ["audio/mpeg"],
      requiresVoice: false,
      // supportedLanguages, maxAudioDurationSeconds intentionally omitted:
      // MeloTTS's own docs mention an optional "lang" input but do not
      // enumerate which languages (including Turkish or German) actually
      // work, and no duration ceiling is documented. Do not invent either
      // until a controlled test proves them.
    },
    defaults: { outputCount: 1 },
    enabled: true,
    isMock: false,
  },
];

const REGISTRY: ReadonlyMap<string, ModelRegistryEntry> = new Map(
  [...MOCK_MODELS, ...FAL_MODELS, ...CLOUDFLARE_MODELS].map((model) => [model.id, model])
);

/** Returns the entry, or undefined when the model is not orchestratable. */
export function findModel(modelId: string): ModelRegistryEntry | undefined {
  return REGISTRY.get(modelId);
}

/** True when this model id is wired into the orchestration chain. */
export function isOrchestratableModel(modelId: string): boolean {
  return REGISTRY.has(modelId);
}

export function listModels(): ModelRegistryEntry[] {
  return [...REGISTRY.values()];
}
