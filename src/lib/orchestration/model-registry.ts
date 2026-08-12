import {
  getGeminiModelId,
  IMAGE_SIZE_SUPPORT,
  SUPPORTED_ASPECT_RATIOS,
  SUPPORTS_THINKING_LEVEL,
} from "@/lib/gemini/geminiModelMapping";
import { isBlockedModelId } from "@/lib/blockedModels";
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
  /** Documented voice/speaker ids this audio model accepts. Validated when both this and settings.voice are present. */
  supportedVoices?: string[];
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
  /**
   * Only meaningful for providerId "fal" — fal.ai's own image endpoints are
   * not input-schema-uniform. "image-size-preset" (default when omitted)
   * maps Cinefield's aspectRatio onto fal's `image_size` enum
   * (square_hd/landscape_16_9/...), the schema flux/seedream/recraft/z-image
   * all share. "aspect-ratio-string" instead passes the aspect ratio through
   * verbatim as fal's `aspect_ratio` enum value (nano-banana's schema).
   * Declarative so fal-provider.ts stays one generic adapter — it branches on
   * this registry field, never on a specific model id.
   */
  falSizeParam?: "image-size-preset" | "aspect-ratio-string";
  /**
   * Only meaningful for providerId "cloudflare-workers-ai" — Cloudflare's
   * own TTS endpoints are not input-schema-uniform. "prompt" (default when
   * omitted) matches MeloTTS's own field name; "text" matches Deepgram
   * Aura-2's. Also selects which optional field the adapter sends alongside
   * it: "prompt" pairs with MeloTTS's `lang`, "text" pairs with Aura-2's
   * `speaker`. Declarative so cloudflare-workers-ai-provider.ts stays one
   * generic adapter — it branches on this registry field, never on a
   * specific model id.
   */
  cloudflareTextField?: "prompt" | "text";
  /**
   * Only meaningful for providerId "fal" — most fal image endpoints have no
   * resolution input at all, but a few (nano-banana-2) document a
   * `resolution` enum alongside aspect_ratio. Declarative so fal-provider.ts
   * only sends the field to endpoints that actually accept it, rather than
   * risking an INVALID_INPUT on the ones that do not.
   */
  falSupportsResolution?: boolean;
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
 * Every id below deliberately does not collide with any id in the visible
 * model catalog (cinemaStudioData.ts), so no existing model card can be
 * routed to fal by accident — the orchestrator only ever runs a model a
 * developer explicitly selected via the `?model=` diagnostic override.
 *
 * Every endpoint id, input parameter, and output field below was verified
 * against its individual fal.ai model documentation page (the catalog
 * listing page was rate-limited during verification) — not invented and not
 * copied from the visible-catalog display names. Where fal does not document
 * a hard ceiling (e.g. num_images), maxOutputCount reuses the same
 * conservative cap already established by fal-flux-schnell rather than
 * inventing a new unverified number.
 */
const FAL_IMAGE_SIZE_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"];

/**
 * fal.ai endpoints. ASYNCHRONOUS since the Phase 8 durability closure: the
 * adapter enqueues and returns a request id, and Temporal observes the job
 * from there. They were declared "sync" while the adapter used subscribe() to
 * wait for completion inside the submit call.
 */
const FAL_MODELS: ModelRegistryEntry[] = [
  {
    id: "fal-flux-schnell",
    label: "FLUX.1 [schnell] (fal.ai)",
    providerId: "fal",
    providerModelId: "fal-ai/flux/schnell",
    generationType: "image",
    supportedWorkflows: ["text-to-image"],
    executionMode: "async",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      // Only ratios that map onto a documented fal image_size preset.
      supportedAspectRatios: FAL_IMAGE_SIZE_ASPECT_RATIOS,
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
  {
    id: "fal-flux-dev",
    label: "FLUX.1 [dev] (fal.ai)",
    providerId: "fal",
    providerModelId: "fal-ai/flux/dev",
    generationType: "image",
    supportedWorkflows: ["text-to-image"],
    executionMode: "async",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      supportedAspectRatios: FAL_IMAGE_SIZE_ASPECT_RATIOS,
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
  {
    id: "fal-seedream-v4",
    label: "Seedream 4.0 (fal.ai)",
    providerId: "fal",
    providerModelId: "fal-ai/bytedance/seedream/v4/text-to-image",
    generationType: "image",
    supportedWorkflows: ["text-to-image"],
    executionMode: "async",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      // fal also documents "auto"/"auto_2K"/"auto_4K" image_size values for
      // this endpoint, but those are not aspect ratios Cinefield's UI emits
      // — omitted rather than invented into the picker.
      supportedAspectRatios: FAL_IMAGE_SIZE_ASPECT_RATIOS,
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
  {
    id: "fal-recraft-v3",
    label: "Recraft V3 (fal.ai)",
    providerId: "fal",
    providerModelId: "fal-ai/recraft/v3/text-to-image",
    generationType: "image",
    supportedWorkflows: ["text-to-image"],
    executionMode: "async",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      supportedAspectRatios: FAL_IMAGE_SIZE_ASPECT_RATIOS,
      supportedResolutions: UI_RESOLUTIONS,
      supportedDurationsSeconds: [],
      minOutputCount: 1,
      // Recraft V3's documented schema has no num_images / batch parameter
      // at all — capped at 1 rather than assuming an undocumented batch
      // input would be accepted.
      maxOutputCount: 1,
      supportsThinking: false,
      supportedThinkingValues: [],
      requiresPrompt: true,
      maxPromptLength: 10_000,
    },
    defaults: { aspectRatio: "1:1", resolution: "1K", outputCount: 1 },
    enabled: true,
    isMock: false,
  },
  {
    id: "fal-z-image-turbo",
    label: "Z-Image Turbo (fal.ai)",
    providerId: "fal",
    providerModelId: "fal-ai/z-image/turbo",
    generationType: "image",
    supportedWorkflows: ["text-to-image"],
    executionMode: "async",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      supportedAspectRatios: FAL_IMAGE_SIZE_ASPECT_RATIOS,
      supportedResolutions: UI_RESOLUTIONS,
      supportedDurationsSeconds: [],
      minOutputCount: 1,
      // fal's own docs state a 1-4 batch size for this endpoint explicitly.
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
  {
    id: "fal-nano-banana",
    label: "Nano Banana (fal.ai)",
    providerId: "fal",
    providerModelId: "fal-ai/nano-banana",
    generationType: "image",
    supportedWorkflows: ["text-to-image"],
    executionMode: "async",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      // This endpoint's own aspect_ratio enum is exactly the UI's full set.
      supportedAspectRatios: UI_ASPECT_RATIOS,
      supportedResolutions: UI_RESOLUTIONS,
      supportedDurationsSeconds: [],
      minOutputCount: 1,
      maxOutputCount: 4,
      supportsThinking: false,
      supportedThinkingValues: [],
      requiresPrompt: true,
      maxPromptLength: 10_000,
    },
    defaults: { aspectRatio: "1:1", resolution: "1K", outputCount: 1 },
    enabled: true,
    isMock: false,
    falSizeParam: "aspect-ratio-string",
  },
  {
    id: "fal-nano-banana-2",
    label: "Nano Banana 2 (fal.ai)",
    providerId: "fal",
    providerModelId: "fal-ai/nano-banana-2",
    generationType: "image",
    supportedWorkflows: ["text-to-image"],
    executionMode: "async",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      // Exactly the values the /image composer can emit for this model
      // (STANDARD_ASPECT_RATIOS in imageModelCapabilities.ts). Every one of
      // them is in fal's own documented aspect_ratio enum for this endpoint;
      // "Auto" is the composer's casing of fal's "auto" and the adapter
      // lowercases it on the way out.
      supportedAspectRatios: ["Auto", "1:1", "3:4", "9:16", "4:3", "16:9", "21:9"],
      // fal documents 0.5K/1K/2K/4K here; the composer only offers the upper
      // three (GPT_RESOLUTION_OPTIONS), and 0.5K is listed so a future
      // control can use it without another registry change.
      supportedResolutions: ["0.5K", "1K", "2K", "4K"],
      supportedDurationsSeconds: [],
      minOutputCount: 1,
      // The composer's batch counter tops out at 4. fal documents num_images
      // as an integer without publishing a ceiling, so this mirrors the UI
      // rather than inventing a provider limit.
      maxOutputCount: 4,
      supportsThinking: false,
      supportedThinkingValues: [],
      requiresPrompt: true,
      maxPromptLength: 10_000,
    },
    defaults: { aspectRatio: "3:4", resolution: "2K", outputCount: 1 },
    enabled: true,
    isMock: false,
    falSizeParam: "aspect-ratio-string",
    falSupportsResolution: true,
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
  {
    id: "cloudflare-aura-2-en",
    label: "Aura-2 English (Cloudflare Workers AI)",
    providerId: "cloudflare-workers-ai",
    providerModelId: "@cf/deepgram/aura-2-en",
    generationType: "audio",
    supportedWorkflows: ["text-to-speech"],
    executionMode: "sync",
    acceptedInputMimeTypes: [],
    maxInputs: 0,
    capabilities: {
      // Same UI-transport workaround as mock-tts/cloudflare-melotts above —
      // not a real Aura-2 capability.
      supportedAspectRatios: UI_ASPECT_RATIOS,
      supportedResolutions: UI_RESOLUTIONS,
      supportedDurationsSeconds: [],
      // One text in, one audio file out — a real Aura-2 constraint.
      minOutputCount: 1,
      maxOutputCount: 1,
      supportsThinking: false,
      supportedThinkingValues: [],
      requiresPrompt: true,
      // maxPromptLength intentionally omitted: not documented for this
      // endpoint — never guessed.
      supportedAudioFormats: ["audio/mpeg"],
      // `speaker` is optional (documented default: "luna") — not required.
      requiresVoice: false,
      // "aura-2-en" is the English-only endpoint id; Cloudflare's other
      // Aura-2 language variants are separate model ids, not a parameter of
      // this one, so only "en" is listed rather than inventing a broader set.
      supportedLanguages: ["en"],
      // maxAudioDurationSeconds intentionally omitted: not documented.
      // Every speaker id from Cloudflare's own Aura-2 documentation —
      // verified, not guessed. Validated by capability-validator.ts when a
      // caller supplies settings.voice.
      supportedVoices: [
        "amalthea", "andromeda", "apollo", "arcas", "aries", "asteria",
        "athena", "atlas", "aurora", "callista", "cora", "cordelia", "delia",
        "draco", "electra", "harmonia", "helena", "hera", "hermes",
        "hyperion", "iris", "janus", "juno", "jupiter", "luna", "mars",
        "minerva", "neptune", "odysseus", "ophelia", "orion", "orpheus",
        "pandora", "phoebe", "pluto", "saturn", "thalia", "theia", "vesta",
        "zeus",
      ],
    },
    defaults: { outputCount: 1 },
    enabled: true,
    isMock: false,
    cloudflareTextField: "text",
  },
];

/**
 * Gemini image models ("Nano Banana"), migrated into the orchestration
 * pipeline during Phase 5 production convergence.
 *
 * These already existed and already ran in production — inline, inside
 * src/app/api/generations/[generationId]/execute/route.ts, which owned the
 * whole generation lifecycle outside Temporal. Registering them here is what
 * lets that route delegate instead of executing, so the second lifecycle
 * owner can be retired without breaking the UI that calls its URL.
 *
 * Capabilities are copied from the per-model support tables in
 * src/lib/gemini/geminiModelMapping.ts rather than restated, so the registry
 * and the adapter cannot drift: image sizes come from IMAGE_SIZE_SUPPORT,
 * thinking support from SUPPORTS_THINKING_LEVEL, aspect ratios from
 * SUPPORTED_ASPECT_RATIOS.
 */
const GEMINI_MODELS: ModelRegistryEntry[] = (
  ["nano-banana-pro", "nano-banana-2", "nano-banana-2-lite"] as const
).map((id) => ({
  id,
  label:
    id === "nano-banana-pro"
      ? "Nano Banana Pro"
      : id === "nano-banana-2"
        ? "Nano Banana 2"
        : "Nano Banana 2 Lite",
  providerId: "gemini",
  providerModelId: getGeminiModelId(id),
  generationType: "image" as const,
  // Gemini accepts an optional reference image, which the legacy route
  // already forwarded when its MIME type was supported.
  supportedWorkflows: ["text-to-image", "image-to-image"] as const,
  executionMode: "sync" as const,
  acceptedInputMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  maxInputs: 1,
  capabilities: {
    supportedAspectRatios: [...SUPPORTED_ASPECT_RATIOS],
    supportedResolutions: [...IMAGE_SIZE_SUPPORT[id]],
    supportedDurationsSeconds: [],
    minOutputCount: 1,
    // interactions.create returns one image per call.
    maxOutputCount: 1,
    supportsThinking: SUPPORTS_THINKING_LEVEL[id],
    supportedThinkingValues: SUPPORTS_THINKING_LEVEL[id] ? ["low", "medium", "high"] : [],
    requiresPrompt: true,
    maxPromptLength: 10_000,
  },
  defaults: { aspectRatio: "1:1", resolution: IMAGE_SIZE_SUPPORT[id][0], outputCount: 1 },
  enabled: true,
  isMock: false,
}));

const REGISTRY: ReadonlyMap<string, ModelRegistryEntry> = new Map(
  [...MOCK_MODELS, ...FAL_MODELS, ...CLOUDFLARE_MODELS, ...GEMINI_MODELS].map((model) => [
    model.id,
    model,
  ])
);

/**
 * Returns the entry, or undefined when the model is not orchestratable.
 *
 * This is the single chokepoint every execution path goes through — the
 * orchestrator resolves the model here before any provider adapter is
 * reached. The blocked-model guard therefore lives here and nowhere else:
 * a permanently blocked id can never resolve to a runnable entry, no matter
 * which route, dev `?model=` override, or test tries it. See
 * lib/blockedModels.ts for why these are blocked. Do not weaken this to
 * "just try one once".
 */
export function findModel(modelId: string): ModelRegistryEntry | undefined {
  if (isBlockedModelId(modelId)) return undefined;
  return REGISTRY.get(modelId);
}

/** True when this model id is wired into the orchestration chain. */
export function isOrchestratableModel(modelId: string): boolean {
  if (isBlockedModelId(modelId)) return false;
  return REGISTRY.has(modelId);
}

export function listModels(): ModelRegistryEntry[] {
  return [...REGISTRY.values()].filter((model) => !isBlockedModelId(model.id));
}
