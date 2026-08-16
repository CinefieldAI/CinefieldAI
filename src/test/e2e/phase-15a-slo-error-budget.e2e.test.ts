import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  SLI_CATALOGUE,
  SLI_IDS,
  SLO_TARGETS,
  type SliId,
} from "@/lib/slo/sli-catalogue";
import {
  BURN_RATE_CAP,
  computeBurnRate,
  computeErrorBudget,
  computeThresholdHeadroom,
} from "@/lib/slo/error-budget";
import {
  evaluateSlo,
  isSloHealthy,
  SLO_WINDOW_SECONDS,
  type SliObservation,
} from "@/lib/slo/slo-snapshot";
import { alertOnSloSnapshot } from "@/lib/slo/slo-alert-bridge";
import {
  observeDependencyReadiness,
  observeGenerationLatency,
  observeGenerationSuccess,
  observeGenerationTimeouts,
  observeRealtimeDebtAge,
} from "@/lib/slo/slo-adapters";
import { ALERT_CATALOGUE, type AlertType } from "@/lib/alerts/alert-contract";
import {
  clearAlertSinks,
  registerAlertSink,
  type AlertDeliverySink,
} from "@/lib/alerts/alert-sink";
import type { AlertEnvelope } from "@/lib/alerts/alert-contract";
import { resetAlertRouter } from "@/lib/alerts/alert-router";
import { fieldRule } from "@/lib/observability/telemetry-contract";
import type { ReadinessReport } from "@/lib/health/health-contract";

/**
 * PHASE 15-A — SLI / SLO + ERROR BUDGET (code-only)
 *
 * Roadmap 15-A: "SLO/Error Budget metriklerini ve alert eşiklerini tanımla."
 * Done-criterion: availability / success / p95 / timeout / queue-age targets
 * are measurable.
 *
 * Phase 15-A observes and measures. Much of this suite proves what it CANNOT
 * do: own health, own alerting, page anyone, or turn missing data into a pass.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SLO_DIR = path.join(ROOT, "src", "lib", "slo");
const sloFiles = () =>
  readdirSync(SLO_DIR).filter((f) => f.endsWith(".ts")).map((f) => ({
    path: f,
    body: readFileSync(path.join(SLO_DIR, f), "utf8"),
  }));

const AT = "2026-08-16T12:00:00.000Z";

class CapturingSink implements AlertDeliverySink {
  readonly name = "capture";
  readonly seen: AlertEnvelope[] = [];
  constructor(readonly channel: AlertEnvelope["channels"][number]) {}
  deliver(e: AlertEnvelope): void {
    this.seen.push(e);
  }
}

function obs(o: Partial<SliObservation> & { sliId: SliId }): SliObservation {
  return { window: "medium", sourceAvailable: true, ...o };
}

// ---------------------------------------------------------------------------
// 1–2. Catalogue integrity
// ---------------------------------------------------------------------------

test("S15A-1  the SLI catalogue is finite, complete and self-documenting", () => {
  assert.ok(SLI_IDS.length >= 5 && SLI_IDS.length <= 20, "bounded catalogue");
  for (const id of SLI_IDS) {
    const d = SLI_CATALOGUE[id];
    assert.equal(d.id, id);
    assert.ok(["ratio", "latency_ms", "age_seconds"].includes(d.kind));
    assert.ok(["higher_is_better", "lower_is_better"].includes(d.direction));
    assert.ok(d.minimumSamples >= 1, `${id} must require at least one sample`);
    assert.ok(d.why.length > 40, `${id} must state why it exists`);
    assert.ok(d.numerator.length > 0);
    // Every SLI must have a target, and every target an SLI.
    assert.ok(SLO_TARGETS[id], `${id} has no target`);
    assert.equal(SLO_TARGETS[id].sliId, id);
    assert.ok(SLO_TARGETS[id].why.length > 40, `${id} target must justify itself`);
  }
  assert.deepEqual(Object.keys(SLO_TARGETS).sort(), [...SLI_IDS].sort());
});

test("S15A-2  each SLI names exactly one canonical, pre-existing source", () => {
  const allowed = new Set([
    "generation_attempts",
    "phase13_health",
    "realtime_outbox_debt",
    "provider_health_store",
  ]);
  for (const id of SLI_IDS) {
    assert.ok(allowed.has(SLI_CATALOGUE[id].source), `${id} invents a source`);
  }
  // Ratio SLIs need a denominator; gauges must not pretend to have one.
  for (const id of SLI_IDS) {
    const d = SLI_CATALOGUE[id];
    if (d.kind === "ratio") assert.ok(d.denominator, `${id} is a ratio with no denominator`);
    else assert.equal(d.denominator, null, `${id} is a gauge but declares a denominator`);
  }
});

// ---------------------------------------------------------------------------
// 3–7. Metric correctness
// ---------------------------------------------------------------------------

test("S15A-3  success ratio is correct and excludes cancellations from both sides", () => {
  const o = observeGenerationSuccess(
    { succeeded: 90, failed: 10, timedOut: 0, p95LatencyMs: null, sourceAvailable: true },
    "medium"
  );
  assert.equal(o.goodCount, 90);
  assert.equal(o.totalCount, 100, "cancelled attempts are in neither count");
  const snap = evaluateSlo(o, AT);
  assert.equal(snap.observedRatio, 0.9);
});

test("S15A-4  availability counts DEGRADED as servable, UNKNOWN as not", () => {
  const report: ReadinessReport = {
    runtime: "web",
    status: "DEGRADED",
    reasons: [],
    timestamp: AT,
    dependencies: [
      { dependency: "supabase", status: "HEALTHY", reason: "ok", criticality: "CRITICAL" },
      { dependency: "redis-a", status: "DEGRADED", reason: "backlog", criticality: "CRITICAL" },
      { dependency: "clerk", status: "UNKNOWN", reason: "unreachable", criticality: "CRITICAL" },
      { dependency: "kafka", status: "UNKNOWN", reason: "deferred", criticality: "DEFERRED" },
    ],
  };
  const o = observeDependencyReadiness(report, "short");
  // DEFERRED is excluded entirely; of the three CRITICAL, two are servable.
  assert.equal(o.totalCount, 3);
  assert.equal(o.goodCount, 2, "UNKNOWN must not count as available");
});

test("S15A-5  p95 latency uses succeeded attempts and compares to the ceiling", () => {
  const o = observeGenerationLatency(
    { succeeded: 50, failed: 5, timedOut: 0, p95LatencyMs: 30_000, sourceAvailable: true },
    "medium"
  );
  const snap = evaluateSlo(o, AT);
  assert.equal(snap.observedValue, 30_000);
  assert.equal(snap.target, SLO_TARGETS.generation_latency_p95.maxValue);
  assert.equal(snap.state, "HEALTHY");

  // Over the ceiling breaches.
  const over = evaluateSlo(
    observeGenerationLatency(
      { succeeded: 50, failed: 0, timedOut: 0, p95LatencyMs: 500_000, sourceAvailable: true },
      "medium"
    ),
    AT
  );
  assert.equal(over.state, "BREACHED");
  assert.equal(over.reasonCode, "threshold_exceeded");
});

test("S15A-6  timeout ratio is expressed as non-timeout success and is correct", () => {
  const o = observeGenerationTimeouts(
    { succeeded: 80, failed: 20, timedOut: 5, p95LatencyMs: null, sourceAvailable: true },
    "medium"
  );
  assert.equal(o.totalCount, 100);
  assert.equal(o.goodCount, 95, "5 timeouts out of 100 terminal attempts");
});

test("S15A-7  debt age reuses the existing aggregate and compares to the ceiling", () => {
  const healthy = evaluateSlo(observeRealtimeDebtAge({ oldestPendingSeconds: 10 }, "short"), AT);
  assert.equal(healthy.state, "HEALTHY");
  const breached = evaluateSlo(observeRealtimeDebtAge({ oldestPendingSeconds: 9_999 }, "short"), AT);
  assert.equal(breached.state, "BREACHED");
  // The ceiling agrees with 13-D's existing threshold so the SLO and the alert
  // do not fire at different moments.
  assert.equal(SLO_TARGETS.realtime_debt_age.maxValue, 300);
});

// ---------------------------------------------------------------------------
// 8–9. Missing data is never healthy
// ---------------------------------------------------------------------------

test("S15A-8  missing data is INSUFFICIENT_DATA, never a pass", () => {
  const empty = evaluateSlo(obs({ sliId: "generation_success_ratio", goodCount: 0, totalCount: 0 }), AT);
  assert.equal(empty.state, "INSUFFICIENT_DATA");
  assert.equal(empty.reasonCode, "insufficient_samples");
  assert.equal(isSloHealthy(empty), false);

  // A perfect ratio over too few samples is still not evidence.
  const tiny = evaluateSlo(obs({ sliId: "generation_success_ratio", goodCount: 3, totalCount: 3 }), AT);
  assert.equal(tiny.state, "INSUFFICIENT_DATA");
  assert.equal(isSloHealthy(tiny), false);
});

test("S15A-9  an unavailable source is UNAVAILABLE, never zero and never healthy", () => {
  const failed = evaluateSlo(
    obs({ sliId: "generation_success_ratio", sourceAvailable: false, goodCount: 0, totalCount: 0 }),
    AT
  );
  assert.equal(failed.state, "UNAVAILABLE");
  assert.equal(failed.reasonCode, "source_unavailable");
  assert.equal(isSloHealthy(failed), false);

  // A failed debt RPC is not "zero debt".
  const noDebt = evaluateSlo(observeRealtimeDebtAge(null, "short"), AT);
  assert.equal(noDebt.state, "UNAVAILABLE");
  assert.equal(noDebt.observedValue, null, "a failed read must not become 0 seconds");

  // A missing readiness report is not full availability.
  const noHealth = evaluateSlo(observeDependencyReadiness(null, "short"), AT);
  assert.equal(noHealth.state, "UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// 10–17. Budget and burn-rate mathematics
// ---------------------------------------------------------------------------

test("S15A-10  error budget math is correct", () => {
  // target 0.95 -> allowed bad 0.05. Observed bad 0.025 -> half the budget left.
  const r = computeErrorBudget({ targetRatio: 0.95, goodCount: 975, totalCount: 1000, minimumSamples: 20 });
  assert.ok(r.ok);
  assert.ok(Math.abs(r.value.budgetRemaining - 0.5) < 1e-9);
  assert.ok(Math.abs(r.value.observedBadRatio - 0.025) < 1e-9);
  assert.equal(r.value.exhausted, false);
});

test("S15A-11  an exhausted budget is explicit and clamped, never negative", () => {
  const r = computeErrorBudget({ targetRatio: 0.95, goodCount: 800, totalCount: 1000, minimumSamples: 20 });
  assert.ok(r.ok);
  assert.equal(r.value.budgetRemaining, 0, "clamped, not negative");
  assert.equal(r.value.exhausted, true);
});

test("S15A-12  a 100% target is handled explicitly, with no division by zero", () => {
  const perfect = computeErrorBudget({ targetRatio: 1, goodCount: 100, totalCount: 100, minimumSamples: 1 });
  assert.ok(perfect.ok);
  assert.equal(perfect.value.allowedBadRatio, 0);
  assert.equal(perfect.value.budgetRemaining, 1);
  assert.equal(perfect.value.exhausted, false);

  const oneBad = computeErrorBudget({ targetRatio: 1, goodCount: 99, totalCount: 100, minimumSamples: 1 });
  assert.ok(oneBad.ok);
  assert.equal(oneBad.value.budgetRemaining, 0, "no budget exists to partially spend");
  assert.equal(oneBad.value.exhausted, true);

  // And burn rate is not-applicable rather than Infinity.
  const burn = computeBurnRate({ observedBadRatio: 0.01, allowedBadRatio: 0 });
  assert.equal(burn.ok, false);
  assert.equal(burn.ok === false && burn.error, "not_applicable");
});

test("S15A-13  burn-rate math is correct and bucketed", () => {
  const r = computeBurnRate({ observedBadRatio: 0.1, allowedBadRatio: 0.05 });
  assert.ok(r.ok);
  assert.equal(r.value.rate, 2);
  assert.equal(r.value.bucket, "fast");

  assert.equal(computeBurnRate({ observedBadRatio: 0, allowedBadRatio: 0.05 }).ok, true);
  const none = computeBurnRate({ observedBadRatio: 0, allowedBadRatio: 0.05 });
  assert.equal(none.ok && none.value.bucket, "none");

  const slow = computeBurnRate({ observedBadRatio: 0.01, allowedBadRatio: 0.05 });
  assert.equal(slow.ok && slow.value.bucket, "slow");
});

test("S15A-14..16  NaN, Infinity and negatives are impossible", () => {
  const hostile: { observedBadRatio: number; allowedBadRatio: number }[] = [
    { observedBadRatio: NaN, allowedBadRatio: 0.05 },
    { observedBadRatio: Infinity, allowedBadRatio: 0.05 },
    { observedBadRatio: -0.5, allowedBadRatio: 0.05 },
    { observedBadRatio: 0.5, allowedBadRatio: NaN },
    { observedBadRatio: 0.5, allowedBadRatio: -1 },
    { observedBadRatio: 2, allowedBadRatio: 0.05 },
  ];
  for (const h of hostile) {
    const r = computeBurnRate(h);
    assert.equal(r.ok, false, `admitted ${JSON.stringify(h)}`);
  }

  // Budget rejects malformed observations rather than coercing them.
  for (const bad of [
    { targetRatio: 1.5, goodCount: 1, totalCount: 1, minimumSamples: 1 },
    { targetRatio: NaN, goodCount: 1, totalCount: 1, minimumSamples: 1 },
    { targetRatio: 0.9, goodCount: 10, totalCount: 5, minimumSamples: 1 },
    { targetRatio: 0.9, goodCount: -1, totalCount: 5, minimumSamples: 1 },
  ]) {
    assert.equal(computeErrorBudget(bad).ok, false, `admitted ${JSON.stringify(bad)}`);
  }

  // The cap keeps an extreme rate finite and comparable.
  const extreme = computeBurnRate({ observedBadRatio: 1, allowedBadRatio: 0.000001 });
  assert.ok(extreme.ok);
  assert.equal(extreme.value.rate, BURN_RATE_CAP);
  assert.ok(Number.isFinite(extreme.value.rate));
});

test("S15A-17  insufficient samples are explicit, not silently averaged", () => {
  const r = computeErrorBudget({ targetRatio: 0.95, goodCount: 5, totalCount: 5, minimumSamples: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "insufficient_samples");

  // Threshold headroom validates its own inputs too.
  assert.equal(computeThresholdHeadroom({ observedValue: -1, maxValue: 100 }).ok, false);
  assert.equal(computeThresholdHeadroom({ observedValue: 10, maxValue: 0 }).ok, false);
});

// ---------------------------------------------------------------------------
// 18–21. States and alert integration
// ---------------------------------------------------------------------------

test("S15A-18  breach and at-risk states are deterministic", () => {
  const healthy = evaluateSlo(obs({ sliId: "generation_success_ratio", goodCount: 1000, totalCount: 1000 }), AT);
  assert.equal(healthy.state, "HEALTHY");

  // target .95 -> allowed .05; observed bad .04 -> 20% budget left -> AT_RISK.
  const atRisk = evaluateSlo(obs({ sliId: "generation_success_ratio", goodCount: 960, totalCount: 1000 }), AT);
  assert.equal(atRisk.state, "AT_RISK");
  assert.equal(atRisk.reasonCode, "budget_low");

  const breached = evaluateSlo(obs({ sliId: "generation_success_ratio", goodCount: 800, totalCount: 1000 }), AT);
  assert.equal(breached.state, "BREACHED");
  assert.equal(breached.reasonCode, "budget_exhausted");

  // Deterministic: same input, same answer.
  assert.deepEqual(
    evaluateSlo(obs({ sliId: "generation_success_ratio", goodCount: 960, totalCount: 1000 }), AT),
    atRisk
  );
});

test("S15A-19..20  a bounded breach signal is emitted through the EXISTING 13-D router", () => {
  resetAlertRouter();
  clearAlertSinks();
  const sink = new CapturingSink("TELEGRAM");
  registerAlertSink(sink);

  const breached = evaluateSlo(obs({ sliId: "generation_success_ratio", goodCount: 800, totalCount: 1000 }), AT);
  const raised = alertOnSloSnapshot(breached);
  assert.ok(raised);
  assert.equal(raised!.outcome, "emitted");

  // Routed by 13-D, with 13-D's severity — not one chosen here.
  assert.equal(sink.seen.length, 1);
  assert.equal(sink.seen[0].type, "slo_budget_exhausted");
  assert.equal(sink.seen[0].severity, "ERROR");
  assert.equal(sink.seen[0].source, "reliability");
  assert.equal(ALERT_CATALOGUE.slo_budget_exhausted.severity, "ERROR");

  // An SLO breach is internal: never on the public status page.
  assert.equal(ALERT_CATALOGUE.slo_budget_exhausted.userVisible, false);
  assert.ok(!sink.seen[0].channels.includes("STATUS_PAGE"));

  // Healthy resolves; unmeasurable states raise nothing at all.
  resetAlertRouter();
  clearAlertSinks();
  const quiet = new CapturingSink("DASHBOARD");
  registerAlertSink(quiet);
  assert.equal(alertOnSloSnapshot(evaluateSlo(obs({ sliId: "generation_success_ratio", goodCount: 1000, totalCount: 1000 }), AT)), null);
  assert.equal(alertOnSloSnapshot(evaluateSlo(obs({ sliId: "generation_success_ratio", goodCount: 0, totalCount: 0 }), AT)), null);
  assert.equal(alertOnSloSnapshot(evaluateSlo(obs({ sliId: "generation_success_ratio", sourceAvailable: false }), AT)), null);
  assert.equal(quiet.seen.length, 0, "unmeasurable is neither a breach nor a recovery");
});

test("S15A-21  no second alert router exists — dedupe/severity/channels stay 13-D's", () => {
  for (const { path: file, body } of sloFiles()) {
    const bare = stripComments(body);
    for (const pattern of [
      /dedupeKey\s*[:=]/, /ESCALATION/, /class \w*Router/, /function \w*route\w*\(/i,
      /TELEGRAM|STATUS_PAGE|DASHBOARD/, /channels\s*:/, /severity\s*:/,
      /setTimeout|setInterval/,
    ]) {
      assert.ok(!pattern.test(bare), `${file} reimplements routing/scheduling (${pattern})`);
    }
  }
  // The bridge calls the real router.
  assert.match(read("src/lib/slo/slo-alert-bridge.ts"), /from "@\/lib\/alerts\/alert-router"/);
});

// ---------------------------------------------------------------------------
// 22–27. Sensitive data and cardinality
// ---------------------------------------------------------------------------

test("S15A-22..26  the snapshot carries no raw rows, prompts, secrets or provider payloads", () => {
  const snap = evaluateSlo(
    {
      ...obs({ sliId: "generation_success_ratio", goodCount: 90, totalCount: 100 }),
      ...({
        rows: [{ id: "gen_1", prompt: "a lighthouse at dusk", error: "ECONNREFUSED 10.0.0.5" }],
        apiKey: "sk_live_deadbeef",
        url: "https://r2.example.com/x.mp4?X-Amz-Signature=abc",
      } as unknown as Partial<SliObservation>),
    },
    AT
  );
  const s = JSON.stringify(snap);
  assert.ok(!/lighthouse/.test(s), "prompt survived");
  assert.ok(!/sk_live/.test(s), "secret survived");
  assert.ok(!/X-Amz-Signature/i.test(s) && !/https?:\/\//.test(s), "URL survived");
  assert.ok(!/ECONNREFUSED|10\.0\.0\.5/.test(s), "raw error survived");
  assert.ok(!/gen_1/.test(s), "row identity survived");
  assert.ok(!/rows/.test(s), "raw rows survived");

  // The snapshot shape is closed.
  assert.deepEqual(Object.keys(snap).sort(), [
    "badCount", "budgetRemaining", "burnRate", "burnRateBucket", "dimension",
    "evaluatedAt", "goodCount", "observedRatio", "observedValue", "reasonCode",
    "sampleCount", "sliId", "state", "target", "window",
  ]);
});

test("S15A-27  metric cardinality is bounded — no user, workspace or request labels", () => {
  // Only bounded catalogue dimensions are declared.
  for (const id of SLI_IDS) {
    for (const dim of SLI_CATALOGUE[id].allowedDimensions) {
      assert.ok(["provider", "modelId", "dependency"].includes(dim), `${id} allows ${dim}`);
    }
  }
  // An unallowed dimension is DROPPED, not honoured.
  const smuggled = evaluateSlo(
    { ...obs({ sliId: "realtime_debt_age", observedValue: 10 }), dimension: { kind: "provider" as never, value: "fal" } },
    AT
  );
  assert.equal(smuggled.dimension, null, "realtime_debt_age allows no dimensions");

  // An allowed dimension with an unbounded-looking value is also dropped.
  const hostile = evaluateSlo(
    {
      ...obs({ sliId: "generation_success_ratio", goodCount: 90, totalCount: 100 }),
      dimension: { kind: "provider", value: "user_12345@example.com" },
    },
    AT
  );
  assert.equal(hostile.dimension, null, "a non-catalogue-shaped value must be dropped");

  // And the source declares no identity dimension anywhere.
  const cat = stripComments(read("src/lib/slo/sli-catalogue.ts"));
  for (const forbidden of ["userId", "workspaceId", "tenantId", "requestId", "generationId"]) {
    assert.ok(!new RegExp(`"${forbidden}"`).test(cat), `${forbidden} is a metric dimension`);
  }
});

test("S15A-28  telemetry fields a snapshot would emit are already 13-E allow-listed", () => {
  for (const f of ["result", "count", "reason", "reasonCode", "durationMs", "classification", "severity"]) {
    assert.ok(fieldRule(f), `${f} is not allow-listed`);
  }
  // Phase 15-A added no telemetry field of its own.
  const contractDiff = read("src/lib/observability/telemetry-contract.ts");
  assert.ok(!/sliId|budgetRemaining|burnRate/.test(contractDiff),
    "Phase 15-A added a new allow-list field; it should not need one");
});

// ---------------------------------------------------------------------------
// 29–35. Structural guards, ownership and neighbouring phases
// ---------------------------------------------------------------------------

test("S15A-29..31  no external monitoring SDK, no migration, no paid service, no UI", () => {
  for (const { path: file, body } of sloFiles()) {
    const bare = stripComments(body);
    for (const pattern of [
      /datadog/i, /better.?stack/i, /@sentry/i, /cloudwatch/i, /\bfetch\s*\(/,
      /axios/i, /VERCEL_/, /api_key|apiKey/i,
    ]) {
      assert.ok(!pattern.test(bare), `${file} reaches an external monitor (${pattern})`);
    }
  }
  const out = execFileSync("git", ["status", "--short", "--", "supabase/", "src/app/", "src/components/"], {
    cwd: ROOT, encoding: "utf8", shell: true,
  });
  assert.equal(out.trim(), "", "Phase 15-A must touch no migration, route or UI");
});

test("S15A-32  Phase 15-A owns no health, billing, routing or lifecycle authority", () => {
  for (const { path: file, body } of sloFiles()) {
    const bare = stripComments(body);
    for (const pattern of [
      /credit|stripe|wallet|ledger|settle|reserve\(/i,
      /temporal|workflow\.|startWorkflow/i,
      /setProviderHealth|clearProviderHealth/,
      /setRoutingControl|clearRoutingControl/,
      /\.rpc\(|\.upsert\(|\.insert\(|supabaseAdmin/,
    ]) {
      assert.ok(!pattern.test(bare), `${file} claims authority it must not own (${pattern})`);
    }
  }
});

test("S15A-33..35  Phase 13 health, 13-D and 14 remain green and unmodified in contract", async () => {
  // Health authority untouched.
  const { READINESS_BUDGET_MS, rollUp } = await import("@/lib/health/health-contract");
  assert.equal(READINESS_BUDGET_MS, 4_000);
  assert.equal(
    rollUp("realtime-dispatcher", [
      { dependency: "redis-a", status: "UNKNOWN", reason: "unreachable", criticality: "CRITICAL" },
    ]).status,
    "UNREADY"
  );

  // 13-D still owns severity for the new types, and the catalogue stayed closed.
  const catalogued = Object.keys(ALERT_CATALOGUE) as AlertType[];
  assert.ok(catalogued.includes("slo_budget_low") && catalogued.includes("slo_budget_exhausted"));
  assert.equal(ALERT_CATALOGUE.slo_budget_low.severity, "WARNING");

  // 14-F remediation bounds untouched: an SLO breach is NOT auto-remediable.
  const { AUTO_REMEDIATION_ALLOWLIST } = await import("@/lib/deployment/remediation-guardrail");
  assert.deepEqual([...AUTO_REMEDIATION_ALLOWLIST], ["dispatcher_pass_failing"]);
  const { eligibilityRuleFor } = await import("@/lib/deployment/incident-diagnosis");
  for (const t of ["slo_budget_low", "slo_budget_exhausted"] as const) {
    assert.equal(eligibilityRuleFor(t)?.remediationEligible, false, `${t} must not auto-remediate`);
  }
});

test("S15A-36  windows are bounded and this module schedules no collection", () => {
  assert.deepEqual(Object.keys(SLO_WINDOW_SECONDS).sort(), ["long", "medium", "short"]);
  for (const v of Object.values(SLO_WINDOW_SECONDS)) assert.ok(v > 0 && Number.isFinite(v));
  for (const { path: file, body } of sloFiles()) {
    assert.ok(!/setInterval|cron|schedule\(/i.test(stripComments(body)), `${file} schedules collection`);
  }
});
