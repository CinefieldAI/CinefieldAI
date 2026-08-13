import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listRouteCandidates } from "@/lib/routing/route-repository";
import { rejectionFor } from "@/lib/routing/model-router";
import { getProviderAdapter, isProviderRegistered } from "@/lib/orchestration/provider-registry";
import { isProductionDurable } from "@/lib/orchestration/providers/provider-capabilities";
import { listModels, type ModelRegistryEntry } from "./model-registry";

/**
 * Can a client be offered this model for a real generation? (Phase 8)
 *
 * THE GAP THIS CLOSES. The server has been fail-closed since the durability
 * gate landed: a model whose only routes are production-ineligible cannot
 * create a generation. The CATALOG did not know that, so /generate kept
 * offering nano-banana while `POST /api/generate` refused it — a product that
 * looks broken rather than one that is honest about what it can do.
 *
 * ONE SOURCE OF ELIGIBILITY TRUTH. This does not re-implement a single check.
 * It calls `listRouteCandidates` and `rejectionFor` — the exact functions the
 * router uses — so availability cannot drift from routing. A second
 * "is this usable" implementation is how a catalog eventually disagrees with
 * the thing it describes.
 *
 * WHAT THE CLIENT LEARNS: a product-level state, and nothing else. No
 * provider, no endpoint, no route id, no priority, no score, no breaker state,
 * no durability enum. Those are internal facts; the answer to "can I use this"
 * is not.
 *
 * NOT A SECURITY BOUNDARY. `POST /api/generate` remains the enforcement point.
 * This exists so the UI can be honest, not so the server can trust it.
 */

export type ModelAvailability =
  /** At least one route can run this model right now. */
  | "available"
  /**
   * Routes exist and are structurally fine, but every one is currently
   * excluded by something that heals on its own — an open circuit breaker, an
   * operator's runtime disable. Worth showing differently from a model that
   * simply cannot run.
   */
  | "temporarily_unavailable"
  /**
   * No route can ever run this model as things stand: no routes at all, or
   * every one blocked by a structural fact like unproven execution
   * durability. An operator has to change something.
   */
  | "not_production_ready";

export interface ModelAvailabilityResult {
  modelId: string;
  availability: ModelAvailability;
  /**
   * Internal only — the typed rejection reasons behind the verdict, for logs
   * and the admin surface. NEVER serialized to a browser; the public route
   * strips this.
   */
  internalReasons: string[];
}

/**
 * The STATIC half of availability, computable without a database.
 *
 * Execution durability is a property of the adapter — it ships with the
 * deploy and cannot change at runtime — so "this model's provider is not
 * production-durable" is knowable at build time. That is what lets the
 * generated catalog carry an honest flag without pretending a build artifact
 * knows live route state.
 *
 * Deliberately NOT the whole answer. A model can be statically fine and still
 * have every route disabled in the database, which only the runtime check
 * below can see.
 */
export function isStaticallyProductionReady(entry: ModelRegistryEntry): boolean {
  if (!entry.enabled) return false;
  if (!isProviderRegistered(entry.providerId)) return false;
  return isProductionDurable(
    getProviderAdapter(entry.providerId).capabilities.productionExecutionDurability
  );
}

/** Structural rejections — an operator must act; nothing heals on its own. */
const STRUCTURAL_REASONS: ReadonlySet<string> = new Set([
  "provider_execution_not_restart_safe",
  "provider_not_registered",
  "route_disabled",
  "route_not_active",
  "provider_disabled",
  "provider_model_disabled",
  "model_lifecycle_disabled",
  "model_version_not_usable",
]);

/**
 * Live availability for one model, derived from the real route table.
 *
 * Runs HARD eligibility only — `rejectionFor`, the same conjunction the router
 * applies first. Health and the circuit breaker are deliberately NOT consulted
 * here: a catalog that flickers with every transient error rate would be
 * unusable, and the distinction the product needs is "can this run at all",
 * not "is it fast this second". Routes excluded by a breaker still count as
 * structurally present, which is exactly why `temporarily_unavailable` exists
 * as a separate state for the runtime layer to fill in later if it ever needs
 * to.
 */
export async function resolveModelAvailability(
  admin: SupabaseClient,
  modelId: string
): Promise<ModelAvailabilityResult> {
  const candidates = await listRouteCandidates(admin, modelId);

  if (candidates.length === 0) {
    return { modelId, availability: "not_production_ready", internalReasons: ["no_routes"] };
  }

  const reasons: string[] = [];
  for (const candidate of candidates) {
    const rejection = rejectionFor(candidate);
    if (!rejection) {
      return { modelId, availability: "available", internalReasons: [] };
    }
    reasons.push(rejection);
  }

  // Nothing passed. If every reason is structural the model cannot run until
  // someone changes configuration or proves an integration; anything else is
  // treated as the softer state.
  const allStructural = reasons.every((reason) => STRUCTURAL_REASONS.has(reason));
  return {
    modelId,
    availability: allStructural ? "not_production_ready" : "temporarily_unavailable",
    internalReasons: reasons,
  };
}

/**
 * Availability for the whole catalog.
 *
 * A read failure degrades to the STATIC answer rather than claiming
 * everything works. That direction matters: overstating availability puts a
 * user in front of a model that will refuse them, while understating it only
 * hides something temporarily.
 */
export async function resolveCatalogAvailability(
  admin: SupabaseClient
): Promise<Map<string, ModelAvailabilityResult>> {
  const results = new Map<string, ModelAvailabilityResult>();

  await Promise.all(
    listModels().map(async (entry) => {
      // Static exclusion is decisive and needs no query: an undurable provider
      // is undurable whatever the route table says.
      if (!isStaticallyProductionReady(entry)) {
        results.set(entry.id, {
          modelId: entry.id,
          availability: "not_production_ready",
          internalReasons: ["static_provider_not_production_durable"],
        });
        return;
      }

      try {
        results.set(entry.id, await resolveModelAvailability(admin, entry.id));
      } catch {
        results.set(entry.id, {
          modelId: entry.id,
          availability: "temporarily_unavailable",
          internalReasons: ["availability_lookup_failed"],
        });
      }
    })
  );

  return results;
}
