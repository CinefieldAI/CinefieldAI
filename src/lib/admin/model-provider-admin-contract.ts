/**
 * Phase 16-B admin Models / Providers contract.
 *
 * ---------------------------------------------------------------------------
 * CATALOGUE STATE, NOT A RECOMPUTED ROUTING DECISION
 * ---------------------------------------------------------------------------
 * This surface reads the canonical Phase 7 catalogue tables
 * (`models`/`providers`/`provider_models`) verbatim -- `lifecycle`/
 * `enabled` flags already stored on each row. It deliberately does NOT
 * call `health-aware-router.ts`'s `loadRouteHealth`/circuit-breaker
 * snapshot to recompute live routing eligibility: doing so here would mean
 * a second place reimplementing (or subtly drifting from) the router's own
 * runtime decision -- exactly the "second routing evaluator" this phase is
 * bound not to become. This answers "what is configured and enabled," not
 * "what would be chosen right now" -- the latter remains the router's own,
 * unduplicated, runtime concern.
 *
 * ---------------------------------------------------------------------------
 * `model_routes` IS DELIBERATELY NOT READ HERE
 * ---------------------------------------------------------------------------
 * `admin-route-service.ts`'s `listRoutesForAdmin` is the one existing read
 * path for `model_routes`, and it is gated by the SEPARATE
 * `ROUTE_ADMIN_CLERK_USER_IDS` allowlist (`assertRouteAdmin`) on top of
 * Phase 16 admin access. Querying `model_routes` directly from this page --
 * even read-only -- would let any Phase 16 admin see route-level data
 * (enabled/priority/status) by visiting Models/Providers instead of
 * `/admin/router`, silently bypassing the boundary Phase 7-B deliberately
 * drew. Route-level detail belongs only to `/admin/router`
 * (`router-admin-service.ts`), which goes through `listRoutesForAdmin`
 * itself. This page shows `models`/`providers`/`provider_models` only --
 * none of which Phase 7-B gated behind route authority.
 */

export interface ModelCatalogueView {
  readonly modelId: string;
  readonly label: string;
  readonly generationType: string;
  readonly lifecycle: string;
}

export interface ProviderCatalogueView {
  readonly providerId: string;
  readonly label: string;
  readonly enabled: boolean;
}

export interface ProviderModelCatalogueView {
  readonly providerId: string;
  readonly providerModelId: string;
  readonly enabled: boolean;
}

export type ModelProviderAdminResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "FOUND";
      readonly models: readonly ModelCatalogueView[];
      readonly providers: readonly ProviderCatalogueView[];
      readonly providerModels: readonly ProviderModelCatalogueView[];
    };
