import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { authorizeTier0Action } from "@/lib/admin/tier0-authorization";
import { verifyElevatedSession, buildElevatedSession } from "@/lib/admin/step-up-auth";
import { guardPrivilegedMutation } from "@/lib/security/privileged-mutation-guard";
import type { AssuranceEvidence } from "@/lib/admin/step-up-auth";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 16-E SECURITY FIX BATCH — the tests the closure audit's fail-open
 * defect demanded, that weren't already covered by the existing 16-E test
 * files (which this batch also updated in place — see
 * `phase-16e-tier0-authorization.e2e.test.ts`, `phase-16e-wired-actions.e2e.test.ts`,
 * `phase-16e-closure-end-to-end.e2e.test.ts`). This file adds: role-tier
 * denial through the full `authorizeTier0Action` chain, expired/wrong-actor
 * elevation through the full chain, the new `guardPrivilegedMutation` CSRF
 * boundary (direct + wired), and two boundary re-confirmations (no new
 * auth authority, audit append-only) specific to this fix.
 */

const NOT_CONFIGURED: AssuranceEvidence = { state: "NOT_CONFIGURED", verifiedAt: null };
const VERIFIED: AssuranceEvidence = { state: "VERIFIED", verifiedAt: new Date().toISOString() };

function envelope(db: FakeSupabaseClient) {
  return db as never;
}

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PRIVILEGED_MUTATION_ROUTES = [
  "src/app/api/admin/dlq/redrive/route.ts",
  "src/app/api/admin/router/disable/route.ts",
  "src/app/api/admin/temporal/[generationId]/cancel/route.ts",
  "src/app/api/admin/moderation/release/route.ts",
  "src/app/api/admin/queue-health/bullmq-retry/route.ts",
];

// ===========================================================================
// Role tier — items 7/8: viewer and operator must never satisfy a
// HIGH_RISK_TIER0 action's minimumRole, through the real decision function.
// ===========================================================================

test("authorizeTier0Action: a VIEWER (base bootstrap allowlist only) cannot execute a HIGH_RISK_TIER0 action, in any mode", async () => {
  process.env.CINEFIELD_ADMIN_CLERK_USER_IDS = "user_viewer_only";
  try {
    for (const mode of [undefined, "shadow" as const, "enforce" as const]) {
      const db = new FakeSupabaseClient();
      const decision = await authorizeTier0Action(envelope(db), {
        requestId: randomUUID(),
        action: "queue.dlq.redrive",
        actorClerkUserId: "user_viewer_only",
        target: { type: "dlq_message" },
        assurance: NOT_CONFIGURED,
        elevation: { elevated: false, reasonCode: "no_elevation" },
        ...(mode ? { mode } : {}),
      });
      assert.equal(decision.allowed, false, `viewer must be refused (mode=${mode ?? "default"})`);
      assert.equal(decision.reasonCode, "role_not_permitted");
      assert.equal(decision.role, "viewer");
    }
  } finally {
    delete process.env.CINEFIELD_ADMIN_CLERK_USER_IDS;
  }
});

test("authorizeTier0Action: an OPERATOR cannot execute a HIGH_RISK_TIER0 action (minimumRole tier0_admin), in any mode — operator only satisfies OPERATOR_MUTATION-tier actions", async () => {
  process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS = "user_operator_only";
  try {
    for (const mode of [undefined, "shadow" as const, "enforce" as const]) {
      const db = new FakeSupabaseClient();
      const decision = await authorizeTier0Action(envelope(db), {
        requestId: randomUUID(),
        action: "route.disable",
        actorClerkUserId: "user_operator_only",
        target: { type: "model_route", id: "route-1" },
        assurance: NOT_CONFIGURED,
        elevation: { elevated: false, reasonCode: "no_elevation" },
        ...(mode ? { mode } : {}),
      });
      assert.equal(decision.allowed, false, `operator must be refused for a tier0_admin-minimum action (mode=${mode ?? "default"})`);
      assert.equal(decision.reasonCode, "role_not_permitted");
      assert.equal(decision.role, "operator");
    }

    // The SAME operator CAN satisfy an OPERATOR_MUTATION-tier action (no
    // step-up required) — proves the role ladder discriminates correctly
    // rather than blanket-refusing every actor.
    const db = new FakeSupabaseClient();
    const decision = await authorizeTier0Action(envelope(db), {
      requestId: randomUUID(),
      action: "queue.bullmq.retry",
      actorClerkUserId: "user_operator_only",
      target: { type: "bullmq_job", id: "job-1" },
      assurance: NOT_CONFIGURED,
      elevation: { elevated: false, reasonCode: "no_elevation" },
    });
    assert.equal(decision.allowed, true, "operator satisfies an OPERATOR_MUTATION-tier action");
  } finally {
    delete process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS;
  }
});

// ===========================================================================
// Elevation edge cases — items 10/11, through the full authorization chain
// (verifyElevatedSession's own unit coverage already exists in
// phase-16e-admin-privilege.e2e.test.ts; this proves the SAME verdicts
// correctly deny at the authorizeTier0Action layer, not just in isolation).
// ===========================================================================

test("authorizeTier0Action: a tier0_admin with an EXPIRED elevation cannot execute — expiry produces elevated:false upstream, and that alone denies here", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0_expired";
  try {
    const built = buildElevatedSession("user_t0_expired", VERIFIED, Date.now() - 1_000_000);
    assert.ok(built);
    const verdict = verifyElevatedSession(built, "user_t0_expired", Date.now());
    assert.equal(verdict.elevated, false);
    assert.equal(verdict.reasonCode, "expired");

    const db = new FakeSupabaseClient();
    const decision = await authorizeTier0Action(envelope(db), {
      requestId: randomUUID(),
      action: "queue.dlq.redrive",
      actorClerkUserId: "user_t0_expired",
      target: { type: "dlq_message" },
      assurance: VERIFIED,
      elevation: verdict,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, "step_up_not_elevated");
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("authorizeTier0Action: an elevation record bound to a DIFFERENT actor cannot execute — a tier0_admin cannot borrow someone else's elevation", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0_a,user_t0_b";
  try {
    const built = buildElevatedSession("user_t0_a", VERIFIED);
    assert.ok(built);
    // user_t0_b attempts to use user_t0_a's elevation record.
    const verdict = verifyElevatedSession(built, "user_t0_b");
    assert.equal(verdict.elevated, false);
    assert.equal(verdict.reasonCode, "actor_mismatch");

    const db = new FakeSupabaseClient();
    const decision = await authorizeTier0Action(envelope(db), {
      requestId: randomUUID(),
      action: "queue.dlq.redrive",
      actorClerkUserId: "user_t0_b",
      target: { type: "dlq_message" },
      assurance: VERIFIED,
      elevation: verdict,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, "step_up_not_elevated");
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

// ===========================================================================
// CSRF guard — items 21-25/27, direct unit coverage of the new module.
// ===========================================================================

function jsonRequest(url: string, headers: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers, body: "{}" });
}

test("guardPrivilegedMutation: a valid same-origin JSON POST passes through (returns null)", () => {
  const req = jsonRequest("https://cinefield.example.com/api/admin/dlq/redrive", {
    "content-type": "application/json",
    origin: "https://cinefield.example.com",
  });
  assert.equal(guardPrivilegedMutation(req), null);
});

test("guardPrivilegedMutation: a charset-suffixed application/json content type still passes", () => {
  const req = jsonRequest("https://cinefield.example.com/api/admin/dlq/redrive", {
    "content-type": "application/json; charset=utf-8",
    origin: "https://cinefield.example.com",
  });
  assert.equal(guardPrivilegedMutation(req), null);
});

test("guardPrivilegedMutation: a foreign Origin is rejected with 403", () => {
  const req = jsonRequest("https://cinefield.example.com/api/admin/dlq/redrive", {
    "content-type": "application/json",
    origin: "https://attacker.example.net",
  });
  const result = guardPrivilegedMutation(req);
  assert.ok(result);
  assert.equal(result.status, 403);
});

test("guardPrivilegedMutation: a malformed Origin header is rejected with 403", () => {
  const req = jsonRequest("https://cinefield.example.com/api/admin/dlq/redrive", {
    "content-type": "application/json",
    origin: "not-a-valid-origin",
  });
  const result = guardPrivilegedMutation(req);
  assert.ok(result);
  assert.equal(result.status, 403);
});

test("guardPrivilegedMutation: a missing Origin header is rejected with 403 — fails closed rather than tolerating an unusual client", () => {
  const req = jsonRequest("https://cinefield.example.com/api/admin/dlq/redrive", {
    "content-type": "application/json",
  });
  const result = guardPrivilegedMutation(req);
  assert.ok(result);
  assert.equal(result.status, 403);
});

test("guardPrivilegedMutation: the cross-site text/plain-declared JSON trick is rejected with 415 — the exact gap the closure audit named", () => {
  const req = jsonRequest("https://cinefield.example.com/api/admin/dlq/redrive", {
    "content-type": "text/plain",
    origin: "https://attacker.example.net",
  });
  const result = guardPrivilegedMutation(req);
  assert.ok(result);
  assert.equal(result.status, 415);
});

test("guardPrivilegedMutation: an unsupported Content-Type is rejected with 415 even from the correct origin", () => {
  const req = jsonRequest("https://cinefield.example.com/api/admin/dlq/redrive", {
    "content-type": "multipart/form-data",
    origin: "https://cinefield.example.com",
  });
  const result = guardPrivilegedMutation(req);
  assert.ok(result);
  assert.equal(result.status, 415);
});

test("guardPrivilegedMutation: matches on protocol+host, ignoring a differing port only when both are actually equal — a same-host different-port origin is still rejected", () => {
  const req = jsonRequest("https://cinefield.example.com/api/admin/dlq/redrive", {
    "content-type": "application/json",
    origin: "https://cinefield.example.com:8443",
  });
  const result = guardPrivilegedMutation(req);
  assert.ok(result, "a differing port is a differing origin per the URL spec — must be rejected");
  assert.equal(result.status, 403);
});

test("guardPrivilegedMutation: works with no hardcoded domain — localhost origin against a localhost request URL passes", () => {
  const req = jsonRequest("http://localhost:3000/api/admin/dlq/redrive", {
    "content-type": "application/json",
    origin: "http://localhost:3000",
  });
  assert.equal(guardPrivilegedMutation(req), null, "no production domain is hardcoded — the guard derives its expectation from the request itself");
});

// ===========================================================================
// CSRF guard wiring — every privileged mutation route calls the guard
// BEFORE requireAdminAccess(), and CSRF passing is not a substitute for
// real auth (item 27: missing/invalid auth still denied independently).
// ===========================================================================

test("every privileged mutation route calls guardPrivilegedMutation before requireAdminAccess() — CSRF is additive, never a bypass of Clerk auth", () => {
  for (const rel of PRIVILEGED_MUTATION_ROUTES) {
    const text = stripComments(read(rel));
    assert.match(text, /guardPrivilegedMutation/, `${rel} must call the canonical CSRF guard`);
    const csrfIndex = text.indexOf("guardPrivilegedMutation(request)");
    const authIndex = text.indexOf("requireAdminAccess()");
    assert.ok(csrfIndex >= 0 && authIndex >= 0, `${rel}: both calls must exist`);
    assert.ok(csrfIndex < authIndex, `${rel}: CSRF guard must run before requireAdminAccess()`);
  }
});

test("guardPrivilegedMutation does not know about Clerk, roles, or sessions — a valid same-origin JSON request from an unauthenticated caller must still fail at requireAdminAccess(), never at this guard", () => {
  const guardText = stripComments(read("src/lib/security/privileged-mutation-guard.ts"));
  assert.doesNotMatch(guardText, /clerk|auth\(\)|sessionClaims|requireAdminAccess/i, "the guard must stay identity-free — a second authentication system is exactly what this fix must not become");
});

test("no privileged mutation route is reachable via GET — a mutation is never a plain navigation/link (item 26)", () => {
  for (const rel of PRIVILEGED_MUTATION_ROUTES) {
    const text = stripComments(read(rel));
    assert.doesNotMatch(text, /export async function GET/, rel);
  }
});

// ===========================================================================
// Boundary re-confirmations specific to this fix
// ===========================================================================

test("no new authentication/session authority was introduced — the CSRF guard and the fail-closed fix touch no cookie/session-issuing code", () => {
  const guardText = stripComments(read("src/lib/security/privileged-mutation-guard.ts"));
  const tier0Text = stripComments(read("src/lib/admin/tier0-authorization.ts"));
  for (const text of [guardText, tier0Text]) {
    assert.doesNotMatch(text, /cookies\(\)\.set|new Response.*Set-Cookie|createSession|signJwt/i);
  }
});

test("audit append-only semantics are preserved by this fix — no new caller of admin_privileged_action_events performs .update( or .delete(", () => {
  const filesToCheck = [
    "src/lib/admin/tier0-authorization.ts",
    "src/lib/security/privileged-mutation-guard.ts",
    "src/app/api/admin/dlq/redrive/route.ts",
    "src/app/api/admin/router/disable/route.ts",
    "src/app/api/admin/temporal/[generationId]/cancel/route.ts",
  ];
  for (const rel of filesToCheck) {
    const text = stripComments(read(rel));
    assert.doesNotMatch(text, /admin_privileged_action_events["'`]\)\s*\.\s*(update|delete)\(/i, rel);
  }
});

test("CINEFIELD_TIER0_ENFORCEMENT_MODE no longer has any code path that converts a deny into allowed:true — structural pin on the fixed source", () => {
  const text = stripComments(read("src/lib/admin/tier0-authorization.ts"));
  assert.doesNotMatch(text, /allowed:\s*!enforce/, "the exact fail-open expression from the pre-fix version must not reappear");
  assert.doesNotMatch(text, /allowed_shadow_mode/, "the fabricated shadow-allow reason code must not reappear");
  // Every `deny(` call site returns a literal `allowed: false` inside the function body.
  const denyBody = text.slice(text.indexOf("const deny ="), text.indexOf("if (!role"));
  assert.match(denyBody, /allowed:\s*false/);
});
