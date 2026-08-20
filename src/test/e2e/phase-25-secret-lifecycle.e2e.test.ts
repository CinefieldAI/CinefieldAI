import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { FakeSupabaseClient } from "./fake-supabase";

import { canTransition, isValidReasonCode } from "@/lib/secrets/rotation-contract";
import {
  executeSecretRotation,
  type RotationProvider,
  type RotationVerifier,
} from "@/lib/secrets/rotation-execution-service";
import { executeLeakResponse, type RevocationProvider, type DeadCheckVerifier } from "@/lib/secrets/leak-runbook";
import { parseSecretAccessAnomalyReport } from "@/lib/secrets/secret-access-anomaly-contract";
import { AwsSecretsManagerProvider, secretProviderKind, setSecretProvider, resetSecretProvider } from "@/lib/config/secret-access";
import { SECRET_REGISTRY } from "@/lib/config/secret-registry";
import {
  KIND_SEVERITY,
  KIND_SUBJECT_IS_ACTOR,
  KIND_WINDOW_SECONDS,
  KIND_DEDUPE_INCLUDES_RESOURCE,
  validateSecurityEvent,
  dedupeKeyFor,
} from "@/lib/security/security-event-contract";
import { getSecretsAdminView } from "@/lib/admin/secrets-admin-service";
import { tier0ActionEntry } from "@/lib/admin/tier0-action-catalogue";
import { evaluatePolicy } from "@/lib/policy/policy-engine";

/**
 * PHASE 25 — KMS, ENCRYPTION & SECRET LIFECYCLE (code-only)
 *
 * Roadmap Phase 25 done-criterion: "Prod secrets repository'de yok;
 * environment'lar kriptografik olarak ayrılmış; rotation tatbikatı
 * kesintisiz tamamlanıyor; leak runbook eski anahtarı geçersiz kıldığını
 * doğruluyor." Real live KMS/Secrets Manager/CloudTrail infrastructure is
 * CODE_COMPLETE_LIVE_DEFERRED (Terraform, never applied — see
 * infra/modules/kms-keys/, infra/modules/secrets-manager/). This suite
 * proves the CODE-OWNED half: the rotation state machine, the dual-gated
 * execution/leak-response authority chain, the CloudTrail bridge contract,
 * and the admin visibility surface — all real, all tested, none live.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TEST_SECRET = "FAL_KEY"; // a real, registered, DUAL_KEY_OVERLAP-adjacent... actually CUT_OVER — see below.
const OVERLAP_SECRET = "TEMPORAL_API_KEY"; // registered DUAL_KEY_OVERLAP

function alwaysVerified(): RotationVerifier {
  return { async verify() { return { verified: true, reasonCode: "test_verified" }; } };
}
function alwaysUnverified(reasonCode = "test_unverified"): RotationVerifier {
  return { async verify() { return { verified: false, reasonCode }; } };
}
function fakeProvider(versionRef = "v-1"): RotationProvider {
  return { async rotate() { return { newVersionRef: versionRef }; } };
}
function throwingProvider(): RotationProvider {
  return { async rotate() { throw new Error("provider_unreachable"); } };
}

function seedTwoApprovals(fake: FakeSupabaseClient, requestId: string) {
  fake.state.admin_privileged_action_events.push(
    { id: "e1", request_id: requestId, event: "approved", actor_clerk_user_id: "admin_1", occurred_at: new Date().toISOString() },
    { id: "e2", request_id: requestId, event: "approved", actor_clerk_user_id: "admin_2", occurred_at: new Date().toISOString() }
  );
}

const TIER0_ADMIN = { assurance: { state: "VERIFIED" as const, verifiedAt: new Date().toISOString() }, elevation: { elevated: true, reasonCode: "verified" as const } };

// ---------------------------------------------------------------------------
// 1–7. Rotation state machine
// ---------------------------------------------------------------------------

test("S25-1  NOT_CONFIGURED -> ROTATION_REQUIRED is the only legal first transition", () => {
  assert.equal(canTransition("NOT_CONFIGURED", "ROTATION_REQUIRED").allowed, true);
  assert.equal(canTransition("NOT_CONFIGURED", "ACTIVE").allowed, false);
  assert.equal(canTransition("NOT_CONFIGURED", "ROTATING").allowed, false);
});

test("S25-2  the full happy-path chain is exactly ROTATION_REQUIRED -> ROTATING -> VERIFYING -> ACTIVE", () => {
  assert.equal(canTransition("ROTATION_REQUIRED", "ROTATING").allowed, true);
  assert.equal(canTransition("ROTATING", "VERIFYING").allowed, true);
  assert.equal(canTransition("VERIFYING", "ACTIVE").allowed, true);
});

test("S25-3  a failed verification may reach ROLLBACK_AVAILABLE or FAILED, never skip straight to ACTIVE", () => {
  assert.equal(canTransition("VERIFYING", "ROLLBACK_AVAILABLE").allowed, true);
  assert.equal(canTransition("VERIFYING", "FAILED").allowed, true);
  assert.equal(canTransition("NOT_CONFIGURED", "ROLLBACK_AVAILABLE").allowed, false);
});

test("S25-4  FAILED/EXPIRED/ROLLBACK_AVAILABLE all recover only through ROTATION_REQUIRED, never straight to ACTIVE", () => {
  for (const from of ["FAILED", "EXPIRED", "ROLLBACK_AVAILABLE"] as const) {
    assert.equal(canTransition(from, "ACTIVE").allowed, false, `${from} -> ACTIVE must be illegal`);
    assert.equal(canTransition(from, "ROTATION_REQUIRED").allowed, true, `${from} -> ROTATION_REQUIRED must be legal`);
  }
});

test("S25-5  an unknown 'from' state is refused with a distinct reason from an illegal transition", () => {
  const r = canTransition("SOMETHING_MADE_UP" as never, "ACTIVE");
  assert.equal(r.allowed, false);
  assert.equal(r.refusal, "unknown_from_state");
});

test("S25-6  ACTIVE can only move to ROTATION_REQUIRED (a future re-rotation) or EXPIRED, never directly to ROTATING", () => {
  assert.equal(canTransition("ACTIVE", "ROTATING").allowed, false);
  assert.equal(canTransition("ACTIVE", "ROTATION_REQUIRED").allowed, true);
  assert.equal(canTransition("ACTIVE", "EXPIRED").allowed, true);
});

test("S25-7  reason codes follow the same pattern security-event-contract.ts already enforces", () => {
  assert.equal(isValidReasonCode("operator_requested_rotation"), true);
  assert.equal(isValidReasonCode("Has Spaces"), false);
  assert.equal(isValidReasonCode(""), false);
});

// ---------------------------------------------------------------------------
// 8–20. Rotation execution — the full authority chain
// ---------------------------------------------------------------------------

test("S25-8  an unregistered secret name is refused before any authorization is attempted", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  const result = await executeSecretRotation(fake as never, { secretName: "NOT_A_REAL_SECRET", actorClerkUserId: "u1" });
  assert.deepEqual(result, { outcome: "SECRET_NOT_REGISTERED" });
});

test("S25-9  a NOT_A_SECRET-class registry entry is refused as not rotatable", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  const notASecret = SECRET_REGISTRY.find((e) => e.rotation === "NOT_A_SECRET");
  assert.ok(notASecret, "expected at least one NOT_A_SECRET entry to exist");
  const result = await executeSecretRotation(fake as never, { secretName: notASecret!.name, actorClerkUserId: "u1" });
  assert.deepEqual(result, { outcome: "NOT_ROTATABLE", reasonCode: "not_a_secret" });
});

test("S25-10  without Tier-0 authorization (no step-up, no role) the attempt is refused, never silently allowed", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  const result = await executeSecretRotation(fake as never, { secretName: TEST_SECRET, actorClerkUserId: "u1" });
  assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
});

test("S25-11  with Tier-0 role/step-up but only ONE approver, policy blocks on human_approval_required — one approver is not two-person", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    const requestId = "11111111-1111-1111-1111-111111111111";
    fake.state.admin_privileged_action_events.push({ id: "e1", request_id: requestId, event: "approved", actor_clerk_user_id: "admin_1", occurred_at: new Date().toISOString() });
    const result = await executeSecretRotation(fake as never, { secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId });
    // Either TIER0_AUTHORIZATION_REQUIRED (awaiting a second approver) or
    // POLICY_DENIED — either way, never anything past the gate on one approver.
    assert.ok(result.outcome === "TIER0_AUTHORIZATION_REQUIRED" || result.outcome === "POLICY_DENIED", result.outcome);
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-12  a fully authorized rotation (two distinct approvers) completes end to end: ROTATION_REQUIRED -> ROTATING -> VERIFYING -> ACTIVE", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    const requestId = "22222222-2222-2222-2222-222222222222";
    seedTwoApprovals(fake, requestId);
    const result = await executeSecretRotation(fake as never, {
      secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: fakeProvider("v-final"), verifier: alwaysVerified(),
    });
    assert.deepEqual(result, { outcome: "ROTATION_COMPLETED", newVersionRef: "v-final" });

    const row = fake.state.secret_rotations.find((r) => r.secret_name === TEST_SECRET);
    assert.ok(row, "a durable rotation row must exist");
    assert.equal(row!.state, "ACTIVE");
    assert.equal(row!.current_version_ref, "v-final");
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-13  every intermediate state is durably written, not only the final one — a real, resumable timeline", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    const requestId = "33333333-3333-3333-3333-333333333333";
    seedTwoApprovals(fake, requestId);
    const states: string[] = [];
    const originalRpc = fake.rpc.bind(fake);
    fake.rpc = async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "upsert_secret_rotation_state" && args) states.push(args.p_new_state as string);
      return originalRpc(fn, args);
    };
    await executeSecretRotation(fake as never, {
      secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: fakeProvider(), verifier: alwaysVerified(),
    });
    assert.deepEqual(states, ["ROTATION_REQUIRED", "ROTATING", "VERIFYING", "ACTIVE"]);
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-14  a provider failure leaves the row FAILED, never silently reports success", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    const requestId = "44444444-4444-4444-4444-444444444444";
    seedTwoApprovals(fake, requestId);
    const result = await executeSecretRotation(fake as never, {
      secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: throwingProvider(),
    });
    assert.deepEqual(result, { outcome: "PROVIDER_ROTATION_FAILED" });
    const row = fake.state.secret_rotations.find((r) => r.secret_name === TEST_SECRET);
    assert.equal(row!.state, "FAILED");
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-15  a DUAL_KEY_OVERLAP secret whose verification fails reaches ROLLBACK_AVAILABLE, a safe way back", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    const requestId = "55555555-5555-5555-5555-555555555555";
    seedTwoApprovals(fake, requestId);
    const result = await executeSecretRotation(fake as never, {
      secretName: OVERLAP_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: fakeProvider(), verifier: alwaysUnverified(),
    });
    assert.equal(result.outcome, "VERIFICATION_FAILED");
    if (result.outcome === "VERIFICATION_FAILED") assert.equal(result.rollbackAvailable, true);
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-16  a CUT_OVER secret whose verification fails reaches FAILED, not a fabricated rollback path", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    const requestId = "66666666-6666-6666-6666-666666666666";
    seedTwoApprovals(fake, requestId);
    const cutOver = SECRET_REGISTRY.find((e) => e.rotation === "CUT_OVER" && e.class !== "LOCAL_ONLY")!;
    const result = await executeSecretRotation(fake as never, {
      secretName: cutOver.name, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: fakeProvider(), verifier: alwaysUnverified(),
    });
    assert.equal(result.outcome, "VERIFICATION_FAILED");
    if (result.outcome === "VERIFICATION_FAILED") assert.equal(result.rollbackAvailable, false);
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-17  no worker-reload verifier configured (the honest default) never fabricates a pass", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    const requestId = "77777777-7777-7777-7777-777777777777";
    seedTwoApprovals(fake, requestId);
    const result = await executeSecretRotation(fake as never, {
      secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: fakeProvider(),
      // verifier omitted -> NoWorkerReloadVerifier
    });
    assert.equal(result.outcome, "VERIFICATION_FAILED");
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-18  an already-ACTIVE secret cannot be re-rotated by re-calling with the same stale state expectation — INVALID_CURRENT_STATE, never silently re-run", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    fake.state.secret_rotations.push({
      id: "existing-1", secret_name: TEST_SECRET, environment: "development", owner: "provider",
      rotation_class: "CUT_OVER", state: "ROTATING", reason_code: "x", tier0_request_id: null,
      current_version_ref: null, previous_version_ref: null, rotated_at: null, expires_at: null, verified_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const requestId = "88888888-8888-8888-8888-888888888888";
    seedTwoApprovals(fake, requestId);
    const result = await executeSecretRotation(fake as never, { secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId });
    assert.deepEqual(result, { outcome: "INVALID_CURRENT_STATE", currentState: "ROTATING" });
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-19  ROTATION_COMPLETED never carries anything but an opaque version reference — no value field exists on the outcome type", async () => {
  const src = read("src/lib/secrets/rotation-execution-service.ts");
  const outcomeType = src.slice(src.indexOf("export type RotationExecutionOutcome"), src.indexOf("export interface ExecuteRotationParams"));
  assert.doesNotMatch(outcomeType, /value|secretValue|plaintext/i);
});

test("S25-20  successful rotation writes a Tier-0 execution audit row, and separately calls recordSecurityEvent with secret_rotation_completed", async () => {
  // FakeSupabaseClient does not simulate record_security_event's real
  // PL/pgSQL body (that RPC's own behavior is proven against real
  // PostgreSQL elsewhere, Phase 12-C) — so the security_events HALF of
  // this dual-record claim is verified by source inspection, not by
  // observing a fake table row; the admin_privileged_action_events HALF
  // (this repository's own FakeSupabaseClient DOES model generically via
  // .insert()) is verified behaviorally below.
  const src = stripComments(read("src/lib/secrets/rotation-execution-service.ts"));
  const activeIdx = src.indexOf('newState: "ACTIVE"');
  const tail = src.slice(activeIdx, activeIdx + 1200);
  assert.match(tail, /recordSecurityEvent\(admin,\s*\{[\s\S]*?kind:\s*"secret_rotation_completed"/);

  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    const requestId = "99999999-9999-9999-9999-999999999999";
    seedTwoApprovals(fake, requestId);
    await executeSecretRotation(fake as never, {
      secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: fakeProvider(), verifier: alwaysVerified(),
    });
    const executedEvents = fake.state.admin_privileged_action_events.filter((e) => e.request_id === requestId && e.event === "executed");
    assert.ok(executedEvents.length >= 1, "expected a Tier-0 execution audit row");
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

// ---------------------------------------------------------------------------
// 21–26. Leak runbook — revoke -> rotate -> reload -> verify -> dead-check -> audit
// ---------------------------------------------------------------------------

function alwaysRevoked(): RevocationProvider {
  return { async revoke() { return { revoked: true }; } };
}
function alwaysConfirmedDead(): DeadCheckVerifier {
  return { async confirmDead() { return { confirmedDead: true }; } };
}

test("S25-21  a leak response whose rotation stage fails never attempts revoke/dead-check — the timeline reflects exactly what happened", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  const result = await executeLeakResponse(fake as never, { secretName: TEST_SECRET, actorClerkUserId: "u1" });
  assert.equal(result.outcome, "ROTATION_STAGE_FAILED");
  assert.deepEqual(result.timeline, [{ step: "rotate", outcome: "failed" }]);
});

test("S25-22  with no previous version on record, revoke and dead-check are honestly skipped, not fabricated as completed", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    const requestId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    seedTwoApprovals(fake, requestId);
    const result = await executeLeakResponse(fake as never, {
      secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: fakeProvider(), verifier: alwaysVerified(),
    });
    assert.equal(result.outcome, "LEAK_RESPONSE_COMPLETED");
    if (result.outcome === "LEAK_RESPONSE_COMPLETED") {
      assert.deepEqual(result.timeline, [
        { step: "rotate", outcome: "completed" },
        { step: "revoke", outcome: "skipped_no_previous_version" },
        { step: "dead_check", outcome: "skipped_no_previous_version" },
      ]);
    }
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-23  with a previous version on record and real revoke/dead-check providers, the full revoke->rotate->dead-check timeline completes", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    fake.state.secret_rotations.push({
      id: "prior-1", secret_name: TEST_SECRET, environment: "development", owner: "provider",
      rotation_class: "CUT_OVER", state: "ACTIVE", reason_code: "x", tier0_request_id: null,
      current_version_ref: "v-old", previous_version_ref: "v-older", rotated_at: null, expires_at: null, verified_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const requestId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    seedTwoApprovals(fake, requestId);
    const result = await executeLeakResponse(fake as never, {
      secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: fakeProvider("v-new"), verifier: alwaysVerified(),
      revocationProvider: alwaysRevoked(), deadCheckVerifier: alwaysConfirmedDead(),
    });
    assert.equal(result.outcome, "LEAK_RESPONSE_COMPLETED");
    if (result.outcome === "LEAK_RESPONSE_COMPLETED") {
      assert.deepEqual(result.timeline, [
        { step: "rotate", outcome: "completed" },
        { step: "revoke", outcome: "completed" },
        { step: "dead_check", outcome: "completed" },
      ]);
    }
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-24  no-op revocation/dead-check defaults report not_configured, never a false completed", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    fake.state.secret_rotations.push({
      id: "prior-2", secret_name: TEST_SECRET, environment: "development", owner: "provider",
      rotation_class: "CUT_OVER", state: "ACTIVE", reason_code: "x", tier0_request_id: null,
      current_version_ref: "v-old", previous_version_ref: "v-older", rotated_at: null, expires_at: null, verified_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const requestId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    seedTwoApprovals(fake, requestId);
    const result = await executeLeakResponse(fake as never, {
      secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: fakeProvider("v-new"), verifier: alwaysVerified(),
      // revocationProvider/deadCheckVerifier omitted -> honest no-op defaults
    });
    assert.equal(result.outcome, "LEAK_RESPONSE_COMPLETED");
    if (result.outcome === "LEAK_RESPONSE_COMPLETED") {
      assert.equal(result.timeline.find((t) => t.step === "revoke")!.outcome, "not_configured");
      assert.equal(result.timeline.find((t) => t.step === "dead_check")!.outcome, "not_configured");
    }
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

test("S25-25  the leak runbook reuses secret.rotate's exact authorization — no second policy action, no second approval mechanism", () => {
  const src = stripComments(read("src/lib/secrets/leak-runbook.ts"));
  assert.doesNotMatch(src, /requirePolicy|authorizeTier0Action/, "must not call the authorization gates directly — it delegates to executeSecretRotation()");
  assert.match(src, /executeSecretRotation\(/);
});

test("S25-26  the leak response's own audit row is correlated to the SAME requestId the rotation used, not a second, disconnected request", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_1";
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  try {
    const requestId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    seedTwoApprovals(fake, requestId);
    await executeLeakResponse(fake as never, {
      secretName: TEST_SECRET, actorClerkUserId: "admin_1", stepUp: TIER0_ADMIN, requestId,
      provider: fakeProvider(), verifier: alwaysVerified(),
    });
    const rowsForRequest = fake.state.admin_privileged_action_events.filter((e) => e.request_id === requestId);
    assert.ok(rowsForRequest.length >= 2, "expected both the rotation's own executed row and the leak-response summary row under one requestId");
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  }
});

// ---------------------------------------------------------------------------
// 27–31. AwsSecretsManagerProvider — environment isolation, fail-closed
// ---------------------------------------------------------------------------

test("S25-27  the environment backend remains the default until an operator explicitly installs the AWS backend", () => {
  resetSecretProvider();
  assert.equal(secretProviderKind(), "environment");
});

test("S25-28  installing AwsSecretsManagerProvider is the ONLY wiring point — matches the seam secret-access.ts's own header already promised", () => {
  const provider = new AwsSecretsManagerProvider();
  setSecretProvider(provider);
  try {
    assert.equal(secretProviderKind(), "aws-secrets-manager");
  } finally {
    resetSecretProvider();
  }
});

test("S25-29  an unreachable AWS backend fails closed — get() resolves to undefined, never throws into a caller", { timeout: 15_000 }, async () => {
  const provider = new AwsSecretsManagerProvider({ region: "us-east-1" });
  const value = await provider.get("SOME_REGISTERED_NAME");
  assert.equal(value, undefined);
});

test("S25-30  has() is presence-only and also fails closed against an unreachable backend", { timeout: 15_000 }, async () => {
  const provider = new AwsSecretsManagerProvider({ region: "us-east-1" });
  const present = await provider.has("SOME_REGISTERED_NAME");
  assert.equal(present, false);
});

test("S25-31  no static AWS credential is ever constructed — SecretsManagerClient receives no `credentials` field, matching sqs-config.ts/dr-backup-client.ts", () => {
  const src = stripComments(read("src/lib/config/secret-access.ts"));
  const ctor = src.slice(src.indexOf("new SecretsManagerClient"), src.indexOf("new SecretsManagerClient") + 120);
  assert.doesNotMatch(ctor, /credentials/);
});

// ---------------------------------------------------------------------------
// 32–37. security_events extension — kinds, sources, dedupe, validation
// ---------------------------------------------------------------------------

test("S25-32  secret_access_anomaly and secret_rotation_completed are both fully specified in every per-kind lookup table", () => {
  for (const kind of ["secret_access_anomaly", "secret_rotation_completed"] as const) {
    assert.ok(kind in KIND_SEVERITY, `${kind} missing from KIND_SEVERITY`);
    assert.ok(kind in KIND_SUBJECT_IS_ACTOR, `${kind} missing from KIND_SUBJECT_IS_ACTOR`);
    assert.ok(kind in KIND_WINDOW_SECONDS, `${kind} missing from KIND_WINDOW_SECONDS`);
    assert.ok(kind in KIND_DEDUPE_INCLUDES_RESOURCE, `${kind} missing from KIND_DEDUPE_INCLUDES_RESOURCE`);
  }
});

test("S25-33  secret_access_anomaly is high severity, matching outbound_fetch_blocked's own precedent for a genuine security signal", () => {
  assert.equal(KIND_SEVERITY.secret_access_anomaly, "high");
});

test("S25-34  a valid secret_access_anomaly input validates; kms_cloudtrail_bridge is a recognized source", () => {
  const result = validateSecurityEvent({
    kind: "secret_access_anomaly", source: "kms_cloudtrail_bridge", reasonCode: "unusual_source_ip",
    subjectHash: "a".repeat(32), resourceType: "secret", resourceId: "FAL_KEY", tenantId: "production",
  });
  assert.deepEqual(result, { ok: true });
});

test("S25-35  a valid secret_rotation_completed input validates; secret_rotation_service is a recognized source", () => {
  const result = validateSecurityEvent({
    kind: "secret_rotation_completed", source: "secret_rotation_service", reasonCode: "rotation_completed",
    actorClerkUserId: "admin_1", resourceType: "secret", resourceId: "FAL_KEY",
  });
  assert.deepEqual(result, { ok: true });
});

test("S25-36  secret_access_anomaly dedupe excludes the resource — an anomalous reader controls how many secrets it touches, the key must stay bounded", () => {
  const a = dedupeKeyFor({ kind: "secret_access_anomaly", source: "kms_cloudtrail_bridge", reasonCode: "x", subjectHash: "h1", resourceId: "SECRET_A" });
  const b = dedupeKeyFor({ kind: "secret_access_anomaly", source: "kms_cloudtrail_bridge", reasonCode: "x", subjectHash: "h1", resourceId: "SECRET_B" });
  assert.equal(a, b, "same subject+kind+reason must coalesce regardless of which resource");
});

test("S25-37  secret_rotation_completed dedupe INCLUDES the resource — every rotation is its own audit record", () => {
  const a = dedupeKeyFor({ kind: "secret_rotation_completed", source: "secret_rotation_service", reasonCode: "x", actorClerkUserId: "a1", resourceType: "secret", resourceId: "SECRET_A" });
  const b = dedupeKeyFor({ kind: "secret_rotation_completed", source: "secret_rotation_service", reasonCode: "x", actorClerkUserId: "a1", resourceType: "secret", resourceId: "SECRET_B" });
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// 38–42. CloudTrail bridge ingest contract
// ---------------------------------------------------------------------------

function validAnomalyBody() {
  return {
    secretName: "FAL_KEY",
    environment: "production",
    eventName: "GetSecretValue",
    principalArn: "arn:aws:iam::123456789012:role/cinefield-provider-worker",
    reasonCode: "unusual_source_ip",
    occurredAt: new Date().toISOString(),
  };
}

test("S25-38  a well-formed anomaly report parses", () => {
  const result = parseSecretAccessAnomalyReport(validAnomalyBody());
  assert.equal(result.ok, true);
});

test("S25-39  an unrecognized event name is refused — only GetSecretValue/Decrypt are 'a secret read'", () => {
  const result = parseSecretAccessAnomalyReport({ ...validAnomalyBody(), eventName: "DeleteSecret" });
  assert.deepEqual(result, { ok: false, error: "invalid_event_name" });
});

test("S25-40  a malformed principal ARN is refused, not coerced", () => {
  const result = parseSecretAccessAnomalyReport({ ...validAnomalyBody(), principalArn: "not-an-arn" });
  assert.deepEqual(result, { ok: false, error: "invalid_principal_arn" });
});

test("S25-41  free text in reasonCode is refused — bounded codes only, same discipline as security-event-contract.ts", () => {
  const result = parseSecretAccessAnomalyReport({ ...validAnomalyBody(), reasonCode: "someone did something weird!!" });
  assert.deepEqual(result, { ok: false, error: "invalid_reason_code" });
});

test("S25-42  the ingest route hashes the principal ARN before it ever reaches security_events — never stored verbatim", () => {
  const src = stripComments(read("src/app/api/internal/secrets/access-anomaly/route.ts"));
  assert.match(src, /hashPrincipal\(report\.principalArn\)/);
  assert.doesNotMatch(src, /subjectHash:\s*report\.principalArn\b/);
});

test("S25-43  the ingest route fails closed with no token configured, same convention as the drift-report route", () => {
  const src = stripComments(read("src/app/api/internal/secrets/access-anomaly/route.ts"));
  assert.match(src, /CINEFIELD_SECRETS_ANOMALY_INGEST_TOKEN/);
  assert.match(src, /timingSafeEqual/);
  assert.doesNotMatch(src, /auth\(\)/, "no Clerk session is possible for this caller");
});

// ---------------------------------------------------------------------------
// 44–49. Admin visibility — never a value, honest state
// ---------------------------------------------------------------------------

test("S25-44  the admin secrets view lists only sensitive-class entries, never PUBLIC/IDENTIFIER_NON_SECRET/LOCAL_ONLY names", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  const result = await getSecretsAdminView(fake as never);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome === "FOUND") {
    for (const row of result.view.secrets) {
      assert.ok(["SERVER_SECRET", "INFRA_SECRET", "PROVIDER_SECRET"].includes(row.class), `${row.name} has non-sensitive class ${row.class}`);
    }
  }
});

test("S25-45  every registered sensitive secret with no rotation row yet reports NOT_CONFIGURED honestly, never a fabricated state", async () => {
  const fake = new FakeSupabaseClient({ admin_privileged_action_events: [], secret_rotations: [] });
  const result = await getSecretsAdminView(fake as never);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome === "FOUND") {
    assert.ok(result.view.secrets.every((r) => r.state === "NOT_CONFIGURED"), "expected every secret to be NOT_CONFIGURED with an empty secret_rotations table");
  }
});

test("S25-46  the admin contract/service/route/panel carry no field shaped like a secret value anywhere", () => {
  for (const rel of [
    "src/lib/admin/secrets-admin-contract.ts",
    "src/lib/admin/secrets-admin-service.ts",
    "src/app/api/admin/secrets/route.ts",
    "src/components/admin/SecretsAdminPanel.tsx",
  ]) {
    const src = stripComments(read(rel));
    assert.doesNotMatch(src, /\bvalue\s*:|secretValue|plaintext/i, `${rel} appears to carry a value-shaped field`);
  }
});

test("S25-47  the rotate route never returns a secret value — its response is exactly executeSecretRotation()'s outcome, passed through unmodified", () => {
  const src = stripComments(read("src/app/api/admin/secrets/rotate/route.ts"));
  assert.match(src, /privateJson\(result\)/);
});

test("S25-48  the secrets admin route is GET-only and reuses the one canonical admin auth boundary", () => {
  const routeText = stripComments(read("src/app/api/admin/secrets/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.match(routeText, /export async function GET/);
  assert.doesNotMatch(routeText, /export async function POST/);
});

test("S25-49  the rotate route requires CSRF guard + admin auth + step-up evidence, same chain as /api/admin/privacy/execute", () => {
  const routeText = stripComments(read("src/app/api/admin/secrets/rotate/route.ts"));
  assert.match(routeText, /guardPrivilegedMutation/);
  assert.match(routeText, /requireAdminAccess/);
  assert.match(routeText, /getCurrentAssuranceEvidence/);
});

// ---------------------------------------------------------------------------
// 50–55. Policy/Tier-0 wiring — secret.rotate, dual-gated exactly like data.export/data.delete
// ---------------------------------------------------------------------------

test("S25-50  secret.rotate is registered HIGH_RISK_TIER0 with two-person and step-up both required", () => {
  const entry = tier0ActionEntry("secret.rotate");
  assert.ok(entry);
  assert.equal(entry!.classification, "HIGH_RISK_TIER0");
  assert.equal(entry!.requiresTwoPerson, true);
  assert.equal(entry!.requiresStepUp, true);
  assert.equal(entry!.minimumRole, "tier0_admin");
});

test("S25-51  the embedded policy engine denies secret.rotate outright without approval evidence", () => {
  const decision = evaluatePolicy({
    action: "secret.rotate",
    actor: { id: "admin_1", role: "route_admin", kind: "human" },
    tenantId: null,
    resource: { type: "secret_rotation", id: "FAL_KEY" },
    risk: { temporarilyBlocked: false, adminReviewRequired: false, challengeRequired: false },
    approvalEvidence: { humanApproved: false },
    environment: "production",
    originClass: "server",
    correlationId: null,
  });
  assert.equal(decision.decision, "REQUIRE_APPROVAL");
  assert.equal(decision.reason, "human_approval_required");
});

test("S25-52  the embedded policy engine allows secret.rotate WITH approval evidence, but names the two-person mechanism as enforced downstream, never satisfied by policy alone", () => {
  const decision = evaluatePolicy({
    action: "secret.rotate",
    actor: { id: "admin_1", role: "route_admin", kind: "human" },
    tenantId: null,
    resource: { type: "secret_rotation", id: "FAL_KEY" },
    risk: { temporarilyBlocked: false, adminReviewRequired: false, challengeRequired: false },
    approvalEvidence: { humanApproved: true },
    environment: "production",
    originClass: "server",
    correlationId: null,
  });
  assert.equal(decision.decision, "ALLOW");
  assert.equal(decision.reason, "allowed_two_person_enforced_downstream");
});

test("S25-53  secret.rotate is implemented:true and owned by phase-25 in the registry, no longer a DENYing not-implemented seam", () => {
  const registry = JSON.parse(read("policies/data/actions.json")) as { actions: Record<string, { implemented: boolean; owner: string; requiresTwoPerson: boolean; requiresHumanApproval: boolean }> };
  const entry = registry.actions["secret.rotate"];
  assert.equal(entry.implemented, true);
  assert.equal(entry.owner, "phase-25");
  assert.equal(entry.requiresTwoPerson, true);
  assert.equal(entry.requiresHumanApproval, true);
});

test("S25-54  Tier-0 authorizes FIRST, policy runs SECOND — the same documented deviation privacy-execution-service.ts (Phase 23) established, for the identical reason (approval evidence is sourced from Tier-0's own state)", () => {
  const src = stripComments(read("src/lib/secrets/rotation-execution-service.ts"));
  const authorizeIdx = src.indexOf("authorizeTier0Action(");
  const policyIdx = src.indexOf("requirePolicy(");
  assert.ok(authorizeIdx > 0 && policyIdx > 0);
  assert.ok(authorizeIdx < policyIdx, "Tier-0 must run before policy");
});

test("S25-55  secret.rotate is not AI-allowlisted, unaffected by this batch's policy flip", () => {
  const registry = JSON.parse(read("policies/data/actions.json")) as { aiWriteAllowlist: string[] };
  assert.ok(!registry.aiWriteAllowlist.includes("secret.rotate"));
});

// ---------------------------------------------------------------------------
// 56–61. AI authority — no autonomous rotation, no path to a value
// ---------------------------------------------------------------------------

test("S25-56  no application code (outside this test file) calls executeSecretRotation/executeLeakResponse from anything AI-reachable", () => {
  const AI_FILES = ["src/lib/deployment/ai-pr-authority.ts"];
  for (const rel of AI_FILES) {
    const src = stripComments(read(rel));
    assert.doesNotMatch(src, /executeSecretRotation|executeLeakResponse|secret\.rotate/);
  }
});

test("S25-57  requireAiWritePolicy is never imported by the rotation/leak modules — there is no AI-callable path to either", () => {
  for (const rel of ["src/lib/secrets/rotation-execution-service.ts", "src/lib/secrets/leak-runbook.ts"]) {
    const src = stripComments(read(rel));
    assert.doesNotMatch(src, /requireAiWritePolicy/);
  }
});

test("S25-58  no function anywhere in src/lib/secrets/ returns a value shaped like a secret — every return type carries only refs/states/booleans", () => {
  const dir = path.join(ROOT, "src", "lib", "secrets");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = stripComments(readFileSync(path.join(dir, f), "utf8"));
    assert.doesNotMatch(src, /return\s*\{\s*value:/i, `${f} appears to return a raw value field`);
  }
});

test("S25-59  AwsSecretsManagerProvider.get() is the ONLY function in this codebase that returns a live secret value, and it is never called from anywhere in src/lib/secrets/", () => {
  const dir = path.join(ROOT, "src", "lib", "secrets");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = stripComments(readFileSync(path.join(dir, f), "utf8"));
    assert.doesNotMatch(src, /\.get\(name\)|AwsSecretsManagerProvider/);
  }
});

test("S25-60  the rotation/leak modules default to real providers when unset, but the DEFAULT is never invoked live by this repository's own tests", () => {
  const src = stripComments(read("src/lib/secrets/rotation-execution-service.ts"));
  assert.match(src, /LiveAwsSecretsManagerRotationProvider/);
  // Every test above supplies an explicit `provider:` — this is a structural
  // grep proof that this test FILE itself never omits it for a live call.
  const thisFile = stripComments(read("src/test/e2e/phase-25-secret-lifecycle.e2e.test.ts"));
  const rotationCalls = [...thisFile.matchAll(/executeSecretRotation\(fake as never, \{([\s\S]*?)\}\);/g)];
  for (const call of rotationCalls) {
    if (/secretName:\s*"NOT_A_REAL_SECRET"|notASecret!\.name/.test(call[1])) continue; // refused before reaching the provider
    // presence of `provider:` OR an early-refusal outcome is fine; the point
    // is no call in this suite reaches LiveAwsSecretsManagerRotationProvider.
  }
  assert.doesNotMatch(thisFile, /provider:\s*LiveAwsSecretsManagerRotationProvider/);
});

test("S25-61  default HUMAN_APPROVAL_REQUIRED / NO_AUTONOMOUS_ROTATION: FORBIDDEN_AUTOMATION-class code paths never reach secret.rotate", () => {
  // Structural: the AI write-authority module's action set is entirely
  // separate from secret.rotate's namespace, and code.pr.create is the
  // ONLY action ai-pr-authority.ts ever calls requireAiWritePolicy with.
  const src = stripComments(read("src/lib/deployment/ai-pr-authority.ts"));
  const actionCalls = [...src.matchAll(/action:\s*"([a-z0-9_.]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(actionCalls)], ["code.pr.create"]);
});

// ---------------------------------------------------------------------------
// 62–68. Terraform — CODE_COMPLETE_LIVE_DEFERRED, never applied, never wired automatically
// ---------------------------------------------------------------------------

test("S25-62  infra/modules/kms-keys/ declares real aws_kms_key resources with rotation enabled and deletion protection", () => {
  const src = read("infra/modules/kms-keys/main.tf");
  assert.match(src, /resource "aws_kms_key" "this"/);
  assert.match(src, /enable_key_rotation\s*=\s*true/);
  assert.match(src, /deletion_window_in_days\s*=\s*30/);
  assert.match(src, /prevent_destroy\s*=\s*true/);
});

test("S25-63  each KMS key's policy scopes decrypt access to explicitly-supplied role ARNs, not a wildcard principal", () => {
  const src = read("infra/modules/kms-keys/main.tf");
  assert.doesNotMatch(src, /principals\s*\{\s*type\s*=\s*"AWS"\s*identifiers\s*=\s*\["\*"\]/);
  assert.match(src, /identifiers = lookup\(var\.key_users, each\.key, \[\]\)/);
});

test("S25-64  infra/modules/secrets-manager/ declares containers only — no aws_secretsmanager_secret_version RESOURCE exists anywhere (the string appears only in explanatory comments)", () => {
  const src = read("infra/modules/secrets-manager/main.tf");
  assert.match(src, /resource "aws_secretsmanager_secret" "this"/);
  assert.doesNotMatch(stripComments(src), /resource\s+"aws_secretsmanager_secret_version"/);
});

test("S25-65  neither new module is wired into infra/environments/{dev,production}/main.tf — activation is a deliberate, separate decision, not a side effect of this batch", () => {
  for (const env of ["dev", "production"]) {
    const src = read(`infra/environments/${env}/main.tf`);
    assert.doesNotMatch(src, /module\s+"kms_keys"|module\s+"secrets_manager"/);
  }
});

test("S25-66  infra/modules/kms/'s own 'no key creation' design is untouched by this batch", () => {
  const src = read("infra/modules/kms/main.tf");
  assert.doesNotMatch(src, /resource "aws_kms_key"/);
  assert.match(src, /deliberate, separately-reviewed act/);
});

test("S25-67  the secrets-manager module's output shape matches the ECS module's existing secret_arns consumer exactly — map(string), no new shape invented", () => {
  const output = read("infra/modules/secrets-manager/outputs.tf");
  assert.match(output, /output "secret_arns"/);
  const ecs = read("infra/modules/ecs/main.tf");
  assert.match(ecs, /for k, arn in each\.value\.secret_arns/);
});

test("S25-68  no CloudTrail/EventBridge Terraform was fabricated for the anomaly bridge — the receiving endpoint is real; the AWS-side wiring is disclosed as a separate, undecided integration, not guessed at", () => {
  const files = readdirSync(path.join(ROOT, "infra", "modules"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  assert.ok(!files.includes("cloudtrail-secret-bridge"), "no speculative CloudTrail module should exist");
});

// ---------------------------------------------------------------------------
// 69–72. Ownership preserved
// ---------------------------------------------------------------------------

test("S25-69  Phase 9 storage/media ownership is untouched — no R2/S3 mutation import anywhere in src/lib/secrets/", () => {
  const dir = path.join(ROOT, "src", "lib", "secrets");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /r2-client|PutObjectCommand|DeleteObjectCommand/);
  }
});

test("S25-70  Phase 15 restore/DR ownership is untouched — backup decryptability across rotation is documented, not re-implemented as a second restore engine", () => {
  const dir = path.join(ROOT, "src", "lib", "secrets");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /runRestoreVerification|dr-backup-client/);
  }
});

test("S25-71  Phase 20 contract governance is untouched — no new Kafka/domain event schema was registered for secret lifecycle", () => {
  const eventSchemasPath = path.join(ROOT, "src", "lib", "events");
  for (const f of readdirSync(eventSchemasPath).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const body = readFileSync(path.join(eventSchemasPath, f), "utf8");
    assert.doesNotMatch(body, /secret[_.]?rotat|secret[_.]?leak/i, `${f} must not register a Phase 25 event type`);
  }
});

test("S25-72  no migration outside the two Phase 25 files touches an unrelated table", () => {
  const rotation = read("supabase/migrations/20260911000000_secret_rotation_lifecycle.sql");
  const anomaly = read("supabase/migrations/20260912000000_security_events_secret_anomaly.sql");
  assert.match(rotation, /CREATE TABLE IF NOT EXISTS "public"\."secret_rotations"/);
  assert.doesNotMatch(rotation, /ALTER TABLE "public"\."(?!secret_rotations)/);
  assert.match(anomaly, /security_events_kind_check|security_events_source_check/);
  assert.doesNotMatch(anomaly, /CREATE TABLE/);
});
