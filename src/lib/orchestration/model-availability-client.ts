/**
 * Runtime production availability, as the browser sees it (Phase 8).
 *
 * WHAT THIS IS NOT: a router. It reproduces no eligibility rule, reads no
 * route, and knows no provider. It fetches one product-level answer the server
 * already computed and caches it. Every decision below is about PRESENTATION —
 * whether to offer a model — and `POST /api/generate` re-derives eligibility
 * itself regardless of anything here.
 *
 * WHY A SHARED CACHE RATHER THAN A HOOK PER CALLER: two places need the same
 * answer — the model list, and the guard in front of Generate — and they must
 * never disagree. One in-flight promise, one result.
 *
 * Client-safe: no server-only import, no registry, no provider identity.
 */

export type RuntimeAvailability =
  /** The server says this model can run right now. */
  | "available"
  /** The server says it cannot. Product-level; no reason is published. */
  | "unavailable"
  /**
   * Runtime data has not resolved yet, or could not be fetched.
   *
   * NOT the same as unavailable, and deliberately not collapsed into it: the
   * server has not said no, we simply have not heard. The UI treats it
   * conservatively for models the server knows, and the generation boundary
   * decides for real either way.
   */
  | "checking";

/** The public shape this module reads. Product fields only. */
interface PublicAvailabilityRow {
  id: string;
  productionAvailable?: boolean;
}

let cache: Map<string, boolean> | null = null;
let inFlight: Promise<Map<string, boolean> | null> | null = null;

/** Test seam. Also used to invalidate after a route change in an admin flow. */
export function __resetModelAvailabilityCache(): void {
  cache = null;
  inFlight = null;
}

/** Test seam: inject a resolved snapshot without a network call. */
export function __setModelAvailabilityForTesting(
  snapshot: Map<string, boolean> | null
): void {
  cache = snapshot;
  inFlight = null;
}

/** What has been resolved so far, or null when nothing has. */
export function peekModelAvailability(): Map<string, boolean> | null {
  return cache;
}

/**
 * Fetches runtime availability once and shares the result.
 *
 * A failure resolves to null rather than throwing. Availability is a UX
 * refinement; it must never be able to break a page, and the server is still
 * the thing that decides whether work runs.
 */
export async function fetchModelAvailability(
  fetcher: typeof fetch = fetch
): Promise<Map<string, boolean> | null> {
  if (cache) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetcher("/api/models", { credentials: "same-origin" });
      if (!response.ok) return null;

      const body = (await response.json()) as { models?: PublicAvailabilityRow[] };
      const resolved = new Map<string, boolean>();
      for (const model of body.models ?? []) {
        if (typeof model.id === "string" && typeof model.productionAvailable === "boolean") {
          resolved.set(model.id, model.productionAvailable);
        }
      }
      cache = resolved;
      return resolved;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export interface AvailabilityInputs {
  /** True when the server registry knows this model at all. */
  isServerModel: boolean;
  /** The build-time baseline. Deploy-fixed; never the live answer on its own. */
  staticProductionReady: boolean;
  /** Resolved runtime answers, or null while unresolved/unavailable. */
  runtime: Map<string, boolean> | null;
}

/**
 * THE decision. One function, used by the model list and by the Generate
 * guard, so the two cannot drift.
 *
 * PRECEDENCE, and the order is the whole point:
 *
 *   1. A model the server does not know is left alone. Most cards in the
 *      picker are catalog art with no server-side model; they never reached
 *      the canonical path and this feature is not about them.
 *   2. STATIC false wins immediately. Execution durability cannot be fixed by
 *      a route change, so there is nothing runtime could say to rescue it —
 *      and answering without a round trip avoids a pointless "checking" flash.
 *   3. RUNTIME decides everything else. A model that is statically ready but
 *      whose last safe route was just disabled must read unavailable WITHOUT
 *      a rebuild, which is exactly what the build artifact cannot know.
 *   4. Unresolved runtime is "checking", never "available". Presenting a
 *      model as ready on the strength of a build artifact is the bug this
 *      correction exists to remove.
 */
export function resolveRuntimeAvailability(
  modelId: string,
  inputs: AvailabilityInputs
): RuntimeAvailability {
  if (!inputs.isServerModel) return "available";
  if (!inputs.staticProductionReady) return "unavailable";

  const runtimeAnswer = inputs.runtime?.get(modelId);
  if (runtimeAnswer === undefined) return "checking";
  return runtimeAnswer ? "available" : "unavailable";
}

/**
 * May this model be offered as normally generatable?
 *
 * Only a resolved "available" qualifies. "checking" does not — the honest
 * reading of "we have not heard yet" is not "yes".
 */
export function canOfferForGeneration(availability: RuntimeAvailability): boolean {
  return availability === "available";
}

/** Product-level label. Never a provider, never a reason. */
export function availabilityLabel(availability: RuntimeAvailability): string | null {
  if (availability === "unavailable") return "Unavailable";
  if (availability === "checking") return "Checking availability…";
  return null;
}
