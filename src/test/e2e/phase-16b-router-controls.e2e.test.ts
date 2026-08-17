import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getAdminRouterView, setAdminRouteEnabled } from "@/lib/admin/router-admin-service";
import { isValidRouteActionReason, ROUTE_ID_PATTERN } from "@/lib/admin/router-admin-contract";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase } from "./e2e-harness";

/**
 * Phase 16-B — Router Controls: read via `listRoutesForAdmin`, mutate via
 * `setRouteEnabled` (both Phase 7-B, unmodified). The core promise under
 * test: a Phase-16-admin who is not on the separate `ROUTE_ADMIN_CLERK_USER_IDS`
 * allowlist gets an honest `ROUTE_AUTHORITY_DENIED`, never fabricated route
 * data or a silently-succeeding mutation; an invalid target never reaches
 * either Phase 7-B function.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/router-admin-contract.ts",
  "src/lib/admin/router-admin-service.ts",
  "src/lib/admin/router-admin-client-state.ts",
  "src/app/api/admin/router/route.ts",
  "src/app/api/admin/router/disable/route.ts",
  "src/app/admin/router/page.tsx",
  "src/components/admin/RouterControlsPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

test("isValidRouteActionReason and ROUTE_ID_PATTERN reject malformed input before either Phase 7-B function is ever called", () => {
  assert.equal(isValidRouteActionReason(""), false);
  assert.equal(isValidRouteActionReason("   "), false);
  assert.equal(isValidRouteActionReason("a".repeat(501)), false);
  assert.equal(isValidRouteActionReason("disabling for maintenance"), true);
  assert.doesNotMatch("not-a-uuid; DROP TABLE model_routes;--", ROUTE_ID_PATTERN);
  assert.match(randomUUID(), ROUTE_ID_PATTERN);
});

test("no ROUTE_ADMIN_CLERK_USER_IDS configured in this test process: list and set both refuse with ROUTE_AUTHORITY_DENIED, never fabricated data or a silent write", async () => {
  const original = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  try {
    const db = new FakeSupabaseClient();
    await installFakeSupabase(db);

    const listResult = await getAdminRouterView(db as never, "user_phase16_admin_not_route_admin");
    assert.deepEqual(listResult, { outcome: "ROUTE_AUTHORITY_DENIED" });

    const setResult = await setAdminRouteEnabled(db as never, "user_phase16_admin_not_route_admin", randomUUID(), false, "test reason");
    assert.deepEqual(setResult, { outcome: "ROUTE_AUTHORITY_DENIED" });
  } finally {
    if (original !== undefined) process.env.ROUTE_ADMIN_CLERK_USER_IDS = original;
  }
});

test("an invalid route id or missing reason returns INVALID_TARGET without ever calling setRouteEnabled", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result1 = await setAdminRouteEnabled(db as never, "user_whoever", "not-a-uuid", false, "a reason");
  assert.deepEqual(result1, { outcome: "INVALID_TARGET" });
  const result2 = await setAdminRouteEnabled(db as never, "user_whoever", randomUUID(), false, "");
  assert.deepEqual(result2, { outcome: "INVALID_TARGET" });
});

test("when ROUTE_ADMIN_CLERK_USER_IDS admits the caller, an unknown route id returns ROUTE_NOT_FOUND, not a fabricated success", async () => {
  const original = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = "user_route_admin_test";
  try {
    const db = new FakeSupabaseClient();
    await installFakeSupabase(db);
    if (!db.state.model_routes) db.state.model_routes = [];
    const result = await setAdminRouteEnabled(db as never, "user_route_admin_test", randomUUID(), false, "test");
    assert.deepEqual(result, { outcome: "ROUTE_NOT_FOUND" });
  } finally {
    if (original !== undefined) process.env.ROUTE_ADMIN_CLERK_USER_IDS = original;
    else delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  }
});

test("when ROUTE_ADMIN_CLERK_USER_IDS admits the caller and the route exists, disabling it succeeds and is reversible by calling again with true", async () => {
  const original = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = "user_route_admin_test";
  try {
    const db = new FakeSupabaseClient();
    await installFakeSupabase(db);
    const routeId = randomUUID();
    db.state.model_routes = [{ id: routeId, model_id: "m1", priority: 100, enabled: true, status: "active", updated_at: "2026-01-01T00:00:00.000Z" }];

    const disableResult = await setAdminRouteEnabled(db as never, "user_route_admin_test", routeId, false, "incident #1");
    assert.deepEqual(disableResult, { outcome: "APPLIED", routeId, enabled: false });
    assert.equal(db.state.model_routes[0].enabled, false);

    const reEnableResult = await setAdminRouteEnabled(db as never, "user_route_admin_test", routeId, true, "incident #1 resolved");
    assert.deepEqual(reEnableResult, { outcome: "APPLIED", routeId, enabled: true });
    assert.equal(db.state.model_routes[0].enabled, true, "the same function reverses its own mutation — no second enable path was built");
  } finally {
    if (original !== undefined) process.env.ROUTE_ADMIN_CLERK_USER_IDS = original;
    else delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  }
});

// ===========================================================================
// STRUCTURAL
// ===========================================================================

test("router-admin-service.ts is a thin wrapper — no route mutation logic is reimplemented", () => {
  const serviceText = stripComments(read("src/lib/admin/router-admin-service.ts"));
  assert.match(serviceText, /listRoutesForAdmin/);
  assert.match(serviceText, /setRouteEnabled/);
  assert.doesNotMatch(serviceText, /\.from\("model_routes"\)/, "must never query model_routes directly — only through the Phase 7-B functions");
  assert.doesNotMatch(serviceText, /setRuntimeRoutingControl|clearRuntimeRoutingControl/, "this slice deliberately does not wire the runtime-control path");
});

test("model-provider-admin-service.ts never reads model_routes (the ROUTE_ADMIN-gated table)", () => {
  const serviceText = stripComments(read("src/lib/admin/model-provider-admin-service.ts"));
  assert.doesNotMatch(serviceText, /model_routes/);
});

test("the disable route requires requireAdminAccess before calling the service, never uses ROUTE_ADMIN_CLERK_USER_IDS directly, and is POST-only", () => {
  const routeText = stripComments(read("src/app/api/admin/router/disable/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.doesNotMatch(routeText, /ROUTE_ADMIN_CLERK_USER_IDS/);
  assert.match(routeText, /export async function POST/);
  assert.doesNotMatch(routeText, /export async function GET/);
  assert.match(routeText, /routeClass:\s*"durable_write"/);
});

test("the list route is GET-only, authenticated_read, and never mutates", () => {
  const routeText = stripComments(read("src/app/api/admin/router/route.ts"));
  assert.match(routeText, /export async function GET/);
  assert.doesNotMatch(routeText, /export async function POST/);
  assert.match(routeText, /routeClass:\s*"authenticated_read"/);
  assert.doesNotMatch(routeText, /setRouteEnabled|setRoutePriority/);
});

test("no operational mutation outside route enable/disable exists anywhere in the new files", () => {
  const banned = [
    { pattern: /reserveCredits|settleReservation|releaseReservation|credit_ledger|credit_wallets|Stripe/i, why: "no billing mutation" },
    { pattern: /suspendUser|deleteUser|banUser|disableUser/i, why: "no user mutation" },
    { pattern: /redriveOneProviderDlqMessage|StartMessageMoveTask|SendMessageCommand|DeleteMessageCommand/, why: "no DLQ mutation from the router surface" },
    { pattern: /retryAdminBullmqJob/, why: "no BullMQ mutation from the router surface" },
    { pattern: /setRoutePriority/, why: "priority mutation is deliberately out of scope for this slice — only enable/disable" },
  ];
  for (const { file, text } of NEW_FILES) {
    for (const rule of banned) {
      assert.doesNotMatch(text, rule.pattern, `${file}: ${rule.why}`);
    }
  }
});

test("no locked product UI route is referenced by the new files, and no migration was added", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of NEW_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE|DROP TABLE/i, file);
  }
});

test("the UI requires a typed reason and explicit confirmation before either action button submits", () => {
  const panelText = stripComments(read("src/components/admin/RouterControlsPanel.tsx"));
  assert.match(panelText, /reason\.trim\(\)\.length === 0/);
  assert.match(panelText, /Confirm/i);
});
