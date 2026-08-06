import type { GenerationType, WorkflowType } from "./types";

/**
 * Cinefield model registry — the single server-side source of truth for
 * orchestration.
 *
 * IMPORTANT: this registry is intentionally NOT a mirror of the model picker
 * in the UI. It contains only models the orchestration chain is allowed to
 * execute. In this first phase that is the three explicit mock entries below.
 * Real provider models (Gemini/Nano Banana, Kling, Seedance, Veo, …) are
 * deliberately absent, so the orchestrator refuses to run them rather than
 * silently redirecting them to the mock provider.
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
  maxPromptLength: number;
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

const REGISTRY: ReadonlyMap<string, ModelRegistryEntry> = new Map(
  [...MOCK_MODELS, ...FAL_MODELS].map((model) => [model.id, model])
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
