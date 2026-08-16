import type { FlagTargetKind } from "@/lib/routing/runtime-flags";
import type { CostObservation } from "./cost-contract";
import type { BudgetEvaluation, BudgetResolution, BudgetScope, CostBudget } from "./cost-budget";

/**
 * Cost guard decision and protection recommendation (Phase 15-B/1).
 *
 * Pure. Takes a bounded cost observation and a budget evaluation, returns what
 * it thinks and what it would suggest. It changes nothing.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE RECOMMENDS. IT DOES NOT ACT.
 * ---------------------------------------------------------------------------
 * It never calls `setRoutingControl`, `clearRoutingControl` or
 * `setRuntimeRoutingControl`; it never writes a runtime flag; it never
 * disables a provider or a model. Phase 7 owns routing control, and the
 * question "may an automated cost signal take a provider offline unattended?"
 * has not been answered by anyone yet. Wiring the mutation now would answer it
 * by accident, in the direction that is hardest to reverse, on the strength of
 * ESTIMATED cost — because no observed provider spend is recorded anywhere in
 * this system today.
 *
 * So the output names a Phase 7 target and stops. An operator, or a later
 * batch that has been given an explicit decision, applies it.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT A FEATURE FLAG SYSTEM
 * ---------------------------------------------------------------------------
 * No percentage rollout, no canary, no segmentation, no progressive delivery,
 * no generic runtime config. Phase 21 owns that. The only vocabulary borrowed
 * from Phase 7 is `FlagTargetKind`, reused as a type so a recommendation can
 * only ever name a target the existing control mechanism already understands —
 * a second target taxonomy is exactly how two subsystems end up disagreeing
 * about what "provider-model" means.
 */

/**
 * What the guard concluded.
 *
 * Four values, not six: the three ways of not knowing (UNKNOWN_COST,
 * UNAVAILABLE, INVALID) collapse into one UNKNOWN decision because they all
 * mean the same thing to a caller deciding whether to spend money. The
 * distinction between them is preserved in `reasonCode` for whoever has to fix
 * the cause.
 */
export type CostDecision = "ALLOW" | "AT_RISK" | "BUDGET_EXHAUSTED" | "UNKNOWN";

/**
 * What the guard would suggest doing about it.
 *
 * `RECOMMEND_ROUTE_EXCLUSION` is reserved: Phase 7 supports a `route` control
 * target, but no 15-B budget scope is per-route, so nothing in this batch
 * produces it. It stays in the union so the successor batch that adds
 * route-scoped budgets extends the registry rather than this vocabulary.
 */
export type CostRecommendation =
  | "NONE"
  | "RECOMMEND_ROUTE_EXCLUSION"
  | "RECOMMEND_PROVIDER_EXCLUSION"
  | "RECOMMEND_PROVIDER_MODEL_EXCLUSION"
  | "HUMAN_REVIEW_REQUIRED";

/** Every value a `CostGuardResult.recommendation` may hold. Bounded by test. */
export const COST_RECOMMENDATIONS: readonly CostRecommendation[] = [
  "NONE",
  "RECOMMEND_ROUTE_EXCLUSION",
  "RECOMMEND_PROVIDER_EXCLUSION",
  "RECOMMEND_PROVIDER_MODEL_EXCLUSION",
  "HUMAN_REVIEW_REQUIRED",
];

/**
 * The Phase 7 target a recommendation refers to.
 *
 * `kind` is Phase 7's own `FlagTargetKind`. This is a description of a target,
 * not a control: it carries no reason, no timestamp and no author, because
 * those are properties of a control that has been SET, and nothing here sets
 * one.
 */
export interface RecommendedTarget {
  readonly kind: FlagTargetKind;
  readonly id: string;
}

export interface CostGuardResult {
  readonly budgetId: string;
  readonly scope: BudgetScope;
  readonly decision: CostDecision;
  readonly recommendation: CostRecommendation;
  /** Present only when the recommendation names something to exclude. */
  readonly target?: RecommendedTarget;
  readonly reasonCode: string;
  /** Always ESTIMATE_BASED in this batch — carried so a reader cannot miss it. */
  readonly basis: CostObservation["basis"];
  readonly provider: string;
  readonly modelId: string;
  readonly currency: string;
  /** Copied through from the evaluation, for telemetry. */
  readonly limit: number;
  readonly projectedSpend?: number;
  readonly remaining?: number;
}

export interface CostGuardInput {
  readonly budget: CostBudget;
  readonly evaluation: BudgetEvaluation;
  /** The request the evaluation was about. Supplies provider/model identity. */
  readonly observation: CostObservation;
}

/**
 * Budget evaluation -> decision + bounded protection recommendation.
 *
 * The mapping from BUDGET_EXHAUSTED to a recommendation follows the budget's
 * SCOPE, not the observation's identity. A provider-model budget being blown
 * justifies excluding that one model; it does not justify taking the whole
 * provider offline, and a guard that reached for the larger blast radius
 * because it happened to know the provider id would be doing real damage on
 * the strength of an estimate.
 *
 * A GLOBAL overrun deliberately produces HUMAN_REVIEW_REQUIRED rather than an
 * exclusion. No single target can be excluded to fix an overrun caused by
 * everything at once; picking one would be arbitrary, and the honest answer is
 * that somebody has to choose what to turn off.
 */
export function evaluateCostGuard(input: CostGuardInput): CostGuardResult {
  const { budget, evaluation, observation } = input;

  const base = {
    budgetId: evaluation.budgetId,
    scope: evaluation.scope,
    basis: observation.basis,
    provider: observation.provider,
    modelId: observation.modelId,
    currency: evaluation.currency,
    limit: evaluation.limit,
    ...(evaluation.projectedSpend !== undefined ? { projectedSpend: evaluation.projectedSpend } : {}),
    ...(evaluation.remaining !== undefined ? { remaining: evaluation.remaining } : {}),
  };

  switch (evaluation.verdict) {
    case "ALLOW":
      return { ...base, decision: "ALLOW", recommendation: "NONE", reasonCode: evaluation.reasonCode };

    case "AT_RISK":
      // No exclusion yet. The objective is still being met, and taking a
      // provider offline at 80% of a budget would cause more disruption than
      // the overrun it prevents. The alert is the action at this level.
      return { ...base, decision: "AT_RISK", recommendation: "NONE", reasonCode: evaluation.reasonCode };

    case "BUDGET_EXHAUSTED":
      return { ...base, decision: "BUDGET_EXHAUSTED", ...exhaustedResponse(budget), reasonCode: evaluation.reasonCode };

    case "UNKNOWN_COST":
    case "UNAVAILABLE":
    case "INVALID":
    default:
      // Not ALLOW, and not an automatic exclusion either. The guard cannot see
      // the numbers, which is a reason to stop and look — not a reason to be
      // confident enough to disable a provider.
      return {
        ...base,
        decision: "UNKNOWN",
        recommendation: "HUMAN_REVIEW_REQUIRED",
        reasonCode: evaluation.reasonCode,
      };
  }
}

function exhaustedResponse(
  budget: CostBudget
): { recommendation: CostRecommendation; target?: RecommendedTarget } {
  if (budget.scope === "PROVIDER_MODEL" && budget.providerModelId) {
    // Phase 7's own id for the target, carried through verbatim. Composing one
    // from provider + model would produce a string `findRuntimeExclusion` has
    // never seen, so the recommendation would look actionable and do nothing.
    return {
      recommendation: "RECOMMEND_PROVIDER_MODEL_EXCLUSION",
      target: { kind: "provider-model", id: budget.providerModelId },
    };
  }
  if (budget.scope === "PROVIDER" && budget.provider) {
    return {
      recommendation: "RECOMMEND_PROVIDER_EXCLUSION",
      target: { kind: "provider", id: budget.provider },
    };
  }
  return { recommendation: "HUMAN_REVIEW_REQUIRED" };
}

/**
 * Would submitting this request cross the ceiling?
 *
 * The single question the roadmap's "hard budget cap" line asks, answered as a
 * boolean for callers that only need the gate. It is `decision === "ALLOW"` and
 * nothing else: every other decision, including every flavour of "I don't
 * know", withholds permission.
 *
 * NOTE ON WHAT THIS IS NOT: no caller invokes it yet. Placing a cost gate in
 * front of `executeGeneration` is a change to the generation submission path
 * and belongs in its own reviewed batch — and it would currently be enforcing
 * an estimate, not observed spend.
 */
export function mayIncurCost(result: CostGuardResult): boolean {
  return result.decision === "ALLOW";
}

/**
 * The caller-facing entry point: a resolved multi-budget verdict -> a decision.
 *
 * This exists so that the complete path from "here is a request" to "here is a
 * decision" never asks the caller to pick between competing budget verdicts.
 * `evaluateCostGuard` above remains the single-budget primitive the resolver
 * is built on; this is what production code should call.
 *
 * When no configured budget governs the request, the decision is ALLOW with
 * `budgetId: "no_budget"` — a bounded slug, since the field doubles as an
 * alert resource. That case is a POLICY GAP, not a measurement failure, and it
 * stays visible: the reason code says so rather than reading like a budget
 * that was checked and passed.
 */
export function evaluateResolvedCostGuard(
  resolution: BudgetResolution,
  observation: CostObservation
): CostGuardResult {
  if (!resolution.decisive) {
    return {
      budgetId: "no_budget",
      scope: "GLOBAL",
      decision: "ALLOW",
      recommendation: "NONE",
      reasonCode: resolution.reasonCode,
      basis: observation.basis,
      provider: observation.provider,
      modelId: observation.modelId,
      currency: observation.currency ?? "XXX",
      limit: 0,
    };
  }
  return evaluateCostGuard({
    budget: resolution.decisive.budget,
    evaluation: resolution.decisive.evaluation,
    observation,
  });
}
