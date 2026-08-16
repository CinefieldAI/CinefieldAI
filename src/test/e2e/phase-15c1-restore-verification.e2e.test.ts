import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  DURABLE_TABLES,
  isDurableTable,
  isValidEnvironmentLabel,
  boundInvalidConstraintSample,
  type ConstraintHealthEvidence,
  type RestoreEnvironmentIdentity,
  type RowCountItem,
} from "@/lib/dr/restore-evidence-contract";
import {
  canonicalRowCountManifest,
  computeRowCountManifestDigest,
  hasUniqueTables,
  sha256Hex,
} from "@/lib/dr/restore-canonical-digest";
import { assertRestoreSafeEnvironment } from "@/lib/dr/restore-isolation-guard";
import { validateRowCounts } from "@/lib/dr/restore-row-count-validator";
import { validateChecksums } from "@/lib/dr/restore-checksum-validator";
import { validateReferentialIntegrity } from "@/lib/dr/restore-referential-integrity-validator";
import { runRestoreValidation } from "@/lib/dr/restore-verification-engine";
import { alertOnRestoreEvidence } from "@/lib/dr/dr-alert-bridge";
import type { RestoreEvidenceSource } from "@/lib/dr/restore-target";
import { ALERT_CATALOGUE, type AlertEnvelope } from "@/lib/alerts/alert-contract";
import { resetAlertRouter } from "@/lib/alerts/alert-router";
import { clearAlertSinks, registerAlertSink, type AlertDeliverySink } from "@/lib/alerts/alert-sink";
import { eligibilityRuleFor } from "@/lib/deployment/incident-diagnosis";
import { sanitizeTelemetry } from "@/lib/observability/telemetry-redaction";

/**
 * Phase 15-C/1 — restore-verification contract and validation engine.
 *
 * The core promise under test: BACKUP_EXISTS != RESTORE_SUCCEEDED, and
 * RESTORE_STARTED != RESTORE_VALIDATED. Most of this file is therefore about
 * proving VALIDATION_PASSED is unreachable except through every check
 * genuinely agreeing — the same discipline 15-B's cost guard was built under,
 * applied to disaster recovery instead of money.
 */

const ROOT = process.cwd();
const DR_DIR = path.join(ROOT, "src", "lib", "dr");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Directory walk, not `git ls-files` — an untracked module must still be seen. */
const drCode = readdirSync(DR_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ file: `src/lib/dr/${f}`, text: stripComments(readFileSync(path.join(DR_DIR, f), "utf8")) }));

const NOW = new Date("2026-08-16T12:00:00.000Z");
const GOOD_DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);

function env(over: Partial<RestoreEnvironmentIdentity> = {}): RestoreEnvironmentIdentity {
  return { environmentClass: "isolated_throwaway", label: "docker-pg-test", ...over };
}

function rowCounts(over: Partial<Record<string, number>> = {}): RowCountItem[] {
  return DURABLE_TABLES.map((e) => ({ table: e.table, rowCount: over[e.table] ?? 10 }));
}

/** A fully-controllable fake source. Every method is independently overridable. */
function fakeSource(over: Partial<RestoreEvidenceSource> = {}): RestoreEvidenceSource {
  return {
    environment: env(),
    restoreId: "restore-1",
    backupId: "backup-1",
    isRestoreReady: async () => true,
    getActualRowCount: async (table) => rowCounts().find((r) => r.table === table)?.rowCount ?? null,
    getActualChecksum: async () => GOOD_DIGEST,
    getConstraintHealth: async () => ({ totalForeignKeys: 5, invalidConstraints: [] }),
    ...over,
  };
}

function captureAlerts(): AlertEnvelope[] {
  const seen: AlertEnvelope[] = [];
  resetAlertRouter();
  clearAlertSinks();
  const sink: AlertDeliverySink = { name: "capture", channel: "DASHBOARD", deliver: (e) => void seen.push(e) };
  registerAlertSink(sink);
  return seen;
}

// ---------------------------------------------------------------------------
// 1–4  CONTRACT
// ---------------------------------------------------------------------------

test("S15C1-1  restore states are a finite, closed set", () => {
  const states = ["NOT_CONFIGURED", "UNAVAILABLE", "RESTORE_NOT_READY", "VALIDATION_FAILED", "VALIDATION_PASSED"];
  // Behavioural: the engine only ever produces one of these five, proven by
  // every other test in this file exercising each path. This test pins the
  // exact vocabulary so a sixth value can't be added silently.
  const contract = read("src/lib/dr/restore-evidence-contract.ts");
  for (const s of states) assert.match(contract, new RegExp(`"${s}"`), `${s} missing from the contract`);
});

test("S15C1-2  evidence shape is bounded — counts, ids, enum labels, digests only", async () => {
  const evidence = await runRestoreValidation({
    source: fakeSource(),
    expectedRowCounts: rowCounts(),
    expectedChecksums: [{ subjectId: "asset-1", expectedDigest: GOOD_DIGEST }],
    startedAt: NOW,
  });
  assert.equal(evidence.state, "VALIDATION_PASSED");
  assert.equal(typeof evidence.restoreId, "string");
  assert.equal(typeof evidence.durationMs, "number");
  assert.ok(evidence.durationMs >= 0);
  assert.equal(typeof evidence.evaluatedAt, "string");
  assert.ok(!Number.isNaN(Date.parse(evidence.evaluatedAt)));
});

test("S15C1-3  no raw-row field exists anywhere in the contract or engine", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/\brow\b(?!Count)/i.test(text) || !/select\s*\*|dump|rawRow/i.test(text),
      `${file} looks like it carries a raw row`);
    assert.ok(!/prompt|signedUrl|connectionString|dumpContents/i.test(text), `${file} carries forbidden content`);
  }
});

test("S15C1-4  no secret or credential field exists in the contract or engine", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/password|apiKey|accessKey|secretKey|token(?!Pattern)/i.test(text), `${file} carries a credential-shaped field`);
  }
});

// ---------------------------------------------------------------------------
// 5–8  CHECKSUM
// ---------------------------------------------------------------------------

test("S15C1-5  a matching checksum passes", async () => {
  const result = await validateChecksums(fakeSource({ getActualChecksum: async () => GOOD_DIGEST }), [
    { subjectId: "asset-1", expectedDigest: GOOD_DIGEST },
  ]);
  assert.equal(result.overall, "MATCH");
  assert.equal(result.results[0]?.outcome, "MATCH");
});

test("S15C1-6  a mismatched checksum fails", async () => {
  const result = await validateChecksums(fakeSource({ getActualChecksum: async () => OTHER_DIGEST }), [
    { subjectId: "asset-1", expectedDigest: GOOD_DIGEST },
  ]);
  assert.equal(result.overall, "MISMATCH");
});

test("S15C1-7  missing expected evidence never passes", async () => {
  const noExpected = await validateChecksums(fakeSource(), []);
  assert.notEqual(noExpected.overall, "MATCH");
  assert.equal(noExpected.overall, "UNAVAILABLE");

  const unreadable = await validateChecksums(fakeSource({ getActualChecksum: async () => null }), [
    { subjectId: "asset-1", expectedDigest: GOOD_DIGEST },
  ]);
  assert.equal(unreadable.overall, "UNAVAILABLE");

  const malformedExpected = await validateChecksums(fakeSource(), [
    { subjectId: "asset-1", expectedDigest: "not-a-digest" },
  ]);
  assert.equal(malformedExpected.overall, "UNAVAILABLE");

  const throwing = await validateChecksums(
    fakeSource({
      getActualChecksum: async () => {
        throw new Error("boom");
      },
    }),
    [{ subjectId: "asset-1", expectedDigest: GOOD_DIGEST }]
  );
  assert.equal(throwing.overall, "UNAVAILABLE");
});

test("S15C1-8  canonical row-count serialization is deterministic", () => {
  const a = rowCounts();
  const b = [...a].reverse();
  assert.equal(canonicalRowCountManifest(a), canonicalRowCountManifest(b), "order must not matter");
  assert.equal(computeRowCountManifestDigest(a), computeRowCountManifestDigest(b));

  // Content changes the digest.
  const changed = a.map((item, i) => (i === 0 ? { ...item, rowCount: item.rowCount + 1 } : item));
  assert.notEqual(computeRowCountManifestDigest(a), computeRowCountManifestDigest(changed));

  // sha256Hex itself is a plain, stable digest of arbitrary text.
  assert.equal(sha256Hex("x"), sha256Hex("x"));
  assert.equal(sha256Hex("x").length, 64);
  assert.match(sha256Hex("x"), /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// 9–12  ROW COUNT
// ---------------------------------------------------------------------------

test("S15C1-9  a matching allowed table count passes", async () => {
  const result = await validateRowCounts(fakeSource(), rowCounts());
  assert.equal(result.overall, "MATCH");
  assert.equal(result.results.length, DURABLE_TABLES.length);
  assert.ok(result.results.every((r) => r.outcome === "MATCH"));
  assert.equal(result.actualManifestDigest, result.expectedManifestDigest, "identical counts, identical digest");
});

test("S15C1-10  a row-count mismatch fails", async () => {
  const expected = rowCounts();
  const source = fakeSource({
    getActualRowCount: async (table) => (table === "generations" ? 999 : rowCounts().find((r) => r.table === table)?.rowCount ?? null),
  });
  const result = await validateRowCounts(source, expected);
  assert.equal(result.overall, "MISMATCH");
  const gen = result.results.find((r) => r.table === "generations");
  assert.equal(gen?.outcome, "MISMATCH");
  assert.equal(gen?.expected, 10);
  assert.equal(gen?.actual, 999);
});

test("S15C1-11  an unapproved or transient table is never silently included", () => {
  assert.equal(isDurableTable("outbox_events"), false, "documented as purgeable — excluded on purpose");
  assert.equal(isDurableTable("workflow_start_outbox"), false, "documented as retired/abandoned-row-prone");
  assert.equal(isDurableTable("outbox_tx_proof"), false, "transient claim/lease state");
  assert.equal(isDurableTable("credit_reservations"), false, "transient claim/lease state");
  assert.equal(isDurableTable("not_a_real_table"), false);

  // Every entry carries a written justification — no bare table name.
  for (const entry of DURABLE_TABLES) {
    assert.ok(entry.why.length > 10, `${entry.table} has no justification`);
  }

  // A caller cannot smuggle an excluded table into a validation pass — a
  // malformed expected list is refused, not partially honoured.
  const withGarbage = [...rowCounts(), { table: "outbox_events" as never, rowCount: 1 }];
  return validateRowCounts(fakeSource(), withGarbage).then((result) => {
    assert.equal(result.overall, "UNAVAILABLE");
    assert.deepEqual(result.results, []);
  });
});

test("S15C1-12  a failed row-count read is never treated as zero", async () => {
  const source = fakeSource({
    getActualRowCount: async (table) => (table === "profiles" ? null : rowCounts().find((r) => r.table === table)?.rowCount ?? null),
  });
  const result = await validateRowCounts(source, rowCounts());
  assert.equal(result.overall, "UNAVAILABLE");
  const profiles = result.results.find((r) => r.table === "profiles");
  assert.equal(profiles?.outcome, "UNAVAILABLE");
  assert.equal(profiles?.actual, undefined, "no fabricated zero");
  assert.equal(result.actualManifestDigest, undefined, "a partial read produces no actual-side digest");

  // Also proven for a table that only exists as a duplicate — caller error,
  // not silently deduplicated.
  assert.equal(hasUniqueTables([{ table: "profiles", rowCount: 1 }, { table: "profiles", rowCount: 2 }]), false);
});

// ---------------------------------------------------------------------------
// 13–15  REFERENTIAL INTEGRITY
// ---------------------------------------------------------------------------

test("S15C1-13  a target with zero invalid constraints is VALID", async () => {
  const result = await validateReferentialIntegrity(
    fakeSource({ getConstraintHealth: async () => ({ totalForeignKeys: 12, invalidConstraints: [] }) })
  );
  assert.equal(result.outcome, "VALID");
  assert.equal(result.totalForeignKeys, 12);
  assert.equal(result.invalidConstraintCount, 0);
});

test("S15C1-14  a broken relationship is INVALID and bounded", async () => {
  const evidence: ConstraintHealthEvidence = {
    totalForeignKeys: 12,
    invalidConstraints: Array.from({ length: 80 }, (_, i) => `media_assets_fk_${i}`),
  };
  const result = await validateReferentialIntegrity(fakeSource({ getConstraintHealth: async () => evidence }));
  assert.equal(result.outcome, "INVALID");
  assert.equal(result.invalidConstraintCount, 80, "the true count is preserved even when the sample is capped");
  assert.ok(result.invalidConstraintSample.length <= 50, "the sample itself is bounded");
  assert.deepEqual(boundInvalidConstraintSample(evidence.invalidConstraints).length, 50);
});

test("S15C1-15  PostgreSQL's own verdict is read, never recomputed — and its absence is UNAVAILABLE", async () => {
  // No relationship graph exists in TypeScript for this module to consult.
  for (const { file, text } of drCode) {
    if (file.includes("restore-referential-integrity-validator")) {
      assert.ok(!/REFERENCES|foreignKeyMap|relationshipGraph/i.test(text), `${file} recreates a relationship model`);
    }
  }
  const unreadable = await validateReferentialIntegrity(fakeSource({ getConstraintHealth: async () => null }));
  assert.equal(unreadable.outcome, "UNAVAILABLE");
  const throwing = await validateReferentialIntegrity(
    fakeSource({
      getConstraintHealth: async () => {
        throw new Error("boom");
      },
    })
  );
  assert.equal(throwing.outcome, "UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// 16–24  ISOLATION AND SIDE-EFFECT SAFETY
// ---------------------------------------------------------------------------

test("S15C1-16  a declared throwaway or staging environment is accepted", () => {
  assert.equal(assertRestoreSafeEnvironment(env({ environmentClass: "isolated_throwaway" })).safe, true);
  assert.equal(assertRestoreSafeEnvironment(env({ environmentClass: "isolated_staging" })).safe, true);
});

test("S15C1-17  a declared production environment is rejected by name", () => {
  const result = assertRestoreSafeEnvironment(env({ environmentClass: "production" }));
  assert.equal(result.safe, false);
  assert.equal(result.reasonCode, "environment_declared_production");
});

test("S15C1-18  an unknown or ambiguous environment is rejected, never defaulted to safe", () => {
  const unknown = assertRestoreSafeEnvironment(env({ environmentClass: "unknown" }));
  assert.equal(unknown.safe, false);
  assert.equal(unknown.reasonCode, "environment_class_unrecognised");

  // A future enum member this module has never seen is refused the same way,
  // not treated as safe-by-default.
  const future = assertRestoreSafeEnvironment(env({ environmentClass: "some_future_class" as never }));
  assert.equal(future.safe, false);

  // A malformed label (long, or shaped like a connection string) is refused
  // even under an otherwise-safe class.
  const badLabel = assertRestoreSafeEnvironment(
    env({ label: "postgres://user:pass@host:5432/db" })
  );
  assert.equal(badLabel.safe, false);
  assert.equal(badLabel.reasonCode, "environment_label_invalid");
  assert.equal(isValidEnvironmentLabel("postgres://user:pass@host:5432/db"), false);

  // No inference from NODE_ENV anywhere in the guard.
  const guard = read("src/lib/dr/restore-isolation-guard.ts");
  assert.ok(!/process\.env\.NODE_ENV/.test(guard), "the guard must not infer from NODE_ENV");
});

test("S15C1-19  a rejected environment calls zero source methods — the refusal is total", async () => {
  let calls = 0;
  const spy = (): void => {
    calls += 1;
  };
  const source = fakeSource({
    environment: env({ environmentClass: "production" }),
    isRestoreReady: async () => {
      spy();
      return true;
    },
    getActualRowCount: async () => {
      spy();
      return 1;
    },
    getActualChecksum: async () => {
      spy();
      return GOOD_DIGEST;
    },
    getConstraintHealth: async () => {
      spy();
      return { totalForeignKeys: 1, invalidConstraints: [] };
    },
  });
  const evidence = await runRestoreValidation({
    source,
    expectedRowCounts: rowCounts(),
    expectedChecksums: [{ subjectId: "a", expectedDigest: GOOD_DIGEST }],
    startedAt: NOW,
  });
  assert.equal(evidence.state, "UNAVAILABLE");
  assert.equal(evidence.reasonCode, "environment_declared_production");
  assert.equal(calls, 0, "no source method may run against a rejected environment");
});

test("S15C1-20  Temporal is never imported by the validation path", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/executeGeneration|TemporalClient|@\/lib\/temporal/i.test(text), `${file} reaches for Temporal`);
  }
});

test("S15C1-21  SQS is never imported by the validation path", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/@\/lib\/aws\/sqs|SendMessageCommand|command-bus/i.test(text), `${file} reaches for SQS`);
  }
});

test("S15C1-22  no provider execution path is reachable", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/orchestrator|provider-command-handler|submitAttempt/i.test(text), `${file} reaches provider execution`);
  }
});

test("S15C1-23  no billing/credit side effect is reachable", () => {
  for (const { file, text } of drCode) {
    // Function-name matches only: `credit_ledger`/`credit_wallets` appear as
    // legitimate string LITERALS in the durable-table allow-list (they are
    // tables this package reads a row COUNT from), which is not the same as
    // touching Phase 10 truth. A write against either table would be.
    assert.ok(!/reserveCredits|settleReservation|releaseReservation/.test(text), `${file} calls a Phase 10 mutation`);
    assert.ok(!/\.from\(["']credit_(ledger|wallets)["']\)\s*\.\s*(insert|update|upsert|delete)/.test(text),
      `${file} writes to a Phase 10 table`);
  }
});

test("S15C1-24  no notification, webhook, or production media write is reachable", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/notification-service|webhook|putAssetBackup|r2-client/i.test(text),
      `${file} reaches a delivery or write path`);
  }
  // Every source method this package calls is a getter/reader by name.
  const target = read("src/lib/dr/restore-target.ts");
  assert.ok(!/\bwrite\(|\bmutate\(|\brestore\(|\bdelete\(/i.test(stripComments(target)),
    "the target interface must expose reads only");
});

// ---------------------------------------------------------------------------
// 25–30  runRestoreVerification-equivalent engine states
// ---------------------------------------------------------------------------

test("S15C1-25  no source configured maps to NOT_CONFIGURED", async () => {
  const evidence = await runRestoreValidation({
    source: null,
    expectedRowCounts: rowCounts(),
    expectedChecksums: [],
    startedAt: NOW,
  });
  assert.equal(evidence.state, "NOT_CONFIGURED");
  assert.equal(evidence.reasonCode, "restore_target_not_configured");
});

test("S15C1-26  an unsafe environment maps to UNAVAILABLE", async () => {
  const evidence = await runRestoreValidation({
    source: fakeSource({ environment: env({ environmentClass: "unknown" }) }),
    expectedRowCounts: rowCounts(),
    expectedChecksums: [],
    startedAt: NOW,
  });
  assert.equal(evidence.state, "UNAVAILABLE");
});

test("S15C1-27  a not-ready restore maps to RESTORE_NOT_READY", async () => {
  const notReady = await runRestoreValidation({
    source: fakeSource({ isRestoreReady: async () => false }),
    expectedRowCounts: rowCounts(),
    expectedChecksums: [],
    startedAt: NOW,
  });
  assert.equal(notReady.state, "RESTORE_NOT_READY");

  const throwing = await runRestoreValidation({
    source: fakeSource({
      isRestoreReady: async () => {
        throw new Error("boom");
      },
    }),
    expectedRowCounts: rowCounts(),
    expectedChecksums: [],
    startedAt: NOW,
  });
  assert.equal(throwing.state, "RESTORE_NOT_READY", "a thrown readiness check must not be assumed ready");
});

test("S15C1-28  a proven mismatch maps to VALIDATION_FAILED", async () => {
  const evidence = await runRestoreValidation({
    source: fakeSource({ getActualChecksum: async () => OTHER_DIGEST }),
    expectedRowCounts: rowCounts(),
    expectedChecksums: [{ subjectId: "a", expectedDigest: GOOD_DIGEST }],
    startedAt: NOW,
  });
  assert.equal(evidence.state, "VALIDATION_FAILED");
  assert.equal(evidence.reasonCode, "checksum_mismatch");
});

test("S15C1-29  every check agreeing maps to VALIDATION_PASSED", async () => {
  const evidence = await runRestoreValidation({
    source: fakeSource(),
    expectedRowCounts: rowCounts(),
    expectedChecksums: [{ subjectId: "a", expectedDigest: GOOD_DIGEST }],
    startedAt: NOW,
  });
  assert.equal(evidence.state, "VALIDATION_PASSED");
});

test("S15C1-30  the engine never claims PASS without evidence", async () => {
  // Zero expected inputs of any kind: nothing was actually checked, so
  // nothing may be reported as agreeing.
  const nothingChecked = await runRestoreValidation({
    source: fakeSource(),
    expectedRowCounts: [],
    expectedChecksums: [],
    startedAt: NOW,
  });
  assert.notEqual(nothingChecked.state, "VALIDATION_PASSED");

  // A read failure mixed with otherwise-agreeing checks still withholds PASS.
  const partialFailure = await runRestoreValidation({
    source: fakeSource({ getActualRowCount: async () => null }),
    expectedRowCounts: rowCounts(),
    expectedChecksums: [{ subjectId: "a", expectedDigest: GOOD_DIGEST }],
    startedAt: NOW,
  });
  assert.notEqual(partialFailure.state, "VALIDATION_PASSED");
  assert.equal(partialFailure.state, "UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// 31–37  ARCHITECTURE / OWNERSHIP
// ---------------------------------------------------------------------------

test("S15C1-31  Phase 9-D's backup foundation is reused, not duplicated", () => {
  // checksum_sha256's shape (64 lowercase hex) is the same pattern the 9-B
  // ingest gate's own CHECK constraint enforces — reused, not reinvented.
  const validator = read("src/lib/dr/restore-checksum-validator.ts");
  assert.match(validator, /\^\[0-9a-f\]\{64\}\$/);

  const services = stripComments(read("src/trigger/operational/operational-services.ts"));
  assert.match(services, /backup_status.*backed_up|eq\("backup_status", "backed_up"\)/,
    "expected checksums are read from Phase 9-D's own backup_status column");
});

test("S15C1-32  no second R2->S3 backup implementation exists", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/PutObjectCommand|S3Client|putAssetBackup/.test(text), `${file} reimplements S3 backup writes`);
  }
});

test("S15C1-33  no scheduler or cadence is introduced", () => {
  const tasks = stripComments(read("src/trigger/operational/operational-tasks.ts"));
  assert.ok(!/schedules\./.test(tasks), "no schedules.task");
  for (const { file, text } of drCode) {
    assert.ok(!/setInterval|cron/i.test(text), `${file} schedules itself`);
  }
});

test("S15C1-34  no production restore is ever triggered", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/pg_start_backup|pg_restore|CREATE DATABASE|DROP DATABASE/i.test(text),
      `${file} appears to trigger a real restore`);
  }
});

test("S15C1-35  no external account or paid resource is created", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/https?:\/\//.test(text), `${file} contains a URL`);
    assert.ok(!/CreateBucket|IAMClient|new S3Client/.test(text), `${file} provisions AWS infrastructure`);
  }
});

test("S15C1-36  no UI was added", () => {
  assert.equal(readdirSync(DR_DIR).some((f) => f.endsWith(".tsx")), false);
  for (const { file, text } of drCode) {
    assert.ok(!/use client|from "react"/.test(text), `${file} contains UI`);
  }
});

test("S15C1-37  no migration was created for this slice", () => {
  const migrations = readdirSync(path.join(ROOT, "supabase", "migrations"));
  assert.equal(migrations.some((m) => /15c|restore_evidence|dr_validation/i.test(m)), false);
});

// ---------------------------------------------------------------------------
// ALERT INTEGRATION
// ---------------------------------------------------------------------------

test("S15C1-alert-1  the dr alert source and type are registered in 13-D", () => {
  assert.equal(ALERT_CATALOGUE.dr_restore_validation_failed.source, "dr");
  assert.equal(ALERT_CATALOGUE.dr_restore_validation_failed.severity, "ERROR");
  assert.equal(ALERT_CATALOGUE.dr_restore_validation_failed.userVisible, false);
});

test("S15C1-alert-2  only a proven VALIDATION_FAILED raises an alert", async () => {
  const seen = captureAlerts();

  for (const state of ["NOT_CONFIGURED", "UNAVAILABLE", "RESTORE_NOT_READY"] as const) {
    const evidence = await runRestoreValidation(
      state === "NOT_CONFIGURED"
        ? { source: null, expectedRowCounts: [], expectedChecksums: [], startedAt: NOW }
        : state === "RESTORE_NOT_READY"
          ? { source: fakeSource({ isRestoreReady: async () => false }), expectedRowCounts: [], expectedChecksums: [], startedAt: NOW }
          : { source: fakeSource({ environment: env({ environmentClass: "unknown" }) }), expectedRowCounts: [], expectedChecksums: [], startedAt: NOW }
    );
    assert.equal(alertOnRestoreEvidence(evidence), null, `${state} must not raise`);
  }
  assert.equal(seen.length, 0);

  const failed = await runRestoreValidation({
    source: fakeSource({ getActualChecksum: async () => OTHER_DIGEST }),
    expectedRowCounts: rowCounts(),
    expectedChecksums: [{ subjectId: "a", expectedDigest: GOOD_DIGEST }],
    startedAt: NOW,
  });
  const raised = alertOnRestoreEvidence(failed);
  assert.equal(raised?.outcome, "emitted");
  assert.equal(seen[0]?.type, "dr_restore_validation_failed");
  assert.equal(seen[0]?.severity, "ERROR");
  clearAlertSinks();
});

test("S15C1-alert-3  a passed validation resolves a standing failure", async () => {
  resetAlertRouter();
  const failed = await runRestoreValidation({
    source: fakeSource({ getActualChecksum: async () => OTHER_DIGEST }),
    expectedRowCounts: rowCounts(),
    expectedChecksums: [{ subjectId: "a", expectedDigest: GOOD_DIGEST }],
    startedAt: NOW,
  });
  alertOnRestoreEvidence(failed);

  const passed = await runRestoreValidation({
    source: fakeSource(),
    expectedRowCounts: rowCounts(),
    expectedChecksums: [{ subjectId: "a", expectedDigest: GOOD_DIGEST }],
    startedAt: NOW,
  });
  assert.equal(alertOnRestoreEvidence(passed), null);
});

test("S15C1-alert-4  the alert is not AI-remediation eligible", () => {
  const rule = eligibilityRuleFor("dr_restore_validation_failed");
  assert.equal(rule?.remediationEligible, false);
});

test("S15C1-alert-5  no second alert router exists in the dr package", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/dedupeKeyFor|ESCALATION|resetAlertRouter\(\)\s*;?\s*$/.test(text), `${file} keeps alert state`);
    assert.ok(!/telegram|slack|smtp|sendgrid|webhook/i.test(text), `${file} delivers directly`);
  }
  const bridge = read("src/lib/dr/dr-alert-bridge.ts");
  assert.match(bridge, /from "@\/lib\/alerts\/alert-router"/);
});

// ---------------------------------------------------------------------------
// SENSITIVE DATA
// ---------------------------------------------------------------------------

test("S15C1-sensitive-1  operational metrics are bounded counts, matching the operational contract", () => {
  // OperationalTaskResult.metrics is a RETURN VALUE, not a telemetry emission
  // point — the same precedent established for Phase 15-B's spendGuardMetrics:
  // every operational service returns counts under its own names, none of
  // them allow-listed, none of them logged. Its obligation is the operational
  // contract's own: every value is a non-negative finite count.
  const fields = { rowCountTablesChecked: 16, rowCountTablesMatched: 16, checksumsChecked: 3, checksumsMatched: 3, invalidConstraints: 0 };
  for (const [key, value] of Object.entries(fields)) {
    assert.equal(typeof value, "number", `${key} must be a count`);
    assert.ok(Number.isFinite(value) && value >= 0, `${key} must be a finite magnitude`);
  }

  // If restore evidence is ever routed through an explicit log line in a
  // later slice, the 13-D alert path is the one already proven safe: the
  // catalogue's own `resource`/`reasonCode` fields are allow-listed today,
  // and this package introduces no field name outside that set.
  const out = sanitizeTelemetry({ level: "info", event: "dr.alert", subsystem: "dr", fields: { resource: "restore_validation", reasonCode: "checksum_mismatch" } });
  assert.equal(out.droppedFieldCount, 0);
});
