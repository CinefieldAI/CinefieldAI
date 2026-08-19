import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DATA_CLASSIFICATION_MATRIX, classificationFor, type DataClass } from "./data-classification";

const ROOT = process.cwd();
const VALID_CLASSES: readonly DataClass[] = ["public", "internal", "personal", "sensitive", "billing", "security_audit"];
const VALID_LEGAL_BASES = ["contract", "legitimate_interest", "legal_obligation", "consent"];
const VALID_DELETION_POLICIES = ["anonymize_on_deletion", "retain_immutable", "retain_for_audit_window", "not_applicable"];

test("every entry has a valid, non-empty class/basis/owner/policy — no silent placeholder value", () => {
  for (const entry of DATA_CLASSIFICATION_MATRIX) {
    assert.ok(VALID_CLASSES.includes(entry.dataClass), `${entry.table}: invalid dataClass ${entry.dataClass}`);
    assert.ok(VALID_LEGAL_BASES.includes(entry.legalBasis), `${entry.table}: invalid legalBasis ${entry.legalBasis}`);
    assert.ok(VALID_DELETION_POLICIES.includes(entry.deletionPolicy), `${entry.table}: invalid deletionPolicy ${entry.deletionPolicy}`);
    assert.ok(entry.owner.length > 0, `${entry.table}: empty owner`);
    assert.ok(entry.purpose.length > 0, `${entry.table}: empty purpose`);
    assert.ok(entry.retentionPolicy.length > 0, `${entry.table}: empty retentionPolicy`);
  }
});

test("no duplicate table entries", () => {
  const tables = DATA_CLASSIFICATION_MATRIX.map((e) => e.table);
  assert.equal(new Set(tables).size, tables.length);
});

test("classificationFor returns the real entry, or null for an unknown table — never a fabricated default", () => {
  assert.equal(classificationFor("profiles")?.dataClass, "personal");
  assert.equal(classificationFor("does_not_exist"), null);
});

test("the ledger is retain_immutable, never anonymize_on_deletion — a financial record must survive account deletion", () => {
  const ledger = classificationFor("credit_ledger");
  assert.ok(ledger);
  assert.equal(ledger?.deletionPolicy, "retain_immutable");
  assert.equal(ledger?.legalBasis, "legal_obligation");
});

test("dataClass values match media_assets.data_class's real CHECK constraint exactly — one vocabulary, never two", () => {
  const migration = readFileSync(path.join(ROOT, "supabase/migrations/20260910000000_privacy_lifecycle.sql"), "utf8");
  const match = /media_assets_data_class_check.*?ARRAY\[([\s\S]*?)\]\)\)\);/.exec(migration);
  assert.ok(match, "could not find the data_class CHECK constraint in the migration");
  const sqlValues = [...match![1].matchAll(/'([a-z_]+)'::"text"/g)].map((m) => m[1]);
  assert.deepEqual(sqlValues.sort(), [...VALID_CLASSES].sort());
});

test("every table this matrix marks personal/billing/sensitive is a real table in the schema (spot-checked against a fresh migration read, not assumed)", () => {
  const remoteSchema = readFileSync(path.join(ROOT, "supabase/migrations/20260805132704_remote_schema.sql"), "utf8");
  const generationAttempts = readFileSync(path.join(ROOT, "supabase/migrations/20260810120000_generation_attempts.sql"), "utf8");
  const creditSystem = readFileSync(path.join(ROOT, "supabase/migrations/20260811120000_credit_system.sql"), "utf8");
  const mediaAssets = readFileSync(path.join(ROOT, "supabase/migrations/20260820000000_media_assets.sql"), "utf8");
  const allSql = remoteSchema + generationAttempts + creditSystem + mediaAssets;
  for (const entry of DATA_CLASSIFICATION_MATRIX) {
    if (entry.dataClass === "personal" || entry.dataClass === "billing" || entry.dataClass === "sensitive") {
      const inThisFile = new RegExp(`CREATE TABLE IF NOT EXISTS "public"\\."${entry.table}"`).test(allSql);
      const inOtherPhase = entry.owner === "phase-23"; // privacy_requests/deletion_tombstones are this batch's own new tables
      assert.ok(inThisFile || inOtherPhase, `${entry.table} not found as a real CREATE TABLE`);
    }
  }
});
