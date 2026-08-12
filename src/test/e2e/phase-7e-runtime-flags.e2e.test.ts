import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  controlKeyFor,
  emptySnapshot,
  findRuntimeExclusion,
  NO_RUNTIME_FLAG_SOURCE,
  rejectionForControl,
  targetsForRoute,
  type RuntimeControl,
  type RuntimeControlSnapshot,
  type RuntimeFlagSource,
} from "@/lib/routing/runtime-flags";
import {
  __setRoutingControlClientForTesting,
  clearRoutingControl,
  parseRuntimeControl,
  redisRuntimeFlagSource,
  setRoutingControl,
  type RoutingControlRedisClient,
} from "@/lib/redis/routing-control-store";
import { routingControlKey } from "@/lib/redis/redis-keys";
import {
  healthKeyFor,
  loadRuntimeControls,
  selectHealthyRoute,
  type HealthSnapshot,
  type OptimizationSnapshot,
  type RouteEvaluation,
} from "@/lib/routing/health-aware-router";
import { unknownCost } from "@/lib/routing/routing-cost";
import type { RouteQuality } from "@/lib/routing/route-quality";
import type { RouteHealth } from "@/lib/routing/route-health";
import type { RouteCandidate } from "@/lib/routing/route-types";
import { decideFailover, DEFAULT_MAX_ATTEMPTS } from "@/lib/routing/failover-policy";

/**
 * PHASE 7-E — runtime routing controls and the emergency stop.
 *
 * The properties that matter:
 *   a runtime control can only ever TIGHTEN what is reachable,
 *   a runtime-disabled route cannot be rescued by any optimization signal,
 *   flags and the circuit breaker stay distinguishable,
 *   and none of it can reach past AMBIGUOUS submission safety.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const T0 = new Date("2026-08-12T10:00:00.000Z");

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

function control(
  kind: RuntimeControl["kind"],
  targetId: string,
  reason: RuntimeControl["reason"] = "disabled"
): RuntimeControl {
  return { kind, targetId, reason, setAt: T0.toISOString() };
}

function snapshotOf(...controls: RuntimeControl[]): RuntimeControlSnapshot {
  return {
    controls: new Map(controls.map((c) => [controlKeyFor(c.kind, c.targetId), c])),
    source: controls.length > 0 ? "runtime_flag" : "database_baseline",
  };
}

function fakeRedis(): RoutingControlRedisClient & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    async del(key) {
      store.delete(key);
      return 1;
    },
  };
}

// ---------------------------------------------------------------------------
// Durable AND runtime
// ---------------------------------------------------------------------------

test("DB enabled + runtime enabled: the route is eligible", () => {
  const route = candidate();
  const result = selectHealthyRoute("model-a", [route], new Map([health(route)]), T0, {
    runtimeControls: emptySnapshot("database_baseline"),
  });
  assert.equal(result.outcome, "selected");
});

test("DB enabled + runtime disabled: the route is excluded", () => {
  const route = candidate();
  const spare = candidate();
  const result = selectHealthyRoute(
    "model-a",
    [route, spare],
    new Map([health(route), health(spare)]),
    T0,
    { runtimeControls: snapshotOf(control("route", route.routeId)) }
  );

  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, spare.routeId);

  const excluded = result.decision.evaluations.find((e) => e.routeId === route.routeId);
  assert.equal(excluded?.rejection, "runtime_disabled");
  assert.equal(excluded?.eligible, false);
  assert.equal(excluded?.runtimeControl?.kind, "route");
});

test("DB disabled + runtime enabled: STILL excluded — controls tighten, never loosen", () => {
  // The central safety property. A flag layer that can re-enable a route the
  // database has disabled turns every flag bug into a production incident.
  const dbDisabled = candidate({ enabled: false });
  const result = selectHealthyRoute(
    "model-a",
    [dbDisabled],
    new Map([health(dbDisabled)]),
    T0,
    { runtimeControls: emptySnapshot("runtime_flag") }
  );

  assert.equal(result.outcome, "no_eligible_route");
  if (result.outcome !== "no_eligible_route") return;
  assert.equal(
    result.decision.evaluations[0].rejection,
    "route_disabled",
    "durable disable must be reported, not overridden"
  );

  // And there is no code path that could: the snapshot type carries only
  // controls that EXCLUDE.
  const source = readSource("src/lib/routing/runtime-flags.ts");
  assert.ok(!/enable|allow|force/i.test(/export interface RuntimeControl \{[\s\S]*?\n\}/.exec(source)?.[0] ?? ""));
});

test("both disabled: excluded, and the durable reason wins the report", () => {
  const route = candidate({ enabled: false });
  const result = selectHealthyRoute("model-a", [route], new Map([health(route)]), T0, {
    runtimeControls: snapshotOf(control("route", route.routeId)),
  });
  assert.equal(result.outcome, "no_eligible_route");
  if (result.outcome !== "no_eligible_route") return;
  assert.equal(result.decision.evaluations[0].rejection, "route_disabled");
});

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

test("killing a provider excludes every route through it, and nothing else", () => {
  const falA = candidate({ providerId: "fal", providerModelId: "fal-ai/a" });
  const falB = candidate({ providerId: "fal", providerModelId: "fal-ai/b" });
  const other = candidate({ providerId: "mock", providerModelId: "mock-image" });

  const result = selectHealthyRoute(
    "model-a",
    [falA, falB, other],
    new Map([health(falA), health(falB), health(other)]),
    T0,
    { runtimeControls: snapshotOf(control("provider", "fal", "emergency_kill")) }
  );

  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, other.routeId);

  // Hoisted: inside the loop's closure TypeScript loses the narrowing the
  // early return above established.
  const evaluations: RouteEvaluation[] = result.decision.evaluations;
  for (const killed of [falA, falB]) {
    const killedEval = evaluations.find((e) => e.routeId === killed.routeId);
    assert.equal(killedEval?.rejection, "emergency_kill");
    assert.equal(killedEval?.runtimeControl?.kind, "provider");
  }
  assert.equal(
    result.decision.evaluations.find((e) => e.routeId === other.routeId)?.rejection,
    undefined,
    "an unrelated provider must be untouched"
  );
});

test("killing a provider model excludes only its routes", () => {
  const target = candidate({ providerId: "fal", providerModelId: "fal-ai/a" });
  const sibling = candidate({ providerId: "fal", providerModelId: "fal-ai/b" });

  const result = selectHealthyRoute(
    "model-a",
    [target, sibling],
    new Map([health(target), health(sibling)]),
    T0,
    { runtimeControls: snapshotOf(control("provider-model", "fal-ai/a")) }
  );

  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, sibling.routeId);
});

test("killing a model stops it generating anywhere", () => {
  const one = candidate({ providerId: "fal", providerModelId: "fal-ai/a" });
  const two = candidate({ providerId: "mock", providerModelId: "mock-image" });

  const result = selectHealthyRoute(
    "model-a",
    [one, two],
    new Map([health(one), health(two)]),
    T0,
    { runtimeControls: snapshotOf(control("model", "model-a", "emergency_kill")) }
  );

  assert.equal(result.outcome, "no_eligible_route");
  if (result.outcome !== "no_eligible_route") return;
  for (const evaluation of result.decision.evaluations) {
    assert.equal(evaluation.rejection, "emergency_kill");
    assert.equal(evaluation.runtimeControl?.kind, "model");
  }
});

test("the narrowest matching level is the one reported", () => {
  const route = candidate({ providerId: "fal", providerModelId: "fal-ai/a" });
  const exclusion = findRuntimeExclusion(
    {
      cinefieldModelId: route.cinefieldModelId,
      providerId: route.providerId,
      providerModelId: route.providerModelId,
      routeId: route.routeId,
    },
    snapshotOf(control("provider", "fal"), control("route", route.routeId))
  );
  assert.equal(exclusion?.matchedTarget.kind, "route", "the narrower fact is the useful one");

  assert.deepEqual(
    targetsForRoute({
      cinefieldModelId: "m",
      providerId: "p",
      providerModelId: "pm",
      routeId: "r",
    }).map((t) => t.kind),
    ["route", "provider-model", "provider", "model"]
  );
});

// ---------------------------------------------------------------------------
// Optimization cannot bypass a flag
// ---------------------------------------------------------------------------

test("a runtime-disabled route loses despite the best health, cost, quality AND priority", () => {
  const perfectButKilled = candidate({ priority: 10_000, providerModelId: "pm-aaa" });
  const mediocre = candidate({ priority: 1, providerModelId: "pm-zzz" });

  const snapshot: HealthSnapshot = new Map([
    health(perfectButKilled, { errorRate: 0, averageLatencyMs: 1 }),
    health(mediocre, { errorRate: 0.6, averageLatencyMs: 90_000 }),
  ]);

  const optimization: OptimizationSnapshot = {
    cost: new Map([
      [
        healthKeyFor(perfectButKilled.providerId, perfectButKilled.providerModelId),
        {
          providerId: perfectButKilled.providerId,
          providerModelId: perfectButKilled.providerModelId,
          state: "known" as const,
          estimatedCost: 0,
          currency: "USD",
        },
      ],
      [
        healthKeyFor(mediocre.providerId, mediocre.providerModelId),
        unknownCost(mediocre.providerId, mediocre.providerModelId),
      ],
    ]),
    quality: new Map<string, RouteQuality>([
      [
        healthKeyFor(perfectButKilled.providerId, perfectButKilled.providerModelId),
        {
          providerId: perfectButKilled.providerId,
          providerModelId: perfectButKilled.providerModelId,
          state: "known",
          score: 1,
        },
      ],
    ]),
  };

  const result = selectHealthyRoute(
    "model-a",
    [perfectButKilled, mediocre],
    snapshot,
    T0,
    {
      optimization,
      runtimeControls: snapshotOf(control("route", perfectButKilled.routeId, "emergency_kill")),
    }
  );

  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(
    result.selection.routeId,
    mediocre.routeId,
    "flag exclusion is structural — it happens before anything is scored"
  );

  // And the killed route was never scored at all.
  const killed = result.decision.evaluations.find((e) => e.routeId === perfectButKilled.routeId);
  assert.equal(killed?.score, undefined, "an excluded route must not be scored");
});

test("every route runtime-killed yields no_eligible_route, not a lucky pick", () => {
  const one = candidate();
  const two = candidate();
  const result = selectHealthyRoute(
    "model-a",
    [one, two],
    new Map([health(one), health(two)]),
    T0,
    {
      runtimeControls: snapshotOf(
        control("route", one.routeId, "emergency_kill"),
        control("route", two.routeId, "emergency_kill")
      ),
    }
  );
  assert.equal(result.outcome, "no_eligible_route");
});

// ---------------------------------------------------------------------------
// Flags and the circuit breaker stay separate
// ---------------------------------------------------------------------------

test("a flag and a breaker produce different reasons and different metadata", () => {
  const flagged = candidate({ providerModelId: "pm-flag" });
  const broken = candidate({ providerModelId: "pm-broken" });
  const fine = candidate({ providerModelId: "pm-fine" });

  const result = selectHealthyRoute(
    "model-a",
    [flagged, broken, fine],
    new Map([
      health(flagged),
      health(broken, { breakerState: "OPEN", admission: "deny" }),
      health(fine),
    ]),
    T0,
    { runtimeControls: snapshotOf(control("route", flagged.routeId)) }
  );

  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, fine.routeId);

  const flagEval = result.decision.evaluations.find((e) => e.routeId === flagged.routeId);
  const breakerEval = result.decision.evaluations.find((e) => e.routeId === broken.routeId);

  assert.equal(flagEval?.rejection, "runtime_disabled");
  assert.ok(flagEval?.runtimeControl, "a flag exclusion carries its control metadata");
  assert.equal(flagEval?.health, undefined, "a flagged route is not even health-checked");

  assert.equal(breakerEval?.rejection, "circuit_open");
  assert.equal(breakerEval?.runtimeControl, undefined, "a breaker is not a flag");
  assert.ok(breakerEval?.health, "a breaker exclusion carries health");
});

test("the two concepts are separate in storage as well as in types", () => {
  const flags = readSource("src/lib/routing/runtime-flags.ts");
  const breaker = readSource("src/lib/routing/circuit-breaker.ts");
  assert.ok(!/breaker/i.test(flags.replace(/^\s*\*.*$/gm, "")), "flag types must not embed breaker state");
  assert.ok(!/runtime_disabled|emergency_kill/.test(breaker), "breaker must not know about flags");

  assert.notEqual(
    routingControlKey("route", "r1"),
    "cinefield:v1:circuit-breaker:route:r1",
    "different keyspaces"
  );
  assert.match(routingControlKey("route", "r1"), /^cinefield:v1:routing-control:/);
});

// ---------------------------------------------------------------------------
// Ambiguous submission safety is untouchable
// ---------------------------------------------------------------------------

test("disabling a provider does NOT justify failing over an ambiguous submission", () => {
  // The scenario the prompt names: provider A's submission is ambiguous, an
  // operator kills provider A, provider B is healthy and available. B must
  // still not run — a kill switch changes where FUTURE work goes, it does not
  // make an unconfirmed job safe to duplicate.
  const decision = decideFailover({
    attempt: {
      submission_evidence: "ambiguous",
      provider_job_id: null,
      status: "failed",
    },
    errorCode: "PROVIDER_TIMEOUT",
    isMockProvider: false,
    attemptCount: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    // Provider B is right there and eligible.
    alternativeRoutesAvailable: 1,
  });

  assert.equal(decision.decision, "reconciliation_required");
  assert.equal(decision.reason, "evidence_ambiguous");
});

test("the failover policy has no knowledge of runtime flags at all", () => {
  // Structural: there is no parameter, no import, and therefore no way for a
  // flag to become an input to the ambiguity decision.
  const source = readSource("src/lib/routing/failover-policy.ts");
  assert.ok(!/runtime|flag|kill/i.test(source.replace(/^\s*(\*|\/\/).*$/gm, "")));
});

// ---------------------------------------------------------------------------
// Source behaviour: available, unavailable, absent, corrupt
// ---------------------------------------------------------------------------

test("with no flag backend configured, the baseline governs and says so", async () => {
  const snapshot = await NO_RUNTIME_FLAG_SOURCE.read([{ kind: "route", id: "r1" }]);
  assert.equal(snapshot.source, "database_baseline");
  assert.equal(snapshot.controls.size, 0);
});

test("controls round-trip through Redis A", async () => {
  const client = fakeRedis();
  __setRoutingControlClientForTesting(client);
  try {
    assert.equal(await setRoutingControl(control("route", "r1", "emergency_kill")), true);

    const snapshot = await redisRuntimeFlagSource.read([{ kind: "route", id: "r1" }]);
    assert.equal(snapshot.source, "runtime_flag");
    assert.equal(snapshot.controls.get(controlKeyFor("route", "r1"))?.reason, "emergency_kill");

    await clearRoutingControl("route", "r1");
    const cleared = await redisRuntimeFlagSource.read([{ kind: "route", id: "r1" }]);
    assert.equal(cleared.controls.size, 0);
    assert.equal(cleared.source, "database_baseline");
  } finally {
    __setRoutingControlClientForTesting(null);
  }
});

test("an unreachable backend reports unavailable and enables nothing", async () => {
  const dead: RoutingControlRedisClient = {
    async get() {
      throw new Error("ECONNREFUSED");
    },
    async set() {
      throw new Error("ECONNREFUSED");
    },
    async del() {
      throw new Error("ECONNREFUSED");
    },
  };
  __setRoutingControlClientForTesting(dead);
  try {
    const snapshot = await redisRuntimeFlagSource.read([{ kind: "route", id: "r1" }]);
    assert.equal(snapshot.source, "unavailable");
    assert.equal(snapshot.controls.size, 0);

    // The documented trade-off: the durable baseline governs, so a DB-disabled
    // route is still excluded while the override layer is down.
    const dbDisabled = candidate({ enabled: false });
    const stillExcluded = selectHealthyRoute(
      "model-a",
      [dbDisabled],
      new Map([health(dbDisabled)]),
      T0,
      { runtimeControls: snapshot }
    );
    assert.equal(stillExcluded.outcome, "no_eligible_route");

    // And an enabled route keeps working — an optional override layer being
    // down must not take the whole platform offline.
    const healthy = candidate();
    const stillWorks = selectHealthyRoute(
      "model-a",
      [healthy],
      new Map([health(healthy)]),
      T0,
      { runtimeControls: snapshot }
    );
    assert.equal(stillWorks.outcome, "selected");
    assert.equal(stillWorks.decision.controlSource, "unavailable", "the degradation is visible");
  } finally {
    __setRoutingControlClientForTesting(null);
  }
});

test("a partial read is discarded rather than served as authoritative", async () => {
  let calls = 0;
  const flaky: RoutingControlRedisClient = {
    async get(key) {
      calls += 1;
      if (calls > 1) throw new Error("ECONNRESET");
      return JSON.stringify(control("route", key, "emergency_kill"));
    },
    async set() {
      return "OK";
    },
    async del() {
      return 1;
    },
  };
  __setRoutingControlClientForTesting(flaky);
  try {
    const snapshot = await redisRuntimeFlagSource.read([
      { kind: "route", id: "r1" },
      { kind: "provider", id: "fal" },
    ]);
    assert.equal(snapshot.source, "unavailable");
    assert.equal(
      snapshot.controls.size,
      0,
      "a partial view looks authoritative while missing controls — discard it"
    );
  } finally {
    __setRoutingControlClientForTesting(null);
  }
});

test("a corrupt or invalid control is treated as absent, never as a silent outage", () => {
  assert.equal(parseRuntimeControl("not json"), null);
  assert.equal(parseRuntimeControl('{"kind":"route"}'), null);
  assert.equal(
    parseRuntimeControl('{"kind":"route","targetId":"r","reason":"whatever","setAt":"x"}'),
    null,
    "an unknown reason must not become a disable"
  );

  const valid = parseRuntimeControl(
    JSON.stringify(control("route", "r1", "emergency_kill"))
  );
  assert.equal(valid?.reason, "emergency_kill");
});

test("an operator note is bounded and cannot smuggle a payload", () => {
  const parsed = parseRuntimeControl(
    JSON.stringify({ ...control("route", "r1"), note: "x".repeat(5_000) })
  );
  assert.ok((parsed?.note?.length ?? 0) <= 200);
});

test("the emergency kill affects the very next routing decision", async () => {
  const client = fakeRedis();
  __setRoutingControlClientForTesting(client);
  try {
    const route = candidate({ providerId: "fal", providerModelId: "fal-ai/x" });
    const spare = candidate({ providerId: "mock", providerModelId: "mock-image" });
    const snapshot: HealthSnapshot = new Map([health(route), health(spare)]);

    const before = selectHealthyRoute(
      "model-a",
      [route, spare],
      snapshot,
      T0,
      { runtimeControls: await loadRuntimeControls([route, spare], redisRuntimeFlagSource) }
    );
    assert.equal(before.outcome, "selected");

    await setRoutingControl(control("provider", "fal", "emergency_kill"));

    const after = selectHealthyRoute("model-a", [route, spare], snapshot, T0, {
      runtimeControls: await loadRuntimeControls([route, spare], redisRuntimeFlagSource),
    });
    assert.equal(after.outcome, "selected");
    if (after.outcome !== "selected") return;
    assert.equal(after.selection.routeId, spare.routeId);
  } finally {
    __setRoutingControlClientForTesting(null);
  }
});

test("loadRuntimeControls deduplicates targets across candidates", async () => {
  const asked: string[] = [];
  const source: RuntimeFlagSource = {
    async read(targets) {
      asked.push(...targets.map((t) => `${t.kind}:${t.id}`));
      return emptySnapshot("database_baseline");
    },
  };

  const a = candidate({ providerId: "fal", providerModelId: "fal-ai/x" });
  const b = candidate({ providerId: "fal", providerModelId: "fal-ai/x" });
  await loadRuntimeControls([a, b], source);

  assert.equal(new Set(asked).size, asked.length, "no target may be asked about twice");
  assert.ok(asked.includes("provider:fal"));
  assert.equal(asked.filter((t) => t === "provider:fal").length, 1);
});

// ---------------------------------------------------------------------------
// Kill semantics: routing only
// ---------------------------------------------------------------------------

test("a kill switch touches no lifecycle, no attempt and no provider", () => {
  for (const file of [
    "src/lib/routing/runtime-flags.ts",
    "src/lib/redis/routing-control-store.ts",
  ]) {
    const source = readSource(file).replace(/^\s*(\*|\/\/).*$/gm, "");
    for (const forbidden of [
      "@temporalio",
      "generation_attempts",
      "generations",
      "cancelGeneration",
      "adapter",
      "createGeneration",
    ]) {
      assert.ok(
        !new RegExp(forbidden.replace(/[/@]/g, "\\$&")).test(source),
        `${file} must not reach ${forbidden}`
      );
    }
  }
});

test("rejection reasons distinguish a planned disable from an emergency stop", () => {
  assert.equal(rejectionForControl(control("route", "r", "disabled")), "runtime_disabled");
  assert.equal(rejectionForControl(control("route", "r", "emergency_kill")), "emergency_kill");
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

test("no client-facing type can carry a flag, a kill or a routing override", () => {
  const createRequest = /export interface GenerationCreateRequest \{[\s\S]*?\n\}/.exec(
    readSource("src/lib/orchestration/generation-create-service.ts")
  );
  assert.ok(createRequest);
  for (const forbidden of ["flag", "kill", "override", "enabled", "control", "variation"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(createRequest[0]),
      `the public create request must have no "${forbidden}" field`
    );
  }

  const route = readSource("src/app/api/generate/route.ts");
  assert.ok(!/killSwitch|routeOverride|flagVariation|runtimeControl/i.test(route));
});

test("runtime control mutations are gated by the same fail-closed admin boundary", () => {
  const source = readSource("src/lib/routing/admin-route-service.ts");
  for (const name of ["setRuntimeRoutingControl", "clearRuntimeRoutingControl"]) {
    const body = new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`).exec(source);
    assert.ok(body, `${name} must exist`);
    assert.ok(
      body[0].includes("assertRouteAdmin("),
      `${name} must be gated — a kill switch cannot have a weaker gate than a priority slider`
    );
  }
  assert.match(source, /^import "server-only";/m);
});

test("no HTTP route and no MCP tool can write a routing control", () => {
  // Phase 7-E deliberately ships the consumer contract and an operator-gated
  // server function, with no network write surface at all. A kill switch
  // reachable by an agent is a kill switch that will eventually be pulled by
  // one.
  const apiDir = join(root, "src", "app", "api");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry: string) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  for (const file of walk(apiDir)) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !/setRuntimeRoutingControl|setRoutingControl|clearRoutingControl/.test(source),
      `${file} must not expose a runtime control write`
    );
  }
});

test("the flag evaluation context carries no prompt, media or credential", () => {
  // Only routing identities are ever sent to a flag source. Checked against
  // the FIELDS, not the prose — the file says in words that an operator note
  // must never be secret-bearing, and a comment saying so is not a field.
  const stripComments = (input: string) =>
    input.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const source = readSource("src/lib/routing/runtime-flags.ts");
  const target = /export interface FlagTarget \{[\s\S]*?\n\}/.exec(source);
  assert.ok(target);
  assert.ok(!/prompt|media|token|secret|apiKey|user/i.test(stripComments(target[0])));

  const controlShape = /export interface RuntimeControl \{[\s\S]*?\n\}/.exec(source);
  assert.ok(controlShape);
  assert.ok(!/prompt|media|token|secret|apiKey/i.test(stripComments(controlShape[0])));

  // And the fields are exactly the routing-identity ones — nothing else can
  // ride along to a flag provider.
  const fields = stripComments(controlShape[0])
    .split("\n")
    .map((line) => line.trim().split(/[?:]/)[0])
    .filter((name) => /^[a-z][A-Za-z]*$/.test(name));
  assert.deepEqual(fields.sort(), ["kind", "note", "reason", "setAt", "targetId"]);
});

test("no flag SDK credential exists and none is invented", () => {
  const packageJson = readSource("package.json");
  assert.ok(
    !/launchdarkly|openfeature/i.test(packageJson),
    "no flag SDK is installed; the contract is an interface a real one can implement"
  );

  const store = readSource("src/lib/redis/routing-control-store.ts");
  assert.ok(!/sdkKey|clientSideId|LD_|apiKey/i.test(store.replace(/^\s*\*.*$/gm, "")));
});

test("runtime control modules never reach the browser", () => {
  const store = readSource("src/lib/redis/routing-control-store.ts");
  assert.ok(!/"use client"/.test(store));
  const clientCatalog = readSource("src/lib/orchestration/orchestration-models.ts");
  assert.ok(!/runtime-flags|routing-control/.test(clientCatalog));
});
