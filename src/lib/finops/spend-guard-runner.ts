import type { PricingRecord } from "@/lib/pricing/pricing-types";
import {
  aggregateCost,
  observeProviderCost,
  toCostMicros,
  type CostAggregate,
  type CostObservation,
} from "./cost-contract";
import { resolveApplicableBudgets, type CostBudget } from "./cost-budget";
import { evaluateResolvedCostGuard, type CostGuardResult } from "./cost-guard";
import { alertOnCostGuard } from "./cost-alert-bridge";
import type { AttemptVolume, AttemptVolumeResult } from "./estimated-spend-repository";

/**
 * Estimated-spend window -> budget verdict -> 13-D alert (Phase 15-B/2).
 *
 * Pure apart from the alert call, which is 13-D's own `raiseAlert` reached
 * through the existing bridge. No database, no clock, no network: the caller
 * reads volumes and pricing and passes them in, so every decision this makes
 * is reproducible from its inputs months later.
 *
 * ---------------------------------------------------------------------------
 * STILL AN ESTIMATE, AND STILL SAYS SO
 * ---------------------------------------------------------------------------
 * Attempt counts times a price list is a forecast of what providers will
 * probably charge. It is not a bill, and no observed provider spend exists in
 * this system to compare it against. Every result carries
 * `basis: "ESTIMATE_BASED"`, and nothing here writes
 * `generation_attempts.cost_amount` — that column stays NULL until real
 * provider evidence exists, because a column named cost_amount holding a
 * forecast is indistinguishable, forever, from one holding a bill.
 */

/**
 * What a billable unit means for one attempt, per the pricing row's own
 * `provider_billing_unit`.
 *
 * ---------------------------------------------------------------------------
 * `per_output` CANNOT BE PRICED FROM CURRENT DATA
 * ---------------------------------------------------------------------------
 * `per_request` maps cleanly: one attempt is one request, so N attempts are N
 * units. That is a fact about the schema, not an assumption.
 *
 * `per_output` needs the number of outputs a request produced, and no such
 * evidence exists. `generations` has no quantity column; `media_assets` has a
 * `provider_output` source value in its CHECK constraint but nothing writes
 * one — the only insert path in the repository is the browser-upload route.
 * Counting it would therefore yield zero outputs for generated content, which
 * is not a missing number but a WRONG one: it would price real traffic at
 * nothing.
 *
 * So `per_output` returns null, which becomes UNKNOWN upstream and withholds
 * ALLOW. That leaves most image traffic unpriceable today. That is the honest
 * state of the evidence, and the fix is to record output counts — not to
 * assume one output per request so the arithmetic completes.
 */
export function billableUnitsFor(volume: AttemptVolume, record: PricingRecord): number | null {
  if (record.providerBillingUnit === "per_request") return volume.attemptCount;
  return null;
}

/** One provider/model pair, priced. */
export interface SpendLine {
  readonly provider: string;
  readonly providerModelId: string;
  /** Cinefield's platform id, resolved by the caller from the registry. */
  readonly modelId: string;
  readonly attemptCount: number;
  /** Present only when the billing unit could be mapped. */
  readonly billableUnitCount?: number;
  readonly observation: CostObservation;
}

/** The bounded result of one guard pass over one window. */
export interface SpendGuardOutcome {
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly basis: CostObservation["basis"];
  readonly lineCount: number;
  readonly attemptCount: number;
  readonly unpriceableLineCount: number;
  readonly spend: CostAggregate;
  readonly guard: CostGuardResult;
  readonly alertRaised: boolean;
  readonly reasonCode: string;
}

/**
 * What the runner needs. Everything is supplied; nothing is fetched.
 *
 * `pricingFor` returns the active pricing row for a platform model id, or null
 * when none is active. `unresolvedModelIds` lets the caller report registry
 * misses without this module having to know what a registry is.
 */
export interface SpendGuardInput {
  readonly volumes: AttemptVolumeResult;
  /** Provider model id -> Cinefield platform model id, from the registry. */
  readonly platformModelIdFor: (volume: AttemptVolume) => string | null;
  readonly pricingFor: (platformModelId: string) => PricingRecord | null;
  /** Whether every pricing lookup above succeeded. False on a read failure. */
  readonly pricingSourceAvailable: boolean;
  readonly budgets: readonly CostBudget[];
  readonly now: Date;
}

/**
 * Prices a window, evaluates it against every applicable budget, and raises a
 * 13-D alert when the strictest verdict warrants one.
 *
 * ---------------------------------------------------------------------------
 * THE UNREADABLE WINDOW IS HANDLED FIRST
 * ---------------------------------------------------------------------------
 * A failed or truncated attempt query produces `sourceAvailable: false`, which
 * becomes an UNAVAILABLE aggregate and, through the guard, an UNKNOWN
 * decision. It does NOT become an empty window. That distinction is the whole
 * of D2, and it is checked before anything can produce a number.
 */
export function runSpendGuard(input: SpendGuardInput): SpendGuardOutcome {
  const { windowStart, windowEnd } = input.volumes.window;
  const base = { windowStart, windowEnd, basis: "ESTIMATE_BASED" as const };

  const lines: SpendLine[] = [];
  let attemptCount = 0;
  let unpriceable = 0;

  for (const volume of input.volumes.volumes) {
    attemptCount += volume.attemptCount;
    const platformModelId = input.platformModelIdFor(volume);
    const record = platformModelId ? input.pricingFor(platformModelId) : null;
    const units = record ? billableUnitsFor(volume, record) : null;

    // `observeProviderCost` owns every state decision from here — missing
    // pricing, staleness, corrupt numerics, currency shape. This function does
    // not re-implement any of them; it only supplies the unit count, and
    // passes `outputCount: 0` when it has none so the shared unit resolver
    // reports the row as uncomputable rather than being handed a guess.
    const observation = observeProviderCost({
      provider: volume.provider,
      modelId: platformModelId ?? volume.providerModelId,
      record,
      request: { outputCount: units ?? 0 },
      sourceAvailable: input.pricingSourceAvailable,
      now: input.now,
    });

    if (observation.state !== "known") unpriceable += 1;

    lines.push({
      provider: volume.provider,
      providerModelId: volume.providerModelId,
      modelId: platformModelId ?? volume.providerModelId,
      attemptCount: volume.attemptCount,
      ...(units !== null ? { billableUnitCount: units } : {}),
      observation,
    });
  }

  // A per_request line was priced for ONE unit by `observeProviderCost`, so
  // multiply back up to the attempt count. Done here rather than inside the
  // observation because the observation models the cost of one request, which
  // is what every other 15-B caller means by it.
  const scaled = lines.map((line) => scaleObservation(line));

  const spend = aggregateCost({
    observations: scaled,
    // The single most important line in this file. A query that failed and a
    // window with no traffic both arrive as an empty list; only this flag
    // separates "we spent nothing" from "we cannot see what we spent".
    sourceAvailable: input.volumes.sourceAvailable,
  });

  // The request under consideration is not modelled here: this is a window
  // monitoring pass, not an admission check. `evaluateCostBudget` supports a
  // `nextCost`, and the pre-spend gate that would supply one is a later,
  // separately reviewed change to the submission path.
  const representative = scaled[0] ?? unpricedRepresentative(input.now);

  // ---- unreadable window: answer before the budgets are consulted ---------
  //
  // An unreadable window has no lines, so the representative observation
  // carries no provider or model. `budgetApplies` would then match NO
  // provider-scoped budget, the resolver would correctly report "no applicable
  // budget", and that reports as ALLOW — the right answer to a different
  // question. The window is not unbudgeted; it is unread, and the two must not
  // produce the same verdict. Deciding here keeps the resolver's own policy
  // intact rather than teaching it about missing evidence.
  if (!input.volumes.sourceAvailable) {
    return {
      ...base,
      lineCount: lines.length,
      attemptCount,
      unpriceableLineCount: unpriceable,
      spend,
      guard: unreadableWindowGuard(representative, input.volumes.reasonCode),
      alertRaised: false,
      reasonCode: input.volumes.reasonCode,
    };
  }

  const resolution = resolveApplicableBudgets({
    budgets: input.budgets,
    observation: representative,
    spendByBudgetId: Object.fromEntries(input.budgets.map((b) => [b.id, spend])),
  });

  const guard = evaluateResolvedCostGuard(resolution, representative);
  const raised = alertOnCostGuard(guard);

  return {
    ...base,
    lineCount: lines.length,
    attemptCount,
    unpriceableLineCount: unpriceable,
    spend,
    guard,
    alertRaised: raised?.outcome === "emitted",
    reasonCode: input.volumes.sourceAvailable ? guard.reasonCode : input.volumes.reasonCode,
  };
}

/** Per-request cost -> whole-window cost for that line. */
function scaleObservation(line: SpendLine): CostObservation {
  const { observation } = line;
  if (observation.state !== "known" || typeof observation.estimatedCost !== "number") return observation;
  const units = line.billableUnitCount ?? 0;
  const total = observation.estimatedCost * units;
  // A scaled total that overflows is not a total. Naming it invalid keeps it
  // out of a sum rather than letting Infinity reach the budget comparison.
  if (!Number.isFinite(total)) {
    return { ...observation, state: "invalid", reasonCode: "scaled_spend_not_finite", estimatedCost: undefined };
  }
  return { ...observation, estimatedCost: total };
}

/**
 * The verdict for a window nobody could read.
 *
 * UNKNOWN with a human-review recommendation, matching what the guard produces
 * for every other kind of missing evidence. It raises no alert: "we could not
 * read the spend window" is an operational fault reported through the task
 * result, not a budget breach, and routing it as one would put a WARNING on a
 * budget that may be perfectly healthy.
 */
function unreadableWindowGuard(observation: CostObservation, reasonCode: string): CostGuardResult {
  return {
    budgetId: "no_budget",
    scope: "GLOBAL",
    decision: "UNKNOWN",
    recommendation: "HUMAN_REVIEW_REQUIRED",
    reasonCode,
    basis: observation.basis,
    provider: observation.provider,
    modelId: observation.modelId,
    currency: observation.currency ?? "XXX",
    limit: 0,
  };
}

/** Stand-in identity for a window with no lines, so budgets can still match. */
function unpricedRepresentative(now: Date): CostObservation {
  return {
    provider: "none",
    modelId: "none",
    basis: "ESTIMATE_BASED",
    state: "known",
    estimatedCost: 0,
    currency: "USD",
    reasonCode: "no_attempts_in_window",
    observedAt: now.toISOString(),
  };
}

/**
 * The bounded telemetry projection of a guard pass.
 *
 * Counts and catalogue labels only. No attempt id, no generation id, no user,
 * no window contents — the window bounds themselves are omitted because a
 * timestamp is not a metric dimension and adding one would make every pass a
 * distinct series.
 */
export function spendGuardMetrics(outcome: SpendGuardOutcome): Record<string, number> {
  const metrics: Record<string, number> = {
    lines: outcome.lineCount,
    attempts: outcome.attemptCount,
    unpriceableLines: outcome.unpriceableLineCount,
    alertsRaised: outcome.alertRaised ? 1 : 0,
  };
  if (outcome.spend.state === "known" && typeof outcome.spend.estimatedSpend === "number") {
    const micros = toCostMicros(outcome.spend.estimatedSpend);
    if (micros !== null) metrics.estimatedSpendMicros = micros;
  }
  return metrics;
}
