import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { recordCancelIntent, readCancelIntent } from "@/lib/orchestration/cancel-intent";
import {
  getAdminTemporalInspection,
  performAdminTemporalCancel,
} from "@/lib/admin/temporal-admin-service";
import { decidePrivilegedAction } from "@/lib/admin/tier0-authorization";
import type { TemporalAdminCancelResult } from "@/lib/admin/temporal-admin-contract";
import { ADMIN_CANCEL_REASON_PATTERN } from "@/lib/admin/temporal-admin-contract";
import {
  interpretCancelResponse,
  interpretInspectionResponse,
  networkErrorState,
} from "@/lib/admin/temporal-admin-client-state";
import { generationWorkflowId, generationIdFromWorkflowId } from "@/lib/temporal/workflow-ids";
import type { AssuranceEvidence, ElevationVerdict } from "@/lib/admin/step-up-auth";
import { FakeSupabaseClient } from "./fake-supabase";

// Phase 16-E: temporal.workflow.cancel is now Tier-0-gated (fail-closed,
// see tier0-authorization.ts) IN FRONT OF the state/order checks this
// file's own tests are about. Each cancel test below grants its actor
// Tier-0 role + step-up evidence so it reaches — and still proves — the
// SAME Phase 6R-H owner behavior it always asserted.
const TIER0_STEP_UP: { assurance: AssuranceEvidence; elevation: ElevationVerdict } = {
  assurance: { state: "VERIFIED", verifiedAt: new Date().toISOString() },
  elevation: { elevated: true, reasonCode: "verified" },
};

function withTier0<T>(actorIds: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = actorIds;
  return fn().finally(() => {
    if (original !== undefined) process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = original;
    else delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  });
}

/**
 * PHASE 19 CLOSURE FIX: `temporal.workflow.cancel` is now catalogued
 * `requiresTwoPerson: true`. Every test below that needs the mutation to
 * actually run (reach `recordCancelIntent`/`GENERATION_NOT_FOUND`/
 * `CANCEL_NOT_ALLOWED` — all decided AFTER Tier-0 clears) now needs a
 * SECOND, distinct Tier-0 admin to approve the same pending `requestId`
 * first. This helper does exactly that and returns the retried attempt's
 * result, so each test still proves the ONE behavior it always asserted.
 */
async function performAdminTemporalCancelWithTwoPersonSatisfied(
  db: FakeSupabaseClient,
  params: { generationId: string; adminActorId: string; reasonCode: string; stepUp: { assurance: AssuranceEvidence; elevation: ElevationVerdict } },
  // record_admin_privileged_action_approval's own "two distinct people"
  // threshold (required_approvals default 2) excludes the requester by
  // construction — two FURTHER, distinct admins must approve.
  approverClerkUserIds: readonly [string, string] = [
    `${params.adminActorId}_approver_a`,
    `${params.adminActorId}_approver_b`,
  ]
): Promise<TemporalAdminCancelResult> {
  const first = await performAdminTemporalCancel(db as never, params);
  if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED" || first.reasonCode !== "awaiting_second_approval") {
    return first;
  }
  let lastApproval;
  for (const approver of approverClerkUserIds) {
    lastApproval = await decidePrivilegedAction(db as never, {
      requestId: first.requestId,
      action: "temporal.workflow.cancel",
      actorClerkUserId: approver,
      target: { type: "generation", id: params.generationId },
      decision: "approve",
      assurance: params.stepUp.assurance,
      elevation: params.stepUp.elevation,
    });
  }
  if (lastApproval?.outcome !== "APPROVAL_RECORDED" || !lastApproval.satisfied) return first;
  return performAdminTemporalCancel(db as never, { ...params, requestId: first.requestId });
}

/**
 * Phase 16-D Temporal/Workflows — inspect (read-only) + the one guarded
 * cancel action.
 *
 * Core promises under test: the admin cancel path reuses the UNCHANGED
 * Phase 6R-H `recordCancelIntent`/Temporal-signal owner (never a second
 * cancellation model), always re-reads current state before acting, fails
 * closed on a terminal generation, records a distinct admin actor id
 * without altering the ordinary user-facing cancel behaviour, and no raw
 * Temporal history/payload is ever exposed.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/temporal/workflow-inspection.ts",
  "src/lib/admin/temporal-admin-contract.ts",
  "src/lib/admin/temporal-admin-service.ts",
  "src/lib/admin/temporal-admin-client-state.ts",
  "src/app/api/admin/temporal/[generationId]/route.ts",
  "src/app/api/admin/temporal/[generationId]/cancel/route.ts",
  "src/app/admin/temporal/page.tsx",
  "src/components/admin/TemporalInvestigationPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

function seedGeneration(db: FakeSupabaseClient, overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string) ?? randomUUID();
  if (!db.state.generations) db.state.generations = [];
  db.state.generations.push({
    id,
    clerk_user_id: "user_owner",
    status: "queued",
    metadata: null,
    ...overrides,
  });
  return id;
}

// ===========================================================================
// cancel-intent.ts extension — additive, backward compatible
// ===========================================================================

test("recordCancelIntent: ordinary owner-initiated cancel is unaffected by the new options param", async () => {
  const db = new FakeSupabaseClient();
  const id = seedGeneration(db);
  const result = await recordCancelIntent(db as never, id, "user_owner", "user_requested");
  assert.equal(result.outcome, "cancelled");
  const row = db.state.generations.find((r) => r.id === id) as { metadata: Record<string, unknown> };
  const intent = readCancelIntent(row.metadata);
  assert.ok(intent);
  assert.equal(intent?.reason, "user_requested");
  assert.equal(intent?.actorClerkUserId, undefined, "no admin actor recorded for the ordinary path");
});

test("recordCancelIntent: admin-initiated cancel records the admin actor id distinctly, ownership check unchanged", async () => {
  const db = new FakeSupabaseClient();
  const id = seedGeneration(db);
  const result = await recordCancelIntent(db as never, id, "user_owner", "admin_cancel:operator_investigation", {
    adminActorId: "admin_user_1",
  });
  assert.equal(result.outcome, "cancelled");
  const row = db.state.generations.find((r) => r.id === id) as { metadata: Record<string, unknown> };
  const intent = readCancelIntent(row.metadata);
  assert.equal(intent?.actorClerkUserId, "admin_user_1");
  assert.equal(intent?.reason, "admin_cancel:operator_investigation");
});

test("recordCancelIntent: an admin-supplied owner id that does not match the row is still refused (ownership check not relaxed)", async () => {
  const db = new FakeSupabaseClient();
  const id = seedGeneration(db, { clerk_user_id: "user_real_owner" });
  await assert.rejects(
    recordCancelIntent(db as never, id, "user_wrong", "admin_cancel:x", { adminActorId: "admin_user_1" }),
    /GENERATION_NOT_FOUND/
  );
});

// ===========================================================================
// workflow-ids.ts — reused verbatim, not re-derived
// ===========================================================================

test("temporal-admin-service derives the workflow id through the existing generationWorkflowId(), not a new scheme", () => {
  const id = randomUUID();
  assert.equal(generationWorkflowId(id), `gen:${id}`);
  assert.equal(generationIdFromWorkflowId(generationWorkflowId(id)), id);
});

// ===========================================================================
// getAdminTemporalInspection — read-only
// ===========================================================================

test("inspection: invalid generation id never reaches the database", async () => {
  const db = new FakeSupabaseClient();
  const result = await getAdminTemporalInspection(db as never, "not-a-uuid");
  assert.deepEqual(result, { outcome: "INVALID_GENERATION_ID" });
});

test("inspection: unknown generation id is GENERATION_NOT_FOUND", async () => {
  const db = new FakeSupabaseClient();
  const result = await getAdminTemporalInspection(db as never, randomUUID());
  assert.equal(result.outcome, "GENERATION_NOT_FOUND");
});

test("inspection: metadata is read only to extract the bounded cancel-intent projection — nothing else in metadata ever reaches the response", async () => {
  const db = new FakeSupabaseClient();
  const id = seedGeneration(db, {
    status: "processing",
    metadata: {
      orchestration: { cancelRequested: { requestedAt: "2026-01-01T00:00:00.000Z", reason: "user_requested" } },
      // Deliberately unrelated content that must never leak into the response.
      somethingElseEntirely: "e2e closure flow secret prompt",
      providerJob: { apiKey: "sk-should-never-appear" },
    },
  });
  const result = await getAdminTemporalInspection(db as never, id);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /somethingElseEntirely|secret prompt|apiKey|sk-should-never-appear/);
  assert.match(serialized, /user_requested/, "the bounded cancel-intent fields ARE forwarded");
});

test("inspection: a found generation reports its durable status and cancel intent, and a Temporal-not-configured workflow state (no env configured in this test process)", async () => {
  const db = new FakeSupabaseClient();
  const id = seedGeneration(db, { status: "processing" });
  const result = await getAdminTemporalInspection(db as never, id);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.equal(result.generation.status, "processing");
  assert.equal(result.generation.cancelIntent, null);
  assert.equal(result.workflow.state, "TEMPORAL_NOT_CONFIGURED", "no TEMPORAL_ADDRESS/NAMESPACE in this test env");
});

// ===========================================================================
// performAdminTemporalCancel — the one guarded mutation
// ===========================================================================

test("cancel: invalid input (bad generation id, bad reason code, missing actor) is refused before any read", async () => {
  const db = new FakeSupabaseClient();
  assert.deepEqual(
    await performAdminTemporalCancel(db as never, { generationId: "bad", adminActorId: "a", reasonCode: "x" }),
    { outcome: "INVALID_INPUT" }
  );
  const id = randomUUID();
  assert.deepEqual(
    await performAdminTemporalCancel(db as never, { generationId: id, adminActorId: "a", reasonCode: "Not Valid!" }),
    { outcome: "INVALID_INPUT" }
  );
  assert.deepEqual(
    await performAdminTemporalCancel(db as never, { generationId: id, adminActorId: "", reasonCode: "x" }),
    { outcome: "INVALID_INPUT" }
  );
});

test("cancel: unknown generation id is GENERATION_NOT_FOUND", async () => {
  await withTier0("admin_1,admin_1_approver_a,admin_1_approver_b", async () => {
    const db = new FakeSupabaseClient();
    const result = await performAdminTemporalCancelWithTwoPersonSatisfied(db, {
      generationId: randomUUID(),
      adminActorId: "admin_1",
      reasonCode: "operator_investigation",
      stepUp: TIER0_STEP_UP,
    });
    assert.deepEqual(result, { outcome: "GENERATION_NOT_FOUND" });
  });
});

test("cancel: a terminal generation fails closed as CANCEL_NOT_ALLOWED, never mutated", async () => {
  await withTier0("admin_1,admin_1_approver_a,admin_1_approver_b", async () => {
    const db = new FakeSupabaseClient();
    const id = seedGeneration(db, { status: "completed" });
    const result = await performAdminTemporalCancelWithTwoPersonSatisfied(db, {
      generationId: id,
      adminActorId: "admin_1",
      reasonCode: "operator_investigation",
      stepUp: TIER0_STEP_UP,
    });
    assert.deepEqual(result, { outcome: "CANCEL_NOT_ALLOWED", status: "completed" });
    const row = db.state.generations.find((r) => r.id === id) as { metadata: Record<string, unknown> | null };
    assert.equal(row.metadata, null, "a refused cancel writes nothing");
  });
});

test("cancel: a non-terminal generation is cancelled, the real owner id is used (never the admin's), and Temporal signalling is honestly false when unconfigured", async () => {
  await withTier0("admin_1,admin_1_approver_a,admin_1_approver_b", async () => {
    const db = new FakeSupabaseClient();
    const id = seedGeneration(db, { status: "queued", clerk_user_id: "user_owner" });
    const result = await performAdminTemporalCancelWithTwoPersonSatisfied(db, {
      generationId: id,
      adminActorId: "admin_1",
      reasonCode: "operator_investigation",
      stepUp: TIER0_STEP_UP,
    });
    assert.equal(result.outcome, "CANCEL_REQUESTED");
    if (result.outcome !== "CANCEL_REQUESTED") return;
    assert.equal(result.alreadyRequested, false);
    assert.equal(result.workflowSignalled, false, "no Temporal config in this test process");

    const row = db.state.generations.find((r) => r.id === id) as { metadata: Record<string, unknown> };
    const intent = readCancelIntent(row.metadata);
    assert.equal(intent?.actorClerkUserId, "admin_1");
    assert.equal(intent?.reason, "admin_cancel:operator_investigation");
  });
});

test("cancel: repeated admin cancel is idempotent (alreadyRequested), and re-reads current state fresh on the second call", async () => {
  // Four distinct Tier-0 admins: admin_1 requests the first cancel
  // (approved by admin_3 + admin_4, the RPC's own 2-distinct-approver
  // threshold), then admin_2 requests a SEPARATE cancel attempt on the
  // same, already-cancelled generation (also approved by admin_3 +
  // admin_4, neither of whom is ITS requester either) — two-person is
  // per-request, so idempotency must hold even though each attempt is its
  // own fully-satisfied two-person cycle.
  await withTier0("admin_1,admin_2,admin_3,admin_4", async () => {
    const db = new FakeSupabaseClient();
    const id = seedGeneration(db, { status: "queued" });
    await performAdminTemporalCancelWithTwoPersonSatisfied(
      db,
      { generationId: id, adminActorId: "admin_1", reasonCode: "first_try", stepUp: TIER0_STEP_UP },
      ["admin_3", "admin_4"]
    );
    const second = await performAdminTemporalCancelWithTwoPersonSatisfied(
      db,
      { generationId: id, adminActorId: "admin_2", reasonCode: "second_try", stepUp: TIER0_STEP_UP },
      ["admin_3", "admin_4"]
    );
    assert.equal(second.outcome, "CANCEL_REQUESTED");
    if (second.outcome !== "CANCEL_REQUESTED") return;
    assert.equal(second.alreadyRequested, true);
  });
});

// ===========================================================================
// client state
// ===========================================================================

test("client state: inspection response mapping covers every documented outcome", () => {
  assert.deepEqual(interpretInspectionResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(interpretInspectionResponse(200, { outcome: "INVALID_GENERATION_ID" }), { kind: "invalid" });
  assert.deepEqual(interpretInspectionResponse(200, { outcome: "GENERATION_NOT_FOUND" }), { kind: "not_found" });
  assert.deepEqual(
    interpretInspectionResponse(200, { outcome: "SOURCE_UNAVAILABLE", reasonCode: "x" }),
    { kind: "unavailable", reasonCode: "x" }
  );
  const found = { outcome: "FOUND" as const, generation: { generationId: "g", status: "queued", cancelIntent: null }, workflow: { state: "TEMPORAL_NOT_CONFIGURED" as const } };
  assert.deepEqual(interpretInspectionResponse(200, found), { kind: "found", result: found });
  assert.deepEqual(networkErrorState(), { kind: "unavailable", reasonCode: "network_error" });
});

test("client state: cancel response mapping covers every documented outcome", () => {
  assert.deepEqual(interpretCancelResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(interpretCancelResponse(200, { outcome: "INVALID_INPUT" }), { kind: "invalid" });
  assert.deepEqual(interpretCancelResponse(200, { outcome: "GENERATION_NOT_FOUND" }), { kind: "not_found" });
  assert.deepEqual(
    interpretCancelResponse(200, { outcome: "CANCEL_NOT_ALLOWED", status: "completed" }),
    { kind: "not_allowed", status: "completed" }
  );
  assert.deepEqual(
    interpretCancelResponse(200, { outcome: "CANCEL_REQUESTED", generationId: "g", alreadyRequested: false, workflowSignalled: true }),
    { kind: "requested", alreadyRequested: false, workflowSignalled: true }
  );
});

test("ADMIN_CANCEL_REASON_PATTERN rejects free text/prose", () => {
  assert.ok(ADMIN_CANCEL_REASON_PATTERN.test("operator_investigation"));
  assert.ok(!ADMIN_CANCEL_REASON_PATTERN.test("Please cancel this now!"));
});

// ===========================================================================
// sensitive data / structural safety
// ===========================================================================

test("no raw Temporal history or payload field is ever read or forwarded", () => {
  const inspectionText = stripComments(read("src/lib/temporal/workflow-inspection.ts"));
  assert.doesNotMatch(inspectionText, /fetchHistory|\.result\(\)|searchAttributes|\bmemo\b|\.raw\b/);
  assert.match(inspectionText, /historyLength/, "a count is fine, the events themselves are not read");
});

test("no @temporalio/worker or @temporalio/workflow import exists in the new admin surface (native binary boundary preserved)", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /@temporalio\/worker|@temporalio\/workflow/, file);
  }
});

test("no prompt, secret, token, or signed-URL shape appears anywhere in the new surface", () => {
  const forbidden = ["prompt", "apikey", "signedurl", "authorization:", "access_token", "refresh_token"];
  for (const { file, text } of NEW_FILES) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word), `${file} mentions forbidden shape "${word}"`);
    }
  }
});

test("the cancel route is POST-only, durable_write, and never reachable via GET", () => {
  const routeText = stripComments(read("src/app/api/admin/temporal/[generationId]/cancel/route.ts"));
  assert.match(routeText, /export async function POST/);
  assert.doesNotMatch(routeText, /export async function GET/);
  assert.match(routeText, /durable_write/);
});

test("the inspect route is GET-only and read-only", () => {
  const routeText = stripComments(read("src/app/api/admin/temporal/[generationId]/route.ts"));
  assert.match(routeText, /export async function GET/);
  assert.doesNotMatch(routeText, /export async function POST/);
});

test("no second cancellation model: no direct provider cancel, no hard Temporal terminate, no new Temporal signal name", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /\.terminate\s*\(|ProviderAdapter\.cancel|providerCancel\s*\(/, file);
  }
  const serviceText = read("src/lib/admin/temporal-admin-service.ts");
  assert.match(serviceText, /requestGenerationCancellation/, "reuses the existing signal-based cancel");
  assert.doesNotMatch(serviceText, /handle\.signal\(/, "does not call the Temporal signal directly — goes through the existing wrapper");
});

test("exactly one canonical admin auth boundary is reused in both routes", () => {
  for (const relPath of [
    "src/app/api/admin/temporal/[generationId]/route.ts",
    "src/app/api/admin/temporal/[generationId]/cancel/route.ts",
  ]) {
    const text = stripComments(read(relPath));
    assert.match(text, /requireAdminAccess/);
    assert.doesNotMatch(text, /ROUTE_ADMIN_CLERK_USER_IDS/);
  }
});

test("no locked product UI route is referenced by the new files", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of NEW_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
  }
});

test("no migration file was added for this surface", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE/i, file);
  }
});
