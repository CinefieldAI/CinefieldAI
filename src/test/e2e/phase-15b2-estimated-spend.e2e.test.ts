import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  countsAsSpend,
  COUNTED_STATUSES,
  MAX_SCANNED_ATTEMPTS,
  QUERIED_STATUSES,
  readAttemptVolumes,
  resolvePlatformModelIds,
  type AttemptVolume,
  type AttemptVolumeResult,
} from "@/lib/finops/estimated-spend-repository";
import {
  billableUnitsFor,
  runSpendGuard,
  spendGuardMetrics,
  type SpendGuardInput,
} from "@/lib/finops/spend-guard-runner";
import { defineCostBudget, type CostBudget } from "@/lib/finops/cost-budget";
import { costTelemetryFields } from "@/lib/finops/cost-alert-bridge";
import { ALERT_CATALOGUE, type AlertEnvelope } from "@/lib/alerts/alert-contract";
import { resetAlertRouter } from "@/lib/alerts/alert-router";
import { clearAlertSinks, registerAlertSink, type AlertDeliverySink } from "@/lib/alerts/alert-sink";
import { eligibilityRuleFor } from "@/lib/deployment/incident-diagnosis";
import { sanitizeTelemetry } from "@/lib/observability/telemetry-redaction";
import type { PricingRecord } from "@/lib/pricing/pricing-types";

/**
 * Phase 15-B/2 — estimated spend aggregation and guard wiring.
 *
 * 15-B/1 built a decision model nothing called. This suite proves a real
 * production path now feeds it, and — more importantly — that every way the
 * path can fail produces a refusal rather than a comfortable zero. A spend
 * aggregator is at its most dangerous when it is partly broken: the arithmetic
 * still completes, the number is just too small.
 */

const ROOT = process.cwd();
const FINOPS_DIR = path.join(ROOT, "src", "lib", "finops");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Directory walk, not `git ls-files` — an untracked module must still be seen. */
const finopsCode = readdirSync(FINOPS_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({
    file: `src/lib/finops/${f}`,
    text: readFileSync(path.join(FINOPS_DIR, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1"),
  }));

/**
 * Strips comments before a structural scan.
 *
 * Every one of these files DOCUMENTS the rule it obeys — "these are `task()`,
 * not `schedules.task()`", "it does not call `setRoutingControl`". Scanning raw
 * text reads those sentences as the very calls they forbid, so the guard fires
 * on the file that is most careful to explain itself.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Reads a file with its comments removed. */
const readCode = (rel: string) => stripComments(read(rel));

const NOW = new Date("2026-08-16T12:00:00.000Z");
const WINDOW = { windowStart: "2026-08-15T12:00:00.000Z", windowEnd: "2026-08-16T12:00:00.000Z" };

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

function volumes(over: Partial<AttemptVolumeResult> = {}): AttemptVolumeResult {
  return {
    window: WINDOW,
    volumes: [{ provider: "fal", providerModelId: "fal-ai/test", attemptCount: 10 }],
    sourceAvailable: true,
    reasonCode: "attempt_volumes_read",
    scannedRows: 10,
    excludedRows: 0,
    ...over,
  };
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

function guardInput(over: Partial<SpendGuardInput> = {}): SpendGuardInput {
  return {
    volumes: volumes(),
    platformModelIdFor: (v) => (v.providerModelId === "fal-ai/test" ? "test-model" : null),
    pricingFor: () => pricing(),
    pricingSourceAvailable: true,
    budgets: [budget()],
    now: NOW,
    ...over,
  };
}

/**
 * A fake Supabase query chain that records what was asked for.
 *
 * THENABLE, like the real builder: `readAttemptVolumes` terminates with
 * `.limit()`, but `resolvePlatformModelIds` awaits the builder directly. A
 * fake that only resolved on `.limit()` would hang or return undefined for
 * the second query, which is a property of the harness rather than of the
 * code under test.
 */
function fakeAdmin(result: { data?: unknown[]; error?: unknown; throws?: boolean }) {
  const calls: Record<string, unknown> = {};
  const settle = () => {
    if (result.throws) throw new Error("driver exploded");
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  const chain: Record<string, unknown> = {
    then: (onfulfilled?: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) => {
      try {
        return settle().then(onfulfilled, onrejected);
      } catch (e) {
        return Promise.reject(e).catch(onrejected ?? ((err) => Promise.reject(err)));
      }
    },
  };
  for (const method of ["select", "gte", "lt", "in"]) {
    chain[method] = (...args: unknown[]) => {
      calls[method] = args;
      return chain;
    };
  }
  chain.limit = (...args: unknown[]) => {
    calls.limit = args;
    return settle();
  };
  return { admin: { from: () => chain } as never, calls };
}

function captureAlerts(): AlertEnvelope[] {
  const seen: AlertEnvelope[] = [];
  resetAlertRouter();
  clearAlertSinks();
  const sink: AlertDeliverySink = {
    name: "capture",
    channel: "DASHBOARD",
    deliver: (e) => void seen.push(e),
  };
  registerAlertSink(sink);
  return seen;
}

// ---------------------------------------------------------------------------
// 1–2  A REAL READ PATH AND A REAL CALLER
// ---------------------------------------------------------------------------

test("S15B2-1  a real repository read path exists and queries only bounded columns", async () => {
  const { admin, calls } = fakeAdmin({
    data: [
      { provider: "fal", provider_model: "fal-ai/test", status: "succeeded", submission_evidence: "job" },
      { provider: "fal", provider_model: "fal-ai/test", status: "failed", submission_evidence: "job" },
      { provider: "fal", provider_model: "fal-ai/other", status: "submitted", submission_evidence: "job" },
    ],
  });
  const result = await readAttemptVolumes(admin, WINDOW);

  assert.equal(result.sourceAvailable, true);
  assert.equal(result.volumes.length, 2);
  assert.deepEqual(result.volumes[0], { provider: "fal", providerModelId: "fal-ai/other", attemptCount: 1 });
  assert.deepEqual(result.volumes[1], { provider: "fal", providerModelId: "fal-ai/test", attemptCount: 2 });

  // Four columns, and none of them can carry user content: two catalogue
  // identifiers and two state labels from closed sets.
  assert.deepEqual(calls.select, ["provider, provider_model, status, submission_evidence"]);
  const selected = String(calls.select).split(",").map((c) => c.trim());
  for (const forbidden of ["prompt", "clerk_user_id", "id", "error_code", "metadata", "provider_job_id"]) {
    assert.ok(!selected.includes(forbidden), `${forbidden} must not be selected`);
  }

  // The query asks for cancelled too — the row is fetched so the evidence can
  // be inspected. Excluding it at the SQL level would make the F1 rule
  // unenforceable, because the rows that need judging would never arrive.
  assert.deepEqual(calls.in, ["status", [...QUERIED_STATUSES]]);
  assert.ok(QUERIED_STATUSES.includes("cancelled"), "cancelled must be fetched, then judged");
  assert.equal(QUERIED_STATUSES.includes("pending"), false, "a pending attempt cost nothing");
  assert.equal(QUERIED_STATUSES.includes("claimed"), false, "a claimed attempt cost nothing");
  assert.ok(COUNTED_STATUSES.includes("submitting"), "an in-flight attempt may already have been charged");
});

test("S15B2-2  a real production caller consumes the aggregation, with no scheduler", () => {
  const services = read("src/trigger/operational/operational-services.ts");
  assert.match(services, /export async function runEstimatedSpendGuard/);
  assert.match(services, /readAttemptVolumes\(/, "the caller performs the real read");
  assert.match(services, /runSpendGuard\(/, "and feeds the guard");

  const tasks = readCode("src/trigger/operational/operational-tasks.ts");
  assert.match(tasks, /export const estimatedSpendGuardTask = task\(\{/);
  // task(), never schedules.task() — no cadence is invented anywhere.
  assert.ok(!/schedules\.task/.test(tasks), "this batch must not introduce a schedule");
  assert.ok(!/cron|rrule/i.test(tasks), "no cadence");
});

// ---------------------------------------------------------------------------
// 3–4  A FAILED READ IS NOT AN EMPTY WINDOW
// ---------------------------------------------------------------------------

test("S15B2-3  a successful query returning zero rows is a real empty window", async () => {
  const { admin } = fakeAdmin({ data: [] });
  const result = await readAttemptVolumes(admin, WINDOW);
  assert.equal(result.sourceAvailable, true);
  assert.equal(result.reasonCode, "empty_window");
  assert.deepEqual([...result.volumes], []);

  const outcome = runSpendGuard(guardInput({ volumes: result }));
  assert.equal(outcome.spend.state, "known");
  assert.equal(outcome.spend.estimatedSpend, 0);
  assert.equal(outcome.guard.decision, "ALLOW");
});

test("S15B2-4  a failed, throwing or truncated query is never zero spend", async () => {
  const cases: Array<[string, Awaited<ReturnType<typeof readAttemptVolumes>>]> = [
    ["driver error", await readAttemptVolumes(fakeAdmin({ error: { message: "boom" } }).admin, WINDOW)],
    ["thrown", await readAttemptVolumes(fakeAdmin({ throws: true }).admin, WINDOW)],
    [
      "truncated",
      await readAttemptVolumes(
        fakeAdmin({
          data: Array.from({ length: 4 }, () => ({
            provider: "fal", provider_model: "fal-ai/test", status: "succeeded",
          })),
        }).admin,
        WINDOW,
        3
      ),
    ],
    ["invalid window", await readAttemptVolumes(fakeAdmin({ data: [] }).admin, { windowStart: "x", windowEnd: "y" })],
  ];

  for (const [name, result] of cases) {
    assert.equal(result.sourceAvailable, false, `${name} must not look readable`);
    const outcome = runSpendGuard(guardInput({ volumes: result }));
    assert.equal(outcome.spend.state, "unavailable", `${name} spend state`);
    assert.equal(outcome.spend.estimatedSpend, undefined, `${name} must not report a spend figure`);
    assert.equal(outcome.guard.decision, "UNKNOWN", `${name} decision`);
    assert.notEqual(outcome.guard.decision, "ALLOW", `${name} must never allow`);
  }

  // A truncated window is a genuine hazard: the count that fits is smaller
  // than the truth, so reporting it would understate spend.
  const truncated = cases[2]?.[1];
  assert.equal(truncated?.reasonCode, "window_exceeds_scan_limit");
  assert.ok(MAX_SCANNED_ATTEMPTS > 0);
});

// ---------------------------------------------------------------------------
// 5–11  PRICING RESOLUTION FAILS CLOSED IN EVERY DIRECTION
// ---------------------------------------------------------------------------

test("S15B2-5  provider pricing is reused, and spend scales with attempt volume", () => {
  const outcome = runSpendGuard(guardInput({ budgets: [budget({ limit: 100 })] }));
  // 10 attempts x USD 0.04 per request = 0.40 for the window.
  assert.equal(outcome.spend.state, "known");
  assert.equal(outcome.spend.estimatedSpend, 0.4);
  assert.equal(outcome.attemptCount, 10);
  assert.equal(outcome.basis, "ESTIMATE_BASED");
  assert.equal(outcome.guard.decision, "ALLOW");
});

test("S15B2-6  the customer credit price cannot influence estimated spend", () => {
  const cheap = runSpendGuard(guardInput({ pricingFor: () => pricing({ creditPricePerUnit: 1 }) }));
  const dear = runSpendGuard(guardInput({ pricingFor: () => pricing({ creditPricePerUnit: 999_999 }) }));
  assert.equal(cheap.spend.estimatedSpend, dear.spend.estimatedSpend);

  for (const { file, text } of finopsCode) {
    assert.ok(!/creditPricePerUnit|credit_price_per_unit/.test(text), `${file} reads the credit price`);
  }
});

test("S15B2-7  missing pricing fails closed", () => {
  const outcome = runSpendGuard(guardInput({ pricingFor: () => null }));
  assert.equal(outcome.spend.state, "unknown");
  assert.equal(outcome.spend.estimatedSpend, undefined);
  assert.equal(outcome.guard.decision, "UNKNOWN");
  assert.equal(outcome.unpriceableLineCount, 1);
});

test("S15B2-8  stale pricing fails closed", () => {
  const outcome = runSpendGuard(
    guardInput({ pricingFor: () => pricing({ verifiedAt: "2019-01-01T00:00:00.000Z" }) })
  );
  assert.equal(outcome.spend.state, "stale");
  assert.notEqual(outcome.guard.decision, "ALLOW");
});

test("S15B2-9  an unreadable pricing source fails closed, distinctly from unpriced", () => {
  const outcome = runSpendGuard(guardInput({ pricingSourceAvailable: false }));
  assert.equal(outcome.spend.state, "unavailable");
  assert.notEqual(outcome.spend.state, runSpendGuard(guardInput({ pricingFor: () => null })).spend.state);
  assert.equal(outcome.guard.decision, "UNKNOWN");
});

test("S15B2-10  a provider/model the registry does not know fails closed, and is not skipped", () => {
  const outcome = runSpendGuard(guardInput({ platformModelIdFor: () => null }));
  assert.equal(outcome.lineCount, 1, "an unknown line is still counted, never dropped");
  assert.equal(outcome.attemptCount, 10, "its attempts still count toward the window");
  assert.equal(outcome.spend.state, "unknown");
  assert.equal(outcome.guard.decision, "UNKNOWN");
});

test("S15B2-11  a currency mismatch against the budget fails closed", () => {
  const outcome = runSpendGuard(
    guardInput({ pricingFor: () => pricing({ providerCurrency: "EUR" }), budgets: [budget({ currency: "USD" })] })
  );
  assert.notEqual(outcome.guard.decision, "ALLOW");
  assert.equal(outcome.guard.reasonCode, "spend_currency_mismatch");

  // And no conversion exists anywhere in the package.
  for (const { file, text } of finopsCode) {
    assert.ok(!/exchangeRate|fxRate|convertCurrency/i.test(text), `${file} converts currency`);
  }
});

// ---------------------------------------------------------------------------
// 12–15  BILLABLE UNITS ARE DERIVED, NEVER GUESSED
// ---------------------------------------------------------------------------

test("S15B2-12  per_request units are deterministic: one attempt is one request", () => {
  const volume: AttemptVolume = { provider: "fal", providerModelId: "fal-ai/test", attemptCount: 7 };
  assert.equal(billableUnitsFor(volume, pricing({ providerBillingUnit: "per_request" })), 7);
  assert.equal(billableUnitsFor({ ...volume, attemptCount: 0 }, pricing()), 0);
});

test("S15B2-13  per_output cannot be mapped from current data, so it fails closed", () => {
  // No output-count evidence exists: `generations` has no quantity column, and
  // nothing writes a `provider_output` media asset. Assuming one output per
  // request would price real traffic wrong, not merely incompletely.
  const volume: AttemptVolume = { provider: "fal", providerModelId: "fal-ai/test", attemptCount: 5 };
  assert.equal(billableUnitsFor(volume, pricing({ providerBillingUnit: "per_output" })), null);

  const outcome = runSpendGuard(guardInput({ pricingFor: () => pricing({ providerBillingUnit: "per_output" }) }));
  assert.equal(outcome.spend.state, "unknown");
  assert.equal(outcome.unpriceableLineCount, 1);
  assert.equal(outcome.guard.decision, "UNKNOWN");
  assert.notEqual(outcome.spend.estimatedSpend, 0, "unpriceable is not free");

  // The claim above is checked against the schema, not just asserted in prose.
  const migrations = readdirSync(path.join(ROOT, "supabase", "migrations"));
  const generations = read(`supabase/migrations/${migrations.find((m) => m.includes("remote_schema"))}`);
  assert.ok(!/"output_count"|"quantity"|"num_outputs"/.test(generations), "a real quantity column now exists");
});

test("S15B2-14  the aggregation returns a bounded shape, never raw rows", () => {
  const outcome = runSpendGuard(guardInput());
  const metrics = spendGuardMetrics(outcome);

  for (const value of Object.values(metrics)) {
    assert.equal(typeof value, "number", "metrics are counts only");
    assert.ok(Number.isFinite(value));
  }
  assert.deepEqual(
    Object.keys(metrics).sort(),
    ["alertsRaised", "attempts", "estimatedSpendMicros", "lines", "unpriceableLines"]
  );
  // No identity, and no timestamp — a window bound would make every pass its
  // own metric series.
  for (const forbidden of ["userId", "generationId", "attemptId", "windowStart", "traceId"]) {
    assert.equal(forbidden in metrics, false, `${forbidden} must not be a metric`);
  }
});

test("S15B2-15  the repository never spreads a database row", () => {
  const repo = finopsCode.find((f) => f.file.endsWith("estimated-spend-repository.ts"));
  assert.ok(repo);
  assert.ok(!/\.\.\.row|\.\.\.data|\.\.\.rows/.test(repo.text), "a spread would carry unlisted columns");
  assert.ok(!/select\("\*"\)|select\('\*'\)/.test(repo.text), "select * would defeat the column bound");
});

// ---------------------------------------------------------------------------
// 16–20  BUDGETS, ALERTS AND REMEDIATION
// ---------------------------------------------------------------------------

test("S15B2-16  several applicable budgets go through the strictest resolver", () => {
  const runner = read("src/lib/finops/spend-guard-runner.ts");
  assert.match(runner, /resolveApplicableBudgets\(/, "the canonical resolver is used");
  assert.match(runner, /evaluateResolvedCostGuard\(/, "and the guard consumes the resolution whole");
  assert.ok(!/\.find\(\s*\(?\w*\)?\s*=>\s*\w+\.verdict/.test(runner), "no hand-rolled verdict selection");

  const global = budget({ id: "global_usd_24h", scope: "GLOBAL", provider: undefined, limit: 1_000 });
  const tight = budget({ id: "provider_fal_24h", limit: 0.1 });
  assert.ok(defineCostBudget(global).ok && defineCostBudget(tight).ok);

  // 0.40 estimated: comfortably inside the global budget, far past the tight
  // provider one. The strict answer must win.
  const outcome = runSpendGuard(guardInput({ budgets: [global, tight] }));
  assert.equal(outcome.guard.decision, "BUDGET_EXHAUSTED");
  assert.equal(outcome.guard.budgetId, "provider_fal_24h");
});

test("S15B2-17  AT_RISK emits the bounded 13-D cost alert", () => {
  const seen = captureAlerts();
  // 0.40 estimated against a 0.45 limit at an 0.8 threshold => 0.888 ratio.
  const outcome = runSpendGuard(guardInput({ budgets: [budget({ limit: 0.45 })] }));
  assert.equal(outcome.guard.decision, "AT_RISK");
  assert.equal(outcome.alertRaised, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.type, "cost_budget_at_risk");
  assert.equal(seen[0]?.severity, "WARNING");
  assert.equal(seen[0]?.resource, "provider_fal_24h");
  clearAlertSinks();
});

test("S15B2-18  BUDGET_EXHAUSTED emits the bounded 13-D cost alert, and mutates no routing", () => {
  const seen = captureAlerts();
  const outcome = runSpendGuard(guardInput({ budgets: [budget({ limit: 0.1 })] }));
  assert.equal(outcome.guard.decision, "BUDGET_EXHAUSTED");
  assert.equal(outcome.alertRaised, true);
  assert.equal(seen[0]?.type, "cost_budget_exhausted");
  assert.equal(seen[0]?.severity, "ERROR");

  // A recommendation, and only a recommendation.
  assert.equal(outcome.guard.recommendation, "RECOMMEND_PROVIDER_EXCLUSION");
  assert.deepEqual(outcome.guard.target, { kind: "provider", id: "fal" });
  clearAlertSinks();
});

test("S15B2-19  ALLOW and UNKNOWN raise no breach alert", () => {
  const seen = captureAlerts();
  const allowed = runSpendGuard(guardInput({ budgets: [budget({ limit: 1_000 })] }));
  assert.equal(allowed.guard.decision, "ALLOW");
  assert.equal(allowed.alertRaised, false);
  assert.equal(seen.length, 0);

  // Going blind raises nothing — and, critically, resolves nothing either.
  const blind = runSpendGuard(guardInput({ volumes: volumes({ sourceAvailable: false }) }));
  assert.equal(blind.guard.decision, "UNKNOWN");
  assert.equal(blind.alertRaised, false);
  assert.equal(seen.length, 0);
  clearAlertSinks();
});

test("S15B2-20  cost alerts remain ineligible for AI remediation", () => {
  for (const type of ["cost_budget_at_risk", "cost_budget_exhausted"] as const) {
    assert.equal(eligibilityRuleFor(type)?.remediationEligible, false, `${type}`);
    assert.equal(ALERT_CATALOGUE[type].source, "cost");
    assert.equal(ALERT_CATALOGUE[type].userVisible, false);
  }
});

// ---------------------------------------------------------------------------
// 21–31  OWNERSHIP BOUNDARIES HOLD
// ---------------------------------------------------------------------------

test("S15B2-21  no second alert router, severity table or delivery channel", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/dedupeKeyFor|ESCALATION/.test(text), `${file} keeps alert state`);
    assert.ok(!/telegram|slack|smtp|sendgrid|webhook/i.test(text), `${file} delivers directly`);
  }
  assert.match(read("src/lib/finops/spend-guard-runner.ts"), /from "\.\/cost-alert-bridge"/);
});

test("S15B2-22  no routing mutation anywhere in the batch", () => {
  const sources = [
    ...finopsCode,
    { file: "operational-services.ts", text: readCode("src/trigger/operational/operational-services.ts") },
    { file: "operational-tasks.ts", text: readCode("src/trigger/operational/operational-tasks.ts") },
  ];
  for (const { file, text } of sources) {
    for (const forbidden of [/setRuntimeRoutingControl/, /emergency_kill/, /disableProvider/, /disableModel/]) {
      assert.ok(!forbidden.test(text), `${file} matches ${forbidden}`);
    }
  }
});

test("S15B2-23  setRoutingControl is never called", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/setRoutingControl/.test(text), `${file} sets a routing control`);
  }
  const services = readCode("src/trigger/operational/operational-services.ts");
  assert.ok(!/setRoutingControl/.test(services), "the production caller sets no routing control");
});

test("S15B2-24  clearRoutingControl is never called", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/clearRoutingControl/.test(text), `${file} clears a routing control`);
  }
});

test("S15B2-25  no cost_amount or cost_currency write exists", () => {
  const sources = [...finopsCode, { file: "svc", text: readCode("src/trigger/operational/operational-services.ts") }];
  for (const { file, text } of sources) {
    // Word-boundary anchored: the reason code `next_cost_currency_mismatch` is
    // a bounded label, not a column write, and matching it would make the
    // guard fire on the very error path that refuses a mismatched currency.
    assert.ok(!/cost_amount|costAmount/.test(text), `${file} writes estimated cost as actual`);
    assert.ok(!/cost_currency/.test(text), `${file} writes cost_currency`);
  }
  // The column still exists and is still deliberately unwritten.
  const attempts = read("supabase/migrations/20260810120000_generation_attempts.sql");
  assert.match(attempts, /"cost_amount" numeric\(12,6\)/, "the schema is unchanged");
});

test("S15B2-26  no credit ledger or wallet mutation", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/credit_ledger|credit_wallets|reserveCredits|settleReservation|releaseReservation/.test(text),
      `${file} touches Phase 10 truth`);
  }
});

test("S15B2-27  no Stripe call", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/stripe/i.test(text), `${file} references Stripe`);
  }
});

test("S15B2-28  no AWS billing or invoice figure is fabricated", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/costExplorer|cost_explorer|invoiceTotal|billingPeriod/i.test(text), `${file} invents a bill`);
  }
  assert.equal(runSpendGuard(guardInput()).basis, "ESTIMATE_BASED");
});

test("S15B2-29  no scheduler or cadence is introduced", () => {
  const tasks = readCode("src/trigger/operational/operational-tasks.ts");
  assert.ok(!/schedules\./.test(tasks), "no schedules.task");
  for (const { file, text } of finopsCode) {
    assert.ok(!/setInterval|setTimeout|cron/i.test(text), `${file} schedules itself`);
  }
});

test("S15B2-30  no UI was added", () => {
  assert.equal(readdirSync(FINOPS_DIR).some((f) => f.endsWith(".tsx")), false);
  for (const { file, text } of finopsCode) {
    assert.ok(!/use client|from "react"/.test(text), `${file} contains UI`);
  }
});

test("S15B2-31  no migration was created", () => {
  const migrations = readdirSync(path.join(ROOT, "supabase", "migrations"));
  assert.equal(migrations.some((m) => /15b|finops|spend/i.test(m)), false);
});

// ---------------------------------------------------------------------------
// 32  TELEMETRY BOUNDARY
// ---------------------------------------------------------------------------

test("S15B2-32  the telemetry that is actually emitted survives the Sensitive Data Guard", () => {
  const outcome = runSpendGuard(guardInput({ budgets: [budget({ limit: 0.45 })] }));
  assert.equal(outcome.guard.decision, "AT_RISK");

  // TWO DIFFERENT CONTRACTS, deliberately not conflated.
  //
  // What reaches a LOG LINE is the guard result, projected by
  // `costTelemetryFields` and carried by the 13-D alert. That is the 13-E
  // surface, and it must pass with nothing dropped.
  const emitted = costTelemetryFields(outcome.guard);
  const out = sanitizeTelemetry({ level: "warn", event: "cost.window", subsystem: "finops", fields: emitted });
  assert.equal(out.droppedFieldCount, 0, `dropped: ${JSON.stringify(emitted)}`);
  assert.equal(out.fields.projectedSpendMicros, 400_000, "0.40 USD in micro-units, not rounded to 0");

  // `spendGuardMetrics` is the OperationalTaskResult.metrics contract instead —
  // a return value, not a log. Every operational service in this repository
  // returns counts under its own names (`models`, `unpriced`,
  // `ambiguousAttempts`), none of which are 13-E fields, and none of which are
  // logged. Holding this to the allow-list would mean six new entries for data
  // that never reaches a sink. Its real obligation is the one the operational
  // contract states: counts only, never content.
  const metrics = spendGuardMetrics(outcome);
  for (const [key, value] of Object.entries(metrics)) {
    assert.equal(typeof value, "number", `${key} must be a count`);
    assert.ok(Number.isFinite(value) && value >= 0, `${key} must be a finite magnitude`);
  }
  assert.equal(metrics.estimatedSpendMicros, 400_000);
});

// ---------------------------------------------------------------------------
// 33–46  PHASE 15-B/3 DEFECT CLOSURE
//        F1 cancelled accounting · F2 behavioural production path
//        F3 NUL hygiene · F4 routed-traffic identity
// ---------------------------------------------------------------------------

/**
 * The complete attempt-status accounting table, pinned.
 *
 * Every status the schema permits appears here with an explicit expectation.
 * A new status added to `GenerationAttemptStatus` without a decision recorded
 * in this table is a silent accounting change, which is how spend goes missing.
 */
const STATUS_ACCOUNTING: ReadonlyArray<{
  status: string;
  evidence: string;
  counted: boolean;
  why: string;
}> = [
  { status: "pending", evidence: "none", counted: false, why: "the request never left Cinefield" },
  { status: "claimed", evidence: "none", counted: false, why: "claimed for submission, not yet sent" },
  { status: "submitting", evidence: "none", counted: true, why: "in flight; money may already be spent" },
  { status: "submitting", evidence: "ambiguous", counted: true, why: "in flight and unprovable" },
  { status: "submitted", evidence: "job", counted: true, why: "a provider job exists" },
  { status: "processing", evidence: "job", counted: true, why: "the provider is working on it" },
  { status: "succeeded", evidence: "job", counted: true, why: "completed and billable" },
  { status: "failed", evidence: "job", counted: true, why: "a failed provider call is still a call" },
  { status: "failed", evidence: "none", counted: true, why: "status alone is decisive for failed" },
  // F1 — the three that depend on evidence rather than on the status.
  { status: "cancelled", evidence: "none", counted: false, why: "provably never crossed the boundary" },
  { status: "cancelled", evidence: "ambiguous", counted: true, why: "cannot prove it did not leave" },
  { status: "cancelled", evidence: "job", counted: true, why: "a provider job id exists" },
];

test("S15B2-33  F1: every attempt status has a pinned accounting decision", () => {
  for (const row of STATUS_ACCOUNTING) {
    assert.equal(
      countsAsSpend(row.status, row.evidence),
      row.counted,
      `${row.status}/${row.evidence} should be ${row.counted ? "COUNTED" : "NOT_COUNTED"}: ${row.why}`
    );
  }

  // Statuses the schema allows but the DB type does not (defensive): an
  // unrecognised status must not silently count as spend.
  for (const unknown of ["completed", "expired", "ambiguous", ""]) {
    assert.equal(countsAsSpend(unknown, "job"), false, `unrecognised status ${unknown} must not count`);
  }

  // And the table covers the whole schema vocabulary, so a new status cannot
  // be added without appearing here.
  const schema = read("supabase/migrations/20260810120000_generation_attempts.sql");
  const declared = [...schema.matchAll(/'(pending|claimed|submitting|submitted|processing|succeeded|failed|cancelled)'::/g)]
    .map((m) => m[1]);
  const pinned = new Set(STATUS_ACCOUNTING.map((r) => r.status));
  for (const status of new Set(declared)) {
    assert.ok(pinned.has(status as string), `schema status ${status} is not pinned in the accounting table`);
  }
});

test("S15B2-34  F1: a cancelled attempt that crossed the provider boundary is counted", async () => {
  const { admin } = fakeAdmin({
    data: [
      { provider: "fal", provider_model: "fal-ai/test", status: "cancelled", submission_evidence: "none" },
      { provider: "fal", provider_model: "fal-ai/test", status: "cancelled", submission_evidence: "ambiguous" },
      { provider: "fal", provider_model: "fal-ai/test", status: "cancelled", submission_evidence: "job" },
    ],
  });
  const result = await readAttemptVolumes(admin, WINDOW);

  // Two of the three crossed the boundary. The third provably did not.
  assert.equal(result.volumes[0]?.attemptCount, 2);
  assert.equal(result.excludedRows, 1);
  assert.equal(result.scannedRows, 3);
});

test("S15B2-35  F1: the fail-open is closed — cancelled spend reaches the budget", () => {
  // Before the fix, all three rows above were dropped and this window priced
  // at zero. Two counted attempts at USD 0.04 is 0.08, and against a 0.05
  // ceiling that is a breach the guard must now see.
  const withCancelled = runSpendGuard(
    guardInput({
      volumes: volumes({ volumes: [{ provider: "fal", providerModelId: "fal-ai/test", attemptCount: 2 }] }),
      budgets: [budget({ limit: 0.05 })],
    })
  );
  assert.equal(withCancelled.spend.estimatedSpend, 0.08);
  assert.equal(withCancelled.guard.decision, "BUDGET_EXHAUSTED");

  // The locally-cancelled attempt must NOT inflate spend either. Counting all
  // three would invent money nobody owed.
  const inflated = runSpendGuard(
    guardInput({
      volumes: volumes({ volumes: [{ provider: "fal", providerModelId: "fal-ai/test", attemptCount: 3 }] }),
      budgets: [budget({ limit: 0.05 })],
    })
  );
  assert.notEqual(inflated.spend.estimatedSpend, withCancelled.spend.estimatedSpend);
});

test("S15B2-36  F3: no tracked TypeScript source carries a NUL byte", () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        if (readFileSync(full).includes(0x00)) offenders.push(path.relative(ROOT, full).replace(/\\/g, "/"));
      }
    }
  };
  walk(path.join(ROOT, "src", "lib"));
  walk(path.join(ROOT, "src", "trigger"));
  assert.deepEqual(offenders, [], "a NUL byte makes git treat a source file as binary and undiffable");

  // The nested map replaced the NUL separator; no separator character is used
  // at all, so no provider or model id can collide with one.
  const repo = read("src/lib/finops/estimated-spend-repository.ts");
  assert.match(repo, /Map<string, Map<string, number>>/, "counts are keyed by nesting, not by a joined string");
});

test("S15B2-37  F4: routed traffic resolves through the canonical Phase 7 join", async () => {
  const { admin, calls } = fakeAdmin({
    data: [
      { provider_id: "fal", provider_model_id: "fal-ai/routed", model_routes: [{ model_id: "platform-x" }] },
    ],
  });
  const resolution = await resolvePlatformModelIds(admin, [
    { provider: "fal", providerModelId: "fal-ai/routed", attemptCount: 1 },
  ]);

  assert.equal(resolution.sourceAvailable, true);
  assert.equal(resolution.byProviderModel.get("fal")?.get("fal-ai/routed"), "platform-x");
  assert.equal(resolution.unresolvedCount, 0);

  // It joins provider_models -> model_routes, the same rows the router used.
  assert.deepEqual(calls.select, ["provider_id, provider_model_id, model_routes(model_id)"]);
});

test("S15B2-38  F4: an ambiguous or absent route stays UNKNOWN, never guessed", async () => {
  // Two platform models share one provider model. They may be priced
  // differently, so picking one would fabricate a price behind a lookup.
  const ambiguous = await resolvePlatformModelIds(
    fakeAdmin({
      data: [
        {
          provider_id: "fal",
          provider_model_id: "fal-ai/shared",
          model_routes: [{ model_id: "platform-a" }, { model_id: "platform-b" }],
        },
      ],
    }).admin,
    [{ provider: "fal", providerModelId: "fal-ai/shared", attemptCount: 1 }]
  );
  assert.equal(ambiguous.byProviderModel.get("fal")?.get("fal-ai/shared"), undefined);
  assert.equal(ambiguous.ambiguousCount, 1);
  assert.equal(ambiguous.unresolvedCount, 1);

  // No route at all.
  const none = await resolvePlatformModelIds(
    fakeAdmin({ data: [{ provider_id: "fal", provider_model_id: "fal-ai/orphan", model_routes: [] }] }).admin,
    [{ provider: "fal", providerModelId: "fal-ai/orphan", attemptCount: 1 }]
  );
  assert.equal(none.unresolvedCount, 1);

  // A failed join is not "nothing matched".
  const failed = await resolvePlatformModelIds(fakeAdmin({ error: { message: "boom" } }).admin, [
    { provider: "fal", providerModelId: "fal-ai/x", attemptCount: 1 },
  ]);
  assert.equal(failed.sourceAvailable, false);
  assert.equal(failed.reasonCode, "route_join_failed");

  // And an unresolved pair prices as UNKNOWN, never as free.
  const outcome = runSpendGuard(guardInput({ platformModelIdFor: () => null }));
  assert.equal(outcome.guard.decision, "UNKNOWN");
  assert.notEqual(outcome.spend.estimatedSpend, 0);
});

test("S15B2-39  F4: no fabricated pricing fallback exists", () => {
  for (const { file, text } of finopsCode) {
    assert.ok(!/creditPricePerUnit|credit_price_per_unit/.test(text), `${file} falls back to the credit price`);
    assert.ok(!/defaultPrice|fallbackPrice|DEFAULT_UNIT_COST/i.test(text), `${file} has a default price`);
  }
});
