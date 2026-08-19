import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveClassRetention, resolveRowRetention } from "./retention-policy-resolver";
import { DATA_CLASSIFICATION_MATRIX, type DataClassificationEntry } from "./data-classification";

test("every one of the 14 real classification entries resolves to a real verdict, none fabricates a DELETE/ANONYMIZE action — no real entry has a defined retention duration today", () => {
  for (const entry of DATA_CLASSIFICATION_MATRIX) {
    const verdict = resolveClassRetention(entry);
    assert.notEqual(verdict.action, "ROW_EVALUATION_REQUIRED", `${entry.table} must not resolve to row evaluation — no real duration is defined for it`);
  }
});

test("account_lifetime classes resolve to KEEP — already enforced by AccountDeletionWorkflow, never an independent age cutoff", () => {
  for (const table of ["profiles", "projects", "generations", "generation_attempts", "media_assets", "credit_wallets", "credit_reservations"]) {
    const entry = DATA_CLASSIFICATION_MATRIX.find((e) => e.table === table);
    assert.ok(entry, `${table} must exist in the matrix`);
    const verdict = resolveClassRetention(entry!);
    assert.equal(verdict.action, "KEEP");
    assert.equal(verdict.reasonCode, "tied_to_account_lifecycle_not_independently_time_expirable");
  }
});

test("credit_ledger resolves to RETAIN_IMMUTABLE — financial record-keeping, never cleaned up by this mechanism", () => {
  const entry = DATA_CLASSIFICATION_MATRIX.find((e) => e.table === "credit_ledger")!;
  const verdict = resolveClassRetention(entry);
  assert.deepEqual(verdict, { action: "RETAIN_IMMUTABLE", reasonCode: "financial_or_legal_record" });
});

test("the four structurally append-only tables resolve to RETAIN_IMMUTABLE, correctly distinguished from a business-decision-pending audit window", () => {
  for (const table of ["security_events", "admin_privileged_action_events", "feature_flag_audit", "deletion_tombstones"]) {
    const entry = DATA_CLASSIFICATION_MATRIX.find((e) => e.table === table)!;
    const verdict = resolveClassRetention(entry);
    assert.deepEqual(verdict, { action: "RETAIN_IMMUTABLE", reasonCode: "append_only_schema_constraint" });
  }
});

test("model_eval_runs resolves to NOT_APPLICABLE — no user identity", () => {
  const entry = DATA_CLASSIFICATION_MATRIX.find((e) => e.table === "model_eval_runs")!;
  assert.deepEqual(resolveClassRetention(entry), { action: "NOT_APPLICABLE", reasonCode: "no_user_identity" });
});

test("privacy_requests resolves to BUSINESS_DECISION_REQUIRED — a retention window is intended but no explicit duration exists, and nothing here invents one", () => {
  const entry = DATA_CLASSIFICATION_MATRIX.find((e) => e.table === "privacy_requests")!;
  assert.deepEqual(resolveClassRetention(entry), { action: "BUSINESS_DECISION_REQUIRED", reasonCode: "no_explicit_retention_duration_defined" });
});

// ---- Row-level logic — proven against a SYNTHETIC entry, never a real one ----
// (no real DATA_CLASSIFICATION_MATRIX entry has retentionDurationDays set,
// and this file must not be the place that sets one on a real table.)

function syntheticEntry(overrides: Partial<DataClassificationEntry> = {}): DataClassificationEntry {
  return {
    table: "synthetic_test_table",
    dataClass: "personal",
    purpose: "test fixture only",
    legalBasis: "legitimate_interest",
    owner: "test",
    storageLocation: "supabase_postgres",
    retentionPolicy: "synthetic_90_days",
    deletionPolicy: "anonymize_on_deletion",
    retentionDurationDays: 90,
    ...overrides,
  };
}

test("a class with a real (synthetic) duration resolves to ROW_EVALUATION_REQUIRED, carrying that exact duration", () => {
  const verdict = resolveClassRetention(syntheticEntry());
  assert.deepEqual(verdict, { action: "ROW_EVALUATION_REQUIRED", durationDays: 90 });
});

const NOW = new Date("2026-08-20T00:00:00.000Z");

test("resolveRowRetention: an expired row (older than the window) resolves to the class's deletion action", () => {
  const verdict = resolveRowRetention({ createdAt: "2026-01-01T00:00:00.000Z" }, 90, "ANONYMIZE", NOW);
  assert.equal(verdict.action, "ANONYMIZE");
  if (verdict.action !== "ANONYMIZE") return;
  assert.equal(verdict.reasonCode, "retention_window_expired");
  assert.ok(verdict.cutoffAt);
});

test("resolveRowRetention: a non-expired row is KEEP, never touched", () => {
  const verdict = resolveRowRetention({ createdAt: "2026-08-01T00:00:00.000Z" }, 90, "ANONYMIZE", NOW);
  assert.deepEqual(verdict, { action: "KEEP", reasonCode: "not_yet_expired" });
});

test("resolveRowRetention: legal_hold dominates regardless of age — even a very old row is never eligible", () => {
  const veryOld = resolveRowRetention({ createdAt: "2020-01-01T00:00:00.000Z", legalHold: true }, 90, "DELETE", NOW);
  assert.deepEqual(veryOld, { action: "LEGAL_HOLD", reasonCode: "legal_hold_active" });
});

test("resolveRowRetention: an invalid/unparseable created_at is NOT_CONFIGURED, never silently treated as expired or not", () => {
  const verdict = resolveRowRetention({ createdAt: "not-a-date" }, 90, "DELETE", NOW);
  assert.deepEqual(verdict, { action: "NOT_CONFIGURED", reasonCode: "invalid_created_at" });
});

test("resolveRowRetention: the exact cutoff boundary (created_at === cutoff) counts as expired, not kept", () => {
  const cutoff = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
  const verdict = resolveRowRetention({ createdAt: cutoff.toISOString() }, 90, "DELETE", NOW);
  assert.equal(verdict.action, "DELETE");
});
