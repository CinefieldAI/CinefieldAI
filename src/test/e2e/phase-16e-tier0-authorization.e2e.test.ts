import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { authorizeTier0Action, recordTier0Execution } from "@/lib/admin/tier0-authorization";
import { recordPrivilegedActionApproval, queryPrivilegedActionAudit } from "@/lib/admin/privileged-action-audit";
import { tier0ActionEntry, registeredTier0Actions } from "@/lib/admin/tier0-action-catalogue";
import type { AssuranceEvidence, ElevationVerdict } from "@/lib/admin/step-up-auth";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 16-E — the Tier-0 authorization decision point (Section 18/27's
 * "done criterion" chain: risk identified -> role checked -> step-up
 * checked -> dual control checked -> durable evidence produced), and the
 * generic dual-control mechanism.
 */

const NOT_CONFIGURED: AssuranceEvidence = { state: "NOT_CONFIGURED", verifiedAt: null };
const VERIFIED: AssuranceEvidence = { state: "VERIFIED", verifiedAt: new Date().toISOString() };
const NOT_ELEVATED: ElevationVerdict = { elevated: false, reasonCode: "no_elevation" };
const ELEVATED: ElevationVerdict = { elevated: true, reasonCode: "verified" };

function envelope(db: FakeSupabaseClient) {
  return db as never;
}

// ===========================================================================
// Catalogue sanity — every entry is genuinely classified, not a placeholder
// ===========================================================================

test("tier0-action-catalogue: every registered action has a real classification and owner", () => {
  const actions = registeredTier0Actions();
  assert.ok(actions.length >= 6, "expected the roadmap-named Tier-0 actions to be catalogued");
  for (const action of actions) {
    const entry = tier0ActionEntry(action);
    assert.ok(entry);
    assert.ok(["READ_ONLY", "OPERATOR_MUTATION", "HIGH_RISK_TIER0"].includes(entry!.classification));
    assert.ok(entry!.owner.length > 0);
  }
});

// ===========================================================================
// Structural refusals
// ===========================================================================

test("authorizeTier0Action: an unknown action is denied and writes NO audit row (nothing to correlate it to)", async () => {
  const db = new FakeSupabaseClient();
  const decision = await authorizeTier0Action(envelope(db), {
    requestId: randomUUID(),
    action: "not.a.real.action",
    actorClerkUserId: "user_1",
    target: { type: "generation" },
    assurance: NOT_CONFIGURED,
    elevation: NOT_ELEVATED,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "unknown_action");
  assert.equal((db.state.admin_privileged_action_events ?? []).length, 0);
});

test("authorizeTier0Action: a malformed request id is refused before any database write", async () => {
  const db = new FakeSupabaseClient();
  const decision = await authorizeTier0Action(envelope(db), {
    requestId: "not-a-uuid",
    action: "queue.dlq.redrive",
    actorClerkUserId: "user_1",
    target: { type: "dlq_message" },
    assurance: NOT_CONFIGURED,
    elevation: NOT_ELEVATED,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "invalid_request_id");
  assert.equal((db.state.admin_privileged_action_events ?? []).length, 0);
});

// ===========================================================================
// Role tier
// ===========================================================================

test("authorizeTier0Action: an actor with no admin role is refused in enforce mode, and the real reason is durably recorded", async () => {
  const db = new FakeSupabaseClient();
  const requestId = randomUUID();
  const decision = await authorizeTier0Action(envelope(db), {
    requestId,
    action: "queue.dlq.redrive",
    actorClerkUserId: "user_totally_unlisted",
    target: { type: "dlq_message" },
    assurance: NOT_CONFIGURED,
    elevation: NOT_ELEVATED,
    enforce: true,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "role_not_permitted");

  const rows = (db.state.admin_privileged_action_events ?? []) as Record<string, unknown>[];
  const events = rows.filter((r) => r.request_id === requestId).map((r) => r.event);
  assert.deepEqual(events, ["requested", "denied"]);
  const denied = rows.find((r) => r.event === "denied");
  assert.equal(denied?.outcome_detail, "role_not_permitted");
});

test("authorizeTier0Action: in SHADOW mode (the default), the same denial still allows the caller through, but the real reason is still recorded", async () => {
  const db = new FakeSupabaseClient();
  const requestId = randomUUID();
  const decision = await authorizeTier0Action(envelope(db), {
    requestId,
    action: "queue.dlq.redrive",
    actorClerkUserId: "user_totally_unlisted",
    target: { type: "dlq_message" },
    assurance: NOT_CONFIGURED,
    elevation: NOT_ELEVATED,
    enforce: false,
  });
  assert.equal(decision.allowed, true, "shadow mode never blocks the caller");
  assert.equal(decision.reasonCode, "allowed_shadow_mode");
  assert.equal(decision.enforced, false);

  const rows = (db.state.admin_privileged_action_events ?? []) as Record<string, unknown>[];
  const denied = rows.find((r) => r.request_id === requestId && r.event === "denied");
  assert.equal(denied?.outcome_detail, "role_not_permitted", "the durable evidence records the REAL reason regardless of enforcement mode");
});

// ===========================================================================
// Step-up assurance
// ===========================================================================

test("authorizeTier0Action: role satisfied, but step-up NOT_CONFIGURED — denied in enforce mode with the honest reason (never a fabricated pass)", async () => {
  const db = new FakeSupabaseClient();
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0";
  try {
    const decision = await authorizeTier0Action(envelope(db), {
      requestId: randomUUID(),
      action: "queue.dlq.redrive",
      actorClerkUserId: "user_t0",
      target: { type: "dlq_message" },
      assurance: NOT_CONFIGURED,
      elevation: NOT_ELEVATED,
      enforce: true,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, "step_up_not_configured");
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("authorizeTier0Action: assurance VERIFIED but no elevated session on file — still denied (assurance alone is not an elevation)", async () => {
  const db = new FakeSupabaseClient();
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0";
  try {
    const decision = await authorizeTier0Action(envelope(db), {
      requestId: randomUUID(),
      action: "queue.dlq.redrive",
      actorClerkUserId: "user_t0",
      target: { type: "dlq_message" },
      assurance: VERIFIED,
      elevation: NOT_ELEVATED,
      enforce: true,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, "step_up_not_elevated");
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("authorizeTier0Action: role + verified assurance + a valid elevated session -> ALLOWED, even in enforce mode", async () => {
  const db = new FakeSupabaseClient();
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0";
  try {
    const requestId = randomUUID();
    const decision = await authorizeTier0Action(envelope(db), {
      requestId,
      action: "queue.dlq.redrive",
      actorClerkUserId: "user_t0",
      target: { type: "dlq_message", id: "msg-1" },
      assurance: VERIFIED,
      elevation: ELEVATED,
      enforce: true,
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reasonCode, "allowed");
    assert.equal(decision.role, "tier0_admin");

    await recordTier0Execution(envelope(db), {
      requestId,
      action: "queue.dlq.redrive",
      actorClerkUserId: "user_t0",
      target: { type: "dlq_message", id: "msg-1" },
      outcome: "executed",
    });

    const result = await queryPrivilegedActionAudit(envelope(db), {});
    assert.equal(result.outcome, "FOUND");
    if (result.outcome !== "FOUND") return;
    const events = result.rows.filter((r) => r.requestId === requestId).map((r) => r.event);
    assert.ok(events.includes("requested"));
    assert.ok(events.includes("approved"));
    assert.ok(events.includes("executed"));
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

// ===========================================================================
// Dual control (generic mechanism, Section 10/26)
// ===========================================================================

test("recordPrivilegedActionApproval: the requester cannot self-approve — structurally blocked in the SQL function (emulated here)", async () => {
  const db = new FakeSupabaseClient();
  const requestId = randomUUID();
  await authorizeTier0Action(envelope(db), {
    requestId,
    action: "media.quarantine.release",
    actorClerkUserId: "user_requester",
    target: { type: "media_asset", id: "asset-1" },
    assurance: NOT_CONFIGURED,
    elevation: NOT_ELEVATED,
    enforce: false, // shadow: only care about the 'requested' event existing
  });

  const result = await recordPrivilegedActionApproval(envelope(db), {
    requestId,
    actorClerkUserId: "user_requester",
    actionType: "media.quarantine.release",
    targetType: "media_asset",
    targetId: "asset-1",
    securityClassification: "HIGH_RISK_TIER0",
  });
  assert.equal(result.recorded, false);
  if (result.recorded) return;
  assert.equal(result.reason, "self_approval_blocked");
});

test("recordPrivilegedActionApproval: a second, distinct approver satisfies a 2-required threshold; a third repeat by the SAME approver does not double-count", async () => {
  const db = new FakeSupabaseClient();
  const requestId = randomUUID();
  await authorizeTier0Action(envelope(db), {
    requestId,
    action: "media.quarantine.release",
    actorClerkUserId: "user_requester",
    target: { type: "media_asset", id: "asset-1" },
    assurance: NOT_CONFIGURED,
    elevation: NOT_ELEVATED,
    enforce: false,
  });

  const first = await recordPrivilegedActionApproval(envelope(db), {
    requestId,
    actorClerkUserId: "user_approver_1",
    actionType: "media.quarantine.release",
    targetType: "media_asset",
    targetId: "asset-1",
    securityClassification: "HIGH_RISK_TIER0",
  });
  assert.equal(first.recorded, true);
  if (!first.recorded) return;
  assert.equal(first.approvals, 1);
  assert.equal(first.satisfied, false);

  // The SAME approver "approving" again must not push the count to 2 — COUNT
  // DISTINCT, not COUNT — matching the media_release_approvals PK discipline.
  const repeat = await recordPrivilegedActionApproval(envelope(db), {
    requestId,
    actorClerkUserId: "user_approver_1",
    actionType: "media.quarantine.release",
    targetType: "media_asset",
    targetId: "asset-1",
    securityClassification: "HIGH_RISK_TIER0",
  });
  assert.equal(repeat.recorded, true);
  if (!repeat.recorded) return;
  assert.equal(repeat.approvals, 1, "a repeat approval by the same actor does not increase the distinct count");

  const second = await recordPrivilegedActionApproval(envelope(db), {
    requestId,
    actorClerkUserId: "user_approver_2",
    actionType: "media.quarantine.release",
    targetType: "media_asset",
    targetId: "asset-1",
    securityClassification: "HIGH_RISK_TIER0",
  });
  assert.equal(second.recorded, true);
  if (!second.recorded) return;
  assert.equal(second.approvals, 2);
  assert.equal(second.satisfied, true);
});

test("recordPrivilegedActionApproval: an approval against a request id that was never requested is refused", async () => {
  const db = new FakeSupabaseClient();
  const result = await recordPrivilegedActionApproval(envelope(db), {
    requestId: randomUUID(),
    actorClerkUserId: "user_approver_1",
    actionType: "media.quarantine.release",
    targetType: "media_asset",
    targetId: "asset-nonexistent",
    securityClassification: "HIGH_RISK_TIER0",
  });
  assert.equal(result.recorded, false);
  if (result.recorded) return;
  assert.equal(result.reason, "no_matching_request");
});
