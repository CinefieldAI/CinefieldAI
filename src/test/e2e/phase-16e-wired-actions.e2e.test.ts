import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { executeAdminDlqRedrive } from "@/lib/admin/dlq-admin-service";
import { setAdminRouteEnabled } from "@/lib/admin/router-admin-service";
import { performAdminTemporalCancel } from "@/lib/admin/temporal-admin-service";
import { decidePrivilegedAction } from "@/lib/admin/tier0-authorization";
import type { AssuranceEvidence, ElevationVerdict } from "@/lib/admin/step-up-auth";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 16-E — proves the four wired call sites (DLQ redrive, route
 * disable, Temporal cancel) refuse without Tier-0 role/step-up, in EVERY
 * enforcement-mode configuration, through the exact production code path
 * (not just `tier0-authorization.ts` in isolation).
 *
 * ---------------------------------------------------------------------------
 * SECURITY FIX BATCH — WHY THIS FILE CHANGED SHAPE
 * ---------------------------------------------------------------------------
 * The pre-fix version of this file asserted that SHADOW mode (the default,
 * `CINEFIELD_TIER0_ENFORCEMENT_MODE` unset) let these three calls through
 * to their real canonical owners with NO step-up evidence at all — "byte-
 * identical to the pre-16-E call." That was the exact fail-open defect the
 * 16-E closure audit proved: a normal admin session, with no Tier-0 role
 * and no step-up, could execute a `HIGH_RISK_TIER0` action simply because
 * enforcement defaulted to shadow. `authorizeTier0Action` no longer has an
 * enforcement-mode lever on `allowed` (see `tier0-authorization.ts`'s
 * header) — every deny is a deny, in every mode. These tests now prove
 * that through the full production chain: SHADOW MODE and ENFORCE MODE
 * produce the IDENTICAL refusal for an unauthorized actor.
 *
 * ---------------------------------------------------------------------------
 * PHASE 19 CLOSURE FIX — WHY "FULL STEP-UP EVIDENCE" NO LONGER MEANS SUCCESS
 * ---------------------------------------------------------------------------
 * All three actions are now catalogued `requiresTwoPerson: true` (the
 * roadmap's own Two-Person Approval list, ¶2344, names all three). Role +
 * step-up alone now correctly stops at `awaiting_second_approval` — a
 * SECOND, distinct admin must approve the same `requestId` via
 * `decidePrivilegedAction` (the Phase 19 closure fix's own missing-half
 * fix — see `tier0-authorization.ts`'s header) before a retry with that
 * SAME `requestId` reaches the real canonical owner. Each "proceeds to the
 * real path" test below now has two phases: first attempt stops pending;
 * a second distinct admin approves; the retry succeeds.
 */

function withEnforcement<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  return fn().finally(() => {
    if (original === undefined) delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
    else process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = original;
  });
}

const VERIFIED: AssuranceEvidence = { state: "VERIFIED", verifiedAt: new Date().toISOString() };
const ELEVATED: ElevationVerdict = { elevated: true, reasonCode: "verified" };

// ===========================================================================
// DLQ redrive
// ===========================================================================

test("executeAdminDlqRedrive: SHADOW mode (no stepUp arg, the default) refuses an unauthorized actor exactly like enforce mode — the pre-fix version of this test asserted the OPPOSITE, which was the fail-open defect", async () => {
  const db = new FakeSupabaseClient();
  const result = await executeAdminDlqRedrive(db as never, "user_admin_test", "investigating incident #42");
  assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED", "shadow mode must refuse an actor with no Tier-0 role/step-up, same as enforce mode");
  if (result.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
  assert.equal(result.reasonCode, "role_not_permitted");
});

test("executeAdminDlqRedrive: enforce mode, no admin role on any allowlist -> TIER0_AUTHORIZATION_REQUIRED, real redrive never attempted", async () => {
  await withEnforcement(async () => {
    const db = new FakeSupabaseClient();
    const result = await executeAdminDlqRedrive(db as never, "user_totally_unlisted", "incident");
    assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    if (result.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
    assert.equal(result.reasonCode, "role_not_permitted");
  });
});

test("executeAdminDlqRedrive: enforce mode, tier0 role but no step-up evidence -> TIER0_AUTHORIZATION_REQUIRED / step_up_not_configured", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0";
  try {
    await withEnforcement(async () => {
      const db = new FakeSupabaseClient();
      const result = await executeAdminDlqRedrive(db as never, "user_t0", "incident");
      assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (result.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
      assert.equal(result.reasonCode, "step_up_not_configured");
    });
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("executeAdminDlqRedrive: enforce mode with full step-up evidence stops at awaiting_second_approval (two-person, Phase 19 closure fix) — never the real redrive path on a single admin's say-so", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0";
  try {
    await withEnforcement(async () => {
      const db = new FakeSupabaseClient();
      const result = await executeAdminDlqRedrive(db as never, "user_t0", "incident", {
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (result.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
      assert.equal(result.reasonCode, "awaiting_second_approval");
      assert.ok(result.requestId, "a requestId must be returned so a second admin can approve it");
    });
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("executeAdminDlqRedrive: after TWO further, distinct admins approve the same requestId (the RPC's own 'two distinct people' threshold excludes the requester), a retry reaches the real (still-unconfigured-in-this-test-process) Phase 15-D/16-B path", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0,user_t0_approver_a,user_t0_approver_b";
  try {
    await withEnforcement(async () => {
      const db = new FakeSupabaseClient();
      const first = await executeAdminDlqRedrive(db as never, "user_t0", "incident", {
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
      const requestId = first.requestId;

      const firstApproval = await decidePrivilegedAction(db as never, {
        requestId,
        action: "queue.dlq.redrive",
        actorClerkUserId: "user_t0_approver_a",
        target: { type: "dlq_message", id: null },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.deepEqual(firstApproval, { outcome: "APPROVAL_RECORDED", approvals: 1, required: 2, satisfied: false });

      const secondApproval = await decidePrivilegedAction(db as never, {
        requestId,
        action: "queue.dlq.redrive",
        actorClerkUserId: "user_t0_approver_b",
        target: { type: "dlq_message", id: null },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.deepEqual(secondApproval, { outcome: "APPROVAL_RECORDED", approvals: 2, required: 2, satisfied: true });

      const retry = await executeAdminDlqRedrive(
        db as never,
        "user_t0",
        "incident",
        { assurance: VERIFIED, elevation: ELEVATED },
        requestId
      );
      // Still NOT_CONFIGURED — no AWS in this test process — but critically
      // NOT TIER0_AUTHORIZATION_REQUIRED: both the policy gate and the full
      // Tier-0 (role + step-up + two-person) gate let it through, and the
      // real (unmodified) Phase 15-D/16-B path was reached.
      assert.equal(retry.outcome, "NOT_CONFIGURED");
    });
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("executeAdminDlqRedrive: the requester cannot satisfy their own two-person requirement by 'approving' their own request", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0";
  try {
    await withEnforcement(async () => {
      const db = new FakeSupabaseClient();
      const first = await executeAdminDlqRedrive(db as never, "user_t0", "incident", {
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

      const selfApproval = await decidePrivilegedAction(db as never, {
        requestId: first.requestId,
        action: "queue.dlq.redrive",
        actorClerkUserId: "user_t0",
        target: { type: "dlq_message", id: null },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.deepEqual(selfApproval, { outcome: "SELF_APPROVAL_BLOCKED" });

      const retry = await executeAdminDlqRedrive(
        db as never,
        "user_t0",
        "incident",
        { assurance: VERIFIED, elevation: ELEVATED },
        first.requestId
      );
      assert.equal(retry.outcome, "TIER0_AUTHORIZATION_REQUIRED", "a blocked self-approval must never satisfy the threshold");
    });
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

// ===========================================================================
// Route disable/enable
// ===========================================================================

test("setAdminRouteEnabled: SHADOW mode (no stepUp arg, the default) refuses an actor who is only on the legacy ROUTE_ADMIN_CLERK_USER_IDS allowlist and has no Tier-0 role — that older authority is a DIFFERENT boundary and is not a step-up substitute", async () => {
  const db = new FakeSupabaseClient();
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = "user_route_admin_test";
  try {
    db.state.model_routes = [{ id: "11111111-1111-4111-8111-111111111111", enabled: true }];
    const result = await setAdminRouteEnabled(
      db as never,
      "user_route_admin_test",
      "11111111-1111-4111-8111-111111111111",
      false,
      "incident #1"
    );
    assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED", "ROUTE_ADMIN_CLERK_USER_IDS membership alone is not a Tier-0 role and must not bypass step-up");
    // The route row is untouched — proof the canonical owner was never reached.
    assert.equal((db.state.model_routes[0] as { enabled: boolean }).enabled, true);
  } finally {
    delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  }
});

test("setAdminRouteEnabled: a tier0_admin WITH full step-up evidence, and ALSO on ROUTE_ADMIN_CLERK_USER_IDS, stops at awaiting_second_approval (two-person, Phase 19 closure fix) — role/step-up alone is not enough", async () => {
  const db = new FakeSupabaseClient();
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = "user_full_authority";
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_full_authority";
  try {
    db.state.model_routes = [{ id: "33333333-3333-4333-8333-333333333333", enabled: true }];
    const result = await setAdminRouteEnabled(
      db as never,
      "user_full_authority",
      "33333333-3333-4333-8333-333333333333",
      false,
      "incident #2",
      { assurance: VERIFIED, elevation: ELEVATED }
    );
    assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    if (result.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
    assert.equal(result.reasonCode, "awaiting_second_approval");
    // The route row is untouched — the canonical owner was never reached.
    assert.equal((db.state.model_routes[0] as { enabled: boolean }).enabled, true);
  } finally {
    delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("setAdminRouteEnabled: both boundaries satisfied AND a second, distinct admin approves — the retry applies the mutation, and neither layer was replaced", async () => {
  const db = new FakeSupabaseClient();
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = "user_full_authority";
  // The RPC's own "two distinct people" threshold (record_admin_privileged_
  // action_approval, required_approvals default 2) excludes the requester
  // by construction — TWO further, distinct admins must approve.
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS =
    "user_full_authority,user_full_authority_approver_a,user_full_authority_approver_b";
  try {
    db.state.model_routes = [{ id: "33333333-3333-4333-8333-333333333333", enabled: true }];
    const first = await setAdminRouteEnabled(
      db as never,
      "user_full_authority",
      "33333333-3333-4333-8333-333333333333",
      false,
      "incident #2",
      { assurance: VERIFIED, elevation: ELEVATED }
    );
    assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

    for (const approver of ["user_full_authority_approver_a", "user_full_authority_approver_b"]) {
      const approval = await decidePrivilegedAction(db as never, {
        requestId: first.requestId,
        action: "route.disable",
        actorClerkUserId: approver,
        target: { type: "model_route", id: "33333333-3333-4333-8333-333333333333" },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.equal(approval.outcome, "APPROVAL_RECORDED");
    }

    const retry = await setAdminRouteEnabled(
      db as never,
      "user_full_authority",
      "33333333-3333-4333-8333-333333333333",
      false,
      "incident #2",
      { assurance: VERIFIED, elevation: ELEVATED },
      first.requestId
    );
    assert.deepEqual(retry, { outcome: "APPLIED", routeId: "33333333-3333-4333-8333-333333333333", enabled: false });
  } finally {
    delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("setAdminRouteEnabled: enforce mode without step-up refuses before ever touching setRouteEnabled/ROUTE_ADMIN_CLERK_USER_IDS", async () => {
  await withEnforcement(async () => {
    const db = new FakeSupabaseClient();
    db.state.model_routes = [{ id: "22222222-2222-4222-8222-222222222222", enabled: true }];
    const result = await setAdminRouteEnabled(
      db as never,
      "user_totally_unlisted",
      "22222222-2222-4222-8222-222222222222",
      false,
      "incident"
    );
    assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    // The route row is untouched — proof the canonical owner was never reached.
    assert.equal((db.state.model_routes[0] as { enabled: boolean }).enabled, true);
  });
});

// ===========================================================================
// Temporal cancel
// ===========================================================================

function seedGeneration(db: FakeSupabaseClient) {
  const id = randomUUID();
  db.state.generations = [{ id, clerk_user_id: "user_owner", status: "queued", metadata: null }];
  return id;
}

test("performAdminTemporalCancel: SHADOW mode (no stepUp arg, the default) refuses an unauthorized actor — the pre-fix version of this test asserted CANCEL_REQUESTED here, which was the fail-open defect", async () => {
  const db = new FakeSupabaseClient();
  const id = seedGeneration(db);
  const result = await performAdminTemporalCancel(db as never, {
    generationId: id,
    adminActorId: "admin_1",
    reasonCode: "operator_investigation",
  });
  assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED", "shadow mode must refuse an actor with no Tier-0 role/step-up, same as enforce mode");
  assert.equal((db.state.generations[0] as { status: string }).status, "queued", "no cancel intent may be recorded before authorization");
});

test("performAdminTemporalCancel: enforce mode without step-up refuses before the cancel-intent write — the generation status is untouched", async () => {
  await withEnforcement(async () => {
    const db = new FakeSupabaseClient();
    const id = seedGeneration(db);
    const result = await performAdminTemporalCancel(db as never, {
      generationId: id,
      adminActorId: "user_totally_unlisted",
      reasonCode: "operator_investigation",
    });
    assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    assert.equal((db.state.generations[0] as { status: string }).status, "queued");
  });
});

test("performAdminTemporalCancel: enforce mode with full step-up evidence stops at awaiting_second_approval (two-person, Phase 19 closure fix) — no cancel intent is recorded on a single admin's say-so", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0";
  try {
    await withEnforcement(async () => {
      const db = new FakeSupabaseClient();
      const id = seedGeneration(db);
      const result = await performAdminTemporalCancel(db as never, {
        generationId: id,
        adminActorId: "user_t0",
        reasonCode: "operator_investigation",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
      });
      assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (result.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
      assert.equal(result.reasonCode, "awaiting_second_approval");
      const row = db.state.generations[0] as { status: string; metadata: Record<string, unknown> | null };
      assert.equal(row.status, "queued");
      assert.equal(row.metadata, null, "no cancel intent may be recorded before the second approval");
    });
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("performAdminTemporalCancel: after TWO further, distinct admins approve the same requestId (the RPC's own 'two distinct people' threshold excludes the requester), the retry reaches the real cancel-intent write", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0,user_t0_approver_a,user_t0_approver_b";
  try {
    await withEnforcement(async () => {
      const db = new FakeSupabaseClient();
      const id = seedGeneration(db);
      const first = await performAdminTemporalCancel(db as never, {
        generationId: id,
        adminActorId: "user_t0",
        reasonCode: "operator_investigation",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
      });
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

      let approval;
      for (const approver of ["user_t0_approver_a", "user_t0_approver_b"]) {
        approval = await decidePrivilegedAction(db as never, {
          requestId: first.requestId,
          action: "temporal.workflow.cancel",
          actorClerkUserId: approver,
          target: { type: "generation", id },
          decision: "approve",
          assurance: VERIFIED,
          elevation: ELEVATED,
        });
        assert.equal(approval.outcome, "APPROVAL_RECORDED");
      }
      if (approval?.outcome === "APPROVAL_RECORDED") assert.equal(approval.satisfied, true);

      const retry = await performAdminTemporalCancel(db as never, {
        generationId: id,
        adminActorId: "user_t0",
        reasonCode: "operator_investigation",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
        requestId: first.requestId,
      });
      assert.equal(retry.outcome, "CANCEL_REQUESTED");
      // recordCancelIntent (Phase 6R-H, unchanged) records INTENT metadata on
      // the row — the actual status transition happens later, asynchronously,
      // when the workflow itself observes the intent. This is the same
      // "recorded, not yet applied" distinction phase-16d-temporal.e2e.test.ts
      // itself relies on. What matters for this test is that the policy gate
      // AND the full Tier-0 (role + step-up + two-person) gate let a fully-
      // authorized attempt reach the real, unmodified owner at all.
      const row = db.state.generations[0] as { status: string; metadata: Record<string, unknown> | null };
      assert.equal(row.status, "queued", "recordCancelIntent does not itself flip status — matches Phase 6R-H's own contract");
      assert.ok(row.metadata, "the cancel intent was durably recorded on the row");
    });
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});
