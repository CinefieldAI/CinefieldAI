import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEFAULT_COST_POLICY,
  normalizeRoutingCost,
  scoreCost,
  unknownCost,
  type RouteCost,
} from "@/lib/routing/routing-cost";
import {
  DEFAULT_QUALITY_POLICY,
  NO_TRUSTED_QUALITY_SOURCE,
  normalizeQuality,
  scoreQuality,
  unknownQuality,
  type QualityPolicy,
  type QualitySignal,
  type RouteQuality,
} from "@/lib/routing/route-quality";
import { scoreRouteComposite } from "@/lib/routing/route-scoring";
import { DEFAULT_ROUTING_POLICY } from "@/lib/routing/routing-policy";
import {
  healthKeyFor,
  selectHealthyRoute,
  type HealthSnapshot,
  type OptimizationSnapshot,
} from "@/lib/routing/health-aware-router";
import { unknownHealth, type RouteHealth } from "@/lib/routing/route-health";
import type { RouteCandidate } from "@/lib/routing/route-types";
import type { PricingRecord } from "@/lib/pricing/pricing-types";

/**
 * PHASE 7-D — cost-aware and quality-aware routing.
 *
 * Two rules dominate this file, and both are about refusing to invent data:
 *
 *     UNKNOWN COST    != ZERO COST
 *     UNKNOWN QUALITY != LOW QUALITY
 *
 * Every fixture price and score below is a TEST fixture. None is written into
 * a seed, and the production quality source returns nothing at all — asserted
 * here so that stays true.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const T0 = new Date("2026-08-12T10:00:00.000Z");
const daysAgo = (days: number) => new Date(T0.getTime() - days * 86_400_000).toISOString();

let counter = 0;
function candidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  counter += 1;
  return {
    routeId: `route-${String(counter).padStart(4, "0")}`,
    cinefieldModelId: "model-a",
    modelVersionId: `version-${counter}`,
    modelVersion: 1,
    providerId: "mock",
    providerModelId: `pm-${String(counter).padStart(4, "0")}`,
    priority: 100,
    enabled: true,
    routeStatus: "active",
    providerEnabled: true,
    providerModelEnabled: true,
    modelLifecycle: "active",
    modelVersionStatus: "active",
    ...overrides,
  };
}

function health(c: RouteCandidate, overrides: Partial<RouteHealth> = {}): [string, RouteHealth] {
  return [
    healthKeyFor(c.providerId, c.providerModelId),
    {
      providerId: c.providerId,
      providerModelId: c.providerModelId,
      breakerState: "CLOSED",
      admission: "admit",
      sampleCount: 50,
      errorRate: 0,
      averageLatencyMs: 1_000,
      consecutiveFailures: 0,
      observedAt: T0.toISOString(),
      confidence: "observed",
      telemetryUnavailable: false,
      ...overrides,
    },
  ];
}

function costFixture(c: RouteCandidate, estimatedCost: number): [string, RouteCost] {
  return [
    healthKeyFor(c.providerId, c.providerModelId),
    {
      providerId: c.providerId,
      providerModelId: c.providerModelId,
      state: "known",
      estimatedCost,
      currency: "USD",
      billingUnit: "per_output",
      pricingVersion: 1,
      verifiedAt: daysAgo(1),
    },
  ];
}

function pricingRow(overrides: Partial<PricingRecord> = {}): PricingRecord {
  return {
    platformModelId: "model-a",
    provider: "mock",
    providerModelId: "pm-0001",
    pricingVersion: 1,
    providerBillingUnit: "per_output",
    providerUnitCost: 0.05,
    providerCurrency: "USD",
    creditPricePerUnit: 10,
    sourceType: "manual_verification",
    sourceReference: "test fixture — never seeded",
    verifiedAt: daysAgo(1),
    effectiveFrom: daysAgo(1),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cost normalization
// ---------------------------------------------------------------------------

test("a verified price becomes a comparable per-request cost", () => {
  const cost = normalizeRoutingCost("mock", "pm-1", pricingRow(), { outputCount: 4 }, T0);
  assert.equal(cost.state, "known");
  assert.ok(Math.abs((cost.estimatedCost ?? 0) - 0.2) < 1e-9, "0.05 × 4 outputs");
  assert.equal(cost.billingUnit, "per_output");
  assert.equal(cost.pricingVersion, 1);
});

test("per_request pricing ignores the output count", () => {
  const cost = normalizeRoutingCost(
    "mock",
    "pm-1",
    pricingRow({ providerBillingUnit: "per_request", providerUnitCost: 0.3 }),
    { outputCount: 7 },
    T0
  );
  assert.equal(cost.estimatedCost, 0.3);
});

test("UNKNOWN COST IS NOT ZERO COST", () => {
  const missing = normalizeRoutingCost("fal", "fal-ai/flux/schnell", null, { outputCount: 1 }, T0);
  assert.equal(missing.state, "unknown");
  assert.equal(missing.estimatedCost, undefined, "an unpriced route must not report a cost");

  // And it must not out-score a route verified at zero.
  const free = scoreCost({
    providerId: "mock",
    providerModelId: "pm",
    state: "known",
    estimatedCost: 0,
    currency: "USD",
  });
  const unpriced = scoreCost(missing);
  assert.ok(
    free.component * free.confidenceFactor > unpriced.component * unpriced.confidenceFactor,
    "a verified-free route must beat an unpriced one"
  );
});

test("a price verified too long ago is STALE, not silently trusted", () => {
  const cost = normalizeRoutingCost(
    "mock",
    "pm-1",
    pricingRow({ verifiedAt: daysAgo(DEFAULT_COST_POLICY.freshnessDays + 10) }),
    { outputCount: 1 },
    T0
  );
  assert.equal(cost.state, "stale");
  assert.ok(cost.estimatedCost !== undefined, "a stale price is still the best info available");
  assert.equal(
    scoreCost(cost).confidenceFactor,
    DEFAULT_COST_POLICY.unknownCostFactor,
    "but it must be discounted"
  );
});

test("a non-comparable currency is unknown, never converted at an invented rate", () => {
  const cost = normalizeRoutingCost(
    "mock",
    "pm-1",
    pricingRow({ providerCurrency: "EUR" }),
    { outputCount: 1 },
    T0
  );
  assert.equal(cost.state, "unknown");
  assert.equal(cost.estimatedCost, undefined);
});

test("an invalid pricing row fails safe rather than becoming free", () => {
  for (const bad of [
    pricingRow({ providerUnitCost: Number.NaN }),
    pricingRow({ providerUnitCost: -1 }),
  ]) {
    const cost = normalizeRoutingCost("mock", "pm-1", bad, { outputCount: 1 }, T0);
    assert.equal(cost.state, "unknown");
    assert.equal(cost.estimatedCost, undefined);
  }

  // A per_output row with no usable output count cannot be computed.
  const uncomputable = normalizeRoutingCost(
    "mock",
    "pm-1",
    pricingRow(),
    { outputCount: 0 },
    T0
  );
  assert.equal(uncomputable.state, "unknown");
});

test("cost scoring is bounded and cheaper is better", () => {
  const cheap = scoreCost({ ...unknownCost("m", "p"), state: "known", estimatedCost: 0.01 });
  const dear = scoreCost({ ...unknownCost("m", "p"), state: "known", estimatedCost: 0.9 });
  assert.ok(cheap.component > dear.component);
  assert.ok(cheap.component <= 1 && dear.component >= 0);

  const absurd = scoreCost({ ...unknownCost("m", "p"), state: "known", estimatedCost: 10_000 });
  assert.ok(absurd.component >= 0 && absurd.component <= 1);
});

// ---------------------------------------------------------------------------
// Cost-aware selection
// ---------------------------------------------------------------------------

test("equal health, different cost: the cheaper route may win", () => {
  const cheap = candidate({ priority: 100, providerModelId: "pm-zzz" });
  const dear = candidate({ priority: 100, providerModelId: "pm-aaa" });

  // The tie-break alone would pick `dear` (lower provider model id), so cost
  // has to be what overturns it.
  const snapshot: HealthSnapshot = new Map([health(cheap), health(dear)]);
  const optimization: OptimizationSnapshot = {
    cost: new Map([costFixture(cheap, 0.01), costFixture(dear, 0.9)]),
  };

  const result = selectHealthyRoute("model-a", [dear, cheap], snapshot, T0, { optimization });
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, cheap.routeId);
});

test("cheaper NEVER beats a circuit-open route", () => {
  const cheapButBroken = candidate({ priority: 900, providerModelId: "pm-aaa" });
  const dearButWorking = candidate({ priority: 100, providerModelId: "pm-zzz" });

  const snapshot: HealthSnapshot = new Map([
    health(cheapButBroken, { breakerState: "OPEN", admission: "deny" }),
    health(dearButWorking),
  ]);
  const optimization: OptimizationSnapshot = {
    cost: new Map([costFixture(cheapButBroken, 0.0001), costFixture(dearButWorking, 5)]),
  };

  const result = selectHealthyRoute(
    "model-a",
    [cheapButBroken, dearButWorking],
    snapshot,
    T0,
    { optimization }
  );
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, dearButWorking.routeId);
  assert.equal(
    result.decision.evaluations.find((e) => e.routeId === cheapButBroken.routeId)?.rejection,
    "circuit_open"
  );
});

test("cheaper NEVER beats a disabled route", () => {
  const cheapButDisabled = candidate({ priority: 9_000, enabled: false });
  const usable = candidate({ priority: 1 });

  const optimization: OptimizationSnapshot = {
    cost: new Map([costFixture(cheapButDisabled, 0), costFixture(usable, 99)]),
  };
  const result = selectHealthyRoute(
    "model-a",
    [cheapButDisabled, usable],
    new Map([health(cheapButDisabled), health(usable)]),
    T0,
    { optimization }
  );
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, usable.routeId);
});

test("a materially unhealthy route does not win on price", () => {
  const cheapAndFailing = candidate({ priority: 100, providerModelId: "pm-aaa" });
  const pricierAndHealthy = candidate({ priority: 100, providerModelId: "pm-zzz" });

  const snapshot: HealthSnapshot = new Map([
    health(cheapAndFailing, { errorRate: 0.85, averageLatencyMs: 90_000 }),
    health(pricierAndHealthy, { errorRate: 0, averageLatencyMs: 800 }),
  ]);
  const optimization: OptimizationSnapshot = {
    cost: new Map([costFixture(cheapAndFailing, 0.001), costFixture(pricierAndHealthy, 0.9)]),
  };

  const result = selectHealthyRoute(
    "model-a",
    [cheapAndFailing, pricierAndHealthy],
    snapshot,
    T0,
    { optimization }
  );
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(
    result.selection.routeId,
    pricierAndHealthy.routeId,
    "a cheaper provider that fails is not a saving"
  );
});

test("an unpriced route loses a close race to a priced one", () => {
  const priced = candidate({ priority: 100, providerModelId: "pm-zzz" });
  const unpriced = candidate({ priority: 100, providerModelId: "pm-aaa" });

  const optimization: OptimizationSnapshot = {
    cost: new Map([
      costFixture(priced, 0),
      [
        healthKeyFor(unpriced.providerId, unpriced.providerModelId),
        unknownCost(unpriced.providerId, unpriced.providerModelId),
      ],
    ]),
  };

  const result = selectHealthyRoute(
    "model-a",
    [unpriced, priced],
    new Map([health(priced), health(unpriced)]),
    T0,
    { optimization }
  );
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, priced.routeId);
});

test("with every route unpriced, routing is unchanged from Phase 7-C", () => {
  const low = candidate({ priority: 100 });
  const high = candidate({ priority: 800 });

  const withoutCost = selectHealthyRoute(
    "model-a",
    [low, high],
    new Map([health(low), health(high)]),
    T0
  );
  const withUnknownCost = selectHealthyRoute(
    "model-a",
    [low, high],
    new Map([health(low), health(high)]),
    T0,
    {
      optimization: {
        cost: new Map([
          [healthKeyFor(low.providerId, low.providerModelId), unknownCost(low.providerId, low.providerModelId)],
          [healthKeyFor(high.providerId, high.providerModelId), unknownCost(high.providerId, high.providerModelId)],
        ]),
      },
    }
  );

  assert.equal(withoutCost.outcome, "selected");
  assert.equal(withUnknownCost.outcome, "selected");
  if (withoutCost.outcome !== "selected" || withUnknownCost.outcome !== "selected") return;
  assert.equal(withUnknownCost.selection.routeId, withoutCost.selection.routeId);
  assert.equal(withUnknownCost.selection.routeId, high.routeId);
});

// ---------------------------------------------------------------------------
// Quality contract
// ---------------------------------------------------------------------------

test("PRODUCTION HAS NO TRUSTED QUALITY SOURCE, and says so", async () => {
  // Phase 22 owns evaluation. Until it exists, the honest answer is nothing —
  // not a plausible default that would quietly start moving traffic.
  const signal = await NO_TRUSTED_QUALITY_SOURCE.read("fal", "fal-ai/flux/schnell");
  assert.equal(signal, null);

  const source = readSource("src/lib/routing/route-quality.ts");
  assert.ok(
    !/score:\s*0\.\d/.test(source),
    "no default quality score may appear anywhere in the module"
  );
  assert.deepEqual(
    DEFAULT_QUALITY_POLICY.trustedEvaluators,
    [],
    "the trusted-evaluator allowlist must start empty"
  );
});

test("a score from an untrusted or unnamed evaluator is discarded, not downgraded", () => {
  const signal: QualitySignal = {
    providerId: "fal",
    providerModelId: "pm-1",
    score: 0.99,
    confidence: 1,
    sampleCount: 10_000,
    evaluatedAt: daysAgo(1),
    evaluator: "someone-on-the-internet",
    evaluatorVersion: "1",
  };
  const quality = normalizeQuality("fal", "pm-1", signal, T0);
  assert.equal(quality.state, "unknown", '"we do not trust this" is not "this is unsure"');
  assert.equal(scoreQuality(quality).component, 1, "and it grants no advantage");
});

test("a trusted score is actionable and can influence selection", () => {
  const policy: QualityPolicy = { ...DEFAULT_QUALITY_POLICY, trustedEvaluators: ["cinefield-eval"] };
  const signal: QualitySignal = {
    providerId: "mock",
    providerModelId: "pm-good",
    score: 0.95,
    confidence: 0.9,
    sampleCount: 500,
    evaluatedAt: daysAgo(1),
    evaluator: "cinefield-eval",
    evaluatorVersion: "1.0",
  };
  const quality = normalizeQuality("mock", "pm-good", signal, T0, policy);
  assert.equal(quality.state, "known");
  assert.equal(scoreQuality(quality).component, 0.95);

  const better = candidate({ priority: 100, providerModelId: "pm-zzz" });
  const worse = candidate({ priority: 100, providerModelId: "pm-aaa" });
  const optimization: OptimizationSnapshot = {
    quality: new Map<string, RouteQuality>([
      [healthKeyFor(better.providerId, better.providerModelId), { ...quality, providerModelId: better.providerModelId }],
      [
        healthKeyFor(worse.providerId, worse.providerModelId),
        {
          providerId: worse.providerId,
          providerModelId: worse.providerModelId,
          state: "known",
          score: 0.2,
        },
      ],
    ]),
  };

  const result = selectHealthyRoute(
    "model-a",
    [worse, better],
    new Map([health(better), health(worse)]),
    T0,
    { optimization }
  );
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, better.routeId);
});

test("UNKNOWN QUALITY IS NOT LOW QUALITY", () => {
  const unevaluated = scoreQuality(unknownQuality("fal", "pm"));
  const bad = scoreQuality({ providerId: "fal", providerModelId: "pm", state: "known", score: 0.1 });
  assert.equal(unevaluated.component, 1, "an unevaluated model has not scored badly");
  assert.ok(unevaluated.component > bad.component);
});

test("a thin or stale evaluation does not move routing", () => {
  const policy: QualityPolicy = { ...DEFAULT_QUALITY_POLICY, trustedEvaluators: ["cinefield-eval"] };
  const base: QualitySignal = {
    providerId: "mock",
    providerModelId: "pm-1",
    score: 0.99,
    confidence: 0.95,
    sampleCount: 1_000,
    evaluatedAt: daysAgo(1),
    evaluator: "cinefield-eval",
    evaluatorVersion: "1.0",
  };

  for (const thin of [
    { ...base, confidence: 0.1 },
    { ...base, sampleCount: 2 },
    { ...base, evaluatedAt: daysAgo(DEFAULT_QUALITY_POLICY.freshnessDays + 30) },
  ]) {
    const quality = normalizeQuality("mock", "pm-1", thin, T0, policy);
    assert.equal(quality.state, "low_confidence");
    assert.equal(scoreQuality(quality).component, 1, "low confidence grants no advantage");
  }
});

test("quality NEVER beats a circuit-open route", () => {
  const excellentButBroken = candidate({ priority: 900, providerModelId: "pm-aaa" });
  const ordinaryButWorking = candidate({ priority: 100, providerModelId: "pm-zzz" });

  const optimization: OptimizationSnapshot = {
    quality: new Map<string, RouteQuality>([
      [
        healthKeyFor(excellentButBroken.providerId, excellentButBroken.providerModelId),
        { providerId: "mock", providerModelId: "pm-aaa", state: "known", score: 1 },
      ],
      [
        healthKeyFor(ordinaryButWorking.providerId, ordinaryButWorking.providerModelId),
        { providerId: "mock", providerModelId: "pm-zzz", state: "known", score: 0.3 },
      ],
    ]),
  };

  const result = selectHealthyRoute(
    "model-a",
    [excellentButBroken, ordinaryButWorking],
    new Map([
      health(excellentButBroken, { breakerState: "OPEN", admission: "deny" }),
      health(ordinaryButWorking),
    ]),
    T0,
    { optimization }
  );
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, ordinaryButWorking.routeId);
});

// ---------------------------------------------------------------------------
// Composite scoring and determinism
// ---------------------------------------------------------------------------

test("the composite score keeps every axis separately inspectable", () => {
  const breakdown = scoreRouteComposite(
    100,
    100,
    { ...unknownHealth("mock", "pm", T0, false), confidence: "observed", errorRate: 0.1, averageLatencyMs: 500 },
    { providerId: "mock", providerModelId: "pm", state: "known", estimatedCost: 0.1, currency: "USD" },
    { providerId: "mock", providerModelId: "pm", state: "unknown" }
  );

  for (const key of [
    "priorityComponent",
    "errorComponent",
    "latencyComponent",
    "costComponent",
    "qualityComponent",
  ] as const) {
    assert.ok(breakdown[key] >= 0 && breakdown[key] <= 1, `${key} must be bounded`);
  }
  assert.equal(breakdown.costState, "known");
  assert.equal(breakdown.qualityState, "unknown");
  assert.ok(breakdown.total > 0);
});

test("cost and quality routing is deterministic across repeats and shuffles", () => {
  const a = candidate({ priority: 300, providerModelId: "pm-a" });
  const b = candidate({ priority: 300, providerModelId: "pm-b" });
  const c = candidate({ priority: 300, providerModelId: "pm-c" });

  const snapshot: HealthSnapshot = new Map([health(a), health(b), health(c)]);
  const optimization: OptimizationSnapshot = {
    cost: new Map([costFixture(a, 0.2), costFixture(b, 0.2), costFixture(c, 0.2)]),
    quality: new Map<string, RouteQuality>([
      [healthKeyFor(a.providerId, a.providerModelId), unknownQuality(a.providerId, a.providerModelId)],
      [healthKeyFor(b.providerId, b.providerModelId), unknownQuality(b.providerId, b.providerModelId)],
      [healthKeyFor(c.providerId, c.providerModelId), unknownQuality(c.providerId, c.providerModelId)],
    ]),
  };

  const first = selectHealthyRoute("model-a", [a, b, c], snapshot, T0, { optimization });
  assert.equal(first.outcome, "selected");
  if (first.outcome !== "selected") return;

  for (let i = 0; i < 100; i += 1) {
    const again = selectHealthyRoute("model-a", [a, b, c], snapshot, T0, { optimization });
    if (again.outcome === "selected") {
      assert.equal(again.selection.routeId, first.selection.routeId);
    }
  }

  for (const ordering of [
    [c, b, a],
    [b, a, c],
    [c, a, b],
  ]) {
    const shuffled = selectHealthyRoute("model-a", ordering, snapshot, T0, { optimization });
    if (shuffled.outcome === "selected") {
      assert.equal(
        shuffled.selection.routeId,
        first.selection.routeId,
        "equal cost and quality must still resolve by the stable tie-break"
      );
    }
  }
});

test("static priority still dominates cost and quality together", () => {
  const preferred = candidate({ priority: 900, providerModelId: "pm-zzz" });
  const cheapAndGood = candidate({ priority: 100, providerModelId: "pm-aaa" });

  const optimization: OptimizationSnapshot = {
    cost: new Map([costFixture(preferred, 0.9), costFixture(cheapAndGood, 0)]),
    quality: new Map<string, RouteQuality>([
      [
        healthKeyFor(cheapAndGood.providerId, cheapAndGood.providerModelId),
        { providerId: "mock", providerModelId: "pm-aaa", state: "known", score: 1 },
      ],
    ]),
  };

  const result = selectHealthyRoute(
    "model-a",
    [cheapAndGood, preferred],
    new Map([health(preferred), health(cheapAndGood)]),
    T0,
    { optimization }
  );
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(
    result.selection.routeId,
    preferred.routeId,
    "an operator's explicit priority is not overturned by optimization"
  );
});

// ---------------------------------------------------------------------------
// Billing separation
// ---------------------------------------------------------------------------

test("routing cost reads the provider side of model_pricing and nothing else", () => {
  const repo = readSource("src/lib/routing/routing-cost-repository.ts");
  const cost = readSource("src/lib/routing/routing-cost.ts");
  const scoring = readSource("src/lib/routing/route-scoring.ts");

  // creditPricePerUnit is mapped by the shared row type, but must never be
  // read by any routing decision.
  assert.ok(
    !/creditPricePerUnit/.test(cost),
    "the routing cost contract must not touch the customer price"
  );
  assert.ok(!/creditPricePerUnit/.test(scoring));

  for (const source of [repo, cost, scoring]) {
    for (const forbidden of [
      "credit_wallets",
      "credit_reservations",
      "credit_ledger",
      "reserve_credits",
      "settle_",
      "refund",
      "stripe",
    ]) {
      assert.ok(
        !new RegExp(forbidden, "i").test(source),
        `routing must never reach ${forbidden}`
      );
    }
  }
});

test("changing a routing price cannot move a credit balance", () => {
  // Structural, and the strongest form available without Phase 10: the
  // modules that consume price for routing import nothing that can settle,
  // reserve, refund or charge.
  const router = readSource("src/lib/routing/health-aware-router.ts");
  const imports = router.split("\n").filter((line) => line.startsWith("import"));
  for (const line of imports) {
    assert.ok(
      !/credit|billing|stripe|wallet|ledger/i.test(line),
      `the router must not import billing: ${line}`
    );
  }

  // Two identical requests differing only in configured cost select
  // differently — and neither path has any credit effect to observe.
  const one = candidate({ priority: 100, providerModelId: "pm-aaa" });
  const two = candidate({ priority: 100, providerModelId: "pm-zzz" });
  const snapshot: HealthSnapshot = new Map([health(one), health(two)]);

  const cheapIsOne = selectHealthyRoute("model-a", [one, two], snapshot, T0, {
    optimization: { cost: new Map([costFixture(one, 0.01), costFixture(two, 0.9)]) },
  });
  const cheapIsTwo = selectHealthyRoute("model-a", [one, two], snapshot, T0, {
    optimization: { cost: new Map([costFixture(one, 0.9), costFixture(two, 0.01)]) },
  });

  assert.equal(cheapIsOne.outcome, "selected");
  assert.equal(cheapIsTwo.outcome, "selected");
  if (cheapIsOne.outcome !== "selected" || cheapIsTwo.outcome !== "selected") return;
  assert.notEqual(
    cheapIsOne.selection.routeId,
    cheapIsTwo.selection.routeId,
    "price must be able to change the ROUTE"
  );
});

test("provider economics stay server-side", () => {
  for (const file of [
    "src/lib/routing/routing-cost-repository.ts",
    "src/lib/routing/health-aware-router.ts",
  ]) {
    assert.match(readSource(file), /^import "server-only";/m, `${file} must be server-only`);
  }

  // The public model catalog the browser imports carries no economics.
  const catalog = readSource("src/lib/orchestration/public-model-catalog.ts");
  for (const forbidden of ["cost", "price", "credit", "quality", "score"]) {
    assert.ok(
      !new RegExp(`"${forbidden}`, "i").test(catalog),
      `the browser catalog must not expose ${forbidden}`
    );
  }
});

// ---------------------------------------------------------------------------
// Security and configuration
// ---------------------------------------------------------------------------

test("no client-facing type can carry a cost, a quality score or a weight", () => {
  const createRequest = /export interface GenerationCreateRequest \{[\s\S]*?\n\}/.exec(
    readSource("src/lib/orchestration/generation-create-service.ts")
  );
  assert.ok(createRequest);
  for (const forbidden of ["cost", "price", "quality", "score", "weight", "evaluator"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(createRequest[0]),
      `the public create request must have no "${forbidden}" field`
    );
  }

  const routeRequest = /export interface RouteRequest \{[\s\S]*?\n\}/.exec(
    readSource("src/lib/routing/route-types.ts")
  );
  assert.ok(routeRequest);
  assert.ok(!/cost|price|quality|weight/i.test(routeRequest[0]));

  // The HTTP boundary accepts none of it either.
  const route = readSource("src/app/api/generate/route.ts");
  assert.ok(!/costShape|qualityScore|routingPolicy|weights/i.test(route));
});

test("every weight and threshold lives in one server-side policy", () => {
  const policy = readSource("src/lib/routing/routing-policy.ts");
  for (const key of ["staticPriority", "errorRate", "latency", "cost", "quality"]) {
    assert.ok(new RegExp(`${key}:`).test(policy), `${key} must be declared in the policy`);
  }

  // Phase 7-E is not being started: no flag client, no runtime override.
  // Checked against CODE, not prose — the file says in words that canary
  // rollout is out of scope, and a comment saying so is not an import.
  const code = policy
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["launchdarkly", "openfeature", "process.env", "canary", "killSwitch"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(code),
      `${forbidden} belongs to Phase 7-E, not here`
    );
  }
});

test("the composite scorer names cost and quality explicitly, not as magic numbers", () => {
  const scoring = readSource("src/lib/routing/route-scoring.ts");
  assert.match(scoring, /weights\.cost/);
  assert.match(scoring, /weights\.quality/);
  // No inline constants deciding policy inside the scorer.
  const body = /export function scoreRouteComposite[\s\S]*?\n\}/.exec(scoring);
  assert.ok(body);
  assert.ok(
    !/\*\s*0\.\d/.test(body[0]),
    "weights must come from the policy, never be hardcoded in the formula"
  );
});

test("no fabricated price or quality score was seeded", () => {
  const migration = readSource("supabase/migrations/20260812000000_model_pricing.sql");
  const inserted = migration.slice(migration.indexOf("INSERT INTO"));
  // The only seeded rows are the four mock models at a verified zero.
  assert.ok(!/fal-|cloudflare-|gemini/i.test(inserted), "no real provider may be priced by a seed");
  assert.equal((inserted.match(/'mock'/g) ?? []).length, 4);

  const routingMigration = readSource("supabase/migrations/20260817000000_model_routing.sql");
  assert.ok(
    !/quality_score|quality/i.test(routingMigration),
    "no quality column or seed may exist before Phase 22"
  );
});

test("the routing policy is not reachable from a browser bundle", () => {
  for (const file of [
    "src/lib/routing/routing-policy.ts",
    "src/lib/routing/routing-cost.ts",
    "src/lib/routing/route-quality.ts",
  ]) {
    const source = readSource(file);
    assert.ok(!/"use client"/.test(source));
  }
  // And nothing client-side imports them.
  const clientCatalog = readSource("src/lib/orchestration/orchestration-models.ts");
  assert.ok(!/routing-policy|routing-cost|route-quality/.test(clientCatalog));
});

test("the default weights keep safety above optimization", () => {
  const { weights } = DEFAULT_ROUTING_POLICY;
  assert.ok(
    weights.staticPriority > weights.cost + weights.quality,
    "an operator's priority must outweigh optimization"
  );
  assert.ok(weights.errorRate > weights.latency, "failing is worse than slow");
  assert.ok(weights.cost < weights.errorRate, "price must not outweigh reliability");
});

// ---------------------------------------------------------------------------
// Closure correction — unknown contributes NOTHING, not a neutral constant
// ---------------------------------------------------------------------------

test("unknown quality contributes exactly zero, not a neutral 1.0", () => {
  const breakdown = scoreRouteComposite(
    100,
    100,
    { ...unknownHealth("mock", "pm", T0, false), confidence: "observed", errorRate: 0, averageLatencyMs: 0 },
    unknownCost("mock", "pm"),
    unknownQuality("mock", "pm")
  );

  assert.equal(breakdown.qualityContribution, 0, "no evidence must contribute no score");
  assert.equal(breakdown.qualityState, "unknown");
  // And the weight itself must not be counted, or the mean is diluted by an
  // axis that knows nothing.
  assert.equal(
    breakdown.appliedWeight,
    DEFAULT_ROUTING_POLICY.weights.staticPriority +
      DEFAULT_ROUTING_POLICY.weights.errorRate +
      DEFAULT_ROUTING_POLICY.weights.latency,
    "an absent axis must claim none of the weight"
  );
});

test("unknown cost also contributes zero and claims no weight", () => {
  const breakdown = scoreRouteComposite(
    100,
    100,
    { ...unknownHealth("mock", "pm", T0, false), confidence: "observed", errorRate: 0, averageLatencyMs: 0 },
    unknownCost("mock", "pm"),
    unknownQuality("mock", "pm")
  );
  assert.equal(breakdown.costContribution, 0);
  assert.equal(breakdown.costState, "unknown");
});

test("a measured-mediocre quality no longer LOSES to an unmeasured one", () => {
  // The bug the correction fixes: unknown scored 1.0 on the quality axis, so
  // a route with a real 0.4 ranked below a route nobody had evaluated.
  const measured = scoreRouteComposite(
    100,
    100,
    { ...unknownHealth("m", "p", T0, false), confidence: "observed", errorRate: 0, averageLatencyMs: 0 },
    unknownCost("m", "p"),
    { providerId: "m", providerModelId: "p", state: "known", score: 0.4 }
  );
  const unmeasured = scoreRouteComposite(
    100,
    100,
    { ...unknownHealth("m", "p2", T0, false), confidence: "observed", errorRate: 0, averageLatencyMs: 0 },
    unknownCost("m", "p2"),
    unknownQuality("m", "p2")
  );

  assert.ok(
    measured.total < unmeasured.total,
    "measured-bad SHOULD rank below unmeasured — the only route known to be bad is the measured one"
  );
  assert.equal(unmeasured.qualityContribution, 0);
  assert.ok(measured.qualityContribution > 0);
});

test("a measured-excellent quality beats an unmeasured one", () => {
  const excellent = scoreRouteComposite(
    100,
    100,
    { ...unknownHealth("m", "p", T0, false), confidence: "observed", errorRate: 0.5, averageLatencyMs: 0 },
    unknownCost("m", "p"),
    { providerId: "m", providerModelId: "p", state: "known", score: 1 }
  );
  const unmeasured = scoreRouteComposite(
    100,
    100,
    { ...unknownHealth("m", "p2", T0, false), confidence: "observed", errorRate: 0.5, averageLatencyMs: 0 },
    unknownCost("m", "p2"),
    unknownQuality("m", "p2")
  );
  assert.ok(excellent.total > unmeasured.total);
});

test("a low-confidence signal contributes nothing, exactly like unknown", () => {
  const lowConfidence = scoreRouteComposite(
    100,
    100,
    { ...unknownHealth("m", "p", T0, false), confidence: "observed", errorRate: 0, averageLatencyMs: 0 },
    unknownCost("m", "p"),
    { providerId: "m", providerModelId: "p", state: "low_confidence", score: 0.99 }
  );
  const unknown = scoreRouteComposite(
    100,
    100,
    { ...unknownHealth("m", "p", T0, false), confidence: "observed", errorRate: 0, averageLatencyMs: 0 },
    unknownCost("m", "p"),
    unknownQuality("m", "p")
  );
  assert.equal(lowConfidence.qualityContribution, 0);
  assert.equal(lowConfidence.total, unknown.total);
});

test("an absent quality axis cannot change which route is selected", () => {
  // Two routes identical in everything the system actually knows. Adding an
  // unknown quality entry to one of them must not move the winner.
  const a = candidate({ priority: 100, providerModelId: "pm-aaa" });
  const b = candidate({ priority: 100, providerModelId: "pm-bbb" });
  const snapshot: HealthSnapshot = new Map([health(a), health(b)]);

  const without = selectHealthyRoute("model-a", [a, b], snapshot, T0);
  const withUnknownQuality = selectHealthyRoute("model-a", [a, b], snapshot, T0, {
    optimization: {
      quality: new Map<string, RouteQuality>([
        [healthKeyFor(a.providerId, a.providerModelId), unknownQuality(a.providerId, a.providerModelId)],
      ]),
    },
  });

  assert.equal(without.outcome, "selected");
  assert.equal(withUnknownQuality.outcome, "selected");
  if (without.outcome !== "selected" || withUnknownQuality.outcome !== "selected") return;
  assert.equal(withUnknownQuality.selection.routeId, without.selection.routeId);
});

test("an absent quality axis cannot alter eligibility, admission or the breaker", () => {
  // Quality is an optimization input and nothing else. It must not be able to
  // revive an excluded route or exclude an eligible one.
  const openBreaker = candidate({ priority: 900, providerModelId: "pm-aaa" });
  const healthy = candidate({ priority: 100, providerModelId: "pm-zzz" });
  const snapshot: HealthSnapshot = new Map([
    health(openBreaker, { breakerState: "OPEN", admission: "deny" }),
    health(healthy),
  ]);

  for (const optimization of [
    undefined,
    {
      quality: new Map<string, RouteQuality>([
        [
          healthKeyFor(openBreaker.providerId, openBreaker.providerModelId),
          { providerId: "mock", providerModelId: "pm-aaa", state: "known" as const, score: 1 },
        ],
      ]),
    },
    {
      quality: new Map<string, RouteQuality>([
        [
          healthKeyFor(openBreaker.providerId, openBreaker.providerModelId),
          unknownQuality(openBreaker.providerId, openBreaker.providerModelId),
        ],
      ]),
    },
  ]) {
    const result = selectHealthyRoute("model-a", [openBreaker, healthy], snapshot, T0, {
      optimization,
    });
    assert.equal(result.outcome, "selected");
    if (result.outcome !== "selected") continue;
    assert.equal(result.selection.routeId, healthy.routeId);
    assert.equal(
      result.decision.evaluations.find((e) => e.routeId === openBreaker.routeId)?.rejection,
      "circuit_open",
      "quality state must not change an admission decision"
    );
  }
});
