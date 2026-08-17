import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { buildRollbackView } from "@/lib/admin/deploy-restore-admin-service";
import { RTO_TARGETS, RPO_TARGETS } from "@/lib/recovery/recovery-target-registry";
import type { TrackedAlertSnapshot } from "@/lib/alerts/alert-router";

/**
 * Phase 16-D Deploy/Restore Health.
 *
 * NOTE ON WHAT IS AND IS NOT EXERCISED HERE. `getAdminDeployRestore` calls
 * `collectAdminHealth()` and `runRestoreVerification()` with their real
 * default dependencies deliberately (Phase 13/15-C's own production paths,
 * not a test seam), and this repository's `.env.local` carries real
 * Supabase credentials — calling it end-to-end from a test would make a
 * live network call, which this repository's zero-cost E2E convention
 * avoids (see `phase-16d-slo-cost.e2e.test.ts`'s header for the same
 * reasoning, and `phase-16-1-admin-health.e2e.test.ts`, which never calls
 * `collectAdminHealth()` directly either). This suite behaviourally tests
 * `buildRollbackView` — the one piece of new wiring logic this package
 * wrote — directly, and proves via structural assertion that
 * `evaluateDeployment` (full CI/artifact eligibility) is deliberately never
 * called with fabricated inputs, and that `runRestoreVerification`/
 * `evaluateRollback` are reused, never reimplemented.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/deploy-restore-admin-contract.ts",
  "src/lib/admin/deploy-restore-admin-service.ts",
  "src/lib/admin/deploy-restore-admin-client-state.ts",
  "src/app/api/admin/deploy-restore/route.ts",
  "src/app/admin/deploy-restore/page.tsx",
  "src/components/admin/DeployRestorePanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

function alert(overrides: Partial<TrackedAlertSnapshot>): TrackedAlertSnapshot {
  return {
    type: "runtime_unready",
    source: "health",
    severity: "CRITICAL",
    resource: "web",
    dedupeKey: "health:runtime_unready:web",
    state: "OPEN",
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-01T00:00:00.000Z",
    occurrenceCount: 1,
    correlation: {},
    ...overrides,
  };
}

// ===========================================================================
// buildRollbackView — the one new wiring function
// ===========================================================================

test("buildRollbackView: HEALTHY readiness with no open critical alerts is NO_ROLLBACK", () => {
  const view = buildRollbackView("HEALTHY", []);
  assert.equal(view.decision, "NO_ROLLBACK");
  assert.deepEqual(view.openCriticalAlertTypes, []);
  assert.equal(view.targetDeploymentId, null);
});

test("buildRollbackView: UNREADY readiness with no known deployment identity is REVIEW_REQUIRED, never a guessed rollback target", () => {
  const view = buildRollbackView("UNREADY", []);
  assert.equal(view.decision, "REVIEW_REQUIRED");
  assert.ok(view.reasons.includes("runtime_unready"));
  assert.ok(view.reasons.includes("deployment_identity_missing"));
  assert.equal(view.targetDeploymentId, null, "no deployment-identity tracking exists — never fabricated");
});

test("buildRollbackView: only CRITICAL severity alerts count as open, and types are deduplicated", () => {
  const view = buildRollbackView("HEALTHY", [
    alert({ type: "runtime_unready", severity: "CRITICAL" }),
    alert({ type: "runtime_unready", severity: "CRITICAL", resource: "worker" }), // same type, different resource
    alert({ type: "dependency_degraded", severity: "WARNING" }), // must be excluded
  ]);
  assert.deepEqual(view.openCriticalAlertTypes, ["runtime_unready"]);
  assert.equal(view.decision, "REVIEW_REQUIRED", "a critical alert open still triggers rollback review even with healthy readiness");
});

test("buildRollbackView: currentReadiness is echoed verbatim from what was passed in", () => {
  const view = buildRollbackView("DEGRADED", []);
  assert.equal(view.currentReadiness, "DEGRADED");
  assert.equal(view.decision, "NO_ROLLBACK", "DEGRADED is acceptable, matching Phase 13's own isReady()");
});

// ===========================================================================
// Recovery / RTO-RPO — empty registries reported honestly
// ===========================================================================

test("RTO_TARGETS and RPO_TARGETS are empty in this repository — no business-approved target exists", () => {
  assert.deepEqual(RTO_TARGETS, {});
  assert.deepEqual(RPO_TARGETS, {});
});

test("the service reports the registries' real size rather than inventing a target or calling measureRecovery with fabricated evidence", () => {
  const serviceText = read("src/lib/admin/deploy-restore-admin-service.ts");
  assert.match(serviceText, /RTO_TARGETS/);
  assert.match(serviceText, /RPO_TARGETS/);
  assert.doesNotMatch(serviceText, /measureRecovery\s*\(/, "no fabricated recovery-incident evidence");
});

// ===========================================================================
// structural: real reuse, no fake unified truth, no execution
// ===========================================================================

test("evaluateRollback (Phase 14-D) and runRestoreVerification (Phase 15-C) are called, never reimplemented", () => {
  const serviceText = read("src/lib/admin/deploy-restore-admin-service.ts");
  assert.match(serviceText, /evaluateRollback\(/);
  assert.match(serviceText, /runRestoreVerification\(/);
  assert.doesNotMatch(serviceText, /function evaluateRollback|function runRestoreValidation/);
});

test("evaluateDeployment is deliberately NEVER called — no fabricated CI/artifact candidate", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /evaluateDeployment\s*\(/, `${file} must not call evaluateDeployment with invented evidence`);
  }
});

test("no deploy, rollback, or restore EXECUTION exists anywhere in the new surface", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(
      text,
      /vercel\.deploy|executeRollback|triggerRestore|pg_restore\s*\(|StartMessageMoveTask|new\s+VercelClient/i,
      file
    );
  }
});

test("no mutation of any kind exists in the Deploy/Restore Health surface", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, file);
  }
});

test("the route reuses the one canonical admin auth boundary and is GET-only", () => {
  const routeText = stripComments(read("src/app/api/admin/deploy-restore/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.match(routeText, /export async function GET/);
  assert.doesNotMatch(routeText, /export async function POST/);
});

test("the panel text distinguishes local restore proof from live PITR, and states no target != met", () => {
  const panelText = read("src/components/admin/DeployRestorePanel.tsx");
  assert.match(panelText, /PITR/);
  assert.match(panelText, /not the same as a target being met|No target configured is not/i);
});

test("no locked product UI route is referenced by the new files", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of NEW_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
  }
});

test("no migration file was added for this surface", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE/i, file);
  }
});
