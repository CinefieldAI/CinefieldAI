import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

import {
  __resetModelAvailabilityCache,
  availabilityLabel,
  canOfferForGeneration,
  fetchModelAvailability,
  peekModelAvailability,
  resolveRuntimeAvailability,
} from "@/lib/orchestration/model-availability-client";
import { resolveCatalogAvailability } from "@/lib/orchestration/model-availability";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase, uninstallFakeSupabase } from "./e2e-harness";
import { createGeneration } from "@/lib/orchestration/generation-create-service";
import { isOrchestrationError } from "@/lib/orchestration/errors";

/**
 * PHASE 8 — RUNTIME availability binding.
 *
 * The previous batch built the server contract and then gated the UI on the
 * BUILD-TIME flag, which cannot see a route disabled after the deploy. So a
 * model could read "ready" in the picker while the server had already stopped
 * accepting it — the same class of inconsistency the batch set out to remove,
 * one layer down.
 *
 * These tests exercise the real decision function and the real availability
 * resolver against a real (fake-backed) route table. Where a source assertion
 * appears it is a supplement, never the primary evidence.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

/** Seeds one model's routes so each case owns its topology. */
function seedRoutes(
  db: FakeSupabaseClient,
  modelId: string,
  routes: { providerId: string; providerModelId: string; enabled?: boolean; priority?: number }[]
): void {
  db.state.models = [{ id: modelId, label: modelId, generation_type: "image", lifecycle: "active" }];
  const versionId = randomUUID();
  db.state.model_versions = [{ id: versionId, model_id: modelId, version: 1, status: "active" }];
  db.state.providers = [...new Set(routes.map((r) => r.providerId))].map((id) => ({
    id,
    enabled: true,
  }));
  db.state.provider_models = routes.map((r, i) => ({
    id: `pm-${i}`,
    provider_id: r.providerId,
    provider_model_id: r.providerModelId,
    enabled: true,
  }));
  db.state.model_routes = routes.map((r, i) => ({
    id: `route-${i}`,
    model_id: modelId,
    model_version_id: versionId,
    provider_model_id: `pm-${i}`,
    enabled: r.enabled ?? true,
    priority: r.priority ?? 100,
    status: "active",
  }));
}

/** A fetch double serving exactly the shape GET /api/models returns. */
function modelsEndpoint(models: { id: string; productionAvailable: boolean }[]) {
  return (async () =>
    ({
      ok: true,
      async json() {
        return { models };
      },
    }) as unknown as Response) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// The decision function — behavioural, with real inputs
// ---------------------------------------------------------------------------

test("a model the server does not know is left completely alone", () => {
  // Most picker rows are catalog art with no server-side model. This feature
  // is not about them and must not touch them.
  const decision = resolveRuntimeAvailability("seedream-5.0-pro", {
    isServerModel: false,
    staticProductionReady: false,
    runtime: null,
  });
  assert.equal(decision, "available");
  assert.equal(canOfferForGeneration(decision), true);
  assert.equal(availabilityLabel(decision), null);
});

test("STATIC false is decisive and needs no round trip", () => {
  // Execution durability cannot be repaired by a route change, so there is
  // nothing runtime could say to rescue it — and answering immediately avoids
  // a pointless "checking" flash on a model that will never be offered.
  const decision = resolveRuntimeAvailability("nano-banana-pro", {
    isServerModel: true,
    staticProductionReady: false,
    runtime: null,
  });
  assert.equal(decision, "unavailable");
  assert.equal(availabilityLabel(decision), "Unavailable");
});

test("STATIC true is NOT sufficient — unresolved runtime reads as checking", () => {
  // The defect this file exists to close: presenting a model as ready on the
  // strength of a build artifact.
  const decision = resolveRuntimeAvailability("fal-flux-schnell", {
    isServerModel: true,
    staticProductionReady: true,
    runtime: null,
  });
  assert.equal(decision, "checking");
  assert.equal(
    canOfferForGeneration(decision),
    false,
    "'we have not heard yet' is not 'yes'"
  );
});

test("RUNTIME false overrides a build-time true", () => {
  const decision = resolveRuntimeAvailability("fal-flux-schnell", {
    isServerModel: true,
    staticProductionReady: true,
    runtime: new Map([["fal-flux-schnell", false]]),
  });
  assert.equal(decision, "unavailable");
  assert.equal(canOfferForGeneration(decision), false);
});

test("RUNTIME true on a statically ready model is offerable", () => {
  const decision = resolveRuntimeAvailability("fal-flux-schnell", {
    isServerModel: true,
    staticProductionReady: true,
    runtime: new Map([["fal-flux-schnell", true]]),
  });
  assert.equal(decision, "available");
  assert.equal(canOfferForGeneration(decision), true);
});

test("runtime cannot rescue a statically unsafe provider", () => {
  // Even a server response claiming true — which the real server never sends
  // for these — must not make a non-durable provider offerable.
  const decision = resolveRuntimeAvailability("nano-banana-pro", {
    isServerModel: true,
    staticProductionReady: false,
    runtime: new Map([["nano-banana-pro", true]]),
  });
  assert.equal(decision, "unavailable");
});

// ---------------------------------------------------------------------------
// The shared fetch/cache
// ---------------------------------------------------------------------------

test("availability is fetched once and shared between callers", async () => {
  __resetModelAvailabilityCache();
  let calls = 0;
  const fetcher = ((async (...args: unknown[]) => {
    calls += 1;
    return modelsEndpoint([{ id: "fal-flux-schnell", productionAvailable: true }])(
      ...(args as [RequestInfo | URL])
    );
  }) as unknown) as typeof fetch;

  const [a, b] = await Promise.all([
    fetchModelAvailability(fetcher),
    fetchModelAvailability(fetcher),
  ]);
  const c = await fetchModelAvailability(fetcher);

  assert.equal(calls, 1, "the picker and the Generate guard must share one request");
  assert.equal(a?.get("fal-flux-schnell"), true);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  assert.deepEqual(peekModelAvailability(), a);
  __resetModelAvailabilityCache();
});

test("a failed fetch leaves availability unresolved, never optimistic", async () => {
  __resetModelAvailabilityCache();
  const failing = (async () => {
    throw new Error("network");
  }) as unknown as typeof fetch;

  const resolved = await fetchModelAvailability(failing);
  assert.equal(resolved, null);

  // Which the decision function reads as "checking", not "available".
  assert.equal(
    resolveRuntimeAvailability("fal-flux-schnell", {
      isServerModel: true,
      staticProductionReady: true,
      runtime: resolved,
    }),
    "checking"
  );
  __resetModelAvailabilityCache();
});

test("a non-ok response is treated as unresolved", async () => {
  __resetModelAvailabilityCache();
  const unauthorized = (async () =>
    ({ ok: false, async json() { return {}; } }) as unknown as Response) as unknown as typeof fetch;
  assert.equal(await fetchModelAvailability(unauthorized), null);
  __resetModelAvailabilityCache();
});

test("the client keeps only ids and booleans from the response", async () => {
  __resetModelAvailabilityCache();
  // Even if the server ever sent more, the client stores nothing else.
  const withExtras = (async () =>
    ({
      ok: true,
      async json() {
        return {
          models: [
            { id: "fal-flux-schnell", productionAvailable: true, providerId: "fal", routeId: "r1" },
          ],
        };
      },
    }) as unknown as Response) as unknown as typeof fetch;

  const resolved = await fetchModelAvailability(withExtras);
  assert.deepEqual([...(resolved?.entries() ?? [])], [["fal-flux-schnell", true]]);
  const serialized = JSON.stringify([...(resolved?.entries() ?? [])]);
  assert.ok(!/fal\b(?!-flux)|routeId|providerId/.test(serialized.replace("fal-flux-schnell", "")));
  __resetModelAvailabilityCache();
});

// ---------------------------------------------------------------------------
// Runtime route changes, WITHOUT regenerating the catalog
// ---------------------------------------------------------------------------

test("CASE A/B/C: disabling and re-enabling the last safe route flips availability", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    // A: a safe fal route.
    seedRoutes(db, "fal-flux-schnell", [
      { providerId: "fal", providerModelId: "fal-ai/flux/schnell" },
    ]);
    let server = await resolveCatalogAvailability(db as never);
    assert.equal(server.get("fal-flux-schnell")?.availability, "available");

    let uiDecision = resolveRuntimeAvailability("fal-flux-schnell", {
      isServerModel: true,
      staticProductionReady: true,
      runtime: new Map([
        ["fal-flux-schnell", server.get("fal-flux-schnell")?.availability === "available"],
      ]),
    });
    assert.equal(canOfferForGeneration(uiDecision), true);

    // B: the operator disables it. NO rebuild, NO catalog regeneration.
    db.state.model_routes[0].enabled = false;
    server = await resolveCatalogAvailability(db as never);
    assert.equal(server.get("fal-flux-schnell")?.availability, "not_production_ready");

    uiDecision = resolveRuntimeAvailability("fal-flux-schnell", {
      isServerModel: true,
      staticProductionReady: true, // build artifact still says ready — and loses
      runtime: new Map([
        ["fal-flux-schnell", server.get("fal-flux-schnell")?.availability === "available"],
      ]),
    });
    assert.equal(uiDecision, "unavailable");
    assert.equal(canOfferForGeneration(uiDecision), false);

    // C: re-enabled, still no rebuild.
    db.state.model_routes[0].enabled = true;
    server = await resolveCatalogAvailability(db as never);
    assert.equal(server.get("fal-flux-schnell")?.availability, "available");
    assert.equal(
      canOfferForGeneration(
        resolveRuntimeAvailability("fal-flux-schnell", {
          isServerModel: true,
          staticProductionReady: true,
          runtime: new Map([["fal-flux-schnell", true]]),
        })
      ),
      true
    );
  } finally {
    await uninstallFakeSupabase();
  }
});

test("MULTI-ROUTE: safe route governs, and losing it flips the UI", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    seedRoutes(db, "fal-flux-schnell", [
      { providerId: "gemini", providerModelId: "gemini-3-pro-image", priority: 10_000 },
      { providerId: "fal", providerModelId: "fal-ai/flux/schnell", priority: 1 },
    ]);
    let server = await resolveCatalogAvailability(db as never);
    assert.equal(
      server.get("fal-flux-schnell")?.availability,
      "available",
      "a top-priority unsafe route must not hide the usable one"
    );

    // Disable the safe one; the unsafe one stays enabled and highest priority.
    db.state.model_routes[1].enabled = false;
    server = await resolveCatalogAvailability(db as never);
    assert.equal(server.get("fal-flux-schnell")?.availability, "not_production_ready");

    // Re-enable.
    db.state.model_routes[1].enabled = true;
    server = await resolveCatalogAvailability(db as never);
    assert.equal(server.get("fal-flux-schnell")?.availability, "available");
  } finally {
    await uninstallFakeSupabase();
  }
});

test("GEMINI and CLOUDFLARE stay unavailable through the runtime path", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    const server = await resolveCatalogAvailability(db as never);
    for (const id of ["nano-banana-pro", "nano-banana-2", "nano-banana-2-lite"]) {
      assert.notEqual(server.get(id)?.availability, "available");
      assert.equal(
        resolveRuntimeAvailability(id, {
          isServerModel: true,
          staticProductionReady: false,
          runtime: new Map([[id, false]]),
        }),
        "unavailable"
      );
    }
    for (const id of ["cloudflare-melotts", "cloudflare-aura-2-en"]) {
      assert.notEqual(server.get(id)?.availability, "available");
    }
  } finally {
    await uninstallFakeSupabase();
  }
});

// ---------------------------------------------------------------------------
// The UI consumes runtime — and the guard covers a preselected model
// ---------------------------------------------------------------------------

test("the model selector consumes RUNTIME availability, not the build flag alone", () => {
  const selector = readSource("src/components/cinema-studio/ModelSelector.tsx");

  // It subscribes to the runtime hook...
  assert.match(selector, /useModelAvailability\(\)/);
  // ...feeds it into the shared decision...
  assert.match(selector, /resolveRuntimeAvailability\(modelId, \{/);
  assert.match(selector, /runtime,/);
  // ...and gates selection on the resolved answer.
  assert.match(selector, /canOfferForGeneration\(selectorAvailability\(id, runtimeAvailability\)\)/);

  // The build flag is now only ONE input, never the sole authority.
  assert.match(selector, /staticProductionReady: isProductionReadyModel\(modelId\)/);
  assert.ok(
    !/if \(isKnownProductionUnavailable/.test(selector),
    "the build-time-only gate is gone"
  );
});

test("the Generate funnel guards an ALREADY-SELECTED model", () => {
  // Blocking the row is not enough: a model can be the selection before the
  // picker is ever opened, or become unavailable while the page is open.
  const hook = readSource("src/hooks/useGeneration.ts");
  assert.match(hook, /await fetchModelAvailability\(\)/);
  assert.match(hook, /canOfferForGeneration\(availability\)/);
  assert.match(hook, /This model is currently unavailable/);

  // The guard runs BEFORE anything is uploaded or created.
  const guardIndex = hook.indexOf("fetchModelAvailability()");
  const createIndex = hook.indexOf('fetch("/api/generate"');
  const uploadIndex = hook.indexOf(".upload(");
  assert.ok(guardIndex > 0 && createIndex > guardIndex, "guard precedes creation");
  assert.ok(uploadIndex > guardIndex, "guard precedes the input upload");
});

test("selecting an unavailable id in client state changes nothing on the server", async () => {
  // The user cannot bypass the UI by forcing a model id: creation re-derives
  // eligibility and refuses, writing nothing.
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const projectId = randomUUID();
  db.state.projects = [{ id: projectId, clerk_user_id: "user_bind", name: "p" }];

  try {
    await assert.rejects(
      createGeneration(db as never, "user_bind", {
        model: "nano-banana-pro",
        prompt: "bypass probe",
        projectId,
      }),
      (error: unknown) =>
        isOrchestrationError(error) &&
        (error.code === "NO_ELIGIBLE_ROUTE" || error.code === "NO_HEALTHY_ROUTE")
    );
    assert.equal(db.state.generations.length, 0);
    assert.equal((db.state.generation_attempts ?? []).length, 0);
    assert.equal(db.storageUploads.length, 0);
  } finally {
    await uninstallFakeSupabase();
  }
});

test("server enforcement never imports the browser's availability view", () => {
  for (const file of [
    "src/lib/orchestration/generation-create-service.ts",
    "src/lib/routing/model-router.ts",
    "src/lib/routing/health-aware-router.ts",
  ]) {
    const source = readSource(file);
    assert.ok(
      !/model-availability-client|productionAvailable|useModelAvailability/.test(source),
      `${file} must not consult the browser's view`
    );
  }
});

// ---------------------------------------------------------------------------
// Nothing provider-shaped crosses the boundary
// ---------------------------------------------------------------------------

test("the client availability module knows nothing about providers", () => {
  const source = readSource("src/lib/orchestration/model-availability-client.ts");
  // Word-boundary matched: a substring search for "fal" also hits "false",
  // which says nothing about providers.
  for (const forbidden of [
    "gemini",
    "cloudflare",
    "fal",
    "providerId",
    "provider_model",
    "routeId",
    "priority",
    "durability",
    "not_proven",
    "restart_safe",
    "provider_job",
  ]) {
    assert.ok(
      !new RegExp(`\b${forbidden}\b`, "i").test(source),
      `the client module must not mention ${forbidden}`
    );
  }

  // And it reproduces no eligibility rule.
  for (const routerish of ["rejectionFor", "listRouteCandidates", "enabled", "scoreRoute"]) {
    assert.ok(!source.includes(routerish), `no router logic in the browser (${routerish})`);
  }
});

test("capability controls still come from the Capability Registry, not availability", () => {
  // A model being unavailable must not change what it is capable of.
  const capabilities = readSource("src/components/landing/createImage/imageModelCapabilities.ts");
  assert.ok(!/productionAvailable|model-availability/.test(capabilities));
  assert.match(capabilities, /getPublicModel/);
});

test("the build catalog drift test still holds", async () => {
  const { renderCatalog } = await import("../../../scripts/generate-public-catalog");
  assert.equal(
    renderCatalog().replace(/\r\n/g, "\n"),
    readSource("src/lib/orchestration/public-model-catalog.ts"),
    "public-model-catalog.ts is stale — run: npm run catalog:generate"
  );
});
