import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { executePrivacyRequest } from "./privacy-execution-service";
import { createPrivacyRequest, getPrivacyRequest } from "./privacy-request-store";
import { decidePrivilegedAction } from "@/lib/admin/tier0-authorization";
import type { AssuranceEvidence, ElevationVerdict } from "@/lib/admin/step-up-auth";
import { FakeSupabaseClient } from "../../test/e2e/fake-supabase";

function envelope(db: FakeSupabaseClient) {
  return db as never;
}

const VERIFIED: AssuranceEvidence = { state: "VERIFIED", verifiedAt: new Date().toISOString() };
const ELEVATED: ElevationVerdict = { elevated: true, reasonCode: "verified" };
const UNVERIFIED: AssuranceEvidence = { state: "NOT_CONFIGURED", verifiedAt: null };
const NOT_ELEVATED: ElevationVerdict = { elevated: false, reasonCode: "no_elevation" };

function seedProfile(db: FakeSupabaseClient, clerkUserId: string) {
  db.state.profiles = [{ clerk_user_id: clerkUserId, username: "alice", email: "alice@example.com", display_name: null, avatar_url: null, plan: "free" }];
}

describe("privacy-execution-service — gating (no Tier-0 role/step-up configured)", () => {
  test("an export request cannot be executed without any Tier-0 configuration — fails closed, never a silent allow", async () => {
    const db = new FakeSupabaseClient();
    seedProfile(db, "user_1");
    const created = await createPrivacyRequest(envelope(db), "user_1", "export");
    if (created.outcome !== "created") return;

    const result = await executePrivacyRequest(envelope(db), {
      privacyRequestId: created.requestId,
      actorClerkUserId: "user_admin_1",
    });
    assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
  });

  test("INVALID_REQUEST for a malformed privacyRequestId", async () => {
    const db = new FakeSupabaseClient();
    const result = await executePrivacyRequest(envelope(db), { privacyRequestId: "not-a-uuid", actorClerkUserId: "user_admin_1" });
    assert.equal(result.outcome, "INVALID_REQUEST");
  });

  test("REQUEST_NOT_FOUND for a real UUID that does not exist", async () => {
    const db = new FakeSupabaseClient();
    const result = await executePrivacyRequest(envelope(db), {
      privacyRequestId: "00000000-0000-4000-8000-000000000000",
      actorClerkUserId: "user_admin_1",
    });
    assert.equal(result.outcome, "REQUEST_NOT_FOUND");
  });

  test("REQUEST_ALREADY_RESOLVED for a terminal request — never re-executed", async () => {
    const db = new FakeSupabaseClient();
    seedProfile(db, "user_1");
    const created = await createPrivacyRequest(envelope(db), "user_1", "export");
    if (created.outcome !== "created") return;
    const { resolvePrivacyRequest } = await import("./privacy-request-store");
    await resolvePrivacyRequest(envelope(db), { requestId: created.requestId, status: "rejected", resolvedBy: "admin_1" });

    const result = await executePrivacyRequest(envelope(db), { privacyRequestId: created.requestId, actorClerkUserId: "user_admin_1" });
    assert.equal(result.outcome, "REQUEST_ALREADY_RESOLVED");
  });
});

describe("privacy-execution-service — full two-person dual control, export", () => {
  test("data.export: role-permitted but no second approver yet -> TIER0_AUTHORIZATION_REQUIRED; a second, distinct admin's approval lets the SAME requestId proceed and actually complete the export", async () => {
    process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_req,user_approver_1,user_approver_2";
    try {
      const db = new FakeSupabaseClient();
      seedProfile(db, "user_1");
      const created = await createPrivacyRequest(envelope(db), "user_1", "export");
      if (created.outcome !== "created") return;

      const first = await executePrivacyRequest(envelope(db), {
        privacyRequestId: created.requestId,
        actorClerkUserId: "user_req",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
      });
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

      // Two DISTINCT approvers, neither the original requester — dual
      // control requires COUNT(DISTINCT actor) >= 2 over 'approved' events.
      await decidePrivilegedAction(envelope(db), {
        requestId: first.requestId,
        action: "data.export",
        actorClerkUserId: "user_approver_1",
        target: { type: "privacy_request", id: created.requestId },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      const approval = await decidePrivilegedAction(envelope(db), {
        requestId: first.requestId,
        action: "data.export",
        actorClerkUserId: "user_approver_2",
        target: { type: "privacy_request", id: created.requestId },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.equal(approval.outcome, "APPROVAL_RECORDED");
      if (approval.outcome !== "APPROVAL_RECORDED") return;
      assert.equal(approval.satisfied, true);

      const retry = await executePrivacyRequest(envelope(db), {
        privacyRequestId: created.requestId,
        actorClerkUserId: "user_req",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
        requestId: first.requestId,
        exportR2Deps: {
          putObject: async () => ({ bucket: "fake", objectKey: "fake", byteLength: 0 }),
          presignDownload: async () => ({ downloadUrl: "https://example.invalid/fake-download", expiresInSeconds: 300 }),
        },
      });
      assert.equal(retry.outcome, "EXPORT_COMPLETED");
      if (retry.outcome !== "EXPORT_COMPLETED") return;
      assert.ok(retry.downloadUrl.length > 0);

      const record = await getPrivacyRequest(envelope(db), created.requestId);
      assert.equal(record?.status, "completed");
      assert.equal(record?.hasExport, true);
    } finally {
      delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    }
  });

  test("data.export: the requester cannot satisfy their own two-person approval — structurally blocked, never reaches execution", async () => {
    process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_req";
    try {
      const db = new FakeSupabaseClient();
      seedProfile(db, "user_1");
      const created = await createPrivacyRequest(envelope(db), "user_1", "export");
      if (created.outcome !== "created") return;

      const first = await executePrivacyRequest(envelope(db), {
        privacyRequestId: created.requestId,
        actorClerkUserId: "user_req",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
      });
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

      const selfApproval = await decidePrivilegedAction(envelope(db), {
        requestId: first.requestId,
        action: "data.export",
        actorClerkUserId: "user_req",
        target: { type: "privacy_request", id: created.requestId },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      assert.equal(selfApproval.outcome, "SELF_APPROVAL_BLOCKED");
    } finally {
      delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    }
  });

  test("without step-up assurance, even a role-permitted actor is refused — requiresStepUp is enforced, not optional", async () => {
    process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_req";
    try {
      const db = new FakeSupabaseClient();
      seedProfile(db, "user_1");
      const created = await createPrivacyRequest(envelope(db), "user_1", "export");
      if (created.outcome !== "created") return;

      const result = await executePrivacyRequest(envelope(db), {
        privacyRequestId: created.requestId,
        actorClerkUserId: "user_req",
        stepUp: { assurance: UNVERIFIED, elevation: NOT_ELEVATED },
      });
      assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    } finally {
      delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    }
  });
});

describe("privacy-execution-service — full two-person dual control, deletion", () => {
  test("data.delete: two-person approved deletion actually runs AccountDeletionWorkflow — profile anonymized, tombstone recorded", async () => {
    process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_req,user_approver_1,user_approver_2";
    try {
      const db = new FakeSupabaseClient();
      seedProfile(db, "user_1");
      const created = await createPrivacyRequest(envelope(db), "user_1", "deletion");
      if (created.outcome !== "created") return;

      const first = await executePrivacyRequest(envelope(db), {
        privacyRequestId: created.requestId,
        actorClerkUserId: "user_req",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
        accountDeletionDeps: { clerkDeleter: { async deleteUser() { return { deleted: true }; } }, r2Delete: async () => ({ deleted: true }) },
      });
      assert.equal(first.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (first.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;

      await decidePrivilegedAction(envelope(db), {
        requestId: first.requestId,
        action: "data.delete",
        actorClerkUserId: "user_approver_1",
        target: { type: "privacy_request", id: created.requestId },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      await decidePrivilegedAction(envelope(db), {
        requestId: first.requestId,
        action: "data.delete",
        actorClerkUserId: "user_approver_2",
        target: { type: "privacy_request", id: created.requestId },
        decision: "approve",
        assurance: VERIFIED,
        elevation: ELEVATED,
      });

      const retry = await executePrivacyRequest(envelope(db), {
        privacyRequestId: created.requestId,
        actorClerkUserId: "user_req",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
        requestId: first.requestId,
        accountDeletionDeps: { clerkDeleter: { async deleteUser() { return { deleted: true }; } }, r2Delete: async () => ({ deleted: true }) },
      });
      assert.equal(retry.outcome, "DELETION_COMPLETED");

      const profile = db.state.profiles.find((p) => p.clerk_user_id === "user_1");
      assert.equal(profile?.username, null);
      assert.ok(db.state.deletion_tombstones.find((t) => t.clerk_user_id === "user_1"));

      const record = await getPrivacyRequest(envelope(db), created.requestId);
      assert.equal(record?.status, "completed");
    } finally {
      delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
    }
  });
});
