import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase, uninstallFakeSupabase } from "./e2e-harness";
import { createGeneration } from "@/lib/orchestration/generation-create-service";

import { selectRoute } from "@/lib/routing/model-router";
import { compareRoutes } from "@/lib/routing/route-repository";
import type { RouteCandidate } from "@/lib/routing/route-types";
import { listModels } from "@/lib/orchestration/model-registry";
import { projectCatalog, projectModelById } from "@/lib/orchestration/capability-projection";
import { assertRouteAdmin, isRouteAdmin } from "@/lib/routing/admin-route-service";
import { isOrchestrationError } from "@/lib/orchestration/errors";

/**
 * PHASE 7 FOUNDATION — 7-A / 7-F / 7-B.
 *
 * Proves the three properties this phase actually claims:
 *   the seeded route table and the code registry describe the same models,
 *   the capability projection is public-safe and derived rather than copied,
 *   the router is deterministic and refuses rather than guessing.
 *
 * NOT PROVEN HERE, and stated rather than implied: the database CHECK and
 * UNIQUE constraints in the 7-A migration. Those are asserted as SQL shape
 * below and exercised for real by supabase/tests/ against a throwaway
 * PostgreSQL — a JavaScript test cannot enforce a partial unique index.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const MIGRATION = "supabase/migrations/20260817000000_model_routing.sql";

// ---------------------------------------------------------------------------
// Candidate builder
// ---------------------------------------------------------------------------

let counter = 0;
function candidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  counter += 1;
  return {
    routeId: `route-${String(counter).padStart(4, "0")}`,
    cinefieldModelId: "model-a",
    modelVersionId: `version-${counter}`,
    modelVersion: 1,
    // "mock" is a genuinely registered adapter, so the provider-registry check
    // passes for real rather than being stubbed out.
    providerId: "mock",
    providerModelId: `provider-model-${counter}`,
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

// ---------------------------------------------------------------------------
// 7-A — the seed and the code registry describe the same world
// ---------------------------------------------------------------------------

test("7-A: every registry model is seeded as a model, provider model and route", () => {
  const sql = readSource(MIGRATION);
  const models = listModels();
  assert.ok(models.length > 0, "registry must not be empty");

  for (const model of models) {
    assert.ok(
      sql.includes(`'${model.id}'`),
      `model ${model.id} is in the code registry but not seeded in ${MIGRATION}`
    );
    assert.ok(
      sql.includes(`'${model.providerModelId}'`),
      `provider model ${model.providerModelId} (${model.id}) is not seeded`
    );
  }

  for (const providerId of new Set(models.map((m) => m.providerId))) {
    assert.ok(sql.includes(`'${providerId}'`), `provider ${providerId} is not seeded`);
  }
});

test("7-A: the migration is additive and closed by default", () => {
  const sql = readSource(MIGRATION);

  // The new attempt columns must be nullable and additive — a NOT NULL column
  // would break every generation created before routing existed.
  for (const column of ["model_version_id", "model_route_id"]) {
    const match = new RegExp(`ADD COLUMN IF NOT EXISTS "?${column}"?[^;]*`, "i").exec(sql);
    assert.ok(match, `${column} must be added to generation_attempts`);
    assert.ok(
      !/NOT NULL/i.test(match[0]),
      `${column} must stay nullable so pre-routing attempts remain valid`
    );
  }

  // RLS on, and no permissive policy: these tables are service-role only.
  for (const table of [
    "providers",
    "models",
    "model_versions",
    "provider_models",
    "model_routes",
  ]) {
    assert.ok(
      new RegExp(`ALTER TABLE[^;]*${table}[^;]*ENABLE ROW LEVEL SECURITY`, "i").test(sql),
      `${table} must have RLS enabled`
    );
  }
  assert.ok(!/CREATE POLICY/i.test(sql), "route tables must expose no permissive RLS policy");
  assert.ok(/REVOKE[^;]*anon/i.test(sql), "anon must be revoked");
  assert.ok(/REVOKE[^;]*authenticated/i.test(sql), "authenticated must be revoked");

  // Pricing already exists elsewhere; duplicating it here would create a
  // second source of truth for money.
  assert.ok(
    !/CREATE TABLE[^;]*model_pricing/i.test(sql),
    "model_pricing already exists — it must not be recreated"
  );
});

// ---------------------------------------------------------------------------
// 7-B — determinism
// ---------------------------------------------------------------------------

test("7-B: identical input yields an identical selection, every time", () => {
  const candidates = [
    candidate({ priority: 100 }),
    candidate({ priority: 500 }),
    candidate({ priority: 300 }),
  ];

  const first = selectRoute("model-a", candidates);
  assert.equal(first.outcome, "selected");

  for (let i = 0; i < 200; i += 1) {
    const again = selectRoute("model-a", candidates);
    assert.deepEqual(again, first, "the router produced a different answer for the same input");
  }
});

test("7-B: highest static priority wins", () => {
  const low = candidate({ priority: 10 });
  const high = candidate({ priority: 900 });
  const mid = candidate({ priority: 400 });

  const result = selectRoute("model-a", [low, high, mid]);
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, high.routeId);
  assert.equal(result.selection.selectionReason, "static_priority_900");
});

test("7-B: equal priorities tie-break stably regardless of input order", () => {
  const a = candidate({ priority: 100, providerModelId: "aaa" });
  const b = candidate({ priority: 100, providerModelId: "bbb" });
  const c = candidate({ priority: 100, providerModelId: "ccc" });

  const orderings = [
    [a, b, c],
    [c, b, a],
    [b, a, c],
    [c, a, b],
  ];

  const winners = orderings.map((ordering) => {
    const result = selectRoute("model-a", ordering);
    assert.equal(result.outcome, "selected");
    return result.outcome === "selected" ? result.selection.routeId : "";
  });

  assert.equal(new Set(winners).size, 1, "input order changed the winner");
  assert.equal(winners[0], a.routeId, "the tie-break must be the lowest provider model id");

  const result = selectRoute("model-a", [a, b, c]);
  if (result.outcome === "selected") {
    assert.match(
      result.selection.selectionReason,
      /_stable_tie_break$/,
      "a contested selection must say so in its reason"
    );
  }
});

test("7-B: the tie-break comparator is a total order", () => {
  const rows = [
    candidate({ priority: 100, providerModelId: "b", routeId: "r2" }),
    candidate({ priority: 100, providerModelId: "b", routeId: "r1" }),
    candidate({ priority: 100, providerModelId: "a", routeId: "r3" }),
    candidate({ priority: 200, providerModelId: "z", routeId: "r4" }),
  ];

  const sorted = [...rows].sort(compareRoutes).map((r) => r.routeId);
  assert.deepEqual(sorted, ["r4", "r3", "r1", "r2"]);
  // Reflexive and antisymmetric — otherwise "stable" means nothing.
  assert.equal(compareRoutes(rows[0], rows[0]), 0);
  assert.equal(compareRoutes(rows[0], rows[1]) > 0, compareRoutes(rows[1], rows[0]) < 0);
});

// ---------------------------------------------------------------------------
// 7-B — eligibility, and refusing instead of guessing
// ---------------------------------------------------------------------------

test("7-B: each ineligible condition is rejected with its own reason", () => {
  const cases: [Partial<RouteCandidate>, string][] = [
    [{ enabled: false }, "route_disabled"],
    [{ routeStatus: "draft" }, "route_not_active"],
    [{ routeStatus: "retired" }, "route_not_active"],
    [{ modelLifecycle: "disabled" }, "model_lifecycle_disabled"],
    [{ modelVersionStatus: "disabled" }, "model_version_not_usable"],
    [{ modelVersionStatus: "deprecated" }, "model_version_not_usable"],
    [{ providerEnabled: false }, "provider_disabled"],
    [{ providerModelEnabled: false }, "provider_model_disabled"],
    // A route pointing at a provider this deployment has no adapter for.
    [{ providerId: "provider-that-does-not-ship" }, "provider_not_registered"],
  ];

  for (const [overrides, expected] of cases) {
    const result = selectRoute("model-a", [candidate(overrides)]);
    assert.equal(result.outcome, "no_eligible_route", `${expected} should not be selectable`);
    if (result.outcome !== "no_eligible_route") continue;
    assert.equal(result.rejected[0].reason, expected);
  }
});

test("7-B: a disabled high-priority route loses to an enabled lower one", () => {
  const disabledBest = candidate({ priority: 900, enabled: false });
  const enabledWorse = candidate({ priority: 100 });

  const result = selectRoute("model-a", [disabledBest, enabledWorse]);
  assert.equal(result.outcome, "selected");
  if (result.outcome !== "selected") return;
  assert.equal(result.selection.routeId, enabledWorse.routeId);
});

test("7-B: no candidates at all is a refusal, not a fallback", () => {
  const result = selectRoute("model-a", []);
  assert.equal(result.outcome, "no_eligible_route");
  if (result.outcome !== "no_eligible_route") return;
  assert.equal(result.cinefieldModelId, "model-a");
  assert.deepEqual(result.rejected, []);
});

test("7-B: a refusal reports why every candidate lost", () => {
  const result = selectRoute("model-a", [
    candidate({ enabled: false }),
    candidate({ providerEnabled: false }),
    candidate({ routeStatus: "retired" }),
  ]);

  assert.equal(result.outcome, "no_eligible_route");
  if (result.outcome !== "no_eligible_route") return;
  assert.equal(result.rejected.length, 3);
  assert.deepEqual(
    result.rejected.map((r) => r.reason).sort(),
    ["provider_disabled", "route_disabled", "route_not_active"]
  );
});

test("7-B: NO_ELIGIBLE_ROUTE is refused before any row or provider call", () => {
  const source = readSource("src/lib/orchestration/generation-create-service.ts");

  const refusal = source.indexOf("NO_ELIGIBLE_ROUTE");
  const rpc = source.indexOf("create_generation_tx");
  assert.ok(refusal > 0 && rpc > 0);
  assert.ok(refusal < rpc, "the route must be resolved BEFORE the generation row is created");

  // The routing decision travels with the generation so execution runs where
  // the router chose rather than re-deriving a destination later.
  assert.match(source, /routing:\s*\{/);
  assert.match(source, /selectionReason:/);
});

test("7-B: the request contract gives a client no way to name a provider", () => {
  const types = readSource("src/lib/routing/route-types.ts");
  const request = /export interface RouteRequest \{[\s\S]*?\n\}/.exec(types);
  assert.ok(request, "RouteRequest must exist");
  assert.ok(
    !/\bprovider(Id)?\s*[?:]/i.test(request[0]),
    "RouteRequest must carry no provider field"
  );

  const createRequest = /export interface GenerationCreateRequest \{[\s\S]*?\n\}/.exec(
    readSource("src/lib/orchestration/generation-create-service.ts")
  );
  assert.ok(createRequest);
  assert.ok(
    !/\bprovider/i.test(createRequest[0]),
    "the public create request must carry no provider field"
  );
});

// ---------------------------------------------------------------------------
// 7-F — capability projection
// ---------------------------------------------------------------------------

test("7-F: the projection covers the registry and is derived from it", () => {
  const registry = listModels();
  const projected = projectCatalog();

  assert.equal(projected.length, registry.length);

  for (const entry of registry) {
    const view = projectModelById(entry.id);
    assert.ok(view, `${entry.id} must be projected`);
    if (!view) continue;
    assert.equal(view.id, entry.id);
    assert.deepEqual(
      view.capabilities.aspectRatios,
      [...entry.capabilities.supportedAspectRatios],
      `${entry.id} aspect ratios must come from the registry, not a copy`
    );
    assert.deepEqual(
      view.capabilities.resolutions,
      [...entry.capabilities.supportedResolutions],
      `${entry.id} resolutions must come from the registry, not a copy`
    );
    assert.equal(view.capabilities.maxOutputCount, entry.capabilities.maxOutputCount);
  }
});

test("7-F: the projection leaks no routing or provider detail", () => {
  // ROUTING and PROVIDER identity, none of which is the client's business.
  //
  // `isMock` is deliberately NOT on this list. It names no provider, endpoint,
  // cost or route — it says only "this model never reaches a real provider",
  // which the browser already tells the user after a mock run. Publishing it
  // is what lets the client stop maintaining its own copy of that fact.
  const forbidden = [
    "provider",
    "providerId",
    "providerModelId",
    "priority",
    "cost",
    "health",
    "apiKey",
    "endpoint",
    "falModelId",
    "cloudflareModel",
  ];

  const serialized = JSON.stringify(projectCatalog());
  for (const key of forbidden) {
    assert.ok(
      !new RegExp(`"${key}"`, "i").test(serialized),
      `the public catalog must not expose "${key}"`
    );
  }

  // Enforced by construction, not by this test alone.
  const source = readSource("src/lib/orchestration/capability-projection.ts");
  // Copying whole arrays out of the registry is the point; spreading the
  // ENTRY itself is what would leak a future field, so only that is banned.
  assert.ok(
    !/\.\.\.entry\s*[,}]/.test(source),
    "the projection must build its output field by field, never by spreading the whole registry entry"
  );
});

test("7-F: the public models endpoint requires a session and serves the projection", () => {
  const route = readSource("src/app/api/models/route.ts");
  assert.match(route, /await auth\(\)/);
  assert.match(route, /status: 401/);
  assert.match(route, /projectCatalog\(\)/);
  assert.ok(!/public/.test(/Cache-Control[^\n]*/.exec(route)?.[0] ?? ""), "cache must be private");
});

// ---------------------------------------------------------------------------
// Admin boundary — fails closed
// ---------------------------------------------------------------------------

test("route administration denies everyone when no allowlist is configured", () => {
  const previous = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  try {
    assert.equal(isRouteAdmin("user_anybody"), false);
    assert.equal(isRouteAdmin(""), false);
    assert.throws(
      () => assertRouteAdmin("user_anybody"),
      (error: unknown) => isOrchestrationError(error) && error.code === "FORBIDDEN"
    );
  } finally {
    if (previous !== undefined) process.env.ROUTE_ADMIN_CLERK_USER_IDS = previous;
  }
});

test("route administration admits only explicitly listed operators", () => {
  const previous = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = " user_ops_1 , user_ops_2 ";
  try {
    assert.equal(isRouteAdmin("user_ops_1"), true);
    assert.equal(isRouteAdmin("user_ops_2"), true);
    assert.equal(isRouteAdmin("user_ops_3"), false);
    assertRouteAdmin("user_ops_1");
  } finally {
    if (previous === undefined) delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
    else process.env.ROUTE_ADMIN_CLERK_USER_IDS = previous;
  }
});

test("every route admin mutation is gated", () => {
  const source = readSource("src/lib/routing/admin-route-service.ts");
  const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.ok(exported.length >= 3, "the admin surface must expose read + enable + priority");

  for (const name of exported) {
    const body = new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`).exec(source);
    assert.ok(body);
    assert.ok(
      body[0].includes("assertRouteAdmin("),
      `${name} must call assertRouteAdmin before touching the route table`
    );
  }
});

// ---------------------------------------------------------------------------
// 7-B end to end — the real repository, the real create service
// ---------------------------------------------------------------------------

test("7-B e2e: creation resolves a route and persists the decision", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const projectId = randomUUID();
  db.state.projects = [{ id: projectId, clerk_user_id: "user_route", name: "p" }];

  try {
    const outcome = await createGeneration(db as never, "user_route", {
      model: "mock-image",
      prompt: "phase 7 zero-cost routing probe",
      projectId,
    });
    assert.equal(outcome.outcome, "created");

    const row = db.state.generations[0] as { metadata: Record<string, unknown> };
    const routing = row.metadata.routing as Record<string, unknown>;
    assert.ok(routing, "the routing decision must travel with the generation");
    assert.equal(routing.providerId, "mock");
    assert.equal(routing.selectionReason, "static_priority_100");
    assert.ok(typeof routing.routeId === "string");

    // The persisted decision is what execution reads, so it must name a real
    // seeded route rather than a value invented at write time.
    assert.ok(
      (db.state.model_routes as { id: string }[]).some((r) => r.id === routing.routeId),
      "the persisted routeId must reference a real route row"
    );
  } finally {
    await uninstallFakeSupabase();
  }
});

test("7-B e2e: with every route disabled, nothing is created and no provider is called", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const projectId = randomUUID();
  db.state.projects = [{ id: projectId, clerk_user_id: "user_route", name: "p" }];
  for (const route of db.state.model_routes as Record<string, unknown>[]) {
    route.enabled = false;
  }

  try {
    await assert.rejects(
      createGeneration(db as never, "user_route", {
        model: "mock-image",
        prompt: "phase 7 zero-cost routing probe",
        projectId,
      }),
      (error: unknown) => isOrchestrationError(error) && error.code === "NO_ELIGIBLE_ROUTE"
    );
    assert.equal(db.state.generations.length, 0, "no durable row may be created without a route");
    assert.equal(db.storageUploads.length, 0);
  } finally {
    await uninstallFakeSupabase();
  }
});

test("7-B e2e: the highest-priority enabled route wins through the real repository", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const projectId = randomUUID();
  db.state.projects = [{ id: projectId, clerk_user_id: "user_route", name: "p" }];

  // A second route for the same model, on the same registered provider but a
  // different provider model, at a higher priority.
  const base = (db.state.model_routes as Record<string, unknown>[]).find(
    (r) => r.model_id === "mock-image"
  )!;
  const rivalProviderModelId = randomUUID();
  (db.state.provider_models as Record<string, unknown>[]).push({
    id: rivalProviderModelId,
    provider_id: "mock",
    provider_model_id: "mock-image-preferred",
    enabled: true,
  });
  const rivalRouteId = randomUUID();
  (db.state.model_routes as Record<string, unknown>[]).push({
    ...base,
    id: rivalRouteId,
    provider_model_id: rivalProviderModelId,
    priority: 900,
  });

  try {
    await createGeneration(db as never, "user_route", {
      model: "mock-image",
      prompt: "phase 7 zero-cost routing probe",
      projectId,
    });

    const row = db.state.generations[0] as { metadata: Record<string, unknown> };
    const routing = row.metadata.routing as Record<string, unknown>;
    assert.equal(routing.routeId, rivalRouteId);
    assert.equal(routing.providerModelId, "mock-image-preferred");
    assert.equal(routing.selectionReason, "static_priority_900");
  } finally {
    await uninstallFakeSupabase();
  }
});
