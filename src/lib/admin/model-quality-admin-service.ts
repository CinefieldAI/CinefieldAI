import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { latestCompletedRun } from "@/lib/eval/eval-store";
import type { ModelQualityAdminResult, ModelQualityRouteView } from "./model-quality-admin-contract";

/**
 * The Phase 22-D admin Model Quality read service.
 *
 * A PLAIN READ, NOT A SECOND ROUTE AUTHORITY. `listRoutesForAdmin`
 * (Phase 7-B, `admin-route-service.ts`) is the route-MUTATION reader and
 * calls `assertRouteAdmin()` — Phase 7's own separate allowlist, deliberate
 * for a screen that can change traffic. This dashboard changes nothing, so
 * it queries `model_routes` directly with the same explicit-columns shape
 * rather than requiring every quality-dashboard viewer to also hold route
 * authority, matching the ambient Phase 16 admin gate `/admin/slo-cost`
 * already uses for its own read-only report.
 */
export async function getModelQualityAdminView(admin: SupabaseClient): Promise<ModelQualityAdminResult> {
  try {
    const { data, error } = await admin
      .from("model_routes")
      .select(
        `id, model_id, priority, enabled,
         model_versions ( version ),
         provider_models ( provider_id, provider_model_id )`
      )
      .order("model_id", { ascending: true })
      .order("priority", { ascending: false });

    if (error) return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "route_read_failed" };

    const rows = (data ?? []) as unknown as {
      id: string;
      model_id: string;
      priority: number;
      enabled: boolean;
      model_versions: { version: number } | null;
      provider_models: { provider_id: string; provider_model_id: string } | null;
    }[];

    const routes: ModelQualityRouteView[] = [];
    for (const row of rows) {
      if (!row.provider_models) continue;
      const run = await latestCompletedRun(admin, row.provider_models.provider_id, row.provider_models.provider_model_id);
      routes.push({
        routeId: row.id,
        cinefieldModelId: row.model_id,
        modelVersion: row.model_versions?.version ?? 0,
        providerId: row.provider_models.provider_id,
        providerModelId: row.provider_models.provider_model_id,
        priority: row.priority,
        enabled: row.enabled,
        latestRun: run
          ? {
              runId: run.runId,
              evalSetKey: run.evalSetKey,
              evaluator: run.evaluator,
              completedAt: run.completedAt,
              caseCount: run.caseCount,
              failedCaseCount: run.failedCaseCount,
              meanQualityScore: run.meanScores.quality_score ?? null,
              meanLatencyScore: null,
              meanSafetyScore: run.meanScores.safety_score ?? null,
            }
          : null,
      });
    }

    return { outcome: "FOUND", routes };
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "model_quality_read_failed" };
  }
}
