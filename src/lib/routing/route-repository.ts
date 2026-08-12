import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrchestrationError } from "@/lib/orchestration/errors";
import type { RouteCandidate } from "./route-types";

/**
 * Reads routing candidates from the durable source of truth (Phase 7-B).
 *
 * Server-only. These tables have RLS enabled with no permissive policy, so a
 * browser cannot reach them at all — this module runs with the service-role
 * client and is the only way routing data is read.
 *
 * ONE QUERY, ORDERED IN SQL. The ordering is part of the contract, not a
 * convenience: selection must be deterministic, and sorting in JavaScript
 * after an unordered fetch would make the winner depend on however PostgreSQL
 * happened to return rows that day.
 */

/** The shape PostgREST returns for the joined select below. */
interface RouteRow {
  id: string;
  model_id: string;
  priority: number;
  enabled: boolean;
  status: string;
  model_versions: { id: string; version: number; status: string } | null;
  provider_models: {
    id: string;
    provider_model_id: string;
    enabled: boolean;
    providers: { id: string; enabled: boolean } | null;
  } | null;
  models: { lifecycle: string } | null;
}

/**
 * Every route declared for a Cinefield model, ordered deterministically.
 *
 * Returns candidates INCLUDING ineligible ones. The router filters them and
 * records why each was rejected — a "no eligible route" that cannot say
 * whether the provider was disabled or the route was never enabled is an
 * operational dead end at exactly the moment someone is debugging an outage.
 *
 * TIE-BREAK IS IN THE ORDER BY. Priority decides first; when two routes share
 * one, the provider model id breaks the tie alphabetically, and the route id
 * breaks that. Both fallbacks are stable, total orderings over immutable
 * values, so the same route state always yields the same winner.
 */
export async function listRouteCandidates(
  admin: SupabaseClient,
  cinefieldModelId: string,
  modelVersion?: number
): Promise<RouteCandidate[]> {
  const query = admin
    .from("model_routes")
    .select(
      `id, model_id, priority, enabled, status,
       models ( lifecycle ),
       model_versions ( id, version, status ),
       provider_models ( id, provider_model_id, enabled, providers ( id, enabled ) )`
    )
    .eq("model_id", cinefieldModelId)
    .order("priority", { ascending: false })
    .order("provider_model_id", { ascending: true, referencedTable: "provider_models" })
    .order("id", { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { operation: "listRouteCandidates", cinefieldModelId },
    });
  }

  const rows = (data ?? []) as unknown as RouteRow[];

  const candidates = rows
    // A route whose joins did not resolve is corrupt, not a candidate. The
    // foreign keys make this impossible in practice; dropping it rather than
    // throwing keeps one bad row from taking down every other route.
    .filter((row) => row.model_versions !== null && row.provider_models?.providers != null)
    .map<RouteCandidate>((row) => ({
      routeId: row.id,
      cinefieldModelId: row.model_id,
      modelVersionId: row.model_versions!.id,
      modelVersion: row.model_versions!.version,
      providerId: row.provider_models!.providers!.id,
      providerModelId: row.provider_models!.provider_model_id,
      priority: row.priority,
      enabled: row.enabled,
      routeStatus: row.status,
      providerEnabled: row.provider_models!.providers!.enabled,
      providerModelEnabled: row.provider_models!.enabled,
      modelLifecycle: row.models?.lifecycle ?? "active",
      modelVersionStatus: row.model_versions!.status,
    }))
    .filter((candidate) => modelVersion === undefined || candidate.modelVersion === modelVersion);

  // Re-assert the ordering in memory. PostgREST orders referenced tables
  // independently of the parent, so the SQL ordering above is necessary but
  // not sufficient for a total order across the joined shape. This is a
  // deterministic sort over values already fetched, not a substitute for it.
  return candidates.sort(compareRoutes);
}

/**
 * THE deterministic ordering. Exported so the router and its tests share one
 * definition rather than two that can drift.
 *
 * Highest priority first, then provider model id, then route id. The last two
 * are arbitrary but STABLE and TOTAL — which is the only property that
 * matters for a tie-break, and the property random selection would destroy.
 */
export function compareRoutes(a: RouteCandidate, b: RouteCandidate): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.providerModelId !== b.providerModelId) {
    return a.providerModelId < b.providerModelId ? -1 : 1;
  }
  if (a.routeId !== b.routeId) return a.routeId < b.routeId ? -1 : 1;
  return 0;
}
