import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createPrivacyRequest,
  listPrivacyRequestsForUser,
  listPendingPrivacyRequests,
  getPrivacyRequest,
  markPrivacyRequestProcessing,
  resolvePrivacyRequest,
} from "./privacy-request-store";
import { FakeSupabaseClient } from "../../test/e2e/fake-supabase";

function envelope(db: FakeSupabaseClient) {
  return db as never;
}

test("createPrivacyRequest: a real pending row is created for the caller's own clerk_user_id", async () => {
  const db = new FakeSupabaseClient();
  const outcome = await createPrivacyRequest(envelope(db), "user_1", "export");
  assert.equal(outcome.outcome, "created");
  if (outcome.outcome !== "created") return;

  const requests = await listPrivacyRequestsForUser(envelope(db), "user_1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, outcome.requestId);
  assert.equal(requests[0].status, "pending");
  assert.equal(requests[0].requestType, "export");
  assert.equal(requests[0].resolvedAt, null);
  assert.equal(requests[0].resolvedBy, null);
});

test("listPrivacyRequestsForUser: never returns another user's request", async () => {
  const db = new FakeSupabaseClient();
  await createPrivacyRequest(envelope(db), "user_1", "export");
  await createPrivacyRequest(envelope(db), "user_2", "deletion");

  const user1Requests = await listPrivacyRequestsForUser(envelope(db), "user_1");
  assert.equal(user1Requests.length, 1);
  assert.equal(user1Requests[0].clerkUserId, "user_1");
});

test("listPendingPrivacyRequests: only pending/processing rows, across all users", async () => {
  const db = new FakeSupabaseClient();
  const a = await createPrivacyRequest(envelope(db), "user_1", "export");
  const b = await createPrivacyRequest(envelope(db), "user_2", "deletion");
  if (a.outcome !== "created" || b.outcome !== "created") return;

  await resolvePrivacyRequest(envelope(db), { requestId: b.requestId, status: "rejected", resolvedBy: "admin_1" });

  const pending = await listPendingPrivacyRequests(envelope(db));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, a.requestId);
});

test("markPrivacyRequestProcessing: only a still-pending row transitions", async () => {
  const db = new FakeSupabaseClient();
  const created = await createPrivacyRequest(envelope(db), "user_1", "export");
  if (created.outcome !== "created") return;

  const ok = await markPrivacyRequestProcessing(envelope(db), created.requestId, "tier0-req-1");
  assert.equal(ok, true);

  const record = await getPrivacyRequest(envelope(db), created.requestId);
  assert.equal(record?.status, "processing");
  assert.equal(record?.tier0RequestId, "tier0-req-1");

  // A second attempt against an already-processing row is refused, not silently re-applied.
  const retried = await markPrivacyRequestProcessing(envelope(db), created.requestId, "tier0-req-2");
  assert.equal(retried, false);
});

test("resolvePrivacyRequest: transitions a pending/processing row to terminal, records resolver and reason", async () => {
  const db = new FakeSupabaseClient();
  const created = await createPrivacyRequest(envelope(db), "user_1", "deletion");
  if (created.outcome !== "created") return;

  const ok = await resolvePrivacyRequest(envelope(db), {
    requestId: created.requestId,
    status: "completed",
    resolvedBy: "admin_1",
    reasonCode: "deletion_completed",
  });
  assert.equal(ok, true);

  const record = await getPrivacyRequest(envelope(db), created.requestId);
  assert.equal(record?.status, "completed");
  assert.equal(record?.resolvedBy, "admin_1");
  assert.equal(record?.reasonCode, "deletion_completed");
  assert.ok(record?.resolvedAt);
});

test("resolvePrivacyRequest: an already-terminal row never transitions again — no silent overwrite", async () => {
  const db = new FakeSupabaseClient();
  const created = await createPrivacyRequest(envelope(db), "user_1", "export");
  if (created.outcome !== "created") return;

  await resolvePrivacyRequest(envelope(db), { requestId: created.requestId, status: "completed", resolvedBy: "admin_1" });
  const secondAttempt = await resolvePrivacyRequest(envelope(db), { requestId: created.requestId, status: "failed", resolvedBy: "admin_2" });
  assert.equal(secondAttempt, false);

  const record = await getPrivacyRequest(envelope(db), created.requestId);
  assert.equal(record?.status, "completed");
  assert.equal(record?.resolvedBy, "admin_1");
});

test("hasExport reflects a completed export, never exposes the raw export object key", async () => {
  const db = new FakeSupabaseClient();
  const created = await createPrivacyRequest(envelope(db), "user_1", "export");
  if (created.outcome !== "created") return;

  await resolvePrivacyRequest(envelope(db), {
    requestId: created.requestId,
    status: "completed",
    resolvedBy: "admin_1",
    exportObjectKey: "privacy-exports/user_1/some-key.json",
    exportExpiresAt: new Date(Date.now() + 300_000).toISOString(),
  });

  const record = await getPrivacyRequest(envelope(db), created.requestId);
  assert.equal(record?.hasExport, true);
  assert.ok(!("exportObjectKey" in (record ?? {})));
});
