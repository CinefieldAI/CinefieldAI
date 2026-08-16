import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  RECOVERY_CLASSES,
  RECOVERY_RESULT_STATES,
  RECOVERY_SUCCESS_STATES,
  isRecoverySuccess,
  type RecoveryIncidentEvidence,
  type RecoveryResultState,
} from "@/lib/recovery/recovery-contract";
import {
  CLASSES_REQUIRING_RESTORE_VALIDATION,
  COMPONENT_DURABILITY,
  RPO_TARGETS,
  RTO_TARGETS,
  requiresRestoreValidation,
  resolveRpoTargetSeconds,
  resolveRtoTargetMs,
} from "@/lib/recovery/recovery-target-registry";
import { measureRecovery } from "@/lib/recovery/recovery-measurement-engine";
import { isRuntimeConsideredRecovered } from "@/lib/recovery/recovery-health-bridge";
import { alertOnRecoveryEvidence } from "@/lib/recovery/recovery-alert-bridge";
import { ALERT_CATALOGUE, type AlertEnvelope } from "@/lib/alerts/alert-contract";
import { resetAlertRouter } from "@/lib/alerts/alert-router";
import { clearAlertSinks, registerAlertSink, type AlertDeliverySink } from "@/lib/alerts/alert-sink";
import type { RestoreValidationState } from "@/lib/dr/restore-evidence-contract";

/**
 * Phase 15-D/2 — recovery contract, RTO/RPO model, deterministic measurement.
 *
 * The core promise under test: NO TARGET != SUCCESS, and unknown/malformed
 * evidence can never be classified as a recovered state. Empty registries
 * (`RTO_TARGETS`, `RPO_TARGETS`) must never silently upgrade to "met", and
 * the engine must never touch a provider, money, AWS, or the database.
 */

const ROOT = process.cwd();
const RECOVERY_DIR = path.join(ROOT, "src", "lib", "recovery");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const recoveryCode = readdirSync(RECOVERY_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ file: `src/lib/recovery/${f}`, text: stripComments(readFileSync(path.join(RECOVERY_DIR, f), "utf8")) }));

const NOW = new Date("2026-08-16T13:00:00.000Z");
const T0 = "2026-08-16T12:00:00.000Z"; // startedAt
const T1 = "2026-08-16T12:05:00.000Z"; // recoveryStartedAt
const T2 = "2026-08-16T12:20:00.000Z"; // serviceRestoredAt (+20min from T0)
const T3 = "2026-08-16T12:25:00.000Z"; // validationCompletedAt (+5min from T2)

function incident(over: Partial<RecoveryIncidentEvidence> = {}): RecoveryIncidentEvidence {
  return {
    incidentId: "incident-1",
    recoveryClass: "queue_recovery",
    affectedComponent: "sqs",
    reasonCode: "test_incident",
    startedAt: T0,
    recoveryStartedAt: T1,
    serviceRestoredAt: T2,
    validationCompletedAt: T3,
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

// ===========================================================================
// A. PINNED ENUMS
// ===========================================================================

test("A1: RECOVERY_CLASSES is the documented seven, nothing free-form", () => {
  assert.deepEqual(
    [...RECOVERY_CLASSES].sort(),
    [
      "database_recovery",
      "dependency_recovery",
      "media_recovery",
      "queue_recovery",
      "realtime_recovery",
      "region_outage",
      "worker_recovery",
    ].sort()
  );
});

test("A2: RECOVERY_RESULT_STATES is pinned to exactly six", () => {
  assert.deepEqual(
    [...RECOVERY_RESULT_STATES].sort(),
    [
      "EVIDENCE_UNAVAILABLE",
      "INVALID_EVIDENCE",
      "RECOVERED_NO_TARGET",
      "RECOVERED_OUTSIDE_TARGET",
      "RECOVERED_WITHIN_TARGET",
      "RECOVERY_INCOMPLETE",
    ].sort()
  );
});

test("A3: exactly one state is a real success", () => {
  assert.deepEqual([...RECOVERY_SUCCESS_STATES], ["RECOVERED_WITHIN_TARGET"]);
  for (const state of RECOVERY_RESULT_STATES) {
    assert.equal(isRecoverySuccess(state), state === "RECOVERED_WITHIN_TARGET");
  }
});

// ===========================================================================
// B. DURATION ARITHMETIC
// ===========================================================================

test("1: valid timestamps produce a recoveryDurationMs and validationDurationMs", () => {
  const evidence = measureRecovery({ incident: incident(), now: NOW });
  assert.equal(evidence.recoveryDurationMs, 20 * 60 * 1000);
  assert.equal(evidence.validationDurationMs, 5 * 60 * 1000);
  assert.equal(evidence.result, "RECOVERED_NO_TARGET");
  assert.equal(evidence.evaluatedAt, NOW.toISOString(), "evaluatedAt comes from the injected `now`, never a live clock");
});

test("recoveryDurationMs still computes when recoveryStartedAt/validationCompletedAt are absent", () => {
  const evidence = measureRecovery({
    incident: incident({ recoveryStartedAt: undefined, validationCompletedAt: undefined }),
    now: NOW,
  });
  assert.equal(evidence.recoveryDurationMs, 20 * 60 * 1000);
  assert.equal(evidence.validationDurationMs, undefined);
});

// ===========================================================================
// C. IMPOSSIBLE TIMESTAMP ORDER / MALFORMED TIMESTAMPS
// ===========================================================================

test("2: serviceRestoredAt before startedAt is rejected", () => {
  const evidence = measureRecovery({
    incident: incident({ serviceRestoredAt: "2026-08-16T11:00:00.000Z" }),
    now: NOW,
  });
  assert.equal(evidence.result, "INVALID_EVIDENCE");
  assert.equal(evidence.reasonCode, "timestamp_order_invalid");
});

test("3: no duration is computed for invalid evidence — never a negative one either", () => {
  const evidence = measureRecovery({
    incident: incident({ serviceRestoredAt: "2026-08-16T11:00:00.000Z" }),
    now: NOW,
  });
  assert.equal(evidence.recoveryDurationMs, undefined);
});

test("startedAt missing/unparseable is rejected", () => {
  const evidence = measureRecovery({ incident: incident({ startedAt: "not-a-date" }), now: NOW });
  assert.equal(evidence.result, "INVALID_EVIDENCE");
  assert.equal(evidence.reasonCode, "started_at_unparseable");
});

test("a malformed recoveryStartedAt is rejected even when other timestamps are fine", () => {
  const evidence = measureRecovery({ incident: incident({ recoveryStartedAt: "garbage" }), now: NOW });
  assert.equal(evidence.result, "INVALID_EVIDENCE");
  assert.equal(evidence.reasonCode, "recovery_started_at_unparseable");
});

test("validationCompletedAt before serviceRestoredAt is rejected", () => {
  const evidence = measureRecovery({
    incident: incident({ validationCompletedAt: "2026-08-16T12:10:00.000Z" }),
    now: NOW,
  });
  assert.equal(evidence.result, "INVALID_EVIDENCE");
});

// ===========================================================================
// D. MALFORMED DATA-LOSS OBSERVATION — NEVER COERCED TO ZERO
// ===========================================================================

for (const bad of [NaN, -1, Infinity, -Infinity]) {
  test(`observedDataLossSeconds=${bad} is rejected, not coerced to 0`, () => {
    const evidence = measureRecovery({
      incident: incident({ affectedComponent: "supabase" }),
      now: NOW,
      observedDataLossSeconds: bad,
    });
    assert.equal(evidence.result, "INVALID_EVIDENCE");
    assert.equal(evidence.reasonCode, "observed_data_loss_malformed");
    assert.notEqual(evidence.observedDataLossSeconds, 0);
  });
}

test("observedDataLossSeconds absent (undefined/null) is fine, not an error", () => {
  for (const absent of [undefined, null]) {
    const evidence = measureRecovery({
      incident: incident({ affectedComponent: "supabase" }),
      now: NOW,
      observedDataLossSeconds: absent,
    });
    assert.notEqual(evidence.result, "INVALID_EVIDENCE");
    assert.equal(evidence.observedDataLossSeconds, undefined);
  }
});

// ===========================================================================
// E. RTO
// ===========================================================================

test("4: no RTO target configured => rtoMet is undefined, not true", () => {
  assert.deepEqual(RTO_TARGETS, {}, "the shipped registry must still be empty");
  const evidence = measureRecovery({ incident: incident(), now: NOW });
  assert.equal(evidence.rtoMet, undefined);
  assert.equal(evidence.result, "RECOVERED_NO_TARGET");
  assert.equal(resolveRtoTargetMs("queue_recovery"), null);
});

test("5: RTO target met => RECOVERED_WITHIN_TARGET", () => {
  const evidence = measureRecovery({
    incident: incident(),
    now: NOW,
    rtoRegistry: { queue_recovery: 30 * 60 * 1000 },
  });
  assert.equal(evidence.targetRtoMs, 30 * 60 * 1000);
  assert.equal(evidence.rtoMet, true);
  assert.equal(evidence.result, "RECOVERED_WITHIN_TARGET");
});

test("6: RTO target breached => RECOVERED_OUTSIDE_TARGET", () => {
  const evidence = measureRecovery({
    incident: incident(),
    now: NOW,
    rtoRegistry: { queue_recovery: 10 * 60 * 1000 },
  });
  assert.equal(evidence.rtoMet, false);
  assert.equal(evidence.result, "RECOVERED_OUTSIDE_TARGET");
  assert.equal(evidence.reasonCode, "rto_breached");
});

test("a malformed RTO registry entry resolves to no target, never to a fabricated one", () => {
  for (const bad of [NaN, -5, Infinity, 1.5, 0]) {
    assert.equal(resolveRtoTargetMs("queue_recovery", { queue_recovery: bad }), null);
  }
});

// ===========================================================================
// F. RPO
// ===========================================================================

test("7: no RPO target => rpoMet undefined even with an observation", () => {
  assert.deepEqual(RPO_TARGETS, {}, "the shipped registry must still be empty");
  const evidence = measureRecovery({
    incident: incident({ affectedComponent: "supabase" }),
    now: NOW,
    observedDataLossSeconds: 5,
  });
  assert.equal(evidence.rpoMet, undefined);
});

test("8: RPO target met => RECOVERED_WITHIN_TARGET", () => {
  const evidence = measureRecovery({
    incident: incident({ affectedComponent: "supabase" }),
    now: NOW,
    observedDataLossSeconds: 10,
    rpoRegistry: { supabase: 60 },
  });
  assert.equal(evidence.targetRpoSeconds, 60);
  assert.equal(evidence.rpoMet, true);
  assert.equal(evidence.result, "RECOVERED_WITHIN_TARGET");
});

test("9: RPO target breached => RECOVERED_OUTSIDE_TARGET, dominates a met RTO", () => {
  const evidence = measureRecovery({
    incident: incident({ affectedComponent: "supabase" }),
    now: NOW,
    rtoRegistry: { queue_recovery: 30 * 60 * 1000 },
    observedDataLossSeconds: 10,
    rpoRegistry: { supabase: 5 },
  });
  assert.equal(evidence.rtoMet, true);
  assert.equal(evidence.rpoMet, false);
  assert.equal(evidence.result, "RECOVERED_OUTSIDE_TARGET", "a proven breach on either axis wins");
});

test("a component with no durability class never resolves an RPO target", () => {
  assert.equal(COMPONENT_DURABILITY.temporal, undefined);
  assert.equal(resolveRpoTargetSeconds("temporal", { temporal: 60 } as never), null);
});

test("sqs is deliberately absent from the durability map — it is transport, never the record of truth", () => {
  assert.equal(COMPONENT_DURABILITY.sqs, undefined);
});

// ===========================================================================
// G. EVIDENCE UNAVAILABLE != SUCCESS
// ===========================================================================

test("10: required validation evidence missing => EVIDENCE_UNAVAILABLE, never success", () => {
  const evidence = measureRecovery({
    incident: incident({ recoveryClass: "database_recovery", affectedComponent: "supabase" }),
    now: NOW,
  });
  assert.equal(evidence.result, "EVIDENCE_UNAVAILABLE");
  assert.ok(!isRecoverySuccess(evidence.result));
  assert.equal(evidence.recoveryDurationMs, undefined, "no duration is claimed when required evidence is unavailable");
});

// ===========================================================================
// H. PHASE 15-C RESTORE VALIDATION REUSE
// ===========================================================================

test("11: any restore validation state short of PASSED keeps the recovery incomplete", () => {
  const notPassed: RestoreValidationState[] = ["NOT_CONFIGURED", "UNAVAILABLE", "RESTORE_NOT_READY", "VALIDATION_FAILED"];
  for (const state of notPassed) {
    const evidence = measureRecovery({
      incident: incident({ recoveryClass: "database_recovery", affectedComponent: "supabase" }),
      now: NOW,
      restoreValidationState: state,
    });
    assert.equal(evidence.result, "RECOVERY_INCOMPLETE", state);
    assert.equal(evidence.reasonCode, `restore_validation_not_passed:${state}`);
  }
});

test("11b: VALIDATION_PASSED unblocks classification for database/media recovery", () => {
  const evidence = measureRecovery({
    incident: incident({ recoveryClass: "database_recovery", affectedComponent: "supabase" }),
    now: NOW,
    restoreValidationState: "VALIDATION_PASSED",
  });
  assert.equal(evidence.result, "RECOVERED_NO_TARGET");
});

test("11c: media_recovery is gated the same way as database_recovery", () => {
  assert.deepEqual([...CLASSES_REQUIRING_RESTORE_VALIDATION].sort(), ["database_recovery", "media_recovery"]);
  const evidence = measureRecovery({
    incident: incident({ recoveryClass: "media_recovery", affectedComponent: "r2" }),
    now: NOW,
  });
  assert.equal(evidence.result, "EVIDENCE_UNAVAILABLE");
});

test("11d: non-database/media classes never gate on restore validation", () => {
  for (const recoveryClass of RECOVERY_CLASSES) {
    if (requiresRestoreValidation(recoveryClass)) continue;
    const evidence = measureRecovery({ incident: incident({ recoveryClass }), now: NOW });
    assert.notEqual(evidence.result, "EVIDENCE_UNAVAILABLE", recoveryClass);
  }
});

test("the engine never recomputes checksum/row-count/referential-integrity logic itself", () => {
  for (const { file, text } of recoveryCode) {
    assert.doesNotMatch(text, /checksum_sha256|pg_constraint|convalidated/i, `${file} must consume, not recompute, Phase 15-C evidence`);
  }
});

// ===========================================================================
// I. PHASE 13 HEALTH REUSE
// ===========================================================================

test("12: isRuntimeConsideredRecovered defers entirely to Phase 13's own HealthStatus", () => {
  const base = { runtime: "provider-worker" as const, dependencies: [], timestamp: NOW.toISOString() };
  assert.equal(isRuntimeConsideredRecovered({ ...base, status: "HEALTHY", reasons: [] }), true);
  assert.equal(isRuntimeConsideredRecovered({ ...base, status: "DEGRADED", reasons: ["degraded_upstream"] }), false);
  assert.equal(isRuntimeConsideredRecovered({ ...base, status: "UNREADY", reasons: ["unreachable"] }), false);
  assert.equal(isRuntimeConsideredRecovered({ ...base, status: "UNKNOWN", reasons: [] }), false);
});

test("the health bridge does not redefine HealthStatus or re-derive rollUp()", () => {
  for (const { file, text } of recoveryCode) {
    if (!file.endsWith("recovery-health-bridge.ts")) continue;
    assert.doesNotMatch(text, /function rollUp|"HEALTHY"\s*\|\s*"DEGRADED"/, `${file} must import, not redefine, the health contract`);
  }
});

// ===========================================================================
// J. STRUCTURAL SAFETY
// ===========================================================================

const BANNED_IDENTIFIERS: { pattern: RegExp; why: string }[] = [
  { pattern: /submitAttempt\s*\(/, why: "must never submit a provider" },
  { pattern: /executeGeneration\s*\(/, why: "must never execute a generation directly" },
  { pattern: /reserveCredits|settleReservation|releaseReservation/, why: "must never touch credit reservations" },
  { pattern: /cost_amount|cost_currency|credit_ledger|credit_wallets/, why: "must never touch billing/money fields" },
  { pattern: /StartMessageMoveTask|@aws-sdk|new\s+SQSClient/, why: "must never call a real AWS API" },
  { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "must never write to the database" },
  { pattern: /"use client"/, why: "this is server-side pure logic, never a UI file" },
];

test("13-17: no file in the recovery package can execute a provider, spend money, call AWS, write to the database, or is a UI file", () => {
  for (const { file, text } of recoveryCode) {
    for (const banned of BANNED_IDENTIFIERS) {
      assert.doesNotMatch(text, banned.pattern, `${file}: ${banned.why}`);
    }
  }
});

test("18: no raw payload / sensitive field name appears anywhere in the package", () => {
  const forbidden = ["prompt", "negative_prompt", "input_url", "output_url", "thumbnail_url", "apiKey", "signedUrl", "authorization", "stack"];
  for (const { file, text } of recoveryCode) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word.toLowerCase()), `${file} mentions forbidden field "${word}"`);
    }
  }
});

test("19: RecoveryIncidentEvidence has no index signature — no arbitrary metadata bag exists", () => {
  const contractText = read(path.join("src", "lib", "recovery", "recovery-contract.ts"));
  assert.doesNotMatch(contractText, /\[key:\s*string\]/, "no arbitrary-key field may exist on the contract");
});

test("17: no migration was created for this slice", () => {
  const migrations = readdirSync(path.join(ROOT, "supabase", "migrations"));
  assert.equal(migrations.some((m) => /15d|recovery|rto_target|rpo_target/i.test(m)), false);
});

// ===========================================================================
// K. ALERT INTEGRATION
// ===========================================================================

test("recovery alert types are registered in 13-D with the right source and visibility", () => {
  for (const type of ["recovery_rto_breached", "recovery_rpo_breached", "recovery_evidence_unavailable"] as const) {
    assert.equal(ALERT_CATALOGUE[type].source, "recovery");
    assert.equal(ALERT_CATALOGUE[type].severity, "ERROR");
    assert.equal(ALERT_CATALOGUE[type].userVisible, false);
  }
});

test("20/21: RECOVERED_NO_TARGET, RECOVERY_INCOMPLETE and INVALID_EVIDENCE never raise", () => {
  const seen = captureAlerts();
  const nonAlerting: RecoveryResultState[] = ["RECOVERED_NO_TARGET", "RECOVERY_INCOMPLETE", "INVALID_EVIDENCE"];
  for (const result of nonAlerting) {
    const raised = alertOnRecoveryEvidence({
      incidentId: "i",
      recoveryClass: "queue_recovery",
      affectedComponent: "sqs",
      result,
      reasonCode: "test",
      evaluatedAt: NOW.toISOString(),
    });
    assert.deepEqual(raised, []);
  }
  assert.equal(seen.length, 0);
});

test("a proven RTO breach raises recovery_rto_breached", () => {
  const seen = captureAlerts();
  const evidence = measureRecovery({ incident: incident(), now: NOW, rtoRegistry: { queue_recovery: 1 } });
  const raised = alertOnRecoveryEvidence(evidence);
  assert.equal(raised[0]?.outcome, "emitted");
  assert.equal(seen[0]?.type, "recovery_rto_breached");
  assert.equal(seen[0]?.severity, "ERROR");
  clearAlertSinks();
});

test("a proven RPO breach raises recovery_rpo_breached", () => {
  const seen = captureAlerts();
  const evidence = measureRecovery({
    incident: incident({ affectedComponent: "supabase" }),
    now: NOW,
    observedDataLossSeconds: 100,
    rpoRegistry: { supabase: 1 },
  });
  const raised = alertOnRecoveryEvidence(evidence);
  assert.equal(raised[0]?.outcome, "emitted");
  assert.equal(seen[0]?.type, "recovery_rpo_breached");
  clearAlertSinks();
});

test("EVIDENCE_UNAVAILABLE raises recovery_evidence_unavailable", () => {
  const seen = captureAlerts();
  const evidence = measureRecovery({
    incident: incident({ recoveryClass: "database_recovery", affectedComponent: "supabase" }),
    now: NOW,
  });
  const raised = alertOnRecoveryEvidence(evidence);
  assert.equal(raised[0]?.outcome, "emitted");
  assert.equal(seen[0]?.type, "recovery_evidence_unavailable");
  clearAlertSinks();
});

test("a within-target recovery resolves standing alerts and raises nothing new", () => {
  resetAlertRouter();
  const breached = measureRecovery({ incident: incident(), now: NOW, rtoRegistry: { queue_recovery: 1 } });
  alertOnRecoveryEvidence(breached);

  const recovered = measureRecovery({ incident: incident(), now: NOW, rtoRegistry: { queue_recovery: 30 * 60 * 1000 } });
  const raised = alertOnRecoveryEvidence(recovered);
  assert.deepEqual(raised, []);
});

test("22: every catalogued recovery type has a real raise or resolve site in this file", () => {
  const bridgeText = read(path.join("src", "lib", "recovery", "recovery-alert-bridge.ts"));
  for (const type of ["recovery_rto_breached", "recovery_rpo_breached", "recovery_evidence_unavailable"]) {
    assert.match(bridgeText, new RegExp(`"${type}"`), `${type} has no raise site in recovery-alert-bridge.ts`);
  }
});
