import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

import {
  isStaticallyProductionReady,
  resolveCatalogAvailability,
  resolveModelAvailability,
} from "@/lib/orchestration/model-availability";
import { findModel } from "@/lib/orchestration/model-registry";
import { projectModelById } from "@/lib/orchestration/capability-projection";
import {
  isProductionReadyModel,
  isOrchestrationModel,
} from "@/lib/orchestration/orchestration-models";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase, uninstallFakeSupabase } from "./e2e-harness";
import { createGeneration } from "@/lib/orchestration/generation-create-service";
import { isOrchestrationError } from "@/lib/orchestration/errors";

/**
 * PHASE 8 — public production availability.
 *
 * The gap this closes: the server has been refusing Gemini-backed generations
 * since the durability gate landed, while the catalog kept advertising them.
 * A product that offers something it will then refuse looks broken; being
 * honest about it is the fix, and weakening the refusal is not.
 *
 * Two rules run through every test here:
 *   availability is DERIVED from the router's own eligibility, never from a
 *   second implementation of it;
 *   and the browser learns a product state, never a provider.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

/**
 * Source with comments removed.
 *
 * Every assertion below is about what the CODE does. Several of these files
 * explain in prose that they must not do routing, and a sentence saying "no
 * route priority here" is not route priority.
 */
const readCode = (relative: string) =>
  readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Seeds a route table directly, so each case controls its own topology. */
function seedRoutes(
  db: FakeSupabaseClient,
  modelId: string,
  routes: {
    providerId: string;
    providerModelId: string;
    enabled?: boolean;
    priority?: number;
    status?: string;
  }[]
): void {
  db.state.models = [{ id: modelId, label: modelId, generation_type: "image", lifecycle: "active" }];
  const versionId = randomUUID();
  db.state.model_versions = [
    { id: versionId, model_id: modelId, version: 1, status: "active" },
  ];
  db.state.providers = [
    ...new Set(routes.map((r) => r.providerId)),
  ].map((id) => ({ id, enabled: true }));
  db.state.provider_models = routes.map((r, index) => ({
    id: `pm-${index}`,
    provider_id: r.providerId,
    provider_model_id: r.providerModelId,
    enabled: true,
  }));
  db.state.model_routes = routes.map((r, index) => ({
    id: `route-${index}`,
    model_id: modelId,
    model_version_id: versionId,
    provider_model_id: `pm-${index}`,
    enabled: r.enabled ?? true,
    priority: r.priority ?? 100,
    status: r.status ?? "active",
  }));
}

// ---------------------------------------------------------------------------
// Static readiness — the half a build artifact may honestly carry
// ---------------------------------------------------------------------------

test("static readiness follows execution durability, nothing else", () => {
  assert.equal(isStaticallyProductionReady(findModel("fal-flux-schnell")!), true);
  assert.equal(isStaticallyProductionReady(findModel("mock-image")!), true);
  assert.equal(isStaticallyProductionReady(findModel("nano-banana-pro")!), false);
  assert.equal(isStaticallyProductionReady(findModel("cloudflare-melotts")!), false);
});

test("the public descriptor and the generated catalog carry it", () => {
  assert.equal(projectModelById("fal-flux-schnell")?.productionReady, true);
  assert.equal(projectModelById("nano-banana-pro")?.productionReady, false);

  // And the client reads the same value from the build artifact.
  assert.equal(isProductionReadyModel("fal-flux-schnell"), true);
  assert.equal(isProductionReadyModel("nano-banana-pro"), false);
  assert.equal(isProductionReadyModel("nano-banana-2"), false);
  assert.equal(isProductionReadyModel("nano-banana-2-lite"), false);
});

// ---------------------------------------------------------------------------
// Runtime availability — the route table decides
// ---------------------------------------------------------------------------

test("CASE 1: a model with a valid fal route is available", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    seedRoutes(db, "model-x", [
      { providerId: "fal", providerModelId: "fal-ai/flux/schnell" },
    ]);
    const result = await resolveModelAvailability(db as never, "model-x");
    assert.equal(result.availability, "available");
    assert.deepEqual(result.internalReasons, []);
  } finally {
    await uninstallFakeSupabase();
  }
});

test("CASE 2: a model with only a Gemini route is NOT available", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    seedRoutes(db, "model-x", [
      { providerId: "gemini", providerModelId: "gemini-3-pro-image" },
    ]);
    const result = await resolveModelAvailability(db as never, "model-x");
    assert.notEqual(result.availability, "available");
    assert.equal(result.availability, "not_production_ready");
    // Internal only — this string never reaches a browser.
    assert.ok(result.internalReasons.includes("provider_execution_not_restart_safe"));
  } finally {
    await uninstallFakeSupabase();
  }
});

test("CASE 3: a model with only a Cloudflare route is NOT available", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    seedRoutes(db, "model-x", [
      { providerId: "cloudflare-workers-ai", providerModelId: "@cf/myshell-ai/melotts" },
    ]);
    const result = await resolveModelAvailability(db as never, "model-x");
    assert.notEqual(result.availability, "available");
    assert.ok(result.internalReasons.includes("provider_execution_not_restart_safe"));
  } finally {
    await uninstallFakeSupabase();
  }
});

test("CASE 4: one safe route among unsafe ones makes the model available", async () => {
  // Availability is the EXISTENCE of a safe route, not "the winner happens to
  // be safe" — the router will simply never pick the unsafe one.
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    seedRoutes(db, "model-x", [
      { providerId: "gemini", providerModelId: "gemini-3-pro-image", priority: 10_000 },
      { providerId: "fal", providerModelId: "fal-ai/flux/schnell", priority: 1 },
    ]);
    const result = await resolveModelAvailability(db as never, "model-x");
    assert.equal(
      result.availability,
      "available",
      "a higher-priority unsafe route must not hide a usable one"
    );
  } finally {
    await uninstallFakeSupabase();
  }
});

test("CASE 5: disabling the last safe route makes the model unavailable", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    seedRoutes(db, "model-x", [
      { providerId: "fal", providerModelId: "fal-ai/flux/schnell", enabled: false },
      { providerId: "gemini", providerModelId: "gemini-3-pro-image", enabled: true },
    ]);
    const result = await resolveModelAvailability(db as never, "model-x");
    assert.equal(result.availability, "not_production_ready");
    assert.ok(result.internalReasons.includes("route_disabled"));
    assert.ok(result.internalReasons.includes("provider_execution_not_restart_safe"));
  } finally {
    await uninstallFakeSupabase();
  }
});

test("CASE 6: enabling an unsafe route never creates availability", async () => {
  // Everything an operator could switch on, switched on.
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    seedRoutes(db, "model-x", [
      {
        providerId: "gemini",
        providerModelId: "gemini-3-pro-image",
        enabled: true,
        priority: 10_000,
        status: "active",
      },
    ]);
    const result = await resolveModelAvailability(db as never, "model-x");
    assert.equal(result.availability, "not_production_ready");
  } finally {
    await uninstallFakeSupabase();
  }
});

test("a model with no routes at all is not production ready", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    seedRoutes(db, "model-x", []);
    const result = await resolveModelAvailability(db as never, "model-x");
    assert.equal(result.availability, "not_production_ready");
    assert.deepEqual(result.internalReasons, ["no_routes"]);
  } finally {
    await uninstallFakeSupabase();
  }
});

test("the catalog resolver short-circuits statically-unsafe models without a query", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  try {
    const all = await resolveCatalogAvailability(db as never);
    assert.equal(all.get("nano-banana-pro")?.availability, "not_production_ready");
    assert.deepEqual(all.get("nano-banana-pro")?.internalReasons, [
      "static_provider_not_production_durable",
    ]);
    assert.equal(all.get("cloudflare-melotts")?.availability, "not_production_ready");
  } finally {
    await uninstallFakeSupabase();
  }
});

// ---------------------------------------------------------------------------
// One eligibility truth, not two
// ---------------------------------------------------------------------------

test("availability reuses the router's own eligibility, and duplicates no check", () => {
  const source = readSource("src/lib/orchestration/model-availability.ts");

  // It calls the router's functions rather than restating their rules.
  assert.match(source, /listRouteCandidates/);
  assert.match(source, /rejectionFor\(candidate\)/);

  // And contains no second copy of the individual conditions.
  for (const duplicated of [
    "candidate.enabled",
    "candidate.providerEnabled",
    "candidate.providerModelEnabled",
    "candidate.routeStatus",
    "modelVersionStatus",
  ]) {
    assert.ok(
      !source.includes(duplicated),
      `${duplicated} must not be re-checked here — rejectionFor owns it`
    );
  }

  // No scoring engine either: availability is existence, not ranking.
  for (const scoring of ["scoreRoute", "scoreCost", "scoreQuality", "compareRoutes"]) {
    assert.ok(!source.includes(scoring), `${scoring} belongs to the router, not the catalog`);
  }
});

test("the Capability Registry did not become the router", () => {
  // Capabilities answer "what can this model do"; availability answers "can it
  // run". The projection may carry the second, but must not learn routing.
  const projection = readCode("src/lib/orchestration/capability-projection.ts");
  for (const routing of ["listRouteCandidates", "model_routes", "priority", "providerId:"]) {
    assert.ok(!projection.includes(routing), `the projection must not do routing (${routing})`);
  }
  // It carries only the STATIC flag, computed from the adapter declaration.
  assert.match(projection, /isStaticallyProductionReady\(entry\)/);
});

// ---------------------------------------------------------------------------
// The public response leaks nothing
// ---------------------------------------------------------------------------

test("the public model API exposes a product state and no internals", () => {
  const route = readCode("src/app/api/models/route.ts");

  // Product-level fields only.
  assert.match(route, /productionAvailability/);
  assert.match(route, /productionAvailable:/);

  // The internal reasons are computed but never serialized.
  assert.ok(!/internalReasons/.test(route), "internal reasons must not reach the response");

  for (const forbidden of [
    "providerId",
    "provider_model_id",
    "routeId",
    "route_id",
    "priority",
    "providerJobId",
    "restart_safe",
    "not_proven",
  ]) {
    assert.ok(!route.includes(forbidden), `the public route must not expose ${forbidden}`);
  }
});

test("the generated client catalog carries no provider or routing internals", () => {
  const catalog = readSource("src/lib/orchestration/public-model-catalog.ts");
  const data = catalog.slice(catalog.indexOf("export const"));
  for (const forbidden of [
    "providerId",
    "providerModelId",
    "fal-ai/",
    "gemini-3",
    "@cf/",
    "routeId",
    "not_proven",
    "restart_safe",
  ]) {
    assert.ok(!data.includes(forbidden), `the browser catalog must not contain ${forbidden}`);
  }
  // But it does carry the product-level static flag.
  assert.match(data, /"productionReady":/);
});

test("the build catalog stays in step with the registry", async () => {
  const { renderCatalog } = await import("../../../scripts/generate-public-catalog");
  assert.equal(
    renderCatalog().replace(/\r\n/g, "\n"),
    readSource("src/lib/orchestration/public-model-catalog.ts"),
    "public-model-catalog.ts is stale — run: npm run catalog:generate"
  );
});

// ---------------------------------------------------------------------------
// The server is still the authority
// ---------------------------------------------------------------------------

test("POST-path creation still refuses, whatever the catalog says", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const projectId = randomUUID();
  db.state.projects = [{ id: projectId, clerk_user_id: "user_avail", name: "p" }];

  try {
    await assert.rejects(
      createGeneration(db as never, "user_avail", {
        model: "nano-banana-pro",
        prompt: "availability probe",
        projectId,
      }),
      (error: unknown) =>
        isOrchestrationError(error) &&
        (error.code === "NO_ELIGIBLE_ROUTE" || error.code === "NO_HEALTHY_ROUTE")
    );

    assert.equal(db.state.generations.length, 0, "no generation row");
    assert.equal((db.state.generation_attempts ?? []).length, 0, "no attempt");
    assert.equal(db.storageUploads.length, 0, "no provider execution");
  } finally {
    await uninstallFakeSupabase();
  }
});

test("availability is a product hint, never an authority", () => {
  // The create path does not consult availability at all — it re-derives
  // eligibility itself. A stale, cached or forged availability value can
  // therefore grant nothing.
  const createService = readSource("src/lib/orchestration/generation-create-service.ts");
  assert.ok(!/model-availability|productionAvailable/.test(createService));
  assert.match(createService, /resolveHealthyRoute/);
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

test("the model selector will not select a known production-unavailable model", () => {
  const selector = readSource("src/components/cinema-studio/ModelSelector.tsx");
  const selectorCode = readCode("src/components/cinema-studio/ModelSelector.tsx");

  // Superseded by the runtime binding: the selector now resolves availability
  // through the shared decision function rather than the build flag alone.
  assert.match(selector, /function selectorAvailability/);
  assert.match(selector, /useModelAvailability\(\)/);
  // Selection is refused before onChange fires, on the RESOLVED answer.
  assert.match(
    selector,
    /if \(!canOfferForGeneration\(selectorAvailability\(id, runtimeAvailability\)\)\) return;/
  );
  // And the row shows it, in product language.
  assert.match(selector, /unavailableLabel \?\? model\.description/);
  assert.match(selector, /aria-disabled=\{unavailableLabel \? true : undefined\}/);

  // No provider name and no internal enum reaches the component.
  for (const forbidden of ["gemini", "cloudflare", "not_proven", "restart_safe", "durability"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(selectorCode),
      `the selector must not name ${forbidden}`
    );
  }
});

test("the gate is narrow: catalog-only cards are untouched", () => {
  // Every marketing card has no server-side model, so it is not what this
  // change is about and must keep behaving exactly as before.
  assert.equal(isOrchestrationModel("seedream-5.0-pro"), false);
  assert.equal(isOrchestrationModel("kling-3.0-omni"), false);

  // The decision only engages for models the registry actually knows: an
  // unknown model reports isServerModel false and is left alone.
  const selector = readSource("src/components/cinema-studio/ModelSelector.tsx");
  assert.match(selector, /isServerModel: isOrchestrationModel\(modelId\)/);
});

test("capability validation is independent of routing availability", () => {
  // A model being unavailable must not change what it is CAPABLE of — the two
  // answer different questions and Phase 7 keeps them apart.
  // NOTE: workflow-router is capability routing (which workflow does this
  // request use), not PROVIDER routing. Naming it here would be a false
  // positive, so the terms below are provider-routing specific.
  const validator = readCode("src/lib/orchestration/capability-validator.ts");
  for (const routing of [
    "productionAvailable",
    "model-availability",
    "rejectionFor",
    "model_routes",
    "providerId",
  ]) {
    assert.ok(!validator.includes(routing), `the validator must not consult routing (${routing})`);
  }

  // nano-banana-pro is unavailable, yet its capabilities are unchanged.
  const descriptor = projectModelById("nano-banana-pro");
  assert.equal(descriptor?.productionReady, false);
  assert.ok((descriptor?.capabilities.aspectRatios.length ?? 0) > 0);
});
