import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ModelCatalogueView,
  ModelProviderAdminResult,
  ProviderCatalogueView,
  ProviderModelCatalogueView,
} from "./model-provider-admin-contract";

/**
 * The Phase 16-B admin Models / Providers read service.
 *
 * Three narrow, explicit-column, concurrent reads against the canonical
 * Phase 7 catalogue tables -- `models`, `providers`, `provider_models` --
 * and nothing else. No `.insert(`, `.update(`, `.upsert(`, or `.delete(`
 * exists anywhere in this file. See the contract's header for why
 * `model_routes` is deliberately not read here.
 */
export async function getAdminModelProviderView(admin: SupabaseClient): Promise<ModelProviderAdminResult> {
  let modelsRow, providersRow, providerModelsRow;
  try {
    [modelsRow, providersRow, providerModelsRow] = await Promise.all([
      admin.from("models").select("id, label, generation_type, lifecycle").order("id", { ascending: true }),
      admin.from("providers").select("id, label, enabled").order("id", { ascending: true }),
      admin
        .from("provider_models")
        .select("provider_id, provider_model_id, enabled")
        .order("provider_id", { ascending: true }),
    ]);
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "read_failed" };
  }

  if (modelsRow.error || providersRow.error || providerModelsRow.error) {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "read_failed" };
  }

  const models: ModelCatalogueView[] = ((modelsRow.data ?? []) as Record<string, unknown>[]).map((row) => ({
    modelId: row.id as string,
    label: row.label as string,
    generationType: row.generation_type as string,
    lifecycle: row.lifecycle as string,
  }));

  const providers: ProviderCatalogueView[] = ((providersRow.data ?? []) as Record<string, unknown>[]).map((row) => ({
    providerId: row.id as string,
    label: row.label as string,
    enabled: row.enabled as boolean,
  }));

  const providerModels: ProviderModelCatalogueView[] = ((providerModelsRow.data ?? []) as Record<string, unknown>[]).map(
    (row) => ({
      providerId: row.provider_id as string,
      providerModelId: row.provider_model_id as string,
      enabled: row.enabled as boolean,
    })
  );

  return { outcome: "FOUND", models, providers, providerModels };
}
