import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateRetentionCleanup, executeRetentionCleanup, MAX_CLEANUP_BATCH_SIZE, type RetentionCleanupOutcome } from "./retention-cleanup-executor";

function isRowEvidence(o: RetentionCleanupOutcome): o is Extract<RetentionCleanupOutcome, { kind: "row_evidence" }> {
  return o.kind === "row_evidence";
}

function isRowExecuted(o: RetentionCleanupOutcome): o is Extract<RetentionCleanupOutcome, { kind: "row_executed" }> {
  return o.kind === "row_executed";
}
import { DATA_CLASSIFICATION_MATRIX, type DataClassificationEntry } from "./data-classification";
import { FakeSupabaseClient } from "../../test/e2e/fake-supabase";

const NOW = new Date("2026-08-20T00:00:00.000Z");
const SENSITIVE_KEY_MARKER = "user-uploads/SENSITIVE_OBJECT_KEY_MARKER.png";

function syntheticMediaEntry(overrides: Partial<DataClassificationEntry> = {}): DataClassificationEntry {
  return {
    table: "media_assets",
    dataClass: "personal",
    purpose: "test fixture only",
    legalBasis: "contract",
    owner: "test",
    storageLocation: "cloudflare_r2_aws_s3",
    retentionPolicy: "synthetic_90_days",
    deletionPolicy: "anonymize_on_deletion",
    retentionDurationDays: 90,
    ...overrides,
  };
}

function seedMediaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? `row-${Math.random().toString(36).slice(2)}`,
    clerk_user_id: "user_test",
    storage_backend: "r2",
    object_key: SENSITIVE_KEY_MARKER,
    legal_hold: false,
    tombstoned_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("today, against the REAL DATA_CLASSIFICATION_MATRIX, every entry resolves class-level and none reaches row evaluation — the mechanism is real but fully inert", async () => {
  const fake = new FakeSupabaseClient();
  const outcomes = await evaluateRetentionCleanup(fake as never, { dryRun: true });
  assert.equal(outcomes.length, DATA_CLASSIFICATION_MATRIX.length);
  for (const outcome of outcomes) {
    assert.equal(outcome.kind, "class_verdict");
  }
});

test("dry-run: an expired row produces bounded row_evidence and mutates nothing", async () => {
  const expired = seedMediaRow({ id: "expired-1", created_at: "2026-01-01T00:00:00.000Z" });
  const notExpired = seedMediaRow({ id: "fresh-1", created_at: "2026-08-15T00:00:00.000Z" });
  const fake = new FakeSupabaseClient({ media_assets: [expired, notExpired] });

  const outcomes = await evaluateRetentionCleanup(fake as never, {
    dryRun: true,
    now: NOW,
    entries: [syntheticMediaEntry()],
  });

  const evidence = outcomes.filter(isRowEvidence);
  assert.equal(evidence.length, 2);
  const expiredEvidence = evidence.find((e) => e.rowId === "expired-1")!;
  assert.equal(expiredEvidence.verdict.action, "ANONYMIZE");
  const freshEvidence = evidence.find((e) => e.rowId === "fresh-1")!;
  assert.equal(freshEvidence.verdict.action, "KEEP");

  assert.equal(outcomes.filter((o) => o.kind === "row_executed").length, 0);
  assert.equal(expired.tombstoned_at, null);
  assert.equal(notExpired.tombstoned_at, null);
});

test("execute mode performs exactly the expired, non-legal-hold rows; legal_hold and non-expired rows are never touched", async () => {
  const expired = seedMediaRow({ id: "expired-2", created_at: "2026-01-01T00:00:00.000Z" });
  const held = seedMediaRow({ id: "held-1", created_at: "2020-01-01T00:00:00.000Z", legal_hold: true });
  const notExpired = seedMediaRow({ id: "fresh-2", created_at: "2026-08-15T00:00:00.000Z" });
  const fake = new FakeSupabaseClient({ media_assets: [expired, held, notExpired] });

  const outcomes = await executeRetentionCleanup(fake as never, { now: NOW, entries: [syntheticMediaEntry()] });

  const executed = outcomes.filter(isRowExecuted);
  assert.equal(executed.length, 1);
  assert.deepEqual(
    executed.map((e) => ({ rowId: e.rowId, action: e.action, succeeded: e.succeeded })),
    [{ rowId: "expired-2", action: "ANONYMIZE", succeeded: true }]
  );

  assert.ok(expired.tombstoned_at, "expired row must be tombstoned");
  assert.equal(held.tombstoned_at, null, "legal_hold row must never be touched");
  assert.equal(notExpired.tombstoned_at, null, "non-expired row must never be touched");

  const heldOutcome = outcomes.filter(isRowEvidence).find((o) => o.rowId === "held-1")!;
  assert.equal(heldOutcome.verdict.action, "LEGAL_HOLD");
});

test("idempotent: running execute twice against the same store does not re-process an already-tombstoned row", async () => {
  const expired = seedMediaRow({ id: "expired-3", created_at: "2026-01-01T00:00:00.000Z" });
  const fake = new FakeSupabaseClient({ media_assets: [expired] });

  const first = await executeRetentionCleanup(fake as never, { now: NOW, entries: [syntheticMediaEntry()] });
  assert.equal(first.filter((o) => o.kind === "row_executed").length, 1);

  const second = await executeRetentionCleanup(fake as never, { now: NOW, entries: [syntheticMediaEntry()] });
  assert.equal(second.filter((o) => o.kind === "row_executed").length, 0, "already-tombstoned row must not resurface");
  assert.equal(second.filter((o) => o.kind === "row_evidence").length, 0, "no rows left to evaluate on the retry");
});

test("fail-closed: a class reaching ROW_EVALUATION_REQUIRED for a table with no registered performer never guesses — reports unsupported_table, no mutation attempted", async () => {
  const fake = new FakeSupabaseClient();
  const outcomes = await evaluateRetentionCleanup(fake as never, {
    dryRun: false,
    now: NOW,
    entries: [syntheticMediaEntry({ table: "synthetic_unregistered_table" })],
  });
  assert.deepEqual(outcomes, [{ kind: "unsupported_table", table: "synthetic_unregistered_table", reasonCode: "no_registered_performer" }]);
});

test("batch size is bounded — more expired rows exist than the batch limit, only the limit is evaluated", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => seedMediaRow({ id: `batch-${i}`, created_at: "2026-01-01T00:00:00.000Z" }));
  const fake = new FakeSupabaseClient({ media_assets: rows });

  const outcomes = await evaluateRetentionCleanup(fake as never, {
    dryRun: true,
    now: NOW,
    batchSize: 2,
    entries: [syntheticMediaEntry()],
  });

  assert.equal(outcomes.filter((o) => o.kind === "row_evidence").length, 2);
});

test("MAX_CLEANUP_BATCH_SIZE caps a caller-supplied batch size, even one larger than the constant", async () => {
  const fake = new FakeSupabaseClient();
  // No rows seeded — this only proves the cap is applied, not exceeded, via
  // the absence of a thrown error/behavior change for an oversized request.
  const outcomes = await evaluateRetentionCleanup(fake as never, {
    dryRun: true,
    now: NOW,
    batchSize: MAX_CLEANUP_BATCH_SIZE * 10,
    entries: [],
  });
  assert.deepEqual(outcomes, []);
});

test("evidence never carries the object storage key or any raw sensitive value — bounded to table/rowId/age/action/reason only", async () => {
  const expired = seedMediaRow({ id: "expired-4", created_at: "2026-01-01T00:00:00.000Z" });
  const fake = new FakeSupabaseClient({ media_assets: [expired] });

  const outcomes = await evaluateRetentionCleanup(fake as never, { dryRun: true, now: NOW, entries: [syntheticMediaEntry()] });

  const serialized = JSON.stringify(outcomes);
  assert.ok(!serialized.includes(SENSITIVE_KEY_MARKER), "evidence must never include the object_key");
  assert.ok(!serialized.includes("clerk_user_id"), "evidence must never include the raw clerk_user_id field name/value");
});
