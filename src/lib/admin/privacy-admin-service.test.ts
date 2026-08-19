import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getPrivacyAdminView } from "./privacy-admin-service";
import { createPrivacyRequest, resolvePrivacyRequest } from "@/lib/privacy/privacy-request-store";
import { DATA_CLASSIFICATION_MATRIX } from "@/lib/privacy/data-classification";
import { PROCESSOR_INVENTORY } from "@/lib/privacy/processor-inventory";
import { FakeSupabaseClient } from "../../test/e2e/fake-supabase";

function envelope(db: FakeSupabaseClient) {
  return db as never;
}

test("getPrivacyAdminView: returns the real classification matrix and processor inventory verbatim, never a second copy", async () => {
  const db = new FakeSupabaseClient();
  const result = await getPrivacyAdminView(envelope(db));
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.deepEqual(result.view.dataClassification, DATA_CLASSIFICATION_MATRIX);
  assert.deepEqual(result.view.processors, PROCESSOR_INVENTORY);
});

test("getPrivacyAdminView: real requests appear, most recent first, with hasExport but never a raw export key", async () => {
  const db = new FakeSupabaseClient();
  const first = await createPrivacyRequest(envelope(db), "user_1", "export");
  const second = await createPrivacyRequest(envelope(db), "user_2", "deletion");
  if (first.outcome !== "created" || second.outcome !== "created") return;
  await resolvePrivacyRequest(envelope(db), {
    requestId: first.requestId,
    status: "completed",
    resolvedBy: "admin_1",
    exportObjectKey: "privacy-exports/user_1/x.json",
    exportExpiresAt: new Date(Date.now() + 300_000).toISOString(),
  });

  const result = await getPrivacyAdminView(envelope(db));
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.equal(result.view.recentRequests.length, 2);
  const exported = result.view.recentRequests.find((r) => r.id === first.requestId);
  assert.equal(exported?.hasExport, true);
  assert.ok(!("exportObjectKey" in (exported ?? {})));
});

test("getPrivacyAdminView: tombstoneCount reflects the real deletion_tombstones row count", async () => {
  const db = new FakeSupabaseClient();
  db.state.deletion_tombstones = [
    { id: "t1", clerk_user_id: "user_1" },
    { id: "t2", clerk_user_id: "user_2" },
  ];
  const result = await getPrivacyAdminView(envelope(db));
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.equal(result.view.tombstoneCount, 2);
});

test("getPrivacyAdminView: an empty table is FOUND with zero requests, never SOURCE_UNAVAILABLE — absence of data is not the same as an unreachable source", async () => {
  const db = new FakeSupabaseClient();
  const result = await getPrivacyAdminView(envelope(db));
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.equal(result.view.recentRequests.length, 0);
  assert.equal(result.view.tombstoneCount, 0);
});
