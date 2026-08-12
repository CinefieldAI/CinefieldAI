import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isProviderRegistered } from "@/lib/orchestration/provider-registry";
import { compareRoutes, listRouteCandidates } from "./route-repository";
import type {
  RouteCandidate,
  RouteRejectionReason,
  RouteRequest,
  RouteResolution,
} from "./route-types";

/**
 * Cinefield Production Model Router — static priority (Phase 7-B).
 *
 * Answers ONE question: given a Cinefield model, where should this generation
 * run? It does not create anything, does not call a provider, does not start
 * or own a workflow, and does not decide when an attempt exists. Temporal
 * remains the sole lifecycle owner; the router hands it a destination and
 * steps out of the way.
 *
 * DETERMINISTIC, AND THAT IS THE FEATURE
 * Same input plus same route state always yields the same provider. No
 * randomness, no round-robin, no load balancing, no health input, no cost
 * comparison — all of that is Phase 7-C and its absence here is deliberate.
 * A router that picks differently on two identical requests makes every
 * downstream bug irreproducible, and "it worked when I tried it" is not a
 * debugging strategy for something that spends money.
 *
 * ELIGIBILITY IS A CONJUNCTION, AND EVERY REJECTION IS RECORDED
 * A route is usable only if the route is enabled and active, its provider is
 * enabled, its provider model is enabled, its model version is usable, the
 * model is not disabled, and the provider actually has a registered adapter
 * in this process. When nothing survives, the caller gets the reason for each
 * candidate rather than a bare failure — because the operational question is
 * never "did it fail", it is "which switch is off".
 *
 * THE LAST CHECK IS NOT REDUNDANT. A route can point at a provider the
 * running code has no adapter for: the database is edited by operators, the
 * adapter registry ships with a deploy, and those two move at different
 * speeds. Selecting such a route would fail later, deeper, and with a worse
 * error than refusing it here.
 */

function rejectionFor(candidate: RouteCandidate): RouteRejectionReason | null {
  if (!candidate.enabled) return "route_disabled";
  if (candidate.routeStatus !== "active") return "route_not_active";
  if (candidate.modelLifecycle === "disabled") return "model_lifecycle_disabled";
  if (candidate.modelVersionStatus === "disabled" || candidate.modelVersionStatus === "deprecated") {
    return "model_version_not_usable";
  }
  if (!candidate.providerEnabled) return "provider_disabled";
  if (!candidate.providerModelEnabled) return "provider_model_disabled";
  if (!isProviderRegistered(candidate.providerId)) return "provider_not_registered";
  return null;
}

/**
 * Selects a route from an already-fetched candidate list.
 *
 * Split out from the database read so the selection rule itself is a pure
 * function: it can be tested exhaustively without a database, and the
 * database test can focus on the query rather than on the policy.
 */
export function selectRoute(
  cinefieldModelId: string,
  candidates: RouteCandidate[]
): RouteResolution {
  const rejected: { routeId: string; reason: RouteRejectionReason }[] = [];
  const eligible: RouteCandidate[] = [];

  for (const candidate of candidates) {
    const reason = rejectionFor(candidate);
    if (reason) rejected.push({ routeId: candidate.routeId, reason });
    else eligible.push(candidate);
  }

  if (eligible.length === 0) {
    return { outcome: "no_eligible_route", cinefieldModelId, rejected };
  }

  // Sorted here as well as in SQL. The pure function must not depend on its
  // caller having ordered the input correctly — that is exactly the kind of
  // implicit precondition that turns into a routing bug.
  const winner = [...eligible].sort(compareRoutes)[0];

  const contested = eligible.filter((c) => c.priority === winner.priority).length > 1;

  return {
    outcome: "selected",
    selection: {
      cinefieldModelId: winner.cinefieldModelId,
      modelVersionId: winner.modelVersionId,
      modelVersion: winner.modelVersion,
      providerId: winner.providerId,
      providerModelId: winner.providerModelId,
      routeId: winner.routeId,
      priority: winner.priority,
      selectionReason: contested
        ? `static_priority_${winner.priority}_stable_tie_break`
        : `static_priority_${winner.priority}`,
    },
  };
}

/**
 * Resolves where a generation should run.
 *
 * `request` carries a Cinefield model id and nothing that names a provider —
 * see RouteRequest. Whatever a caller sends, it cannot choose a destination.
 */
export async function resolveRoute(
  admin: SupabaseClient,
  request: RouteRequest
): Promise<RouteResolution> {
  const candidates = await listRouteCandidates(
    admin,
    request.cinefieldModelId,
    request.modelVersion
  );
  return selectRoute(request.cinefieldModelId, candidates);
}
