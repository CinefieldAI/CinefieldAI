import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { rejectionFor, selectRoute } from "@/lib/routing/model-router";
import {
  healthKeyFor,
  selectHealthyRoute,
  type HealthSnapshot,
  type OptimizationSnapshot,
} from "@/lib/routing/health-aware-router";
import {
  controlKeyFor,
  emptySnapshot,
  type RuntimeControlSnapshot,
} from "@/lib/routing/runtime-flags";
import type { RouteCandidate } from "@/lib/routing/route-types";
import type { RouteHealth } from "@/lib/routing/route-health";
import type { RouteQuality } from "@/lib/routing/route-quality";
import { getProviderAdapter, listRegisteredProviders } from "@/lib/orchestration/provider-registry";
import { isProductionDurable } from "@/lib/orchestration/providers/provider-capabilities";
import { decideFailover, DEFAULT_MAX_ATTEMPTS } from "@/lib/routing/failover-policy";
import { randomUUID } from "node:crypto";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase, uninstallFakeSupabase } from "./e2e-harness";
import { createGeneration } from "@/lib/orchestration/generation-create-service";
import { projectModelById } from "@/lib/orchestration/capability-projection";
import { isOrchestrationError } from "@/lib/orchestration/errors";

/**
 * PHASE 8 — PRODUCTION REACHABILITY GATE.
 *
 * The binding rule: a provider that cannot prove restart-safe execution does
 * not run canonical production work. Not "is deprioritized", not "is warned
 * about" — is excluded, structurally, before anything is weighed.
 *
 * Every test here builds the most favourable possible case for an unsafe
 * provider — highest priority, perfect health, zero cost, top quality, runtime
 * flags clear — and proves it still loses. A gate that only holds for
 * unattractive routes is not a gate.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const T0 = new Date("2026-08-13T10:00:00.000Z");

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

/** Perfect telemetry — the best case an unsafe provider could ever have. */
function perfectHealth(c: RouteCandidate): [string, RouteHealth] {
  return [
    healthKeyFor(c.providerId, c.providerModelId),
    {
      providerId: c.providerId,
      providerModelId: c.providerModelId,
      breakerState: "CLOSED",
      admission: "admit",
      sampleCount: 500,
      errorRate: 0,
      averageLatencyMs: 1,
      consecutiveFailures: 0,
      observedAt: T0.toISOString(),
      confidence: "observed",
      telemetryUnavailable: false,
    },
  ];
}

/** Free and top-rated — again, the best case. */
function perfectOptimization(c: RouteCandidate): OptimizationSnapshot {
  return {
    cost: new Map([
      [
        healthKeyFor(c.providerId, c.providerModelId),
        {
          providerId: c.providerId,
          providerModelId: c.providerModelId,
          state: "known" as const,
          estimatedCost: 0,
          currency: "USD",
        },
      ],
    ]),
    quality: new Map<string, RouteQuality>([
      [
        healthKeyFor(c.providerId, c.providerModelId),
        {
          providerId: c.providerId,
          providerModelId: c.providerModelId,
          state: "known",
          score: 1,
        },
      ],
    ]),
  };
}

// ---------------------------------------------------------------------------
// The classification itself
// ---------------------------------------------------------------------------

test("each adapter's production durability is declared, and only fal and mock qualify", () => {
  const durability = Object.fromEntries(
    listRegisteredProviders().map((id) => [
      id,
      getProviderAdapter(id).capabilities.productionExecutionDurability,
    ])
  );

  assert.equal(durability["fal"], "implemented_not_live_validated");
  assert.equal(durability["mock"], "restart_safe");
  assert.equal(durability["gemini"], "not_proven");
  assert.equal(durability["cloudflare-workers-ai"], "not_proven");

  assert.equal(isProductionDurable("restart_safe"), true);
  assert.equal(isProductionDurable("implemented_not_live_validated"), true);
  assert.equal(isProductionDurable("not_proven"), false);
  assert.equal(isProductionDurable("unsupported"), false);
});

test("fal is NOT marked live-validated", () => {
  // Eligible because the recovery code is real and tested with doubles. That
  // is a different claim from "we ran it against fal", and the two must not
  // be allowed to blur.
  assert.equal(
    getProviderAdapter("fal").capabilities.productionExecutionDurability,
    "implemented_not_live_validated"
  );
  assert.notEqual(
    getProviderAdapter("fal").capabilities.productionExecutionDurability,
    "restart_safe"
  );
});

// ---------------------------------------------------------------------------
// GEMINI — the full best-case exclusion
// ---------------------------------------------------------------------------

test("GEMINI: excluded even as the best route on every other axis", () => {
  const gemini = candidate({
    providerId: "gemini",
    providerModelId: "gemini-3-pro-image",
    priority: 10_000,
  });
  const fallback = candidate({ providerId: "mock", priority: 1 });

  const health: HealthSnapshot = new Map([perfectHealth(gemini), perfectHealth(fallback)]);

  const result = selectHealthyRoute("model-a", [gemini, fallback], health, T0, {
    optimization: perfectOptimization(gemini),
    runtimeControls: emptySnapshot("database_baseline"),
  });

  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, fallback.routeId, "gemini must never win");

  const evaluation = result.decision.evaluations.find((e) => e.routeId === gemini.routeId);
  assert.equal(evaluation?.rejection, "provider_execution_not_restart_safe");
  assert.equal(evaluation?.eligible, false);
  assert.equal(
    evaluation?.score,
    undefined,
    "an excluded route must never receive a composite score"
  );
  assert.equal(evaluation?.health, undefined, "it is not even health-checked");
});

test("CLOUDFLARE: excluded on the same terms", () => {
  const cloudflare = candidate({
    providerId: "cloudflare-workers-ai",
    providerModelId: "@cf/myshell-ai/melotts",
    priority: 10_000,
  });
  const fallback = candidate({ providerId: "mock", priority: 1 });

  const result = selectHealthyRoute(
    "model-a",
    [cloudflare, fallback],
    new Map([perfectHealth(cloudflare), perfectHealth(fallback)]),
    T0,
    { optimization: perfectOptimization(cloudflare) }
  );

  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, fallback.routeId);
  assert.equal(
    result.decision.evaluations.find((e) => e.routeId === cloudflare.routeId)?.rejection,
    "provider_execution_not_restart_safe"
  );
});

test("FAL remains eligible", () => {
  const fal = candidate({ providerId: "fal", providerModelId: "fal-ai/flux/schnell" });
  assert.equal(rejectionFor(fal), null, "fal passes hard eligibility");

  const result = selectHealthyRoute("model-a", [fal], new Map([perfectHealth(fal)]), T0);
  assert.equal(result.outcome, "selected");
});

// ---------------------------------------------------------------------------
// Nothing can bypass the gate
// ---------------------------------------------------------------------------

test("route priority cannot bypass durability", () => {
  for (const priority of [0, 100, 5_000, 10_000]) {
    const gemini = candidate({ providerId: "gemini", priority });
    assert.equal(rejectionFor(gemini), "provider_execution_not_restart_safe");
  }
});

test("enabling everything in the database cannot bypass durability", () => {
  // ENABLED ROUTE != PRODUCTION-SAFE ROUTE. An operator's intent cannot
  // conjure a recovery path that does not exist.
  const gemini = candidate({
    providerId: "gemini",
    enabled: true,
    routeStatus: "active",
    providerEnabled: true,
    providerModelEnabled: true,
    modelLifecycle: "active",
    modelVersionStatus: "active",
  });
  assert.equal(rejectionFor(gemini), "provider_execution_not_restart_safe");
});

test("runtime flags cannot re-enable an undurable provider", () => {
  // Runtime controls only ever SUBTRACT. There is no control shape that adds
  // a route back, and the durability gate runs in hard eligibility, which
  // sits before controls are even consulted.
  const gemini = candidate({ providerId: "gemini", priority: 9_999 });
  const fallback = candidate({ providerId: "mock", priority: 1 });

  const noControls: RuntimeControlSnapshot = emptySnapshot("runtime_flag");
  const result = selectHealthyRoute(
    "model-a",
    [gemini, fallback],
    new Map([perfectHealth(gemini), perfectHealth(fallback)]),
    T0,
    { runtimeControls: noControls, optimization: perfectOptimization(gemini) }
  );

  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, fallback.routeId);

  // And the control type genuinely has no "enable" shape.
  const flags = readSource("src/lib/routing/runtime-flags.ts");
  const control = /export interface RuntimeControl \{[\s\S]*?\n\}/.exec(flags);
  assert.ok(control);
  assert.ok(!/enable|allow|force|bypass/i.test(control[0].replace(/^\s*\*.*$/gm, "")));
  assert.ok(controlKeyFor("provider", "gemini").length > 0);
});

test("the static router applies the same gate as the health router", () => {
  // One eligibility function, two callers. A second notion of eligibility is
  // how an unsafe provider eventually gets traffic through the back door.
  const gemini = candidate({ providerId: "gemini", priority: 9_999 });
  const fallback = candidate({ providerId: "mock", priority: 1 });

  const staticResult = selectRoute("model-a", [gemini, fallback]);
  assert.equal(staticResult.outcome, "selected");
  if (staticResult.outcome !== "selected") return;
  assert.equal(staticResult.selection.routeId, fallback.routeId);
});

test("a model whose only routes are undurable gets NO route, not an unsafe one", () => {
  const gemini = candidate({ providerId: "gemini", priority: 500 });
  const cloudflare = candidate({ providerId: "cloudflare-workers-ai", priority: 400 });

  const result = selectHealthyRoute(
    "model-a",
    [gemini, cloudflare],
    new Map([perfectHealth(gemini), perfectHealth(cloudflare)]),
    T0,
    { optimization: perfectOptimization(gemini) }
  );

  // no_eligible_route, not no_healthy_route: this is a capability fact, not an
  // outage, and the two need different operator responses.
  assert.equal(result.outcome, "no_eligible_route");
  if (result.outcome !== "no_eligible_route") return;
  for (const evaluation of result.decision.evaluations) {
    assert.equal(evaluation.rejection, "provider_execution_not_restart_safe");
    assert.equal(evaluation.score, undefined);
  }
});

// ---------------------------------------------------------------------------
// Failover uses the same gate
// ---------------------------------------------------------------------------

test("FAILOVER cannot fall back onto an undurable provider", () => {
  // Failover selection runs through the same selectHealthyRoute, so a route
  // rejected for initial routing is rejected as a failover candidate too.
  // There is no separate, weaker failover eligibility path.
  const failed = candidate({ providerId: "fal", providerModelId: "fal-ai/a", priority: 100 });
  const gemini = candidate({ providerId: "gemini", priority: 9_999 });

  const result = selectHealthyRoute(
    "model-a",
    [failed, gemini],
    new Map([perfectHealth(failed), perfectHealth(gemini)]),
    T0,
    { excludeRouteIds: [failed.routeId], optimization: perfectOptimization(gemini) }
  );

  assert.notEqual(result.outcome, "selected", "there is nowhere safe to fail over to");

  const activity = readSource("worker/activities/generation-activities.ts");
  assert.match(activity, /resolveHealthyRoute\(admin, \{/, "failover uses the same resolver");
  assert.match(activity, /excludeRouteIds: triedRouteIds/);
});

test("AMBIGUOUS still blocks failover regardless of any durability status", () => {
  const decision = decideFailover({
    attempt: { submission_evidence: "ambiguous", provider_job_id: null, status: "failed" },
    errorCode: "PROVIDER_TIMEOUT",
    isMockProvider: false,
    attemptCount: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    alternativeRoutesAvailable: 5,
  });
  assert.equal(decision.decision, "reconciliation_required");
  assert.equal(decision.reason, "evidence_ambiguous");
});

// ---------------------------------------------------------------------------
// Ordering and structure
// ---------------------------------------------------------------------------

test("the gate lives in HARD eligibility, before anything is scored", () => {
  const router = readSource("src/lib/routing/model-router.ts");
  const eligibility = /export function rejectionFor\([\s\S]*?\n\}/.exec(router);
  assert.ok(eligibility);
  assert.match(eligibility[0], /isProductionDurable/);
  assert.match(eligibility[0], /provider_execution_not_restart_safe/);

  // And the health router calls that same function before health, cost or
  // quality are looked at.
  // Measured on the CALL SITES inside the selector, not on the import block —
  // every one of these names appears at the top of the file too.
  const health = readSource("src/lib/routing/health-aware-router.ts");
  const selector = health.slice(health.indexOf("export function selectHealthyRoute"));
  const hardIndex = selector.indexOf("rejectionFor(candidate)");
  const controlsIndex = selector.indexOf("const exclusion = findRuntimeExclusion(");
  const scoreIndex = selector.indexOf("scoreRouteComposite(");

  assert.ok(hardIndex > 0, "hard eligibility runs inside the selector");
  assert.ok(controlsIndex > hardIndex, "durability precedes runtime controls");
  assert.ok(scoreIndex > controlsIndex, "and scoring comes last");
});

test("the browser cannot express durability, a provider, or a bypass", () => {
  const createRequest = /export interface GenerationCreateRequest \{[\s\S]*?\n\}/.exec(
    readSource("src/lib/orchestration/generation-create-service.ts")
  );
  assert.ok(createRequest);
  for (const forbidden of ["durab", "provider", "route", "bypass", "restart"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(createRequest[0]),
      `the public create request must have no "${forbidden}" field`
    );
  }

  const apiRoute = readSource("src/app/api/generate/route.ts");
  assert.ok(!/durability|restart_safe|not_proven|providerJobId/i.test(apiRoute));

  // The client catalog carries no durability or provider identity either.
  const catalog = readSource("src/lib/orchestration/public-model-catalog.ts");
  assert.ok(!/durability|restart_safe|not_proven|providerId/i.test(catalog));
});

test("no direct provider fallback exists anywhere in the request path", () => {
  const apiRoute = readSource("src/app/api/generate/route.ts");
  for (const forbidden of ["geminiProvider", "falProvider", "cloudflareWorkersAiProvider"]) {
    assert.ok(!new RegExp(forbidden).test(apiRoute), `no direct ${forbidden} call from the route`);
  }

  const createService = readSource("src/lib/orchestration/generation-create-service.ts");
  assert.ok(!/getProviderAdapter/.test(createService), "creation never touches an adapter");
});

test("no Phase 9 storage was invented to keep an undurable provider alive", () => {
  for (const file of [
    "src/lib/orchestration/providers/gemini-provider.ts",
    "src/lib/orchestration/providers/cloudflare-workers-ai-provider.ts",
  ]) {
    const source = readSource(file);

    // NOTE: these adapters legitimately read Supabase Storage to DOWNLOAD a
    // user-supplied input image. That is not a result store, and banning the
    // word outright would flag correct, pre-existing code. What must not
    // appear is anything that WRITES an output somewhere to survive a crash.
    for (const forbidden of [
      "\\.upload\\(",
      "redis",
      "bullmq",
      "writeFile",
      "tmpdir",
      "createWriteStream",
    ]) {
      assert.ok(
        !new RegExp(forbidden, "i").test(source),
        `${file} must not grow a durability backend — that is Phase 9's`
      );
    }

    // And the in-memory map is still there, unchanged: the fix was exclusion,
    // not a quietly invented store.
    assert.match(source, /PENDING_RESULTS/);
  }
});

// ---------------------------------------------------------------------------
// End to end: the canonical path refuses, and nothing durable is created
// ---------------------------------------------------------------------------

test("END TO END: a gemini generation is refused before any row exists", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const projectId = randomUUID();
  db.state.projects = [{ id: projectId, clerk_user_id: "user_gate", name: "p" }];

  try {
    await assert.rejects(
      createGeneration(db as never, "user_gate", {
        model: "nano-banana-pro",
        prompt: "gate probe",
        projectId,
      }),
      (error: unknown) =>
        isOrchestrationError(error) &&
        (error.code === "NO_ELIGIBLE_ROUTE" || error.code === "NO_HEALTHY_ROUTE")
    );

    // The whole point of refusing at creation: no durable generation, no
    // attempt, no provider submission, nothing to settle.
    assert.equal(db.state.generations.length, 0, "no generation row may be created");
    assert.equal((db.state.generation_attempts ?? []).length, 0, "and no attempt");
    assert.equal(db.storageUploads.length, 0);
  } finally {
    await uninstallFakeSupabase();
  }
});

test("END TO END: a mock generation still works — the gate is targeted, not a blanket block", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const projectId = randomUUID();
  db.state.projects = [{ id: projectId, clerk_user_id: "user_gate", name: "p" }];

  try {
    const outcome = await createGeneration(db as never, "user_gate", {
      model: "mock-image",
      prompt: "gate probe",
      projectId,
    });
    assert.equal(outcome.outcome, "created");
    const row = db.state.generations[0] as { metadata: Record<string, unknown> };
    const routing = row.metadata.routing as Record<string, unknown>;
    assert.equal(routing.providerId, "mock");
  } finally {
    await uninstallFakeSupabase();
  }
});

test("PUBLIC CATALOG AVAILABILITY GAP is real and recorded", async () => {
  // The server is fail-closed — proven above. The CATALOG is not: the public
  // descriptor has no availability/status field at all, and projectCatalog()
  // filters only on the registry's `enabled` flag, which is still true for a
  // gemini model. So /api/models still advertises nano-banana while creation
  // refuses it.
  //
  // Adding availability semantics means a new projection field, a regenerated
  // client catalog and UI treatment for an unavailable model — a larger change
  // than a provider batch should make to a frozen page. Recorded here rather
  // than faked.
  const descriptor = projectModelById("nano-banana-pro");
  assert.ok(descriptor, "the model is still published by the catalog");

  const serialized = JSON.stringify(descriptor);
  assert.ok(
    !/availability|unavailable|status|durab/i.test(serialized),
    "there is no field in which the catalog could express this"
  );

  const projection = readSource("src/lib/orchestration/capability-projection.ts");
  assert.match(
    projection,
    /\.filter\(\(entry\) => entry\.enabled\)/,
    "the only filter is the registry enabled flag"
  );

  // The gap is documented, not silently carried.
  const doc = readSource("docs/architecture/PROVIDER_NETWORK.md");
  assert.match(doc, /PUBLIC CATALOG AVAILABILITY GAP/);
});
