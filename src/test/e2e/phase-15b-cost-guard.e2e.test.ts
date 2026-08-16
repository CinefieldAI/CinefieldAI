import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  aggregateCost,
  MICROS_PER_UNIT,
  observeProviderCost,
  toCostMicros,
  type CostObservation,
} from "@/lib/finops/cost-contract";
import {
  COST_BUDGETS,
  defineCostBudget,
  budgetApplies,
  evaluateCostBudget,
  NON_ALLOW_VERDICTS,
  RATIO_CAP,
  type CostBudget,
} from "@/lib/finops/cost-budget";
import {
  COST_RECOMMENDATIONS,
  evaluateCostGuard,
  mayIncurCost,
  type CostGuardResult,
} from "@/lib/finops/cost-guard";
import { alertOnCostGuard, costTelemetryFields } from "@/lib/finops/cost-alert-bridge";
import { ALERT_CATALOGUE, type AlertEnvelope } from "@/lib/alerts/alert-contract";
import { resetAlertRouter } from "@/lib/alerts/alert-router";
import { clearAlertSinks, registerAlertSink, type AlertDeliverySink } from "@/lib/alerts/alert-sink";
import { sanitizeTelemetry } from "@/lib/observability/telemetry-redaction";
import { analyzeIncident } from "@/lib/deployment/incident-diagnosis";
import type { PricingRecord } from "@/lib/pricing/pricing-types";

/**
 * Phase 15-B/1 — cost observation and deterministic budget evaluation.
 *
 * The load-bearing assertions here are the negative ones. It is easy to write
 * a cost guard that computes correctly on the happy path and quietly treats
 * every uncertainty as free capacity; that guard passes arithmetic tests and
 * authorizes exactly the spend it exists to prevent. So most of this file is
 * about what the module refuses to do.
 */

const ROOT = process.cwd();
const FINOPS_DIR = path.join(ROOT, "src", "lib", "finops");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Reads the finops directory FROM DISK, not from `git ls-files`.
 *
 * A tracked-files listing cannot see a module that has been written but not
 * yet committed, so a structural guard built on one passes before the commit
 * and fails after it. That has happened three times in this repository; the
 * directory walk is the fix.
 */
const finopsFiles = readdirSync(FINOPS_DIR).filter((f) => f.endsWith(".ts"));
const finopsSources = finopsFiles.map((f) => ({
  file: `src/lib/finops/${f}`,
  text: readFileSync(path.join(FINOPS_DIR, f), "utf8"),
}));

/** Strips comments so prose about a forbidden call is not read as the call. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const finopsCode = finopsSources.map((s) => ({ file: s.file, text: stripComments(s.text) }));

const NOW = new Date("2026-08-16T12:00:00.000Z");

function pricing(over: Partial<PricingRecord> = {}): PricingRecord {
  return {
    platformModelId: "test-model",
    provider: "fal",
    providerModelId: "fal-ai/test",
    pricingVersion: 3,
    providerBillingUnit: "per_request",
    providerUnitCost: 0.04,
    providerCurrency: "USD",
    creditPricePerUnit: 250,
    sourceType: "official_docs",
    sourceReference: "https://example.test/pricing",
    verifiedAt: "2026-08-01T00:00:00.000Z",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function observe(over: Partial<PricingRecord> | null, opts: { sourceAvailable?: boolean } = {}) {
  return observeProviderCost({
    provider: "fal",
    modelId: "test-model",
    record: over === null ? null : pricing(over),
    request: { outputCount: 1 },
    sourceAvailable: opts.sourceAvailable ?? true,
    now: NOW,
  });
}

function budget(over: Partial<CostBudget> = {}): CostBudget {
  return {
    id: "provider_fal_24h",
    scope: "PROVIDER",
    provider: "fal",
    limit: 10,
    currency: "USD",
    windowSeconds: 86_400,
    atRiskRatio: 0.8,
    why: "Synthetic budget used only by tests.",
    ...over,
  };
}

/** Builds a spend aggregate at an exact amount, without faking the state. */
function spendOf(amount: number) {
  const per = observe({ providerUnitCost: amount });
  return aggregateCost(amount === 0 ? [] : [per]);
}

function guard(b: CostBudget, spendAmount: number, next?: CostObservation): CostGuardResult {
  const observation = next ?? observe({});
  const evaluation = evaluateCostBudget({ budget: b, spend: spendOf(spendAmount), nextCost: next });
  return evaluateCostGuard({ budget: b, evaluation, observation });
}

/**
 * A DASHBOARD sink, because that channel receives every severity. A TELEGRAM
 * sink would see the ERROR alert and silently miss the WARNING one, which
 * would make this file's AT_RISK assertions pass for the wrong reason.
 */
function captureAlerts(): AlertEnvelope[] {
  const seen: AlertEnvelope[] = [];
  resetAlertRouter();
  clearAlertSinks();
  const sink: AlertDeliverySink = {
    name: "capture",
    channel: "DASHBOARD",
    deliver: (envelope) => void seen.push(envelope),
  };
  registerAlertSink(sink);
  return seen;
}

// ---------------------------------------------------------------------------
// 1–2  PROVIDER COST IS THE OPERATIONAL COST; CREDIT PRICE IS NOT
// ---------------------------------------------------------------------------

test("S15B-1  provider_unit_cost is the operational cost source", () => {
  const o = observe({ providerUnitCost: 0.04, creditPricePerUnit: 250 });
  assert.equal(o.state, "known");
  assert.equal(o.estimatedCost, 0.04, "the provider's unit cost, not the credit price");
  assert.equal(o.currency, "USD");
  assert.equal(o.basis, "ESTIMATE_BASED");
});

test("S15B-2  credit_price_per_unit is never read as operational cost truth", () => {
  // Behavioural: moving the credit price cannot move the cost.
  const cheap = observe({ providerUnitCost: 0.04, creditPricePerUnit: 1 });
  const dear = observe({ providerUnitCost: 0.04, creditPricePerUnit: 999_999 });
  assert.equal(cheap.estimatedCost, dear.estimatedCost);

  // Structural: the column is not referenced anywhere in the package. A guard
  // that grew more relaxed as margin grew would be worse than no guard.
  for (const { file, text } of finopsCode) {
    assert.ok(!/creditPricePerUnit/.test(text), `${file} reads the customer credit price`);
    assert.ok(!/credit_price_per_unit/.test(text), `${file} reads the customer credit price`);
  }
});

// ---------------------------------------------------------------------------
// 3–9  UNKNOWN IS NOT ZERO, AND CORRUPT INPUT IS NAMED
// ---------------------------------------------------------------------------

test("S15B-3  a model with no active pricing is UNKNOWN, not free", () => {
  const o = observe(null);
  assert.equal(o.state, "unknown");
  assert.equal(o.reasonCode, "no_active_pricing");
  assert.equal(o.estimatedCost, undefined, "absent, never 0");
});

test("S15B-4  stale pricing is STALE and still not free", () => {
  const o = observe({ verifiedAt: "2020-01-01T00:00:00.000Z" });
  assert.equal(o.state, "stale");
  assert.notEqual(o.estimatedCost, 0);
  // The number is reported; the STATE is what withholds permission.
  assert.equal(o.estimatedCost, 0.04);
});

test("S15B-5  an unavailable pricing source is UNAVAILABLE, distinct from unpriced", () => {
  const o = observe(null, { sourceAvailable: false });
  assert.equal(o.state, "unavailable");
  assert.equal(o.reasonCode, "pricing_source_unavailable");
  assert.equal(o.estimatedCost, undefined);
  assert.notEqual(o.state, observe(null).state, "a failed read is not an unpriced model");
});

test("S15B-6  a malformed cost is INVALID", () => {
  assert.equal(observe({ providerUnitCost: "0.04" as unknown as number }).state, "invalid");
  assert.equal(observe({ providerCurrency: "dollars" }).state, "invalid");
  assert.equal(observe({ providerCurrency: "usd" }).state, "invalid", "ISO 4217 is uppercase");
});

test("S15B-7  a negative provider cost is rejected, not treated as a discount", () => {
  const o = observe({ providerUnitCost: -5 });
  assert.equal(o.state, "invalid");
  assert.equal(o.reasonCode, "provider_unit_cost_negative");
  assert.equal(o.estimatedCost, undefined);
});

test("S15B-8  NaN is rejected", () => {
  const o = observe({ providerUnitCost: Number.NaN });
  assert.equal(o.state, "invalid");
  assert.equal(o.reasonCode, "provider_unit_cost_not_finite");
});

test("S15B-9  Infinity is rejected", () => {
  assert.equal(observe({ providerUnitCost: Number.POSITIVE_INFINITY }).state, "invalid");
  assert.equal(observe({ providerUnitCost: Number.NEGATIVE_INFINITY }).state, "invalid");
});

test("S15B-9b  an unpriced member poisons an aggregate rather than being skipped", () => {
  const mixed = aggregateCost([observe({}), observe(null)]);
  assert.equal(mixed.state, "unknown");
  assert.equal(mixed.estimatedSpend, undefined, "a partial sum understates spend");

  // An empty window is the one honest zero, and it stays distinguishable.
  const empty = aggregateCost([]);
  assert.equal(empty.state, "known");
  assert.equal(empty.estimatedSpend, 0);
  assert.equal(empty.observationCount, 0);
});

// ---------------------------------------------------------------------------
// 10  CURRENCY
// ---------------------------------------------------------------------------

test("S15B-10  a currency mismatch fails closed and is never converted", () => {
  const eur = observe({ providerUnitCost: 1, providerCurrency: "EUR" });
  assert.equal(eur.state, "known", "the observation itself is fine");

  const e = evaluateCostBudget({ budget: budget({ currency: "USD" }), spend: spendOf(0), nextCost: eur });
  assert.equal(e.verdict, "INVALID");
  assert.equal(e.reasonCode, "next_cost_currency_mismatch");

  // And a mixed-currency window cannot be summed at all.
  assert.equal(aggregateCost([observe({}), eur]).reasonCode, "mixed_currency_observations");

  // No exchange rate exists anywhere in the package.
  for (const { file, text } of finopsCode) {
    assert.ok(!/exchangeRate|fxRate|convertCurrency/i.test(text), `${file} converts currency`);
  }
});

// ---------------------------------------------------------------------------
// 11–16  BUDGET EVALUATION ACROSS SCOPES AND THRESHOLDS
// ---------------------------------------------------------------------------

test("S15B-11  a global budget evaluates over everything", () => {
  const g = budget({ id: "global_usd_24h", scope: "GLOBAL", provider: undefined });
  assert.ok(defineCostBudget(g).ok);
  assert.ok(budgetApplies(g, observe({})), "GLOBAL matches any provider");
  assert.ok(budgetApplies(g, observeProviderCost({
    provider: "replicate", modelId: "other", record: pricing({ provider: "replicate" }),
    request: { outputCount: 1 }, sourceAvailable: true, now: NOW,
  })));
  assert.equal(evaluateCostBudget({ budget: g, spend: spendOf(1) }).verdict, "ALLOW");
});

test("S15B-12  a provider budget matches only its provider", () => {
  const b = budget();
  assert.ok(budgetApplies(b, observe({})));
  const other = observeProviderCost({
    provider: "replicate", modelId: "test-model", record: pricing({ provider: "replicate" }),
    request: { outputCount: 1 }, sourceAvailable: true, now: NOW,
  });
  assert.equal(budgetApplies(b, other), false);
});

test("S15B-13  a provider-model budget matches only its model, and needs both ids", () => {
  const b = budget({
    id: "pm_fal_test_24h", scope: "PROVIDER_MODEL", modelId: "test-model", providerModelId: "fal-ai/test",
  });
  assert.ok(defineCostBudget(b).ok);
  assert.ok(budgetApplies(b, observe({})));
  assert.equal(budgetApplies(b, observeProviderCost({
    provider: "fal", modelId: "different-model", record: pricing(), request: { outputCount: 1 },
    sourceAvailable: true, now: NOW,
  })), false);

  // Missing the Phase 7 id would leave the budget evaluable but unactionable.
  const noTarget = defineCostBudget({ ...b, providerModelId: undefined });
  assert.equal(noTarget.ok, false);
  assert.equal(noTarget.ok === false && noTarget.error, "scope_target_mismatch");
});

test("S15B-14  a next request that crosses the ceiling is BUDGET_EXHAUSTED", () => {
  const b = budget({ limit: 10 });
  const next = observe({ providerUnitCost: 2 });
  const e = evaluateCostBudget({ budget: b, spend: spendOf(9), nextCost: next });
  assert.equal(e.verdict, "BUDGET_EXHAUSTED");
  assert.equal(e.projectedSpend, 11);
  assert.equal(e.remaining, 0, "clamped at zero, never negative");

  // Landing exactly on the ceiling is within it.
  const exact = evaluateCostBudget({ budget: b, spend: spendOf(9), nextCost: observe({ providerUnitCost: 1 }) });
  assert.equal(exact.verdict, "AT_RISK", "at the limit, not over it");
  assert.equal(exact.remaining, 0);
});

test("S15B-15  approaching the threshold is AT_RISK", () => {
  const e = evaluateCostBudget({ budget: budget({ limit: 10, atRiskRatio: 0.8 }), spend: spendOf(8.5) });
  assert.equal(e.verdict, "AT_RISK");
  assert.equal(e.projectedRatio, 0.85);
  assert.equal(e.remaining, 1.5);
});

test("S15B-16  comfortably below the threshold is ALLOW", () => {
  const e = evaluateCostBudget({ budget: budget({ limit: 10, atRiskRatio: 0.8 }), spend: spendOf(1) });
  assert.equal(e.verdict, "ALLOW");
  assert.equal(e.reasonCode, "within_budget");
  assert.ok(mayIncurCost(guard(budget({ limit: 10 }), 1)));
});

test("S15B-16b  no verdict is ever NaN or Infinity, and the ratio is capped", () => {
  const huge = evaluateCostBudget({
    budget: budget({ limit: 0.000001 }), spend: spendOf(0), nextCost: observe({ providerUnitCost: 1_000_000 }),
  });
  assert.equal(huge.verdict, "BUDGET_EXHAUSTED");
  assert.equal(huge.projectedRatio, RATIO_CAP);
  assert.ok(Number.isFinite(huge.projectedRatio!));

  // A malformed budget is refused rather than dividing by it.
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const e = evaluateCostBudget({ budget: budget({ limit: bad }), spend: spendOf(1) });
    assert.equal(e.verdict, "INVALID", `limit ${bad}`);
    assert.equal(e.projectedRatio, undefined);
  }
});

// ---------------------------------------------------------------------------
// 17–18  UNCERTAINTY, AND A BOUNDED RECOMMENDATION
// ---------------------------------------------------------------------------

test("S15B-17  every uncertain input yields UNKNOWN and withholds permission", () => {
  const cases: Array<[string, CostObservation]> = [
    ["unknown", observe(null)],
    ["stale", observe({ verifiedAt: "2020-01-01T00:00:00.000Z" })],
    ["unavailable", observe(null, { sourceAvailable: false })],
    ["invalid", observe({ providerUnitCost: Number.NaN })],
  ];
  for (const [name, next] of cases) {
    const g = guard(budget(), 1, next);
    assert.equal(g.decision, "UNKNOWN", `${name} must not resolve to a spend decision`);
    assert.equal(mayIncurCost(g), false, `${name} must not authorize spend`);
    assert.equal(g.recommendation, "HUMAN_REVIEW_REQUIRED");
  }

  // And the verdict list itself agrees: only ALLOW allows.
  assert.equal(NON_ALLOW_VERDICTS.includes("ALLOW" as never), false);
});

test("S15B-18  the recommendation is bounded and matches the budget's scope", () => {
  const pm = budget({
    id: "pm_fal_test_24h", scope: "PROVIDER_MODEL", modelId: "test-model", providerModelId: "fal-ai/test", limit: 1,
  });
  const gPm = guard(pm, 0, observe({ providerUnitCost: 5 }));
  assert.equal(gPm.recommendation, "RECOMMEND_PROVIDER_MODEL_EXCLUSION");
  assert.deepEqual(gPm.target, { kind: "provider-model", id: "fal-ai/test" });

  const gProv = guard(budget({ limit: 1 }), 0, observe({ providerUnitCost: 5 }));
  assert.equal(gProv.recommendation, "RECOMMEND_PROVIDER_EXCLUSION");
  assert.deepEqual(gProv.target, { kind: "provider", id: "fal" });

  // A global overrun has no single target that would fix it.
  const gGlobal = guard(
    budget({ id: "global_usd_24h", scope: "GLOBAL", provider: undefined, limit: 1 }), 0,
    observe({ providerUnitCost: 5 })
  );
  assert.equal(gGlobal.recommendation, "HUMAN_REVIEW_REQUIRED");
  assert.equal(gGlobal.target, undefined);

  // AT_RISK recommends nothing: the alert is the action at that level.
  assert.equal(guard(budget({ limit: 10 }), 8.5).recommendation, "NONE");

  for (const g of [gPm, gProv, gGlobal]) {
    assert.ok(COST_RECOMMENDATIONS.includes(g.recommendation), "outside the bounded set");
  }
});

// ---------------------------------------------------------------------------
// 19–23  PHASE 7 OWNS ROUTING CONTROL; PHASE 21 OWNS FLAGS
// ---------------------------------------------------------------------------

test("S15B-19  the package mutates no routing state", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/\bawait\s/.test(text), `${file} performs async work; this package is pure`);
    assert.ok(!/redis|supabase|createClient|fetch\(/i.test(text), `${file} reaches for I/O`);
  }
});

test("S15B-20  setRoutingControl is never called", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/setRoutingControl|setRuntimeRoutingControl/.test(text), `${file} sets a routing control`);
  }
  // The prohibition is documented in prose, so prove the scan sees code only.
  const raw = read("src/lib/finops/cost-guard.ts");
  assert.ok(raw.includes("setRoutingControl"), "the comment naming the rule still exists");
  assert.ok(!stripComments(raw).includes("setRoutingControl"), "and it is only a comment");
});

test("S15B-21  clearRoutingControl is never called", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/clearRoutingControl/.test(text), `${file} clears a routing control`);
  }
});

test("S15B-22  no Phase 21 feature-flag system is introduced", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/percentageRollout|rolloutPercent|canary|progressiveDelivery|featureFlag/i.test(text),
      `${file} contains Phase 21 vocabulary`);
    assert.ok(!/routing-control-store|admin-route-service/.test(text), `${file} imports a control writer`);
  }
});

test("S15B-23  Phase 7's target taxonomy is reused, not duplicated", () => {
  const guardSrc = read("src/lib/finops/cost-guard.ts");
  assert.match(guardSrc, /import type \{ FlagTargetKind \} from "@\/lib\/routing\/runtime-flags"/);

  // No local re-declaration of the kinds.
  for (const { file, text } of finopsCode) {
    assert.ok(!/type\s+\w*TargetKind\s*=/.test(text), `${file} declares its own target kinds`);
  }

  // The cost state union is built from Phase 7's, not copied beside it.
  const contract = read("src/lib/finops/cost-contract.ts");
  assert.match(contract, /CostState as RoutingCostState/);
  assert.match(contract, /export type CostState = RoutingCostState \| "unavailable" \| "invalid"/);

  // And the arithmetic is Phase 7's, so the router and the guard cannot quote
  // different numbers for the same request.
  assert.match(contract, /normalizeRoutingCost\(/);
});

// ---------------------------------------------------------------------------
// 24–28  13-D OWNS ALERTING
// ---------------------------------------------------------------------------

test("S15B-24  the cost alert source and both types are registered in 13-D", () => {
  assert.equal(ALERT_CATALOGUE.cost_budget_at_risk.source, "cost");
  assert.equal(ALERT_CATALOGUE.cost_budget_exhausted.source, "cost");
  assert.equal(ALERT_CATALOGUE.cost_budget_at_risk.severity, "WARNING");
  assert.equal(ALERT_CATALOGUE.cost_budget_exhausted.severity, "ERROR");
  // Provider economics never reach the public status page.
  assert.equal(ALERT_CATALOGUE.cost_budget_at_risk.userVisible, false);
  assert.equal(ALERT_CATALOGUE.cost_budget_exhausted.userVisible, false);
});

test("S15B-25  AT_RISK emits cost_budget_at_risk through the 13-D router", () => {
  const seen = captureAlerts();
  const result = alertOnCostGuard(guard(budget({ limit: 10 }), 8.5));
  assert.equal(result?.outcome, "emitted");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.type, "cost_budget_at_risk");
  assert.equal(seen[0]?.severity, "WARNING", "severity comes from the catalogue");
  assert.equal(seen[0]?.resource, "provider_fal_24h");
  assert.equal(seen[0]?.dedupeKey, "cost:cost_budget_at_risk:provider_fal_24h");
  clearAlertSinks();
});

test("S15B-26  BUDGET_EXHAUSTED emits cost_budget_exhausted through the 13-D router", () => {
  const seen = captureAlerts();
  const result = alertOnCostGuard(guard(budget({ limit: 1 }), 0, observe({ providerUnitCost: 5 })));
  assert.equal(result?.outcome, "emitted");
  assert.equal(seen[0]?.type, "cost_budget_exhausted");
  assert.equal(seen[0]?.severity, "ERROR");

  // An UNKNOWN raises nothing and, critically, resolves nothing: going blind
  // must not clear a standing breach.
  const before = seen.length;
  assert.equal(alertOnCostGuard(guard(budget({ limit: 1 }), 0, observe(null))), null);
  assert.equal(seen.length, before);

  // Recovery does clear it.
  assert.equal(alertOnCostGuard(guard(budget({ limit: 100 }), 1)), null);
  clearAlertSinks();
});

test("S15B-27  neither cost alert is eligible for AI remediation", () => {
  for (const type of ["cost_budget_at_risk", "cost_budget_exhausted"] as const) {
    const d = analyzeIncident({
      alertId: "a1", type, source: "cost", severity: "ERROR", resource: "provider_fal_24h",
      reasonCode: "projected_spend_over_limit", dedupeKey: `cost:${type}:provider_fal_24h`,
      state: "ACTIVE", firstSeen: NOW.toISOString(), lastSeen: NOW.toISOString(),
      occurrenceCount: 1, channels: [], correlation: {},
    });
    assert.equal(d.outcome, "HUMAN_INVESTIGATION_REQUIRED", `${type} must not be auto-remediated`);
  }
});

test("S15B-28  no second alert router, severity table or dedupe store exists", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/dedupeKeyFor|ESCALATION|new Map\(/.test(text), `${file} keeps alert state`);
    assert.ok(!/"CRITICAL"|"WARNING"|severity:/.test(text), `${file} decides a severity`);
    assert.ok(!/telegram|slack|sendgrid|smtp|webhook/i.test(text), `${file} delivers directly`);
  }
  const bridge = read("src/lib/finops/cost-alert-bridge.ts");
  assert.match(bridge, /from "@\/lib\/alerts\/alert-router"/, "it uses the existing router");
});

// ---------------------------------------------------------------------------
// 29–30  13-E OWNS THE TELEMETRY BOUNDARY
// ---------------------------------------------------------------------------

test("S15B-29  every emitted telemetry field survives the Sensitive Data Guard", () => {
  const fields = costTelemetryFields(guard(budget({ limit: 10 }), 8.5));
  const out = sanitizeTelemetry({ level: "warn", event: "cost.budget", subsystem: "finops", fields });
  assert.equal(out.droppedFieldCount, 0, `dropped: ${JSON.stringify(fields)}`);
  assert.equal(out.fields.decision, "at_risk");
  assert.equal(out.fields.budgetScope, "provider");
  assert.equal(out.fields.costBasis, "estimate_based");
  assert.equal(out.fields.currency, "USD", "ISO 4217 keeps its standard spelling");

  // The trap this lowercasing avoids: 13-E validates `code` fields against a
  // lowercase-only pattern, so an uppercase enum is DROPPED, not truncated —
  // producing a cost alert with no decision in it.
  const raw = sanitizeTelemetry({
    level: "warn", event: "cost.budget", subsystem: "finops", fields: { decision: "AT_RISK" },
  });
  assert.equal(raw.droppedFieldCount, 1, "the drop hazard is real");
});

test("S15B-30  money is emitted as integer micro-units, so small costs are not rounded to free", () => {
  assert.equal(MICROS_PER_UNIT, 1_000_000);
  assert.equal(toCostMicros(0.04), 40_000);
  assert.equal(toCostMicros(0.000001), 1);
  assert.equal(toCostMicros(-1), null);
  assert.equal(toCostMicros(Number.NaN), null);
  assert.equal(toCostMicros(Number.POSITIVE_INFINITY), null);

  // The hazard this exists for: the redactor rounds `count` fields, so a raw
  // float of 0.04 would be recorded as 0 — a cost log claiming it was free.
  const raw = sanitizeTelemetry({
    level: "info", event: "x", subsystem: "finops", fields: { costMicros: 0.04 },
  });
  assert.equal(raw.fields.costMicros, 0, "the rounding hazard is real");

  const cheap = guard(budget({ limit: 10 }), 0, observe({ providerUnitCost: 0.04 }));
  const out = sanitizeTelemetry({
    level: "info", event: "x", subsystem: "finops", fields: costTelemetryFields(cheap),
  });
  assert.equal(out.fields.costMicros, 40_000, "and micro-units avoid it");

  // Nothing unbounded reaches telemetry.
  for (const value of Object.values(costTelemetryFields(cheap))) {
    if (typeof value === "string") assert.ok(value.length <= 64, `unbounded field: ${value}`);
  }
});

// ---------------------------------------------------------------------------
// 31–35  PHASE 10 OWNS THE LEDGER
// ---------------------------------------------------------------------------

test("S15B-31  no credit ledger or wallet write exists in the package", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/credit_ledger|credit_wallets|creditLedger|creditWallet/.test(text), `${file} touches the ledger`);
  }
});

test("S15B-32  reserveCredits is never called", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/reserveCredits|reserve_credits/.test(text), `${file} reserves credits`);
  }
});

test("S15B-33  settleReservation is never called", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/settleReservation|settle_reservation/.test(text), `${file} settles a reservation`);
  }
});

test("S15B-34  releaseReservation and refunds are never called", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/releaseReservation|release_reservation|refund/i.test(text), `${file} releases or refunds`);
  }
});

test("S15B-35  no Stripe mutation exists", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/stripe/i.test(text), `${file} references Stripe`);
  }
});

// ---------------------------------------------------------------------------
// 36–39  EXTERNAL TRUTH STAYS EXTERNAL; NOTHING ELSE WAS TOUCHED
// ---------------------------------------------------------------------------

test("S15B-36  no AWS or provider invoice figure is fabricated", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/costExplorer|cost_explorer|invoiceTotal|invoice_total|billingPeriod/i.test(text),
      `${file} invents an external billing figure`);
  }
  // Every cost this batch can produce declares itself an estimate.
  assert.equal(observe({}).basis, "ESTIMATE_BASED");
  assert.equal(aggregateCost([observe({})]).basis, "ESTIMATE_BASED");
  const contract = stripComments(read("src/lib/finops/cost-contract.ts"));
  assert.ok(!/"OBSERVED_ACTUAL" as const|basis: "OBSERVED_ACTUAL"/.test(contract),
    "no code path produces OBSERVED_ACTUAL");
});

test("S15B-37  the package makes no external API call", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/https?:\/\//.test(text), `${file} contains a URL`);
    assert.ok(!/process\.env/.test(text), `${file} reads the environment`);
  }
});

test("S15B-38  no UI was added, and no locked route was touched", () => {
  assert.equal(finopsFiles.some((f) => f.endsWith(".tsx")), false);
  for (const { file, text } of finopsCode) {
    assert.ok(!/react|use client|jsx/i.test(text), `${file} contains UI`);
  }
});

test("S15B-39  no migration was created, and cost_amount is not written", () => {
  const migrations = readdirSync(path.join(ROOT, "supabase", "migrations"));
  assert.equal(migrations.some((m) => /finops|cost_budget|15b/i.test(m)), false);
  for (const { file, text } of finopsCode) {
    assert.ok(!/cost_amount|costAmount/.test(text), `${file} writes observed spend it does not have`);
  }
});

// ---------------------------------------------------------------------------
// 40  THE REGISTRY IS HONEST ABOUT BEING EMPTY
// ---------------------------------------------------------------------------

test("S15B-40  the production registry defines no invented limits, and validates any that are added", () => {
  assert.deepEqual([...COST_BUDGETS], [], "a fabricated ceiling is worse than none");
  for (const b of COST_BUDGETS) {
    assert.ok(defineCostBudget(b).ok, `registered budget ${b.id} is malformed`);
  }
  // The machinery is complete: a real budget validates the moment it is added.
  assert.ok(defineCostBudget(budget()).ok);
  assert.equal(defineCostBudget(budget({ id: "Not A Slug" })).ok, false);
  assert.equal(defineCostBudget(budget({ atRiskRatio: 1 })).ok, false);
  assert.equal(defineCostBudget(budget({ windowSeconds: 0 })).ok, false);
  assert.equal(defineCostBudget(budget({ currency: "US" })).ok, false);
});
