import { strict as assert } from "node:assert";
import { test } from "node:test";
import { reapplyTombstonesAfterRestore, isAccountTombstoned } from "./restore-redelete-guard";
import { FakeSupabaseClient } from "../../test/e2e/fake-supabase";

function envelope(db: FakeSupabaseClient) {
  return db as never;
}

test("reapplyTombstonesAfterRestore: a restored profile matching a tombstone is re-anonymized", async () => {
  const db = new FakeSupabaseClient();
  db.state.deletion_tombstones = [
    { id: "t1", clerk_user_id: "user_1", tombstoned_at: new Date().toISOString(), reason_code: "dsar_deletion_request", executed_by: "admin_1", requested_by: null, legal_hold_exception: false },
  ];
  // Simulates a restore reviving the PRE-deletion row.
  db.state.profiles = [{ clerk_user_id: "user_1", username: "alice_restored", email: "alice@example.com", display_name: "Alice", avatar_url: null }];

  const result = await reapplyTombstonesAfterRestore(envelope(db));
  assert.equal(result.tombstoneCount, 1);
  assert.equal(result.profilesReanonymized, 1);

  const profile = db.state.profiles.find((p) => p.clerk_user_id === "user_1");
  assert.equal(profile?.username, null);
  assert.equal(profile?.email, null);
});

test("reapplyTombstonesAfterRestore: a restored media asset for a tombstoned user is re-tombstoned", async () => {
  const db = new FakeSupabaseClient();
  db.state.deletion_tombstones = [
    { id: "t1", clerk_user_id: "user_1", tombstoned_at: new Date().toISOString(), reason_code: "dsar_deletion_request", executed_by: "admin_1", requested_by: null, legal_hold_exception: false },
  ];
  db.state.media_assets = [
    { id: "m1", clerk_user_id: "user_1", tombstoned_at: null },
    { id: "m2", clerk_user_id: "user_1", tombstoned_at: new Date().toISOString() },
  ];

  const result = await reapplyTombstonesAfterRestore(envelope(db));
  assert.equal(result.mediaAssetsRetombstoned, 1, "only the row the restore un-tombstoned needs re-applying");

  assert.ok(db.state.media_assets.find((a) => a.id === "m1")?.tombstoned_at);
});

test("reapplyTombstonesAfterRestore: already-anonymized/already-tombstoned rows are left alone — idempotent, no spurious writes counted", async () => {
  const db = new FakeSupabaseClient();
  db.state.deletion_tombstones = [
    { id: "t1", clerk_user_id: "user_1", tombstoned_at: new Date().toISOString(), reason_code: "dsar_deletion_request", executed_by: "admin_1", requested_by: null, legal_hold_exception: false },
  ];
  db.state.profiles = [{ clerk_user_id: "user_1", username: null, email: null, display_name: null, avatar_url: null }];
  db.state.media_assets = [{ id: "m1", clerk_user_id: "user_1", tombstoned_at: new Date().toISOString() }];

  const result = await reapplyTombstonesAfterRestore(envelope(db));
  assert.equal(result.profilesReanonymized, 0);
  assert.equal(result.mediaAssetsRetombstoned, 0);
});

test("reapplyTombstonesAfterRestore: an account with no tombstone is never touched", async () => {
  const db = new FakeSupabaseClient();
  db.state.profiles = [{ clerk_user_id: "user_1", username: "alice", email: "alice@example.com", display_name: null, avatar_url: null }];

  const result = await reapplyTombstonesAfterRestore(envelope(db));
  assert.equal(result.tombstoneCount, 0);
  const profile = db.state.profiles.find((p) => p.clerk_user_id === "user_1");
  assert.equal(profile?.username, "alice", "an un-tombstoned user's data must never be touched by this guard");
});

test("isAccountTombstoned: true only for a real tombstone row, never inferred", async () => {
  const db = new FakeSupabaseClient();
  db.state.deletion_tombstones = [
    { id: "t1", clerk_user_id: "user_1", tombstoned_at: new Date().toISOString(), reason_code: "x", executed_by: "admin_1", requested_by: null, legal_hold_exception: false },
  ];
  assert.equal(await isAccountTombstoned(envelope(db), "user_1"), true);
  assert.equal(await isAccountTombstoned(envelope(db), "user_2"), false);
});
