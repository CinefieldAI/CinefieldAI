/**
 * Phase 22-D Admin Model Quality dashboard contract — read-only.
 *
 * Mirrors `slo-cost-admin-contract.ts`'s own shape: this package computes
 * no second opinion about a score — every row is exactly what
 * `eval-store.ts`'s `latestCompletedRun()` (Phase 22-A/B, itself the same
 * read `eval-quality-provider.ts` gives the router) already returns.
 */

/**
 * A simple measured metric (quality, safety). `NO_EVIDENCE` when no case in
 * the run measured this dimension — never a fabricated zero (Phase 22
 * corrective batch, section 7-9).
 */
export type QualityMetricState =
  | { readonly state: "AVAILABLE"; readonly value: number }
  | { readonly state: "NO_EVIDENCE" };

/**
 * Latency, reported in milliseconds. Same NO_EVIDENCE discipline as
 * QualityMetricState — kept as its own type so a unit mismatch (score vs.
 * milliseconds) cannot compile if the two are ever swapped by accident.
 */
export type LatencyMetricState =
  | { readonly state: "AVAILABLE"; readonly valueMs: number }
  | { readonly state: "NO_EVIDENCE" };

/**
 * Cost cannot be averaged across currencies — MIXED_CURRENCY is reported
 * honestly rather than silently blending units (eval-store.ts's
 * `CostSummary`, read through verbatim, never recomputed here).
 *
 * A route with no completed run at all (`latestRun: null`, below) is the
 * corrective brief's fourth state, UNAVAILABLE, realized once at the route
 * level rather than duplicated on every metric — a metric can only be
 * NO_EVIDENCE/MIXED_CURRENCY/AVAILABLE once a run exists to read from.
 */
export type CostMetricState =
  | { readonly state: "AVAILABLE"; readonly value: number; readonly currency: string }
  | { readonly state: "NO_EVIDENCE" }
  | { readonly state: "MIXED_CURRENCY" };

export interface ModelQualityRouteView {
  readonly routeId: string;
  readonly cinefieldModelId: string;
  readonly modelVersion: number;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly priority: number;
  readonly enabled: boolean;
  /** Null when no completed eval run exists yet for this provider/model pair — the route-level UNAVAILABLE state. */
  readonly latestRun: {
    readonly runId: string;
    readonly evalSetKey: string;
    readonly evaluator: string;
    readonly completedAt: string | null;
    readonly caseCount: number;
    readonly failedCaseCount: number;
    readonly quality: QualityMetricState;
    readonly latency: LatencyMetricState;
    readonly safety: QualityMetricState;
    readonly cost: CostMetricState;
    /** Null when this run's evidence has no known manifest/compiler lineage — see eval-store.ts's EvalRunSummary. */
    readonly manifestVersion: string | null;
    readonly compilerVersion: string | null;
  } | null;
}

/**
 * Whether the golden dataset is even large enough for Phase 7's own
 * `DEFAULT_QUALITY_POLICY.minSamples` bar (route-quality.ts) — independent
 * of whether any evaluator is in `trustedEvaluators` yet. Computed from the
 * real dataset/policy, never a hardcoded guess, so it cannot silently rot
 * out of sync if either changes (Phase 22 corrective batch, section 17).
 * `datasetCaseCount < minSamplesForRoutingConfidence` is expected and
 * normal today — this is what makes the distinction honest rather than
 * alarming.
 */
export interface EvidenceScale {
  readonly datasetCaseCount: number;
  readonly minSamplesForRoutingConfidence: number;
  readonly label: "CI_EVAL_EVIDENCE" | "PRODUCTION_ROUTING_CONFIDENT";
}

export type ModelQualityAdminResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly routes: readonly ModelQualityRouteView[]; readonly evidenceScale: EvidenceScale };
