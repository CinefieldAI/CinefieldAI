import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  evaluatePreviewGate,
  type CheckOutcome,
  type PreviewGateInput,
} from "@/lib/deployment/preview-gate";
import { resolveRequiredChecks } from "@/lib/deployment/required-checks";
import type { RequiredCheckId } from "@/lib/deployment/required-checks";
import { classifyChangeRisk } from "@/lib/deployment/change-risk";

/**
 * PHASE 14-C — PREVIEW CANDIDATE GATE (code-only)
 *
 * Roadmap 14-C done-criterion: "PR preview otomatik testleri geçmeden prod
 * aday olmuyor." No Vercel API is called anywhere; the gate decides from
 * supplied observations.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DEPLOYMENT_DIR = path.join(ROOT, "src", "lib", "deployment");
const deploymentFiles = () =>
  readdirSync(DEPLOYMENT_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ path: f, body: readFileSync(path.join(DEPLOYMENT_DIR, f), "utf8") }));

/** A MEDIUM_RISK change with everything green — the baseline happy path. */
function allGreen(overrides: Partial<PreviewGateInput> = {}): PreviewGateInput {
  const paths = ["src/lib/orchestration/providers/fal-provider.ts"];
  const riskClass = classifyChangeRisk(paths).riskClass;
  const requiredCheckIds = resolveRequiredChecks(riskClass, paths);
  const checkOutcomes: Partial<Record<RequiredCheckId, CheckOutcome>> = {};
  for (const id of requiredCheckIds) checkOutcomes[id] = "pass";

  return {
    riskClass,
    requiredCheckIds,
    checkOutcomes,
    previewState: "PASSED",
    previewReadiness: "HEALTHY",
    criticalSecurityAlertOpen: false,
    touchesMigration: false,
    humanApproved: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1–2. Required checks
// ---------------------------------------------------------------------------

test("S14C-1  a missing required check blocks — absence is never a pass", () => {
  const base = allGreen();
  const outcomes = { ...base.checkOutcomes };
  delete outcomes.typecheck;
  const r = evaluatePreviewGate({ ...base, checkOutcomes: outcomes });
  assert.equal(r.decision, "BLOCKED");
  assert.ok(r.refusals.includes("required_check_missing"));
  assert.equal(r.prodCandidate, false);

  // Pending and skipped are also not passes.
  for (const outcome of ["pending", "skipped"] as const) {
    const r2 = evaluatePreviewGate({
      ...base,
      checkOutcomes: { ...base.checkOutcomes, typecheck: outcome },
    });
    assert.equal(r2.decision, "BLOCKED", `${outcome} was treated as a pass`);
  }
});

test("S14C-2  a failed required check blocks", () => {
  const base = allGreen();
  const r = evaluatePreviewGate({
    ...base,
    checkOutcomes: { ...base.checkOutcomes, test_suite: "fail" },
  });
  assert.equal(r.decision, "BLOCKED");
  assert.ok(r.refusals.includes("required_check_failed"));
});

// ---------------------------------------------------------------------------
// 3. Preview state
// ---------------------------------------------------------------------------

test("S14C-3  only a PASSED preview qualifies — every other state blocks", () => {
  const base = allGreen();
  for (const state of ["NOT_CREATED", "BUILDING", "FAILED", "READY", "TESTING", "BLOCKED"] as const) {
    const r = evaluatePreviewGate({ ...base, previewState: state });
    assert.equal(r.decision, "BLOCKED", `${state} produced ${r.decision}`);
    assert.equal(r.prodCandidate, false);
  }
  // READY means built but not tested — explicitly not enough.
  assert.ok(
    evaluatePreviewGate({ ...base, previewState: "READY" }).refusals.includes("preview_tests_incomplete")
  );
  assert.equal(evaluatePreviewGate({ ...base, previewState: "PASSED" }).decision, "PROD_CANDIDATE");
});

// ---------------------------------------------------------------------------
// 4–5. Health and security
// ---------------------------------------------------------------------------

test("S14C-4  UNREADY and UNKNOWN readiness block; DEGRADED does not", () => {
  const base = allGreen();
  for (const readiness of ["UNREADY", "UNKNOWN"] as const) {
    const r = evaluatePreviewGate({ ...base, previewReadiness: readiness });
    assert.equal(r.decision, "BLOCKED", `${readiness} did not block`);
    assert.ok(r.refusals.includes("readiness_unready"));
  }
  // DEGRADED is acceptable, matching Phase 13's own isReady() contract.
  assert.equal(evaluatePreviewGate({ ...base, previewReadiness: "DEGRADED" }).decision, "PROD_CANDIDATE");
});

test("S14C-5  an open critical security alert blocks however green the build is", () => {
  const r = evaluatePreviewGate({ ...allGreen(), criticalSecurityAlertOpen: true });
  assert.equal(r.decision, "BLOCKED");
  assert.ok(r.refusals.includes("critical_security_alert"));
});

// ---------------------------------------------------------------------------
// 6. Migration rule
// ---------------------------------------------------------------------------

test("S14C-6  a migration without both proofs blocks", () => {
  const paths = ["supabase/migrations/20260901000000_x.sql"];
  const riskClass = classifyChangeRisk(paths).riskClass;
  const requiredCheckIds = resolveRequiredChecks(riskClass, paths);
  const outcomes: Partial<Record<RequiredCheckId, CheckOutcome>> = {};
  for (const id of requiredCheckIds) outcomes[id] = "pass";

  assert.equal(riskClass, "HIGH_RISK");
  assert.ok(requiredCheckIds.includes("migration_safety"));
  assert.ok(requiredCheckIds.includes("postgres_proofs"));

  for (const missing of ["migration_safety", "postgres_proofs"] as const) {
    const r = evaluatePreviewGate({
      riskClass,
      requiredCheckIds,
      checkOutcomes: { ...outcomes, [missing]: "fail" },
      previewState: "PASSED",
      previewReadiness: "HEALTHY",
      criticalSecurityAlertOpen: false,
      touchesMigration: true,
      humanApproved: true,
    });
    assert.equal(r.decision, "BLOCKED", `${missing} failing did not block`);
    assert.ok(r.refusals.includes("migration_proofs_missing"));
  }
});

// ---------------------------------------------------------------------------
// 7–9. Authority separation
// ---------------------------------------------------------------------------

test("S14C-7  AI cannot set PROD_CANDIDATE — the input shape has no such field", () => {
  const src = stripComments(read("src/lib/deployment/preview-gate.ts"));
  const shape = src.slice(src.indexOf("export interface PreviewGateInput"), src.indexOf("export interface PreviewGateResult"));
  for (const forbidden of ["prodCandidate", "force", "skip", "override", "decision"]) {
    assert.ok(!new RegExp(`readonly ${forbidden}`, "i").test(shape),
      `PreviewGateInput admits "${forbidden}"`);
  }
  // A smuggled field changes nothing: the function reads named fields only.
  const forged = { ...allGreen(), previewState: "FAILED" as const, prodCandidate: true, force: true };
  assert.equal(evaluatePreviewGate(forged as PreviewGateInput).prodCandidate, false);
});

test("S14C-8  all inputs satisfied → production candidate", () => {
  const r = evaluatePreviewGate(allGreen());
  assert.equal(r.decision, "PROD_CANDIDATE");
  assert.equal(r.prodCandidate, true);
  assert.deepEqual(r.refusals, []);
});

test("S14C-9  PR eligibility alone is insufficient, and HIGH_RISK still needs a human", () => {
  // A HIGH_RISK change with every mechanical input green is NOT a candidate
  // until a human approves. Green checks answer "does it work", not "should we".
  const paths = ["worker/workflows/generation-workflow.ts"];
  const riskClass = classifyChangeRisk(paths).riskClass;
  const requiredCheckIds = resolveRequiredChecks(riskClass, paths);
  const outcomes: Partial<Record<RequiredCheckId, CheckOutcome>> = {};
  for (const id of requiredCheckIds) outcomes[id] = "pass";

  const withoutHuman = evaluatePreviewGate({
    riskClass, requiredCheckIds, checkOutcomes: outcomes,
    previewState: "PASSED", previewReadiness: "HEALTHY",
    criticalSecurityAlertOpen: false, touchesMigration: false, humanApproved: false,
  });
  assert.equal(withoutHuman.decision, "REVIEW_REQUIRED");
  assert.equal(withoutHuman.prodCandidate, false);

  const withHuman = evaluatePreviewGate({
    riskClass, requiredCheckIds, checkOutcomes: outcomes,
    previewState: "PASSED", previewReadiness: "HEALTHY",
    criticalSecurityAlertOpen: false, touchesMigration: false, humanApproved: true,
  });
  assert.equal(withHuman.decision, "PROD_CANDIDATE");

  // FORBIDDEN_AUTOMATION can never reach candidate, human or not.
  const forbidden = evaluatePreviewGate({
    ...allGreen(), riskClass: "FORBIDDEN_AUTOMATION", humanApproved: true,
  });
  assert.equal(forbidden.decision, "BLOCKED");
  assert.ok(forbidden.refusals.includes("forbidden_automation"));
});

// ---------------------------------------------------------------------------
// 10–12. External boundaries and neighbouring stages
// ---------------------------------------------------------------------------

test("S14C-10..11  no Vercel API, no deploy execution anywhere in the module", () => {
  for (const { path: file, body } of deploymentFiles()) {
    const bare = stripComments(body);
    // Targets API/SDK USAGE, not the word "vercel". `change-risk.ts` matches
    // the literal path `vercel.json` in its FORBIDDEN_AUTOMATION rule — that
    // is a safety rule ABOUT Vercel config, the opposite of calling Vercel.
    for (const pattern of [
      /api\.vercel\.com/i, /VERCEL_TOKEN/, /@vercel\/(client|sdk)/i,
      /\bfetch\s*\(/, /createDeployment/i, /promoteToProduction/i,
      /\bdeployTo\w*\s*\(/i,
    ]) {
      assert.ok(!pattern.test(bare), `${file} contains a deploy/Vercel primitive (${pattern})`);
    }
  }
});

test("S14C-12  Phase 14-F remains green — the gate did not weaken remediation bounds", async () => {
  const { AUTO_REMEDIATION_ALLOWLIST, isRemediationKillSwitchEngaged } = await import(
    "@/lib/deployment/remediation-guardrail"
  );
  assert.deepEqual([...AUTO_REMEDIATION_ALLOWLIST], ["dispatcher_pass_failing"]);
  // Default-engaged still holds when the variable is absent.
  const prev = process.env.CINEFIELD_AUTO_REMEDIATION_ENABLED;
  delete process.env.CINEFIELD_AUTO_REMEDIATION_ENABLED;
  try {
    assert.equal(isRemediationKillSwitchEngaged(), true);
  } finally {
    if (prev !== undefined) process.env.CINEFIELD_AUTO_REMEDIATION_ENABLED = prev;
  }
});
