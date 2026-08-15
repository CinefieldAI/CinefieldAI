import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  evaluateDeployment,
  evaluateRollback,
  type DeploymentCandidate,
  type DeploymentRecord,
  type RollbackSignals,
} from "@/lib/deployment/deployment-guard";
import { evaluatePreviewGate, type PreviewGateResult } from "@/lib/deployment/preview-gate";
import type { ArtifactIdentity, CandidateClaim } from "@/lib/deployment/artifact-verification";

/**
 * PHASE 14-D — DEPLOYMENT GUARD + ROLLBACK GUARD (code-only)
 *
 * Roadmap 14-D done-criterion: "Bad release trafik artmadan duruyor ve önceki
 * deployment'a dönüyor." Nothing here executes a deploy or a rollback; the
 * guards decide and an external system would act.
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

const DIGEST = "c".repeat(64);
const COMMIT = "abc1234";

const goodPreview: PreviewGateResult = { decision: "PROD_CANDIDATE", refusals: [], prodCandidate: true };
const badPreview: PreviewGateResult = { decision: "BLOCKED", refusals: ["preview_failed"], prodCandidate: false };

function artifact(o: Partial<ArtifactIdentity> = {}): ArtifactIdentity {
  return {
    artifactId: "art-1", digest: DIGEST, commitSha: COMMIT, buildId: "build-1",
    status: "VERIFIED", provenanceRef: "attestation-1", ...o,
  };
}
const claim = (o: Partial<CandidateClaim> = {}): CandidateClaim =>
  ({ commitSha: COMMIT, digest: DIGEST, buildId: "build-1", ...o });

function candidate(o: Partial<DeploymentCandidate> = {}): DeploymentCandidate {
  return {
    preview: goodPreview,
    artifact: artifact(),
    claim: claim(),
    riskClass: "MEDIUM_RISK",
    ciGreen: true,
    humanApproved: false,
    criticalSecurityAlertOpen: false,
    targetReadiness: "HEALTHY",
    ...o,
  };
}

const deployment = (o: Partial<DeploymentRecord> = {}): DeploymentRecord =>
  ({ deploymentId: "dep-1", artifactDigest: DIGEST, commitSha: COMMIT, verifiedGood: true, ...o });

// ---------------------------------------------------------------------------
// 1–5. Deployment Guard
// ---------------------------------------------------------------------------

test("S14D-1  no preview candidate → deploy blocked", () => {
  const v = evaluateDeployment(candidate({ preview: badPreview }));
  assert.equal(v.decision, "BLOCK");
  assert.ok(v.refusals.includes("not_prod_candidate"));
});

test("S14D-2  an unverified artifact → blocked, re-verified rather than trusted", () => {
  for (const bad of [
    artifact({ status: "UNVERIFIED" }),
    artifact({ status: "UNKNOWN" }),
    artifact({ digest: "d".repeat(64) }), // digest mismatch vs the claim
    artifact({ commitSha: "999999" }), // commit mismatch
    artifact({ buildId: "build-OLD" }), // stale lineage
    null,
  ]) {
    const v = evaluateDeployment(candidate({ artifact: bad }));
    assert.equal(v.decision, "BLOCK");
    assert.ok(v.refusals.includes("artifact_not_verified"));
  }

  // The guard calls 14-E itself rather than accepting a cached boolean.
  const src = stripComments(read("src/lib/deployment/deployment-guard.ts"));
  assert.match(src, /verifyArtifact\(candidate\.artifact, candidate\.claim\)/);
});

test("S14D-3  CI failure → blocked", () => {
  const v = evaluateDeployment(candidate({ ciGreen: false }));
  assert.equal(v.decision, "BLOCK");
  assert.ok(v.refusals.includes("ci_not_green"));
});

test("S14D-4  high risk without human approval → blocked from eligibility", () => {
  const v = evaluateDeployment(candidate({ riskClass: "HIGH_RISK", humanApproved: false }));
  assert.equal(v.decision, "REVIEW_REQUIRED");
  assert.ok(v.refusals.includes("human_approval_required"));

  // With approval it becomes eligible — and only then.
  const approved = evaluateDeployment(candidate({ riskClass: "HIGH_RISK", humanApproved: true }));
  assert.equal(approved.decision, "ELIGIBLE_FOR_EXTERNAL_DEPLOY");

  // FORBIDDEN_AUTOMATION never becomes eligible, approved or not.
  const forbidden = evaluateDeployment(candidate({ riskClass: "FORBIDDEN_AUTOMATION", humanApproved: true }));
  assert.equal(forbidden.decision, "BLOCK");
  assert.ok(forbidden.refusals.includes("forbidden_automation"));
});

test("S14D-5  a fully verified, approved candidate is eligible for EXTERNAL deploy only", () => {
  const v = evaluateDeployment(candidate());
  assert.equal(v.decision, "ELIGIBLE_FOR_EXTERNAL_DEPLOY");
  assert.deepEqual(v.refusals, []);
  // The name is the contract: eligibility for an external system to act,
  // not an action taken here.
  assert.ok(!/EXECUTED|DEPLOYED/.test(v.decision));

  // Security and readiness each block independently of everything else.
  assert.equal(evaluateDeployment(candidate({ criticalSecurityAlertOpen: true })).decision, "BLOCK");
  assert.equal(evaluateDeployment(candidate({ targetReadiness: "UNREADY" })).decision, "BLOCK");
  assert.equal(evaluateDeployment(candidate({ targetReadiness: "UNKNOWN" })).decision, "BLOCK");
  // DEGRADED remains acceptable, matching Phase 13's isReady() contract.
  assert.equal(evaluateDeployment(candidate({ targetReadiness: "DEGRADED" })).decision, "ELIGIBLE_FOR_EXTERNAL_DEPLOY");
});

test("S14D-6  AI cannot deploy — no execution primitive exists in the module", () => {
  for (const { path: file, body } of deploymentFiles()) {
    const bare = stripComments(body);
    for (const pattern of [
      /api\.vercel\.com/i, /VERCEL_TOKEN/, /@vercel\/(client|sdk)/i,
      /createDeployment/i, /promoteToProduction/i, /\bexecuteDeploy/i,
      /\bperformRollback/i, /\brollbackTo\s*\(/i, /\bfetch\s*\(/,
    ]) {
      assert.ok(!pattern.test(bare), `${file} contains an execution primitive (${pattern})`);
    }
  }
});

// ---------------------------------------------------------------------------
// 7–10. Rollback Guard
// ---------------------------------------------------------------------------

function signals(o: Partial<RollbackSignals> = {}): RollbackSignals {
  return {
    currentReadiness: "HEALTHY",
    openCriticalAlerts: [],
    current: deployment(),
    previousGood: deployment({ deploymentId: "dep-0" }),
    ...o,
  };
}

test("S14D-7  a readiness regression requires rollback to the known-good target", () => {
  const v = evaluateRollback(signals({ currentReadiness: "UNREADY" }));
  assert.equal(v.decision, "ROLLBACK_REQUIRED_EXTERNAL_EXECUTION");
  assert.ok(v.reasons.includes("runtime_unready"));
  assert.equal(v.targetDeploymentId, "dep-0");

  // Healthy and quiet means no rollback.
  const calm = evaluateRollback(signals());
  assert.equal(calm.decision, "NO_ROLLBACK");
  assert.equal(calm.targetDeploymentId, null);
});

test("S14D-8  a critical alert affects the decision, but recommends rather than requires", () => {
  const v = evaluateRollback(signals({ openCriticalAlerts: ["runtime_unready"] }));
  assert.equal(v.decision, "ROLLBACK_RECOMMENDED");
  assert.ok(v.reasons.includes("critical_alert_open"));
  assert.equal(v.targetDeploymentId, "dep-0");

  // Readiness failure is the stronger signal and escalates to REQUIRED.
  const both = evaluateRollback(signals({ currentReadiness: "UNREADY", openCriticalAlerts: ["x"] }));
  assert.equal(both.decision, "ROLLBACK_REQUIRED_EXTERNAL_EXECUTION");
});

test("S14D-9  an unknown previous-good prevents automatic rollback", () => {
  for (const prev of [null, deployment({ verifiedGood: false })]) {
    const v = evaluateRollback(signals({ currentReadiness: "UNREADY", previousGood: prev }));
    assert.equal(v.decision, "REVIEW_REQUIRED", "it guessed at a rollback target");
    assert.ok(v.reasons.includes("unknown_previous_good"));
    assert.equal(v.targetDeploymentId, null);
  }
  // "roll back to latest" must not exist as a concept.
  const src = stripComments(read("src/lib/deployment/deployment-guard.ts"));
  assert.ok(!/latest|mostRecent/i.test(src), "the guard reasons about a 'latest' deployment");
});

test("S14D-10  missing deployment identity blocks automatic rollback", () => {
  const v = evaluateRollback(signals({ currentReadiness: "UNREADY", current: null }));
  assert.equal(v.decision, "REVIEW_REQUIRED");
  assert.ok(v.reasons.includes("deployment_identity_missing"));
  assert.equal(v.targetDeploymentId, null);
});

// ---------------------------------------------------------------------------
// 11–13. Boundaries and neighbouring stages
// ---------------------------------------------------------------------------

test("S14D-11  rollback performs no Vercel call and no execution", () => {
  const src = stripComments(read("src/lib/deployment/deployment-guard.ts"));
  assert.ok(!/\bfetch\s*\(|vercel|axios/i.test(src));
  // Its strongest verdict names EXTERNAL execution explicitly.
  assert.match(src, /ROLLBACK_REQUIRED_EXTERNAL_EXECUTION/);
});

test("S14D-12  rollback cannot start the remediation loop", () => {
  const src = stripComments(read("src/lib/deployment/deployment-guard.ts"));
  for (const pattern of [
    /considerIncidentForRemediation/, /proposeFixForIncident/,
    /bridgeIncidentToProposal/, /evaluateRemediationAttempt/,
  ]) {
    assert.ok(!pattern.test(src), `the guard can trigger remediation (${pattern})`);
  }
  // And it reaches neither billing nor the provider path.
  assert.ok(!/stripe|credit|wallet|provider\.submit/i.test(src));
});

test("S14D-13  Phases F, C and E remain green", async () => {
  const { AUTO_REMEDIATION_ALLOWLIST, isRemediationKillSwitchEngaged } = await import(
    "@/lib/deployment/remediation-guardrail"
  );
  assert.deepEqual([...AUTO_REMEDIATION_ALLOWLIST], ["dispatcher_pass_failing"]);
  const prev = process.env.CINEFIELD_AUTO_REMEDIATION_ENABLED;
  delete process.env.CINEFIELD_AUTO_REMEDIATION_ENABLED;
  try {
    assert.equal(isRemediationKillSwitchEngaged(), true);
  } finally {
    if (prev !== undefined) process.env.CINEFIELD_AUTO_REMEDIATION_ENABLED = prev;
  }

  // C still refuses an unfinished preview.
  assert.equal(
    evaluatePreviewGate({
      riskClass: "LOW_RISK", requiredCheckIds: [], checkOutcomes: {},
      previewState: "TESTING", previewReadiness: "HEALTHY",
      criticalSecurityAlertOpen: false, touchesMigration: false, humanApproved: true,
    }).prodCandidate,
    false
  );

  // E still blocks an unverified artifact through D's own path.
  assert.equal(
    evaluateDeployment(candidate({ artifact: artifact({ status: "UNVERIFIED" }) })).decision,
    "BLOCK"
  );
});
