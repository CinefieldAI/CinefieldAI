import { listModels, type ModelRegistryEntry } from "./model-registry";
import type { GenerationType, WorkflowType } from "./types";

/**
 * Public-safe capability projection (Phase 7-F).
 *
 * ONE SOURCE OF TRUTH, TWO AUDIENCES. The server validates a generation
 * request against `ModelRegistryEntry.capabilities`; the browser renders its
 * controls from the projection below, which is DERIVED from the very same
 * entry. They cannot disagree about what a model supports, because there is
 * only one place that knows.
 *
 * That is the whole point. Today the UI carries its own opinion — "if the
 * model is nano-banana-2-lite then the resolution list is 1K" — and the
 * server carries another. When those drift, a user picks a setting the UI
 * offered and the server rejects it, which reads as a bug in the product
 * rather than in the duplication.
 *
 * WHAT IS DELIBERATELY NOT PROJECTED
 *   providerId, providerModelId   where it runs is not the client's business
 *   route priority, cost, health  routing concerns; see src/lib/routing/
 *   fal/cloudflare adapter hints  provider-shaped implementation detail
 *   isMock                        an execution property, not a capability
 *
 * The omissions are enforced by construction: this file builds a new object
 * field by field rather than spreading the registry entry, so a field added
 * to the registry is never exposed by accident.
 *
 * No "server-only" import: this module is meant to be reachable from a client
 * bundle, and everything it can reach is already public-safe.
 */

export interface PublicModelCapabilities {
  aspectRatios: string[];
  resolutions: string[];
  durationsSeconds: number[];
  minOutputCount: number;
  maxOutputCount: number;
  supportsThinking: boolean;
  thinkingValues: string[];
  requiresPrompt: boolean;
  maxPromptLength?: number;
  /** Audio-only; absent for other modalities rather than empty. */
  audioFormats?: string[];
  languages?: string[];
  voices?: string[];
  requiresVoice?: boolean;
  maxAudioDurationSeconds?: number;
}

export interface PublicModelDescriptor {
  /** The Cinefield model id — the ONLY identity a client ever sends. */
  id: string;
  label: string;
  generationType: GenerationType;
  supportedWorkflows: WorkflowType[];
  acceptedInputMimeTypes: string[];
  maxInputs: number;
  /**
   * True for offline development models that never reach a real provider.
   *
   * This is NOT provider identity — it names no provider, endpoint, cost or
   * route. It is published because the browser already tells the user "no
   * real AI provider was used" after a mock run, and that sentence has to be
   * driven by the same source as the run itself. Keeping it out would mean
   * the client re-deriving it from a hand-maintained list, which is the exact
   * duplication this projection exists to end.
   */
  isMock: boolean;
  capabilities: PublicModelCapabilities;
  defaults: {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    outputCount: number;
  };
}

/** Drops undefined keys so an absent capability is absent, not null. */
function optional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : value;
}

export function projectModel(entry: ModelRegistryEntry): PublicModelDescriptor {
  const c = entry.capabilities;
  return {
    id: entry.id,
    label: entry.label,
    generationType: entry.generationType,
    supportedWorkflows: [...entry.supportedWorkflows],
    acceptedInputMimeTypes: [...entry.acceptedInputMimeTypes],
    maxInputs: entry.maxInputs,
    isMock: entry.isMock,
    capabilities: {
      aspectRatios: [...c.supportedAspectRatios],
      resolutions: [...c.supportedResolutions],
      durationsSeconds: [...c.supportedDurationsSeconds],
      minOutputCount: c.minOutputCount,
      maxOutputCount: c.maxOutputCount,
      supportsThinking: c.supportsThinking,
      thinkingValues: [...c.supportedThinkingValues],
      requiresPrompt: c.requiresPrompt,
      ...(optional(c.maxPromptLength) !== undefined ? { maxPromptLength: c.maxPromptLength } : {}),
      ...(c.supportedAudioFormats ? { audioFormats: [...c.supportedAudioFormats] } : {}),
      ...(c.supportedLanguages ? { languages: [...c.supportedLanguages] } : {}),
      ...(c.supportedVoices ? { voices: [...c.supportedVoices] } : {}),
      ...(c.requiresVoice !== undefined ? { requiresVoice: c.requiresVoice } : {}),
      ...(c.maxAudioDurationSeconds !== undefined
        ? { maxAudioDurationSeconds: c.maxAudioDurationSeconds }
        : {}),
    },
    defaults: { ...entry.defaults },
  };
}

/**
 * Every model a client may legitimately choose.
 *
 * Disabled models are excluded — offering a control the server will refuse is
 * worse than not offering it. `listModels()` already drops permanently
 * blocked ids.
 */
export function projectCatalog(): PublicModelDescriptor[] {
  return listModels()
    .filter((entry) => entry.enabled)
    .map(projectModel)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One model's projection, or null when the id is not offerable. */
export function projectModelById(modelId: string): PublicModelDescriptor | null {
  return projectCatalog().find((model) => model.id === modelId) ?? null;
}
