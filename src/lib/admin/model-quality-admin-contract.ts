/**
 * Phase 22-D Admin Model Quality dashboard contract — read-only.
 *
 * Mirrors `slo-cost-admin-contract.ts`'s own shape: this package computes
 * no second opinion about a score — every row is exactly what
 * `eval-store.ts`'s `latestCompletedRun()` (Phase 22-A/B, itself the same
 * read `eval-quality-provider.ts` gives the router) already returns.
 */

export interface ModelQualityRouteView {
  readonly routeId: string;
  readonly cinefieldModelId: string;
  readonly modelVersion: number;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly priority: number;
  readonly enabled: boolean;
  /** Null when no completed eval run exists yet for this provider/model pair. */
  readonly latestRun: {
    readonly runId: string;
    readonly evalSetKey: string;
    readonly evaluator: string;
    readonly completedAt: string | null;
    readonly caseCount: number;
    readonly failedCaseCount: number;
    readonly meanQualityScore: number | null;
    readonly meanLatencyScore: number | null;
    readonly meanSafetyScore: number | null;
  } | null;
}

export type ModelQualityAdminResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly routes: readonly ModelQualityRouteView[] };
