import { raiseAlert, resolveAlert, type RaiseResult } from "@/lib/alerts/alert-router";
import { toCostMicros } from "./cost-contract";
import type { CostGuardResult } from "./cost-guard";

/**
 * Cost budget pressure -> the existing Central Alert Router (15-B/1 -> 13-D).
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT AN ALERT ROUTER
 * ---------------------------------------------------------------------------
 * No dedupe state, no severity table, no channel logic, no escalation ladder,
 * no delivery. It picks WHICH catalogued type applies and hands a candidate to
 * `raiseAlert` — the same 13-D router every other producer uses. A cost budget
 * that stays blown for six hours therefore behaves like every other repeated
 * alert instead of inventing its own storm behaviour.
 *
 * Severity is not decided here either: `cost_budget_at_risk` is WARNING and
 * `cost_budget_exhausted` is ERROR in 13-D's catalogue, the only place
 * severity is ever set. This file cannot make a cost alert louder than the
 * catalogue says it is.
 *
 * ---------------------------------------------------------------------------
 * AN UNKNOWN COST RAISES NOTHING, AND RESOLVES NOTHING
 * ---------------------------------------------------------------------------
 * When the guard could not price the traffic, there is no budget claim to
 * make in either direction. Raising would produce an alert whose content is
 * "we don't know", which is not actionable at 3am; resolving would clear a
 * standing breach on the strength of having gone blind — the failure mode
 * Phase 15-A named explicitly and refused.
 *
 * Safety does not depend on this file. `evaluateCostGuard` already withholds
 * ALLOW for every unknown state; the alert is how a human finds out, not how
 * the spend is stopped.
 */

/**
 * Turns one guard result into at most one 13-D alert.
 *
 * Returns null when nothing was raised — either because the budget is fine or
 * because the guard could not see the numbers.
 */
export function alertOnCostGuard(result: CostGuardResult): RaiseResult | null {
  // `budgetId` is the alert resource. `defineCostBudget` has already checked
  // it against 13-D's RESOURCE_PATTERN, so it cannot be rejected downstream
  // for shape — which is why the budget carries a slug rather than a composed
  // provider/model string.
  const resource = result.budgetId;

  if (result.decision === "BUDGET_EXHAUSTED") {
    return raiseAlert({ type: "cost_budget_exhausted", resource, reasonCode: result.reasonCode });
  }
  if (result.decision === "AT_RISK") {
    return raiseAlert({ type: "cost_budget_at_risk", resource, reasonCode: result.reasonCode });
  }
  if (result.decision === "ALLOW") {
    // Back inside the ceiling: clear both levels so a budget that recovers
    // stops re-escalating. Only a positively-known ALLOW does this.
    resolveAlert("cost_budget_at_risk", resource);
    resolveAlert("cost_budget_exhausted", resource);
    return null;
  }
  return null;
}

/**
 * The bounded telemetry projection of a guard result.
 *
 * Every field here is on the Phase 13-E allow-list, and every money value is
 * an integer micro-unit rather than a float — the redactor validates numeric
 * fields as `count` and rounds them, so a USD 0.04 call logged as a float
 * would appear in the record as `0`.
 *
 * Amounts that cannot be represented safely are OMITTED rather than zeroed.
 * A missing field reads as "not reported"; a zero reads as "free", and this
 * whole package exists to stop those two being confused.
 */
export function costTelemetryFields(result: CostGuardResult): Record<string, string | number> {
  const fields: Record<string, string | number> = {
    subsystem: "finops-cost-guard",
    resource: result.budgetId,
    // Enum labels are lowercased on the way out. 13-E validates a `code` field
    // against CODE_PATTERN, which is lowercase-only, so `AT_RISK` would be
    // DROPPED rather than truncated — the alert would arrive with no decision
    // in it at all. The domain types keep their uppercase spelling; only this
    // projection conforms, because the allow-list is the boundary and it is
    // the boundary that should win.
    decision: lower(result.decision),
    // The recommendation travels under the existing bounded-vocabulary field
    // rather than a new one. Values come from COST_RECOMMENDATIONS only.
    classification: lower(result.recommendation),
    reasonCode: result.reasonCode,
    budgetScope: lower(result.scope),
    provider: result.provider,
    modelId: result.modelId,
    // `currency` is a `name` field, and NAME_PATTERN permits uppercase — ISO
    // 4217 codes stay in their standard spelling.
    currency: result.currency,
    costBasis: lower(result.basis),
  };

  const limit = toCostMicros(result.limit);
  if (limit !== null) fields.budgetLimitMicros = limit;

  if (result.projectedSpend !== undefined) {
    const projected = toCostMicros(result.projectedSpend);
    if (projected !== null) fields.costMicros = projected;
  }
  if (result.remaining !== undefined) {
    const remaining = toCostMicros(result.remaining);
    if (remaining !== null) fields.budgetRemainingMicros = remaining;
  }

  return fields;
}

/** Enum label -> 13-E `code` spelling. Closed vocabularies only. */
function lower(value: string): string {
  return value.toLowerCase();
}
