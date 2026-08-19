import { strict as assert } from "node:assert";
import { test } from "node:test";
import { setFeatureFlagAdmin } from "./feature-flag-admin-service";
import { recordPrivilegedActionApproval } from "./privileged-action-audit";
import type { AssuranceEvidence, ElevationVerdict } from "./step-up-auth";
import { FakeSupabaseClient } from "../../test/e2e/fake-supabase";

/**
 * Phase 21 corrective batch — proves the caller-supplied `reason` actually
 * reaches the durable `feature_flag_audit.reason_code` column, not merely
 * that `setFeatureFlagAdmin`'s signature declares a `reason: string`
 * parameter. `FakeSupabaseClient.setFeatureFlag()` mirrors the real
 * `set_feature_flag()` RPC's write, so asserting against
 * `db.state.feature_flag_audit` is asserting against exactly the shape the
 * real RPC argument (`p_reason_code`) would have produced.
 */

const VERIFIED: AssuranceEvidence = { state: "VERIFIED", verifiedAt: new Date().toISOString() };
const ELEVATED: ElevationVerdict = { elevated: true, reasonCode: "verified" };

function envelope(db: FakeSupabaseClient) {
  return db as never;
}

function lastAuditRow(db: FakeSupabaseClient, flagKey: string) {
  const rows = (db.state.feature_flag_audit ?? []) as Record<string, unknown>[];
  const matching = rows.filter((r) => r.flag_key === flagKey);
  return matching[matching.length - 1];
}

test("operator flag set: the caller's reason reaches feature_flag_audit.reason_code", async () => {
  const db = new FakeSupabaseClient();
  process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS = "user_op_1";
  try {
    const result = await setFeatureFlagAdmin(
      envelope(db),
      "user_op_1",
      "uploads.enabled",
      false,
      "incident-42: abuse spike, disabling uploads while we investigate",
      undefined,
      null
    );
    assert.equal(result.outcome, "APPLIED");

    const audit = lastAuditRow(db, "uploads.enabled");
    assert.ok(audit, "an audit row must exist");
    assert.equal(audit.reason_code, "incident-42: abuse spike, disabling uploads while we investigate");
    assert.equal(audit.new_value, false);
  } finally {
    delete process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS;
  }
});

test("Tier-0 flag set (maintenance_mode): the caller's reason reaches feature_flag_audit.reason_code", async () => {
  const db = new FakeSupabaseClient();
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0_1";
  try {
    const result = await setFeatureFlagAdmin(
      envelope(db),
      "user_t0_1",
      "maintenance_mode",
      true,
      "planned DB migration window",
      undefined,
      null,
      { assurance: VERIFIED, elevation: ELEVATED }
    );
    assert.equal(result.outcome, "APPLIED");

    const audit = lastAuditRow(db, "maintenance_mode");
    assert.ok(audit);
    assert.equal(audit.reason_code, "planned DB migration window");
    assert.equal(audit.new_value, true);
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("release_stage -> \"public\" (two-person): the caller's reason reaches feature_flag_audit.reason_code only after the second, distinct approval", async () => {
  const db = new FakeSupabaseClient();
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0_requester,user_t0_approver_a,user_t0_approver_b";
  try {
    const reason = "GA launch: all 12 security gates closed, real Stripe key rotated in";

    const first = await setFeatureFlagAdmin(
      envelope(db),
      "user_t0_requester",
      "release_stage",
      "public",
      reason,
      undefined,
      null,
      { assurance: VERIFIED, elevation: ELEVATED }
    );
    assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED", "release_stage.activate_public requires two-person — one call cannot complete it");
    if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
    const requestId = first.requestId;

    // No audit row yet — the write must not happen before the second approval.
    assert.equal(lastAuditRow(db, "release_stage"), undefined);

    const firstApproval = await recordPrivilegedActionApproval(envelope(db), {
      requestId,
      actorClerkUserId: "user_t0_approver_a",
      actionType: "release_stage.activate_public",
      targetType: "feature_flag",
      targetId: "release_stage",
      securityClassification: "HIGH_RISK_TIER0",
    });
    assert.equal(firstApproval.recorded, true);
    if (firstApproval.recorded) assert.equal(firstApproval.satisfied, false, "one approval is not yet the required two");

    const secondApproval = await recordPrivilegedActionApproval(envelope(db), {
      requestId,
      actorClerkUserId: "user_t0_approver_b",
      actionType: "release_stage.activate_public",
      targetType: "feature_flag",
      targetId: "release_stage",
      securityClassification: "HIGH_RISK_TIER0",
    });
    assert.equal(secondApproval.recorded, true);
    if (secondApproval.recorded) assert.equal(secondApproval.satisfied, true, "two DISTINCT approvers satisfy the threshold");

    const retry = await setFeatureFlagAdmin(
      envelope(db),
      "user_t0_requester",
      "release_stage",
      "public",
      reason,
      undefined,
      null,
      { assurance: VERIFIED, elevation: ELEVATED },
      requestId
    );
    assert.equal(retry.outcome, "APPLIED");

    const audit = lastAuditRow(db, "release_stage");
    assert.ok(audit);
    assert.equal(audit.reason_code, reason);
    assert.equal(audit.new_value, "public");
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("rollback (re-invoking the same service with the flag's own captured rollback value) persists its own reason too — there is no separate rollback code path to diverge", async () => {
  const db = new FakeSupabaseClient();
  process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS = "user_op_1";
  try {
    const applied = await setFeatureFlagAdmin(envelope(db), "user_op_1", "uploads.enabled", false, "incident-42: disable uploads", undefined, null);
    assert.equal(applied.outcome, "APPLIED");
    if (applied.outcome !== "APPLIED") return;
    // First-ever write for this flag in this fresh db: there was no PRIOR
    // row, so previousValue is correctly null — the ROLLBACK target
    // (uploads.enabled's own registered default, true) was still captured
    // separately as feature_flags.rollback_value; confirm that here.
    assert.equal(applied.previousValue, null);
    const rollbackTarget = (db.state.feature_flags ?? []).find((f) => f.flag_key === "uploads.enabled")?.rollback_value;
    assert.equal(rollbackTarget, true);

    const rolledBack = await setFeatureFlagAdmin(
      envelope(db),
      "user_op_1",
      "uploads.enabled",
      rollbackTarget as boolean,
      "incident-42 resolved: re-enabling uploads",
      undefined,
      null
    );
    assert.equal(rolledBack.outcome, "APPLIED");

    const audit = lastAuditRow(db, "uploads.enabled");
    assert.ok(audit);
    assert.equal(audit.reason_code, "incident-42 resolved: re-enabling uploads");
    assert.equal(audit.new_value, true);
    assert.equal(audit.previous_value, false, "the rollback's own previous_value is the value it is reverting FROM");
  } finally {
    delete process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS;
  }
});

test("an empty/whitespace-only reason is still refused — persistence was fixed without loosening validation", async () => {
  const db = new FakeSupabaseClient();
  process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS = "user_op_1";
  try {
    const emptyResult = await setFeatureFlagAdmin(envelope(db), "user_op_1", "uploads.enabled", false, "", undefined, null);
    assert.equal(emptyResult.outcome, "INVALID_TARGET");

    const whitespaceResult = await setFeatureFlagAdmin(envelope(db), "user_op_1", "uploads.enabled", false, "   ", undefined, null);
    assert.equal(whitespaceResult.outcome, "INVALID_TARGET");

    assert.equal((db.state.feature_flag_audit ?? []).length, 0, "no audit row for a refused mutation");
  } finally {
    delete process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS;
  }
});

test("an over-length reason is refused, matching FLAG_SET_REASON_MAX_LENGTH", async () => {
  const db = new FakeSupabaseClient();
  process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS = "user_op_1";
  try {
    const tooLong = "x".repeat(501);
    const result = await setFeatureFlagAdmin(envelope(db), "user_op_1", "uploads.enabled", false, tooLong, undefined, null);
    assert.equal(result.outcome, "INVALID_TARGET");
    assert.equal((db.state.feature_flag_audit ?? []).length, 0);
  } finally {
    delete process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS;
  }
});
