/**
 * Client-safe list of Cinefield mock orchestration model ids.
 *
 * This module is intentionally free of server-only imports so the browser
 * can decide whether to call /api/orchestration/execute. The authoritative
 * definitions live in model-registry.ts (server-only); these ids must stay
 * in sync with the mock entries there.
 *
 * No production model picker entry uses these ids, so real models can never
 * be routed to the mock provider by accident.
 */
export const MOCK_ORCHESTRATION_MODEL_IDS = [
  "mock-image",
  "mock-image-edit",
  "mock-video",
] as const;

export type MockOrchestrationModelId = (typeof MOCK_ORCHESTRATION_MODEL_IDS)[number];

export function isMockOrchestrationModel(modelId: string): boolean {
  return (MOCK_ORCHESTRATION_MODEL_IDS as readonly string[]).includes(modelId);
}

/**
 * Generation type per mock model, so the browser can write a row that is
 * self-consistent with the server-side registry. The registry remains the
 * authority at execution time; this only keeps the inserted row honest.
 */
const MOCK_MODEL_GENERATION_TYPES: Record<MockOrchestrationModelId, "image" | "video"> = {
  "mock-image": "image",
  "mock-image-edit": "image",
  "mock-video": "video",
};

export function getMockModelGenerationType(modelId: string): "image" | "video" | null {
  return isMockOrchestrationModel(modelId)
    ? MOCK_MODEL_GENERATION_TYPES[modelId as MockOrchestrationModelId]
    : null;
}

/** Provider id every mock model routes to. */
export const MOCK_PROVIDER_ID = "mock";
