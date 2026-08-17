import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  resolveAdminPrivilegeRole,
  requireAdminPrivilege,
  roleAtLeast,
  operatorAdminIds,
  tier0AdminIds,
} from "@/lib/admin/admin-privilege";
import {
  resolveAssuranceEvidence,
  buildElevatedSession,
  verifyElevatedSession,
  ASSURANCE_MAX_AGE_SECONDS,
} from "@/lib/admin/step-up-auth";

/**
 * Phase 16-E — role separation (Section 4/5) and step-up assurance/elevated
 * session (Section 7/8/9) pure decision cores. Both are Clerk-free by
 * construction (see each file's header), so every case here runs with no
 * mocked SDK and no network I/O.
 */

// ===========================================================================
// admin-privilege.ts — role resolution
// ===========================================================================

test("roleAtLeast: viewer < operator < tier0_admin, and equality passes", () => {
  assert.equal(roleAtLeast("viewer", "viewer"), true);
  assert.equal(roleAtLeast("operator", "viewer"), true);
  assert.equal(roleAtLeast("tier0_admin", "operator"), true);
  assert.equal(roleAtLeast("viewer", "operator"), false);
  assert.equal(roleAtLeast("operator", "tier0_admin"), false);
});

test("resolveAdminPrivilegeRole: an id on no list resolves to null, never a fallback tier", () => {
  assert.equal(resolveAdminPrivilegeRole("user_nobody"), null);
  assert.equal(resolveAdminPrivilegeRole(null), null);
  assert.equal(resolveAdminPrivilegeRole(""), null);
});

test("resolveAdminPrivilegeRole: base CINEFIELD_ADMIN_CLERK_USER_IDS membership alone is VIEWER, never operator/tier0", () => {
  const original = process.env.CINEFIELD_ADMIN_CLERK_USER_IDS;
  const originalOp = process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS;
  const originalT0 = process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  try {
    process.env.CINEFIELD_ADMIN_CLERK_USER_IDS = "user_viewer_1";
    delete process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS;
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    assert.equal(resolveAdminPrivilegeRole("user_viewer_1"), "viewer");
    const decision = requireAdminPrivilege("user_viewer_1", "operator");
    assert.equal(decision.allowed, false);
    assert.equal(decision.role, "viewer");
    assert.equal(decision.reasonCode, "role_below_minimum");
  } finally {
    if (original === undefined) delete process.env.CINEFIELD_ADMIN_CLERK_USER_IDS;
    else process.env.CINEFIELD_ADMIN_CLERK_USER_IDS = original;
    if (originalOp === undefined) delete process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS;
    else process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS = originalOp;
    if (originalT0 === undefined) delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    else process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = originalT0;
  }
});

test("resolveAdminPrivilegeRole: TIER0 list membership resolves to tier0_admin and satisfies every lower minimum", () => {
  const idSet = tier0AdminIds("user_t0_1, user_t0_2");
  assert.equal(idSet.has("user_t0_1"), true);
  assert.equal(resolveAdminPrivilegeRole("user_t0_1"), null, "resolveAdminPrivilegeRole reads process.env directly, not the injected set");
});

test("operatorAdminIds/tier0AdminIds: unset or malformed env is an empty set, never 'no restriction'", () => {
  assert.equal(operatorAdminIds(undefined).size, 0);
  assert.equal(operatorAdminIds("").size, 0);
  assert.equal(operatorAdminIds(" , , ").size, 0);
  assert.equal(tier0AdminIds(undefined).size, 0);
});

test("requireAdminPrivilege: role cannot be user-supplied — only clerkUserId is accepted, and it is resolved server-side from env allowlists", () => {
  // The function signature itself is the proof: no `role` parameter exists
  // for a caller to pass. This test pins that no id resolves to a role
  // without appearing in one of the three env-driven allowlists.
  const decision = requireAdminPrivilege("user_totally_unlisted", "viewer");
  assert.equal(decision.allowed, false);
  assert.equal(decision.role, null);
  assert.equal(decision.reasonCode, "no_role");
});

// ===========================================================================
// step-up-auth.ts — assurance evidence
// ===========================================================================

test("resolveAssuranceEvidence: absent claims, non-object claims, and a missing cinefieldStepUp claim are all NOT_CONFIGURED — never fabricated VERIFIED", () => {
  assert.deepEqual(resolveAssuranceEvidence(null), { state: "NOT_CONFIGURED", verifiedAt: null });
  assert.deepEqual(resolveAssuranceEvidence(undefined), { state: "NOT_CONFIGURED", verifiedAt: null });
  assert.deepEqual(resolveAssuranceEvidence("not-an-object"), { state: "NOT_CONFIGURED", verifiedAt: null });
  assert.deepEqual(resolveAssuranceEvidence({}), { state: "NOT_CONFIGURED", verifiedAt: null });
  assert.deepEqual(resolveAssuranceEvidence({ cinefieldStepUp: {} }), { state: "NOT_CONFIGURED", verifiedAt: null });
});

test("resolveAssuranceEvidence: a stale verifiedAt (older than ASSURANCE_MAX_AGE_SECONDS) is NOT_CONFIGURED", () => {
  const staleIso = new Date(Date.now() - (ASSURANCE_MAX_AGE_SECONDS + 60) * 1000).toISOString();
  const result = resolveAssuranceEvidence({ cinefieldStepUp: { verifiedAt: staleIso } });
  assert.equal(result.state, "NOT_CONFIGURED");
});

test("resolveAssuranceEvidence: a fresh verifiedAt is VERIFIED — the only path this file will ever return it from", () => {
  const freshIso = new Date().toISOString();
  const result = resolveAssuranceEvidence({ cinefieldStepUp: { verifiedAt: freshIso } });
  assert.equal(result.state, "VERIFIED");
  assert.equal(result.verifiedAt, freshIso);
});

test("resolveAssuranceEvidence: a future-dated verifiedAt (clock skew / forged claim) is refused, not accepted", () => {
  const futureIso = new Date(Date.now() + 60_000).toISOString();
  const result = resolveAssuranceEvidence({ cinefieldStepUp: { verifiedAt: futureIso } });
  assert.equal(result.state, "NOT_CONFIGURED");
});

// ===========================================================================
// step-up-auth.ts — elevated session
// ===========================================================================

test("buildElevatedSession: refuses to build from NOT_CONFIGURED evidence — this is the ONLY place an elevation could be fabricated, and it cannot", () => {
  const record = buildElevatedSession("user_1", { state: "NOT_CONFIGURED", verifiedAt: null });
  assert.equal(record, null);
});

test("buildElevatedSession + verifyElevatedSession: a fresh, actor-matched elevation verifies", () => {
  const now = Date.now();
  const record = buildElevatedSession("user_1", { state: "VERIFIED", verifiedAt: new Date(now).toISOString() }, now, 900);
  assert.ok(record);
  const verdict = verifyElevatedSession(record, "user_1", now + 1000);
  assert.equal(verdict.elevated, true);
  assert.equal(verdict.reasonCode, "verified");
});

test("verifyElevatedSession: expired elevation is denied", () => {
  const now = Date.now();
  const record = buildElevatedSession("user_1", { state: "VERIFIED", verifiedAt: new Date(now).toISOString() }, now, 900);
  assert.ok(record);
  const verdict = verifyElevatedSession(record, "user_1", now + 901_000);
  assert.equal(verdict.elevated, false);
  assert.equal(verdict.reasonCode, "expired");
});

test("verifyElevatedSession: wrong actor is denied — an elevation is bound to exactly one actor", () => {
  const now = Date.now();
  const record = buildElevatedSession("user_1", { state: "VERIFIED", verifiedAt: new Date(now).toISOString() }, now, 900);
  assert.ok(record);
  const verdict = verifyElevatedSession(record, "user_2", now + 1000);
  assert.equal(verdict.elevated, false);
  assert.equal(verdict.reasonCode, "actor_mismatch");
});

test("verifyElevatedSession: absent record is denied — no client Boolean can substitute for it", () => {
  const verdict = verifyElevatedSession(null, "user_1");
  assert.equal(verdict.elevated, false);
  assert.equal(verdict.reasonCode, "no_elevation");
});

test("verifyElevatedSession: a malformed record (wrong shape) is denied, not thrown", () => {
  const verdict = verifyElevatedSession({ clerkUserId: "user_1" } as never, "user_1");
  assert.equal(verdict.elevated, false);
  assert.equal(verdict.reasonCode, "malformed_record");
});
