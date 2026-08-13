import { PUBLIC_MODEL_CATALOG } from "./public-model-catalog";
import type { PublicModelDescriptor } from "./capability-projection";

/**
 * Client-safe view of the models wired into the Cinefield orchestration
 * pipeline.
 *
 * PHASE 7-F: THIS FILE NO LONGER KNOWS ANYTHING ON ITS OWN.
 * It used to be a hand-maintained map — sixteen entries repeating each
 * model's generation type and provider, under a comment asking whoever
 * touched it to "keep the ids in sync" with the server registry. That is a
 * second source of truth by construction, and the two only agreed as long as
 * nobody forgot. Everything below is now derived from the canonical
 * capability projection, which is derived from the one registry the server
 * validates against. Adding a model to the registry adds it here; there is
 * nothing left to forget.
 *
 * THE PROVIDER IS GONE, AND ITS ABSENCE IS THE POINT.
 * This module used to export `getOrchestrationProvider()`, so a browser could
 * state which provider a model runs on. It cannot any more: the projection
 * carries no provider identity, and the Phase 7-B router — server-side, from
 * the route table — is the only thing that decides where a generation runs.
 * A client sends a Cinefield model id and nothing else that names a
 * destination.
 *
 * Safe to import from a client component, and deliberately reads the
 * GENERATED catalog rather than the projection itself: evaluating the
 * projection in the browser would drag the registry — and every
 * providerModelId in it — into the bundle. See
 * scripts/generate-public-catalog.ts.
 */

const BY_ID: ReadonlyMap<string, PublicModelDescriptor> = new Map(
  PUBLIC_MODEL_CATALOG.map((model) => [model.id, model])
);

/** Every orchestratable model id. Derived, never listed. */
export const ORCHESTRATION_MODEL_IDS: string[] = PUBLIC_MODEL_CATALOG.map((model) => model.id);

/** The public capability descriptor for a model, or null when it has none. */
export function getPublicModel(modelId: string): PublicModelDescriptor | null {
  return BY_ID.get(modelId) ?? null;
}

/** True when this model executes through the orchestration pipeline. */
export function isOrchestrationModel(modelId: string): boolean {
  return BY_ID.has(modelId);
}

/**
 * Generation type for an orchestration model, or null if it is not one.
 *
 * Lets the browser present a self-consistent request. The server re-derives
 * this from the registry regardless of what arrives, so this is convenience,
 * never authority.
 */
export function getOrchestrationGenerationType(
  modelId: string
): "image" | "video" | "audio" | null {
  return BY_ID.get(modelId)?.generationType ?? null;
}

/**
 * Is this model production-ready as far as the SHIPPED CODE knows?
 *
 * The static half of availability: false when the model's provider has no
 * proven restart-safe execution, or no adapter in this deployment. Fixed at
 * deploy time, which is why a client may read it from the build artifact.
 *
 * NOT the whole answer, and never an authority. A statically ready model can
 * still have every route disabled in the database — `GET /api/models` gives
 * the live verdict — and `POST /api/generate` enforces the truth regardless of
 * what any client believes.
 */
export function isProductionReadyModel(modelId: string): boolean {
  return BY_ID.get(modelId)?.productionReady === true;
}

/**
 * True only for offline mock models — used to label a result honestly rather
 * than to decide anything.
 */
export function isMockOrchestrationModel(modelId: string): boolean {
  return BY_ID.get(modelId)?.isMock === true;
}
