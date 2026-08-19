import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildDsarExportBundle, serializeDsarBundle, buildDsarExportObjectKey, MAX_DSAR_BUNDLE_BYTES } from "./dsar-export";
import { FakeSupabaseClient } from "../../test/e2e/fake-supabase";

function envelope(db: FakeSupabaseClient) {
  return db as never;
}

test("buildDsarExportBundle: gathers exactly the calling user's own data, never another user's", async () => {
  const db = new FakeSupabaseClient();
  db.state.profiles = [
    { clerk_user_id: "user_1", username: "alice", email: "alice@example.com", display_name: "Alice", avatar_url: null, plan: "free", created_at: new Date().toISOString() },
    { clerk_user_id: "user_2", username: "bob", email: "bob@example.com", display_name: "Bob", avatar_url: null, plan: "free", created_at: new Date().toISOString() },
  ];
  db.state.projects = [
    { id: "p1", clerk_user_id: "user_1", title: "My project", description: null, status: "draft", created_at: new Date().toISOString() },
    { id: "p2", clerk_user_id: "user_2", title: "Not mine", description: null, status: "draft", created_at: new Date().toISOString() },
  ];
  db.state.generations = [
    { id: "g1", project_id: "p1", clerk_user_id: "user_1", generation_type: "image", provider: "mock", model: "mock-image", prompt: "a cat", negative_prompt: null, status: "completed", created_at: new Date().toISOString(), completed_at: new Date().toISOString() },
  ];
  db.state.media_assets = [
    { id: "m1", clerk_user_id: "user_1", generation_id: "g1", media_type: "image", role: "original", status: "finalized", created_at: new Date().toISOString() },
  ];
  db.state.credit_wallets = [{ clerk_user_id: "user_1", balance: 42 }];
  db.state.credit_ledger = [
    { id: "l1", clerk_user_id: "user_1" },
    { id: "l2", clerk_user_id: "user_1" },
  ];

  const bundle = await buildDsarExportBundle(envelope(db), "user_1");
  assert.equal(bundle.clerkUserId, "user_1");
  assert.equal((bundle.profile as { username: string } | null)?.username, "alice");
  assert.equal(bundle.projects.length, 1);
  assert.equal((bundle.projects[0] as { id: string }).id, "p1");
  assert.equal(bundle.generations.length, 1);
  assert.equal((bundle.generations[0] as { prompt: string }).prompt, "a cat");
  assert.equal(bundle.mediaAssets.length, 1);
  assert.equal(bundle.creditLedgerSummary.currentBalance, 42);
  assert.equal(bundle.creditLedgerSummary.entryCount, 2);
});

test("buildDsarExportBundle: a user with no profile row still returns a well-formed (null-profile) bundle, never throws", async () => {
  const db = new FakeSupabaseClient();
  const bundle = await buildDsarExportBundle(envelope(db), "user_ghost");
  assert.equal(bundle.profile, null);
  assert.deepEqual(bundle.projects, []);
  assert.deepEqual(bundle.generations, []);
  assert.equal(bundle.creditLedgerSummary.currentBalance, null);
  assert.equal(bundle.creditLedgerSummary.entryCount, 0);
});

test("serializeDsarBundle: a normal bundle serializes under the byte cap", () => {
  const result = serializeDsarBundle({
    clerkUserId: "user_1",
    generatedAt: new Date().toISOString(),
    profile: { username: "alice" },
    projects: [],
    generations: [],
    mediaAssets: [],
    creditLedgerSummary: { currentBalance: 0, entryCount: 0 },
  });
  assert.equal(result.outcome, "serialized");
});

test("serializeDsarBundle: refuses rather than silently truncating past the byte cap", () => {
  const hugeString = "x".repeat(MAX_DSAR_BUNDLE_BYTES + 1000);
  const result = serializeDsarBundle({
    clerkUserId: "user_1",
    generatedAt: new Date().toISOString(),
    profile: { note: hugeString },
    projects: [],
    generations: [],
    mediaAssets: [],
    creditLedgerSummary: { currentBalance: 0, entryCount: 0 },
  });
  assert.equal(result.outcome, "too_large");
});

test("buildDsarExportObjectKey: deterministic per (user, request) — a retry rewrites the same object", () => {
  const a = buildDsarExportObjectKey("user_1", "req-1");
  const b = buildDsarExportObjectKey("user_1", "req-1");
  assert.equal(a, b);
  assert.match(a, /^privacy-exports\/user_1\/req-1\.json$/);
});

test("buildDsarExportObjectKey: refuses an unsafe segment rather than building a traversal-prone key", () => {
  assert.throws(() => buildDsarExportObjectKey("../etc", "req-1"));
  assert.throws(() => buildDsarExportObjectKey("user_1", "../../secret"));
});
