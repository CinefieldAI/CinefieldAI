import { strict as assert } from "node:assert";
import { test } from "node:test";
import { executeAccountDeletion } from "./account-deletion-workflow";
import { FakeSupabaseClient } from "../../test/e2e/fake-supabase";
import type { ClerkUserDeleter } from "./clerk-account-service";

function fakeClerkDeleter(deleted = true): ClerkUserDeleter {
  return { async deleteUser() { return { deleted }; } };
}

function seedProfile(db: FakeSupabaseClient, clerkUserId: string) {
  db.state.profiles = [
    { clerk_user_id: clerkUserId, username: "alice", email: "alice@example.com", display_name: "Alice", avatar_url: "https://example.invalid/a.png", plan: "free" },
  ];
}

test("executeAccountDeletion: anonymizes the profile row without deleting it — every other table FKs to it", async () => {
  const db = new FakeSupabaseClient();
  seedProfile(db, "user_1");

  const result = await executeAccountDeletion(
    db as never,
    { clerkUserId: "user_1", reasonCode: "dsar_deletion_request", requestedBy: "user_1", executedBy: "admin_1" },
    { clerkDeleter: fakeClerkDeleter(), r2Delete: async () => ({ deleted: true }) }
  );
  assert.equal(result.outcome, "completed");

  const profile = db.state.profiles.find((p) => p.clerk_user_id === "user_1");
  assert.ok(profile, "the profile row must still exist");
  assert.equal(profile?.username, null);
  assert.equal(profile?.email, null);
  assert.equal(profile?.display_name, null);
  assert.equal(profile?.avatar_url, null);
});

test("executeAccountDeletion: tombstones every non-legal-hold media asset and attempts a real R2 delete for each", async () => {
  const db = new FakeSupabaseClient();
  seedProfile(db, "user_1");
  db.state.media_assets = [
    { id: "m1", clerk_user_id: "user_1", object_key: "quarantine/output/user_1/m1/original.png", storage_backend: "r2", legal_hold: false, tombstoned_at: null },
    { id: "m2", clerk_user_id: "user_1", object_key: "quarantine/output/user_1/m2/original.png", storage_backend: "r2", legal_hold: false, tombstoned_at: null },
  ];
  const deletedKeys: string[] = [];

  const result = await executeAccountDeletion(
    db as never,
    { clerkUserId: "user_1", reasonCode: "dsar_deletion_request", requestedBy: null, executedBy: "admin_1" },
    {
      clerkDeleter: fakeClerkDeleter(),
      r2Delete: async (key) => { deletedKeys.push(key); return { deleted: true }; },
    }
  );
  assert.equal(result.outcome, "completed");
  if (result.outcome !== "completed") return;

  assert.equal(result.mediaAssetsTombstoned, 2);
  assert.equal(result.mediaAssetsPhysicallyDeleted, 2);
  assert.deepEqual(deletedKeys.sort(), ["quarantine/output/user_1/m1/original.png", "quarantine/output/user_1/m2/original.png"]);

  for (const asset of db.state.media_assets) {
    assert.ok(asset.tombstoned_at, `${asset.id} must be tombstoned`);
  }
});

test("executeAccountDeletion: a legal_hold asset is excluded entirely — never tombstoned, never physically deleted", async () => {
  const db = new FakeSupabaseClient();
  seedProfile(db, "user_1");
  db.state.media_assets = [
    { id: "held", clerk_user_id: "user_1", object_key: "quarantine/output/user_1/held/original.png", storage_backend: "r2", legal_hold: true, tombstoned_at: null },
    { id: "free", clerk_user_id: "user_1", object_key: "quarantine/output/user_1/free/original.png", storage_backend: "r2", legal_hold: false, tombstoned_at: null },
  ];
  let deleteAttempts = 0;

  const result = await executeAccountDeletion(
    db as never,
    { clerkUserId: "user_1", reasonCode: "dsar_deletion_request", requestedBy: null, executedBy: "admin_1" },
    { clerkDeleter: fakeClerkDeleter(), r2Delete: async () => { deleteAttempts += 1; return { deleted: true }; } }
  );
  assert.equal(result.outcome, "completed");
  if (result.outcome !== "completed") return;

  assert.equal(result.mediaAssetsTombstoned, 1);
  assert.equal(result.mediaAssetsLegalHoldExcluded, 1);
  assert.equal(deleteAttempts, 1, "only the non-held asset's R2 object should be touched");

  const held = db.state.media_assets.find((a) => a.id === "held");
  assert.equal(held?.tombstoned_at, null, "a legal-hold asset must never be tombstoned");
});

test("executeAccountDeletion: records a real, durable tombstone with the legal_hold_exception flag set honestly", async () => {
  const db = new FakeSupabaseClient();
  seedProfile(db, "user_1");
  db.state.media_assets = [
    { id: "held", clerk_user_id: "user_1", object_key: "k", storage_backend: "r2", legal_hold: true, tombstoned_at: null },
  ];

  await executeAccountDeletion(
    db as never,
    { clerkUserId: "user_1", reasonCode: "dsar_deletion_request", requestedBy: null, executedBy: "admin_1" },
    { clerkDeleter: fakeClerkDeleter(), r2Delete: async () => ({ deleted: true }) }
  );

  const tombstone = db.state.deletion_tombstones.find((t) => t.clerk_user_id === "user_1");
  assert.ok(tombstone);
  assert.equal(tombstone?.legal_hold_exception, true);
  assert.equal(tombstone?.executed_by, "admin_1");
});

test("executeAccountDeletion: a second attempt against an already-tombstoned account is a safe no-op, never a second tombstone or a re-run of the sweep", async () => {
  const db = new FakeSupabaseClient();
  seedProfile(db, "user_1");
  db.state.media_assets = [{ id: "m1", clerk_user_id: "user_1", object_key: "k", storage_backend: "r2", legal_hold: false, tombstoned_at: null }];

  let deleteCalls = 0;
  const deps = { clerkDeleter: fakeClerkDeleter(), r2Delete: async () => { deleteCalls += 1; return { deleted: true }; } };

  const first = await executeAccountDeletion(db as never, { clerkUserId: "user_1", reasonCode: "dsar_deletion_request", requestedBy: null, executedBy: "admin_1" }, deps);
  assert.equal(first.outcome, "completed");
  assert.equal(deleteCalls, 1);

  const second = await executeAccountDeletion(db as never, { clerkUserId: "user_1", reasonCode: "dsar_deletion_request", requestedBy: null, executedBy: "admin_2" }, deps);
  assert.equal(second.outcome, "already_tombstoned");
  assert.equal(deleteCalls, 1, "the sweep must not re-run against an already-tombstoned account");

  assert.equal(db.state.deletion_tombstones.filter((t) => t.clerk_user_id === "user_1").length, 1);
});

test("executeAccountDeletion: a Clerk API failure is recorded honestly, never silently treated as success, and never blocks the Postgres-side erasure that already happened", async () => {
  const db = new FakeSupabaseClient();
  seedProfile(db, "user_1");

  const result = await executeAccountDeletion(
    db as never,
    { clerkUserId: "user_1", reasonCode: "dsar_deletion_request", requestedBy: null, executedBy: "admin_1" },
    { clerkDeleter: fakeClerkDeleter(false), r2Delete: async () => ({ deleted: true }) }
  );
  assert.equal(result.outcome, "completed");
  if (result.outcome !== "completed") return;
  assert.equal(result.clerkAccountDeleted, false);

  // The Postgres-side anonymization must have happened regardless.
  const profile = db.state.profiles.find((p) => p.clerk_user_id === "user_1");
  assert.equal(profile?.username, null);
});

test("executeAccountDeletion: refuses a malformed reason code rather than silently accepting free text", async () => {
  const db = new FakeSupabaseClient();
  seedProfile(db, "user_1");
  await assert.rejects(
    executeAccountDeletion(db as never, { clerkUserId: "user_1", reasonCode: "not a valid code!", requestedBy: null, executedBy: "admin_1" }, {})
  );
});
