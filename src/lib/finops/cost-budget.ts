import { RESOURCE_PATTERN } from "@/lib/alerts/alert-contract";
import type { CostAggregate, CostObservation } from "./cost-contract";

/**
 * Operational cost budgets and their deterministic evaluation (Phase 15-B/1).
 *
 * Pure functions over an explicit registry. No I/O, no clock, no randomness:
 * the same budget and the same spend always produce the same verdict, which is
 * what makes "why was this request refused on the 14th" answerable later.
 *
 * ---------------------------------------------------------------------------
 * WHAT A BUDGET HERE IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * It is a ceiling on ESTIMATED OPERATIONAL PROVIDER COST — money Cinefield
 * expects to owe a provider. It is not a customer's credit balance, not a
 * Stripe limit, not an AWS budget, and not a spending authorization. Phase 10
 * owns the credit ledger and remains the only economic truth in this system;
 * a budget being exhausted here says "we are about to spend more on providers
 * than planned", never "this user cannot pay".
 *
 * ---------------------------------------------------------------------------
 * NaN AND Infinity CANNOT ESCAPE THIS MODULE
 * ---------------------------------------------------------------------------
 * Every division guards its denominator and every input is validated before
 * arithmetic touches it. This matters more for money than it does elsewhere: a
 * NaN ratio compares false against every threshold, so a broken calculation
 * reads as "under budget" and fails open on precisely the signal meant to stop
 * spending.
 */

/**
 * What a budget applies to.
 *
 * Three scopes, matching the three Phase 7 control targets that a protection
 * recommendation could name. Per-user, per-workspace and per-request budgets
 * are deliberately absent: the roadmap scopes 15-B to PROVIDER cost, per-user
 * spending limits are a Phase 10 credit concern, and a per-request budget is
 * just the price check the calculator already performs.
 */
export type BudgetScope = "GLOBAL" | "PROVIDER" | "PROVIDER_MODEL";

/**
 * One budget definition.
 *
 * `id` is the alert resource, so it is constrained by 13-D's RESOURCE_PATTERN
 * rather than being built from a provider and model id at emit time. Model ids
 * contain dots (`cinema-studio-4.0`) and a joined "provider:model" contains a
 * colon; both are rejected by that pattern, so a composed resource would fail
 * validation inside the router and the alert would be silently dropped. A slug
 * chosen up front cannot fail that way, and provider/model identity still
 * travels as bounded telemetry dimensions.
 */
export interface CostBudget {
  /** Bounded slug, also used as the alert resource. */
  readonly id: string;
  readonly scope: BudgetScope;
  /** Required for PROVIDER and PROVIDER_MODEL; absent for GLOBAL. */
  readonly provider?: string;
  /**
   * Cinefield's platform model id. Required for PROVIDER_MODEL; absent
   * otherwise. This is what an observation is MATCHED against, because a
   * caller always knows which platform model it asked for — even when pricing
   * could not be read at all.
   */
  readonly modelId?: string;
  /**
   * The PROVIDER's id for the same model, as Phase 7 spells it.
   *
   * Required for PROVIDER_MODEL. It exists separately from `modelId` because
   * `targetsForRoute` keys a `provider-model` control on the provider's id,
   * not on ours and not on a composed "provider:model" string. Deriving one by
   * joining two fields would create a second target taxonomy that silently
   * matches nothing the routing layer has ever heard of, so the value is
   * supplied explicitly and carried straight through to the recommendation.
   */
  readonly providerModelId?: string;
  /** Ceiling in `currency`, for one window. Must be finite and > 0. */
  readonly limit: number;
  /** ISO 4217. No conversion is ever performed against a different one. */
  readonly currency: string;
  /** Window the limit applies to. A limit without a window is meaningless. */
  readonly windowSeconds: number;
  /**
   * Fraction of the limit at which the budget is AT_RISK, in (0, 1).
   *
   * A separate warning level exists so the only two outcomes are not "fine"
   * and "stopped". Something has to fire while there is still time to react.
   */
  readonly atRiskRatio: number;
  /** Why this budget exists and how the number was chosen. */
  readonly why: string;
}

/**
 * The production budget registry.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY EMPTY
 * ---------------------------------------------------------------------------
 * A budget limit is a business figure, not an engineering one. Nobody has set
 * a monthly provider spend ceiling for Cinefield, and inventing a plausible
 * one here would be exactly the fabricated input this phase forbids — with the
 * added hazard that a fabricated limit either throttles real traffic or, more
 * likely, sits so high it never fires while looking like protection.
 *
 * This mirrors the stance `src/trigger/operational/operational-tasks.ts` takes
 * on cadences: the machinery is complete, tested and callable; choosing the
 * numbers is a separate, deliberate act. Registering the first real budget is
 * a one-line change plus a written justification, and `defineCostBudget`
 * validates it the moment it is added.
 */
export const COST_BUDGETS: readonly CostBudget[] = [];

/** Why a budget definition was refused. */
export type BudgetDefinitionError =
  | "invalid_id"
  | "invalid_limit"
  | "invalid_currency"
  | "invalid_window"
  | "invalid_at_risk_ratio"
  | "scope_target_mismatch";

export type BudgetDefinitionResult =
  | { readonly ok: true; readonly budget: CostBudget }
  | { readonly ok: false; readonly error: BudgetDefinitionError };

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Validates a budget definition.
 *
 * A malformed budget is refused at definition time rather than producing an
 * INVALID verdict on every evaluation forever. The scope/target agreement
 * check is the important one: a PROVIDER_MODEL budget missing its model would
 * otherwise silently behave like a provider-wide cap, which is a much larger
 * cap than whoever wrote it intended.
 */
export function defineCostBudget(budget: CostBudget): BudgetDefinitionResult {
  if (typeof budget.id !== "string" || !RESOURCE_PATTERN.test(budget.id)) {
    return { ok: false, error: "invalid_id" };
  }
  if (typeof budget.limit !== "number" || !Number.isFinite(budget.limit) || budget.limit <= 0) {
    return { ok: false, error: "invalid_limit" };
  }
  if (typeof budget.currency !== "string" || !CURRENCY_PATTERN.test(budget.currency)) {
    return { ok: false, error: "invalid_currency" };
  }
  if (
    typeof budget.windowSeconds !== "number" ||
    !Number.isInteger(budget.windowSeconds) ||
    budget.windowSeconds <= 0
  ) {
    return { ok: false, error: "invalid_window" };
  }
  if (
    typeof budget.atRiskRatio !== "number" ||
    !Number.isFinite(budget.atRiskRatio) ||
    budget.atRiskRatio <= 0 ||
    budget.atRiskRatio >= 1
  ) {
    return { ok: false, error: "invalid_at_risk_ratio" };
  }

  const hasProvider = typeof budget.provider === "string" && budget.provider.length > 0;
  const hasModel = typeof budget.modelId === "string" && budget.modelId.length > 0;
  const hasProviderModel = typeof budget.providerModelId === "string" && budget.providerModelId.length > 0;
  const targetOk =
    (budget.scope === "GLOBAL" && !hasProvider && !hasModel && !hasProviderModel) ||
    (budget.scope === "PROVIDER" && hasProvider && !hasModel && !hasProviderModel) ||
    // Both ids, always: one to match observations, one to name the Phase 7
    // target. A PROVIDER_MODEL budget carrying only the platform id could be
    // evaluated but never acted on, which is the worst of the two failures.
    (budget.scope === "PROVIDER_MODEL" && hasProvider && hasModel && hasProviderModel);
  if (!targetOk) return { ok: false, error: "scope_target_mismatch" };

  return { ok: true, budget };
}

/** Does this budget govern this observation? */
export function budgetApplies(budget: CostBudget, observation: CostObservation): boolean {
  if (budget.scope === "GLOBAL") return true;
  if (budget.provider !== observation.provider) return false;
  if (budget.scope === "PROVIDER") return true;
  return budget.modelId === observation.modelId;
}

/**
 * The verdict.
 *
 * Six outcomes rather than a boolean, because "no" has several meanings and
 * they need different responses: BUDGET_EXHAUSTED means stop, UNKNOWN_COST
 * means find out what things cost, UNAVAILABLE means fix the pricing read, and
 * INVALID means fix the configuration. Collapsing them would leave an operator
 * staring at a refusal with no idea which of the four happened.
 */
export type BudgetVerdict =
  | "ALLOW"
  | "AT_RISK"
  | "BUDGET_EXHAUSTED"
  | "UNKNOWN_COST"
  | "UNAVAILABLE"
  | "INVALID";

/** Verdicts under which new provider spend must NOT proceed. */
export const NON_ALLOW_VERDICTS: readonly BudgetVerdict[] = [
  "AT_RISK",
  "BUDGET_EXHAUSTED",
  "UNKNOWN_COST",
  "UNAVAILABLE",
  "INVALID",
];

export interface BudgetEvaluation {
  readonly budgetId: string;
  readonly scope: BudgetScope;
  readonly verdict: BudgetVerdict;
  readonly reasonCode: string;
  readonly currency: string;
  /** The configured ceiling. Always present; a budget without one is INVALID. */
  readonly limit: number;
  /** Spend so far in the window. Present only when it could be established. */
  readonly currentSpend?: number;
  /** Spend + the next request. Present only when both were known. */
  readonly projectedSpend?: number;
  /** max(0, limit - projectedSpend). Present only when projection was possible. */
  readonly remaining?: number;
  /** projectedSpend / limit, clamped to [0, 1000]. Present with projection. */
  readonly projectedRatio?: number;
}

/**
 * Ratio ceiling.
 *
 * A projection 800x over budget and one 80,000x over are the same operational
 * fact — stop — and an unclamped ratio only invites a chart axis or a log
 * field to carry a meaningless magnitude. Phase 15-A's burn rate caps for the
 * same reason.
 */
export const RATIO_CAP = 1_000;

export interface BudgetEvaluationInput {
  readonly budget: CostBudget;
  /** Spend already incurred in this window, from `aggregateCost`. */
  readonly spend: CostAggregate;
  /**
   * The cost of the request being considered, if there is one.
   *
   * Omit it to evaluate the window as it stands (a monitoring pass). Supply it
   * to ask the preventive question: would submitting THIS cross the ceiling?
   */
  readonly nextCost?: CostObservation;
}

/**
 * Deterministic budget evaluation.
 *
 * ---------------------------------------------------------------------------
 * UNCERTAINTY IS NOT HEADROOM
 * ---------------------------------------------------------------------------
 * Unknown, stale, unavailable and invalid inputs all resolve to a non-ALLOW
 * verdict. Treating an unreadable price as zero would give the guard its
 * largest apparent headroom at exactly the moment it can see least, which is
 * how a cost control ends up authorizing the spend it exists to prevent.
 *
 * A STALE price is refused even though it carries a number. It is the best
 * information available, but "the best available" is a routing tie-breaker,
 * not a basis for committing money — and a price nobody has re-verified in six
 * months is as likely to be an undercount as an overcount.
 */
export function evaluateCostBudget(input: BudgetEvaluationInput): BudgetEvaluation {
  const { budget, spend, nextCost } = input;

  const definition = defineCostBudget(budget);
  const base = {
    budgetId: typeof budget?.id === "string" ? budget.id : "unknown",
    scope: budget?.scope ?? "GLOBAL",
    currency: typeof budget?.currency === "string" ? budget.currency : "XXX",
    limit: typeof budget?.limit === "number" && Number.isFinite(budget.limit) ? budget.limit : 0,
  } as const;

  if (!definition.ok) {
    return { ...base, verdict: "INVALID", reasonCode: `budget_${definition.error}` };
  }

  // ---- can the window be established at all? -------------------------------
  if (spend.state === "unavailable") {
    return { ...base, verdict: "UNAVAILABLE", reasonCode: "spend_source_unavailable" };
  }
  if (spend.state === "invalid") {
    return { ...base, verdict: "INVALID", reasonCode: `spend_${spend.reasonCode}` };
  }
  if (spend.state !== "known" || typeof spend.estimatedSpend !== "number") {
    // "unknown" and "stale" both land here: a window containing traffic nobody
    // could price has an unknown total, not a smaller one.
    return { ...base, verdict: "UNKNOWN_COST", reasonCode: `spend_${spend.reasonCode}` };
  }

  // A priced non-empty window must state its currency; an empty one has none
  // to state, and comparing 0 against any ceiling is safe in every currency.
  if (spend.observationCount > 0 && spend.currency !== budget.currency) {
    return { ...base, verdict: "INVALID", reasonCode: "spend_currency_mismatch" };
  }
  if (!Number.isFinite(spend.estimatedSpend) || spend.estimatedSpend < 0) {
    return { ...base, verdict: "INVALID", reasonCode: "spend_not_representable" };
  }

  const currentSpend = spend.estimatedSpend;

  // ---- the request under consideration, if any -----------------------------
  let increment = 0;
  if (nextCost) {
    if (nextCost.state === "unavailable") {
      return { ...base, currentSpend, verdict: "UNAVAILABLE", reasonCode: "next_cost_source_unavailable" };
    }
    if (nextCost.state === "invalid") {
      return { ...base, currentSpend, verdict: "INVALID", reasonCode: `next_${nextCost.reasonCode}` };
    }
    if (nextCost.state !== "known" || typeof nextCost.estimatedCost !== "number") {
      return { ...base, currentSpend, verdict: "UNKNOWN_COST", reasonCode: `next_${nextCost.reasonCode}` };
    }
    if (nextCost.currency !== budget.currency) {
      // Fail closed. Converting would need an exchange rate nobody has set,
      // and a guessed rate is a guessed spending limit.
      return { ...base, currentSpend, verdict: "INVALID", reasonCode: "next_cost_currency_mismatch" };
    }
    if (!Number.isFinite(nextCost.estimatedCost) || nextCost.estimatedCost < 0) {
      return { ...base, currentSpend, verdict: "INVALID", reasonCode: "next_cost_not_representable" };
    }
    increment = nextCost.estimatedCost;
  }

  const projectedSpend = currentSpend + increment;
  if (!Number.isFinite(projectedSpend)) {
    return { ...base, currentSpend, verdict: "INVALID", reasonCode: "projection_not_finite" };
  }

  // `budget.limit` is > 0 and finite — `defineCostBudget` proved it above — so
  // this division cannot produce NaN or Infinity.
  const projectedRatio = Math.min(RATIO_CAP, projectedSpend / budget.limit);
  const remaining = Math.max(0, budget.limit - projectedSpend);
  const measured = { ...base, currentSpend, projectedSpend, remaining, projectedRatio };

  // Strictly greater than: spending exactly to the ceiling is within it.
  if (projectedSpend > budget.limit) {
    return { ...measured, verdict: "BUDGET_EXHAUSTED", reasonCode: "projected_spend_over_limit" };
  }
  if (projectedRatio >= budget.atRiskRatio) {
    return { ...measured, verdict: "AT_RISK", reasonCode: "projected_spend_near_limit" };
  }
  return { ...measured, verdict: "ALLOW", reasonCode: "within_budget" };
}
