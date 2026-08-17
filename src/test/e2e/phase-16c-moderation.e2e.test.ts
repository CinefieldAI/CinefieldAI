import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminSafetyAudit, performModerationAction } from "@/lib/admin/moderation-admin-service";
import { MODERATION_REASON_CODE_PATTERN, isValidModerationReasonCode } from "@/lib/admin/moderation-admin-contract";
import {
  interpretModerationActionResponse,
  interpretModerationViewResponse,
  networkErrorState,
} from "@/lib/admin/moderation-admin-client-state";

/**
 * Phase 16-C — Moderation. `performModerationAction`/`getAdminSafetyAudit`
 * are thin wrappers around Phase 9-E's ALREADY-tested, ALREADY-dual-control
 * `requestMediaRelease`/`approveMediaRelease`/`rejectMediaAsset`/
 * `readSafetyAudit` — this suite proves the wrapper adds validation and a
 * bounded `ROUTE_AUTHORITY_DENIED` outcome without adding, weakening, or
 * reimplementing any of the real authorization/dual-control logic. Because
 * `FakeSupabaseClient.rpc()` cannot emulate these Phase 9-E RPC names, this
 * suite uses the same lightweight table+rpc double `phase-9e-quarantine-
 * release.e2e.test.ts` already established — NOT `DEFERRED_EXTERNAL`: this
 * mutation is Supabase-RPC-based and fully testable offline, unlike 16-B's
 * real-AWS/real-Redis-B mutations.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/moderation-admin-contract.ts",
  "src/lib/admin/moderation-admin-service.ts",
  "src/lib/admin/moderation-admin-client-state.ts",
  "src/app/api/admin/moderation/route.ts",
  "src/app/api/admin/moderation/release/route.ts",
  "src/app/admin/moderation/page.tsx",
  "src/components/admin/ModerationPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

const ASSET_ID = randomUUID();
const ADMIN_A = "user_mod_admin_alpha";
const ADMIN_B = "user_mod_admin_beta";

/** Same shape phase-9e-quarantine-release.e2e.test.ts's own `rpcAdmin` uses. */
function moderationAdmin(rpcResponses: Record<string, unknown> = {}, auditRows: Record<string, unknown>[] = [], calls: string[] = []) {
  const table = {
    select: () => table,
    eq: () => table,
    order: async () => ({ data: auditRows, error: null }),
  };
  return {
    from: () => table,
    rpc: async (fn: string) => {
      calls.push(fn);
      return { data: rpcResponses[fn] ?? null, error: null };
    },
  } as unknown as SupabaseClient;
}

function moderationAdminWithRpcError(fn: string) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
    rpc: async (calledFn: string) => (calledFn === fn ? { data: null, error: { message: "boom" } } : { data: null, error: null }),
  } as unknown as SupabaseClient;
}

function withAdmins<T>(admins: string[], run: () => T): T {
  const saved = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = admins.join(",");
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
    else process.env.ROUTE_ADMIN_CLERK_USER_IDS = saved;
  }
}

// ---------------------------------------------------------------------------
// Input validation — never reaches the wrapped Phase 9-E functions
// ---------------------------------------------------------------------------

test("MODERATION_REASON_CODE_PATTERN matches quarantine-release.ts's own REASON_PATTERN exactly", () => {
  assert.equal(isValidModerationReasonCode("incident_report_1"), true);
  assert.equal(isValidModerationReasonCode(""), false);
  assert.equal(isValidModerationReasonCode("Uppercase"), false);
  assert.equal(isValidModerationReasonCode("a".repeat(66)), false, "1 + 64 = 65 is the max length; 66 must be rejected");
  assert.match("valid_reason_1", MODERATION_REASON_CODE_PATTERN);
});

test("an invalid asset id returns INVALID_TARGET before any RPC is called", async () => {
  const calls: string[] = [];
  const admin = moderationAdmin({}, [], calls);
  const result = await performModerationAction(admin, ADMIN_A, "request", "not-a-uuid", undefined);
  assert.deepEqual(result, { outcome: "INVALID_TARGET" });
  assert.deepEqual(calls, []);
});

test("an invalid reason code returns INVALID_TARGET before any RPC is called", async () => {
  const calls: string[] = [];
  const admin = moderationAdmin({}, [], calls);
  const result = await performModerationAction(admin, ADMIN_A, "approve", ASSET_ID, "Not Valid!");
  assert.deepEqual(result, { outcome: "INVALID_TARGET" });
  assert.deepEqual(calls, []);
});

test("getAdminSafetyAudit rejects a malformed asset id with INVALID_IDENTIFIER", async () => {
  const result = await getAdminSafetyAudit(moderationAdmin(), "not-a-uuid");
  assert.deepEqual(result, { outcome: "INVALID_IDENTIFIER" });
});

// ---------------------------------------------------------------------------
// ROUTE_AUTHORITY_DENIED — the separate ROUTE_ADMIN_CLERK_USER_IDS authority
// ---------------------------------------------------------------------------

test("with no ROUTE_ADMIN_CLERK_USER_IDS configured, request/approve/reject all return ROUTE_AUTHORITY_DENIED, never fabricated success", async () => {
  const original = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  try {
    const admin = moderationAdmin();
    for (const action of ["request", "approve", "reject"] as const) {
      const result = await performModerationAction(admin, ADMIN_A, action, ASSET_ID, "some_reason");
      assert.deepEqual(result, { outcome: "ROUTE_AUTHORITY_DENIED" }, action);
    }
  } finally {
    if (original !== undefined) process.env.ROUTE_ADMIN_CLERK_USER_IDS = original;
  }
});

test("a Phase-16 admin who is not on ROUTE_ADMIN_CLERK_USER_IDS is denied even though requireAdminAccess would allow them", async () => {
  await withAdmins([ADMIN_A], async () => {
    const admin = moderationAdmin();
    const result = await performModerationAction(admin, "user_phase16_admin_only", "request", ASSET_ID, undefined);
    assert.deepEqual(result, { outcome: "ROUTE_AUTHORITY_DENIED" });
  });
});

// ---------------------------------------------------------------------------
// The three actions, correctly passed through
// ---------------------------------------------------------------------------

test("request: REQUEST_RECORDED carries through recorded/approvals/required verbatim", async () => {
  await withAdmins([ADMIN_A], async () => {
    const admin = moderationAdmin({ request_media_release: { recorded: true, approvals: 1, required: 2 } });
    const result = await performModerationAction(admin, ADMIN_A, "request", ASSET_ID, "incident_1");
    assert.deepEqual(result, { outcome: "REQUEST_RECORDED", recorded: true, approvals: 1, required: 2 });
  });
});

test("approve: a released asset returns RELEASED with the real event id", async () => {
  await withAdmins([ADMIN_A, ADMIN_B], async () => {
    const admin = moderationAdmin({
      approve_media_release: { released: true, event_id: "evt_1" },
    });
    const result = await performModerationAction(admin, ADMIN_B, "approve", ASSET_ID, undefined);
    assert.deepEqual(result, { outcome: "RELEASED", assetId: ASSET_ID, eventId: "evt_1" });
  });
});

test("approve: two approvals of an unmoderated asset still fail with RELEASE_REFUSED / moderation_not_passed — no admin override exists", async () => {
  await withAdmins([ADMIN_A, ADMIN_B], async () => {
    const admin = moderationAdmin({
      approve_media_release: { released: false, reason: "moderation_not_passed", moderation_status: "not_evaluated" },
    });
    const result = await performModerationAction(admin, ADMIN_B, "approve", ASSET_ID, undefined);
    assert.deepEqual(result, {
      outcome: "RELEASE_REFUSED",
      reason: "moderation_not_passed",
      approvals: undefined,
      required: undefined,
      moderationStatus: "not_evaluated",
    });
  });
});

test("approve: awaiting_second_approval is reported, not silently treated as released", async () => {
  await withAdmins([ADMIN_A], async () => {
    const admin = moderationAdmin({
      approve_media_release: { released: false, reason: "awaiting_second_approval", approvals: 1, required: 2 },
    });
    const result = await performModerationAction(admin, ADMIN_A, "approve", ASSET_ID, undefined);
    assert.equal(result.outcome, "RELEASE_REFUSED");
    assert.equal((result as { reason: string }).reason, "awaiting_second_approval");
  });
});

test("reject: a rejected asset returns REJECTED with the real event id", async () => {
  await withAdmins([ADMIN_A], async () => {
    const admin = moderationAdmin({ reject_media_asset: { rejected: true, event_id: "evt_2" } });
    const result = await performModerationAction(admin, ADMIN_A, "reject", ASSET_ID, "policy_violation");
    assert.deepEqual(result, { outcome: "REJECTED", assetId: ASSET_ID, eventId: "evt_2" });
  });
});

test("reject: an already-released asset cannot be rejected back — REJECT_REFUSED", async () => {
  await withAdmins([ADMIN_A], async () => {
    const admin = moderationAdmin({ reject_media_asset: { rejected: false, reason: "already_released" } });
    const result = await performModerationAction(admin, ADMIN_A, "reject", ASSET_ID, undefined);
    assert.deepEqual(result, { outcome: "REJECT_REFUSED", reason: "already_released" });
  });
});

test("a database error from the RPC becomes ACTION_UNAVAILABLE, not an uncaught exception", async () => {
  await withAdmins([ADMIN_A], async () => {
    const admin = moderationAdminWithRpcError("request_media_release");
    const result = await performModerationAction(admin, ADMIN_A, "request", ASSET_ID, undefined);
    assert.deepEqual(result, { outcome: "ACTION_UNAVAILABLE", reasonCode: "action_failed" });
  });
});

// ---------------------------------------------------------------------------
// Safety audit read
// ---------------------------------------------------------------------------

test("getAdminSafetyAudit maps the durable audit trail's snake_case rows to the view shape", async () => {
  const admin = moderationAdmin({}, [
    { action: "release_requested", actor_clerk_user_id: ADMIN_A, created_at: "2026-08-01T00:00:00.000Z", reason_code: "incident_1" },
    { action: "released", actor_clerk_user_id: ADMIN_B, created_at: "2026-08-01T00:05:00.000Z", reason_code: null },
  ]);
  const result = await getAdminSafetyAudit(admin, ASSET_ID);
  assert.equal(result.outcome, "FOUND");
  const found = result as { outcome: "FOUND"; entries: readonly { action: string; actor: string; createdAt: string; reasonCode: string | null }[] };
  assert.equal(found.entries.length, 2);
  assert.deepEqual(found.entries[0], {
    action: "release_requested",
    actor: ADMIN_A,
    createdAt: "2026-08-01T00:00:00.000Z",
    reasonCode: "incident_1",
  });
  assert.equal(found.entries[1].reasonCode, null);
});

test("a thrown error reading the audit trail becomes AUDIT_UNAVAILABLE, not an uncaught exception", async () => {
  const admin = {
    from: () => {
      throw new Error("down");
    },
  } as unknown as SupabaseClient;
  const result = await getAdminSafetyAudit(admin, ASSET_ID);
  assert.deepEqual(result, { outcome: "AUDIT_UNAVAILABLE", reasonCode: "read_failed" });
});

// ---------------------------------------------------------------------------
// Client-state interpretation
// ---------------------------------------------------------------------------

test("interpretModerationViewResponse and interpretModerationActionResponse map every outcome", () => {
  assert.deepEqual(interpretModerationViewResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(interpretModerationViewResponse(200, { asset: {}, audit: {} }), {
    kind: "loaded",
    body: { asset: {}, audit: {} },
  });
  assert.deepEqual(interpretModerationViewResponse(200, {}), { kind: "unavailable", reasonCode: "malformed_response" });

  assert.deepEqual(interpretModerationActionResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(interpretModerationActionResponse(400, { outcome: "INVALID_TARGET" }), { kind: "invalid_target" });
  assert.deepEqual(interpretModerationActionResponse(200, { outcome: "ROUTE_AUTHORITY_DENIED" }), { kind: "route_authority_denied" });
  assert.deepEqual(interpretModerationActionResponse(200, { outcome: "ACTION_UNAVAILABLE", reasonCode: "action_failed" }), {
    kind: "unavailable",
    reasonCode: "action_failed",
  });
  assert.deepEqual(interpretModerationActionResponse(200, { outcome: "RELEASED", assetId: ASSET_ID, eventId: "e1" }), {
    kind: "result",
    result: { outcome: "RELEASED", assetId: ASSET_ID, eventId: "e1" },
  });
  assert.deepEqual(networkErrorState(), { kind: "unavailable", reasonCode: "network_error" });
});

// ---------------------------------------------------------------------------
// STRUCTURAL — thin wrapper, no reinvented authority/dual-control
// ---------------------------------------------------------------------------

test("moderation-admin-service.ts calls the real Phase 9-E functions unmodified and adds no new SQL, RPC name, or direct table write", () => {
  const serviceText = stripComments(read("src/lib/admin/moderation-admin-service.ts"));
  assert.match(serviceText, /requestMediaRelease/);
  assert.match(serviceText, /approveMediaRelease/);
  assert.match(serviceText, /rejectMediaAsset/);
  assert.match(serviceText, /readSafetyAudit/);
  assert.doesNotMatch(serviceText, /\.rpc\(/, "no direct RPC call — only the Phase 9-E functions call RPCs");
  assert.doesNotMatch(serviceText, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/, "no direct table write");
  assert.doesNotMatch(serviceText, /assertRouteAdmin|requirePolicy/, "authority and policy gating live inside the Phase 9-E functions, not reimplemented here");
});

test("no second two-person or approval-counting mechanism was invented anywhere in the new files", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /media_release_approvals|required_approvals|COUNT\(/i, `${file}: no reimplemented approval counting`);
  }
});

test("the moderation view route is GET-only, authenticated_read; the release route is POST-only, durable_write", () => {
  const viewText = stripComments(read("src/app/api/admin/moderation/route.ts"));
  assert.match(viewText, /requireAdminAccess/);
  assert.match(viewText, /export async function GET/);
  assert.doesNotMatch(viewText, /export async function POST/);
  assert.match(viewText, /routeClass:\s*"authenticated_read"/);

  const releaseText = stripComments(read("src/app/api/admin/moderation/release/route.ts"));
  assert.match(releaseText, /requireAdminAccess/);
  assert.match(releaseText, /export async function POST/);
  assert.doesNotMatch(releaseText, /export async function GET/);
  assert.match(releaseText, /routeClass:\s*"durable_write"/);
});

test("the panel requires a typed reason code matching the pattern and explicit confirmation before any action submits", () => {
  const panelText = stripComments(read("src/components/admin/ModerationPanel.tsx"));
  assert.match(panelText, /REASON_CODE_PATTERN\.test\(reasonCode\)/);
  assert.match(panelText, /Confirm/i);
  assert.match(panelText, /pendingAction/);
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
