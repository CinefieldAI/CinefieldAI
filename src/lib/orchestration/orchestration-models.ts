/**
 * Client-safe descriptor of the models wired into the Cinefield
 * orchestration pipeline.
 *
 * This module is deliberately free of server-only imports so the browser can
 * decide whether a given modelId should be executed via
 * POST /api/orchestration/execute. The authoritative definitions live in
 * model-registry.ts (server-only); the ids here must stay in sync with it.
 *
 * Architectural rule: model buttons are pure selectors. Adding a model means
 * one entry here plus one in the server registry — never a new API route,
 * generate handler, or provider-specific branch.
 *
 * None of these ids collide with the visible model catalog, so no existing
 * model card can be routed to an orchestration provider by accident.
 */

export type OrchestrationProviderId = "mock" | "fal";

interface OrchestrationModelDescriptor {
  generationType: "image" | "video" | "audio";
  provider: OrchestrationProviderId;
  /** True for offline development models that never call an external API. */
  isMock: boolean;
}

const ORCHESTRATION_MODELS: Record<string, OrchestrationModelDescriptor> = {
  "mock-image": { generationType: "image", provider: "mock", isMock: true },
  "mock-image-edit": { generationType: "image", provider: "mock", isMock: true },
  "mock-video": { generationType: "video", provider: "mock", isMock: true },
  "mock-tts": { generationType: "audio", provider: "mock", isMock: true },
  "fal-flux-schnell": { generationType: "image", provider: "fal", isMock: false },
};

export const ORCHESTRATION_MODEL_IDS = Object.keys(ORCHESTRATION_MODELS);

/** True when this model executes through the orchestration pipeline. */
export function isOrchestrationModel(modelId: string): boolean {
  return Object.prototype.hasOwnProperty.call(ORCHESTRATION_MODELS, modelId);
}

/**
 * Generation type for an orchestration model, or null if it is not one. Lets
 * the browser insert a row that is self-consistent with the server registry;
 * the registry remains authoritative at execution time.
 */
export function getOrchestrationGenerationType(
  modelId: string
): "image" | "video" | "audio" | null {
  return ORCHESTRATION_MODELS[modelId]?.generationType ?? null;
}

/** Provider id for an orchestration model, or null if it is not one. */
export function getOrchestrationProvider(modelId: string): OrchestrationProviderId | null {
  return ORCHESTRATION_MODELS[modelId]?.provider ?? null;
}

/** True only for offline mock models — used to label results honestly. */
export function isMockOrchestrationModel(modelId: string): boolean {
  return ORCHESTRATION_MODELS[modelId]?.isMock === true;
}
