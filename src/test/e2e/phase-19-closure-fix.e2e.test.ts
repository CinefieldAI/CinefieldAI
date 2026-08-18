import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";

import { setAdminRouteEnabled } from "@/lib/admin/router-admin-service";
import { executeAdminDlqRedrive } from "@/lib/admin/dlq-admin-service";
import { performAdminTemporalCancel } from "@/lib/admin/temporal-admin-service";
import { decidePrivilegedAction, authorizeTier0Action } from "@/lib/admin/tier0-authorization";
import { tier0ActionEntry } from "@/lib/admin/tier0-action-catalogue";
import { evaluatePolicy } from "@/lib/policy/policy-engine";
import type { AssuranceEvidence, ElevationVerdict } from "@/lib/admin/step-up-auth";
import { FakeSupabaseClient } from "./fake-supabase";
import registry from "../../../policies/data/actions.json";

/**
 * Phase 19 CLOSURE FIX — proves the specific gaps the master closure audit
 * found: the real production provider/route-disable, DLQ-redrive and
 * Temporal-cancel paths now pass through `requirePolicy()`; all three are
 * catalogued two-person per the roadmap's own list (¶2344); and the
 * previously-missing second half of the dual-control mechanism (a real
 * caller for `record_admin_privileged_action_approval`) now exists and
 * enforces requester-≠-approver, action/target binding, and a bounded
 * request window — reusing the Phase 16-E audit table with no new
 * migration. `phase-16e-wired-actions.e2e.test.ts` and the various
 * `phase-16*-closure-end-to-end.e2e.test.ts` files prove the day-to-day
 * happy/deny paths through the real service functions; this file covers
 * what's specific to the closure-fix batch and not already exercised
 * elsewhere.
 */

const ROOT = process.cwd();
function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const VERIFIED: AssuranceEvidence = { state: "VERIFIED", verifiedAt: new Date().toISOString() };
const ELEVATED: ElevationVerdict = { elevated: true, reasonCode: "verified" };

// ---------------------------------------------------------------------------
// Registry — the three newly-wired actions and the deployment two-person fix
// ---------------------------------------------------------------------------

describe("Phase 19 closure fix — registry", () => {
  const actions = (
    registry as {
      actions: Record<string, { critical: boolean; requiredRoles: string[]; requiresTwoPerson: boolean; requiresHumanApproval: boolean; implemented: boolean }>;
      aiWriteAllowlist: string[];
    }
  ).actions;

  for (const action of ["route.disable", "queue.dlq.redrive", "temporal.workflow.cancel"]) {
    test(`${action} is registered, critical, implemented, route_admin-only, and two-person`, () => {
      const entry = actions[action];
      assert.ok(entry, `${action} must be registered`);
      assert.equal(entry.critical, true);
      assert.equal(entry.implemented, true);
      assert.equal(entry.requiresTwoPerson, true);
      assert.deepEqual(entry.requiredRoles, ["route_admin"]);
    });

    test(`${action} is never AI-allowlisted`, () => {
      const r = registry as { aiWriteAllowlist: string[] };
      assert.ok(!r.aiWriteAllowlist.includes(action));
    });

    test(`${action}: an AI agent is denied by evaluatePolicy before any role check can help it`, () => {
      const decision = evaluatePolicy({
        action,
        actor: { id: "agent_seer", role: "route_admin", kind: "ai_agent" },
        tenantId: null,
        resource: { type: "x", id: null },
        risk: { temporarilyBlocked: false, adminReviewRequired: false, challengeRequired: false },
        approvalEvidence: { humanApproved: true },
        environment: "production",
        originClass: "server",
        correlationId: null,
      });
      assert.equal(decision.decision, "DENY");
      assert.equal(decision.reason, "ai_write_authority_off");
    });
  }

  test("deployment.production.apply is now requiresTwoPerson: true, correctly representing the roadmap's own Two-Person Approval list (¶2344) — it was NOT before this batch", () => {
    assert.equal(actions["deployment.production.apply"].requiresTwoPerson, true);
  });
});

// ---------------------------------------------------------------------------
// Real policy wiring — requirePolicy() is the FIRST gate in all three paths
// ---------------------------------------------------------------------------

describe("Phase 19 closure fix — real policy wiring (structural)", () => {
  const cases: Array<{ file: string; action: string }> = [
    { file: "src/lib/admin/router-admin-service.ts", action: "route.disable" },
    { file: "src/lib/admin/dlq-admin-service.ts", action: "queue.dlq.redrive" },
    { file: "src/lib/admin/temporal-admin-service.ts", action: "temporal.workflow.cancel" },
  ];

  for (const { file, action } of cases) {
    test(`${file} calls requirePolicy("${action}") and catches PolicyDenied — never lets a real fault through as allow`, () => {
      const src = stripComments(read(file));
      assert.match(src, /from "@\/lib\/policy\/policy-gate"/);
      assert.match(src, new RegExp(`action:\\s*"${action.replace(/\./g, "\\.")}"`));
      assert.match(src, /catch \(caught\)/);
      assert.match(src, /if \(!\(caught instanceof PolicyDenied\)\) throw caught;/);
    });
  }
});

// ---------------------------------------------------------------------------
// Two-person: rejection, expiry, and action/target binding
// ---------------------------------------------------------------------------

describe("Phase 19 closure fix — two-person: rejection", () => {
  test("route.disable: a second admin rejecting the pending request leaves it permanently unsatisfied — retry never reaches setRouteEnabled", async () => {
    process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_req,user_rejector";
    try {
      const db = new FakeSupabaseClient();
      db.state.model_routes = [{ id: "44444444-4444-4444-8444-444444444444", enabled: true }];
      const first = await setAdminRouteEnabled(
        db as never,
        "user_req",
        "44444444-4444-4444-8444-444444444444",
        false,
        "incident",
        { assurance: VERIFIED, elevation: ELEVATED }
      );
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

      const rejection = await decidePrivilegedAction(db as never, {
        requestId: first.requestId,
        action: "route.disable",
        actorClerkUserId: "user_rejector",
        target: { type: "model_route", id: "44444444-4444-4444-8444-444444444444" },
        decision: "reject",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.deepEqual(rejection, { outcome: "REJECTED" });

      const retry = await setAdminRouteEnabled(
        db as never,
        "user_req",
        "44444444-4444-4444-8444-444444444444",
        false,
        "incident",
        { assurance: VERIFIED, elevation: ELEVATED },
        first.requestId
      );
      assert.equal(retry.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (retry.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
      assert.equal(retry.reasonCode, "two_person_rejected");
      assert.equal((db.state.model_routes[0] as { enabled: boolean }).enabled, true, "a rejected request must never reach the canonical owner");
    } finally {
      delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    }
  });

  test("queue.dlq.redrive: rejection is durably distinguishable from a still-pending request in the audit trail", async () => {
    process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_req,user_rejector";
    try {
      const db = new FakeSupabaseClient();
      const first = await executeAdminDlqRedrive(db as never, "user_req", "incident", { assurance: VERIFIED, elevation: ELEVATED });
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

      const rejection = await decidePrivilegedAction(db as never, {
        requestId: first.requestId,
        action: "queue.dlq.redrive",
        actorClerkUserId: "user_rejector",
        target: { type: "dlq_message", id: null },
        decision: "reject",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.deepEqual(rejection, { outcome: "REJECTED" });

      const events = (db.state.admin_privileged_action_events ?? []) as Array<{ request_id: string; event: string }>;
      assert.ok(events.some((e) => e.request_id === first.requestId && e.event === "rejected"));
    } finally {
      delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    }
  });
});

describe("Phase 19 closure fix — two-person: expiry", () => {
  test("temporal.workflow.cancel: a pending request older than PRIVILEGED_ACTION_REQUEST_TTL_SECONDS is expired, not silently still-pending — the retry says so, and a second admin can no longer approve it", async () => {
    process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_req,user_approver";
    try {
      const db = new FakeSupabaseClient();
      db.state.generations = [{ id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", clerk_user_id: "user_owner", status: "queued", metadata: null }];

      const first = await performAdminTemporalCancel(db as never, {
        generationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        adminActorId: "user_req",
        reasonCode: "operator_investigation",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
      });
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

      // Backdate the ONLY 'requested' event for this requestId well past the
      // TTL — simulating an operator who let the pending request go stale,
      // never a fabricated race.
      const events = db.state.admin_privileged_action_events as Array<{ request_id: string; event: string; occurred_at: string }>;
      const requested = events.find((e) => e.request_id === first.requestId && e.event === "requested");
      assert.ok(requested, "the requested event must exist to backdate");
      requested!.occurred_at = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago

      const staleApproval = await decidePrivilegedAction(db as never, {
        requestId: first.requestId,
        action: "temporal.workflow.cancel",
        actorClerkUserId: "user_approver",
        target: { type: "generation", id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.deepEqual(staleApproval, { outcome: "REQUEST_EXPIRED" });

      const retry = await performAdminTemporalCancel(db as never, {
        generationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        adminActorId: "user_req",
        reasonCode: "operator_investigation",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
        requestId: first.requestId,
      });
      assert.equal(retry.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (retry.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
      assert.equal(retry.reasonCode, "two_person_expired");
    } finally {
      delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    }
  });
});

describe("Phase 19 closure fix — two-person: approval bound to action + target", () => {
  test("an approval submitted against the right requestId but the WRONG action is refused, not silently applied to the original request", async () => {
    process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_req,user_approver";
    try {
      const db = new FakeSupabaseClient();
      const first = await executeAdminDlqRedrive(db as never, "user_req", "incident", { assurance: VERIFIED, elevation: ELEVATED });
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

      const mismatched = await decidePrivilegedAction(db as never, {
        requestId: first.requestId,
        action: "route.disable", // wrong — the real request is queue.dlq.redrive
        actorClerkUserId: "user_approver",
        target: { type: "model_route", id: "some-route" },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.deepEqual(mismatched, { outcome: "NO_MATCHING_REQUEST" });
    } finally {
      delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    }
  });

  test("an approval submitted against the right requestId and action but the WRONG target is refused", async () => {
    process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_req,user_approver";
    try {
      const db = new FakeSupabaseClient();
      db.state.model_routes = [{ id: "55555555-5555-4555-8555-555555555555", enabled: true }];
      const first = await setAdminRouteEnabled(
        db as never,
        "user_req",
        "55555555-5555-4555-8555-555555555555",
        false,
        "incident",
        { assurance: VERIFIED, elevation: ELEVATED }
      );
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

      const mismatched = await decidePrivilegedAction(db as never, {
        requestId: first.requestId,
        action: "route.disable",
        actorClerkUserId: "user_approver",
        target: { type: "model_route", id: "66666666-6666-4666-8666-666666666666" }, // wrong route id
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.deepEqual(mismatched, { outcome: "NO_MATCHING_REQUEST" });
    } finally {
      delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    }
  });
});

// ---------------------------------------------------------------------------
// The new "decide" route
// ---------------------------------------------------------------------------

describe("Phase 19 closure fix — POST /api/admin/privileged-actions/decide", () => {
  const routeText = stripComments(read("src/app/api/admin/privileged-actions/decide/route.ts"));

  test("requires requireAdminAccess, is CSRF-guarded, POST-only, durable_write, and never a GET", () => {
    assert.match(routeText, /requireAdminAccess/);
    assert.match(routeText, /guardPrivilegedMutation/);
    assert.match(routeText, /export async function POST/);
    assert.doesNotMatch(routeText, /export async function GET/);
    assert.match(routeText, /routeClass:\s*"durable_write"/);
  });

  test("never executes the underlying action — no route/DLQ/Temporal owner is imported here", () => {
    assert.doesNotMatch(
      routeText,
      /setRouteEnabled|redriveOneProviderDlqMessage|requestGenerationCancellation|recordCancelIntent/
    );
  });

  test("carries no sensitive payload — bounded fields only, decided by decidePrivilegedAction's own contract", () => {
    // Word-boundary matches only — "tier0-authorization" (the module this
    // route imports) is a benign filename substring match, not an Authorization
    // header or credential.
    assert.doesNotMatch(routeText, /\bprompt\b|\bpayload\b|\bAuthorization\s*:|\bcookie\b|\bsecret\b|\btoken\b/i);
  });
});

// ---------------------------------------------------------------------------
// Tier-0 / policy composition order — no single layer substitutes for another
// ---------------------------------------------------------------------------

describe("Phase 19 closure fix — composition: policy ALLOW is necessary but not sufficient", () => {
  test("evaluatePolicy alone allows route.disable for a route_admin with no risk/AI issues, but that is not authorization to execute — Tier-0 (role/step-up/two-person) still independently applies", () => {
    const decision = evaluatePolicy({
      action: "route.disable",
      actor: { id: "user_x", role: "route_admin", kind: "human" },
      tenantId: null,
      resource: { type: "model_route", id: "r-1" },
      risk: { temporarilyBlocked: false, adminReviewRequired: false, challengeRequired: false },
      approvalEvidence: { humanApproved: false },
      environment: "production",
      originClass: "server",
      correlationId: null,
    });
    assert.equal(decision.decision, "ALLOW");
    assert.equal(decision.reason, "allowed_two_person_enforced_downstream", "policy ALLOW for a two-person action says so explicitly — it never claims the threshold itself");
  });

  test("a role that passes policy but has no Tier-0 catalogue entry role is still refused by authorizeTier0Action — a policy ALLOW never bypasses Tier-0", async () => {
    const db = new FakeSupabaseClient();
    const result = await authorizeTier0Action(db as never, {
      requestId: randomUUID(),
      action: "route.disable",
      actorClerkUserId: "user_with_no_tier0_role",
      target: { type: "model_route", id: "r-1" },
      assurance: { state: "NOT_CONFIGURED", verifiedAt: null },
      elevation: { elevated: false, reasonCode: "no_elevation" },
      mode: "enforce",
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, "role_not_permitted");
  });
});

// ---------------------------------------------------------------------------
// Ownership preserved — no canonical owner replaced
// ---------------------------------------------------------------------------

describe("Phase 19 closure fix — ownership preserved", () => {
  test("setRouteEnabled itself (the Phase 7-B function this batch composes with) is untouched — no policy/Tier-0 call inside its own body", () => {
    const guard = stripComments(read("src/lib/routing/admin-route-service.ts"));
    const start = guard.indexOf("export async function setRouteEnabled(");
    const end = guard.indexOf("\nexport ", start + 1);
    const body = guard.slice(start, end === -1 ? undefined : end);
    assert.ok(start >= 0, "setRouteEnabled must exist in this file");
    assert.doesNotMatch(body, /requirePolicy|decidePrivilegedAction|authorizeTier0Action/, "the closure fix composes AROUND setRouteEnabled, never inside it");
  });

  test("tier0-action-catalogue.ts's route.disable/queue.dlq.redrive/temporal.workflow.cancel entries name their real canonical owner unchanged", () => {
    for (const action of ["route.disable", "queue.dlq.redrive", "temporal.workflow.cancel"]) {
      const entry = tier0ActionEntry(action);
      assert.ok(entry);
      assert.ok(entry!.owner.length > 0);
      assert.equal(entry!.requiresTwoPerson, true);
    }
  });
});
