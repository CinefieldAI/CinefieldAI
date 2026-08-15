import type { ChangeRiskClass } from "./change-risk";
import type { PreviewGateResult } from "./preview-gate";
import { verifyArtifact, type ArtifactIdentity, type CandidateClaim } from "./artifact-verification";
import type { HealthStatus } from "@/lib/health/health-contract";

/**
 * Deployment Guard + Rollback Guard (Phase 14-D, code-only).
 *
 * Roadmap 14-D: "Rolling Release + regression abort + Rollback Guard kur."
 * Done-criterion: "Bad release trafik artmadan duruyor ve önceki deployment'a
 * dönüyor" — a bad release stops before traffic grows and returns to the
 * previous deployment.
 *
 * ---------------------------------------------------------------------------
 * IT DECIDES. IT NEVER EXECUTES.
 * ---------------------------------------------------------------------------
 * There is no deploy call, no rollback call, no Vercel client and no network
 * primitive in this file. The strongest thing it can produce is
 * `ELIGIBLE_FOR_EXTERNAL_DEPLOY` — a statement that every precondition is
 * satisfied, addressed to whatever external system actually deploys. Nothing
 * here can move traffic.
 *
 * ---------------------------------------------------------------------------
 * NO SINGLE INPUT IS SUFFICIENT
 * ---------------------------------------------------------------------------
 * Eligibility requires ALL of: a 14-C production candidate, a 14-E verified
 * artifact bound to this candidate, green CI, human approval where the risk
 * class demands it, no open critical security alert, and healthy readiness.
 * Each of these has been the "obviously fine" one at some point in some
 * incident; the guard is the place that refuses to accept any of them alone.
 */

export type DeployDecision = "BLOCK" | "REVIEW_REQUIRED" | "ELIGIBLE_FOR_EXTERNAL_DEPLOY";

export type DeployRefusal =
  | "not_prod_candidate"
  | "artifact_not_verified"
  | "ci_not_green"
  | "human_approval_required"
  | "critical_security_alert"
  | "readiness_not_healthy"
  | "forbidden_automation";

export interface DeploymentCandidate {
  /** The 14-C verdict. Its own gate already folded in checks and preview. */
  readonly preview: PreviewGateResult;
  /** The artifact proposed for deployment, and what this candidate claims. */
  readonly artifact: ArtifactIdentity | null;
  readonly claim: CandidateClaim;
  readonly riskClass: ChangeRiskClass;
  /** Server-observed: every required check passed. */
  readonly ciGreen: boolean;
  readonly humanApproved: boolean;
  readonly criticalSecurityAlertOpen: boolean;
  /** Readiness of the target runtime, from Phase 13. */
  readonly targetReadiness: HealthStatus;
}

export interface DeployVerdict {
  readonly decision: DeployDecision;
  readonly refusals: readonly DeployRefusal[];
}

/**
 * Decides whether a candidate may be handed to an external deployer.
 *
 * Collects every refusal rather than short-circuiting: an operator fixing a
 * blocked release wants the whole list, not one problem per attempt.
 */
export function evaluateDeployment(candidate: DeploymentCandidate): DeployVerdict {
  const refusals: DeployRefusal[] = [];

  if (candidate.riskClass === "FORBIDDEN_AUTOMATION") refusals.push("forbidden_automation");

  // 1. 14-C must have said yes. Its own gate covers required checks, preview
  //    state, readiness of the preview and migration proofs.
  if (!candidate.preview?.prodCandidate) refusals.push("not_prod_candidate");

  // 2. 14-E must verify the artifact AGAINST THIS CANDIDATE. Re-run rather
  //    than trust a cached boolean: a verdict computed elsewhere, earlier,
  //    against a different claim is exactly the stale-approval hazard 14-E's
  //    lineage check exists to catch.
  if (!verifyArtifact(candidate.artifact, candidate.claim).verified) {
    refusals.push("artifact_not_verified");
  }

  if (!candidate.ciGreen) refusals.push("ci_not_green");
  if (candidate.criticalSecurityAlertOpen) refusals.push("critical_security_alert");

  // 3. Readiness. DEGRADED is acceptable for the same reason Phase 13's
  //    `isReady()` accepts it; UNREADY and UNKNOWN are not.
  if (candidate.targetReadiness !== "HEALTHY" && candidate.targetReadiness !== "DEGRADED") {
    refusals.push("readiness_not_healthy");
  }

  if (refusals.length > 0) return { decision: "BLOCK", refusals };

  // 4. Human approval for anything above MEDIUM. Mechanical greenness is not
  //    consent, and an AI cannot supply this — the field is server-assembled
  //    evidence, and no caller in this repository can set it to true.
  if ((candidate.riskClass === "HIGH_RISK") && !candidate.humanApproved) {
    return { decision: "REVIEW_REQUIRED", refusals: ["human_approval_required"] };
  }

  return { decision: "ELIGIBLE_FOR_EXTERNAL_DEPLOY", refusals: [] };
}

// ---------------------------------------------------------------------------
// ROLLBACK GUARD
// ---------------------------------------------------------------------------

export type RollbackDecision =
  | "NO_ROLLBACK"
  | "ROLLBACK_RECOMMENDED"
  | "ROLLBACK_REQUIRED_EXTERNAL_EXECUTION"
  | "REVIEW_REQUIRED";

export type RollbackReason =
  | "readiness_regression"
  | "runtime_unready"
  | "dependency_unavailable"
  | "critical_alert_open"
  | "unknown_previous_good"
  | "deployment_identity_missing"
  | "healthy";

/**
 * A deployment this system knows about.
 *
 * `verifiedGood` is what makes a deployment a rollback TARGET. A deployment
 * that merely existed earlier is not known-good — it may be the one that
 * broke something last month.
 */
export interface DeploymentRecord {
  readonly deploymentId: string;
  readonly artifactDigest: string;
  readonly commitSha: string;
  readonly verifiedGood: boolean;
}

export interface RollbackSignals {
  /** Phase 13 readiness of the current release. */
  readonly currentReadiness: HealthStatus;
  /** 13-D alert types currently open. Bounded strings from the catalogue. */
  readonly openCriticalAlerts: readonly string[];
  readonly current: DeploymentRecord | null;
  /** The most recent deployment marked verified-good, if one is known. */
  readonly previousGood: DeploymentRecord | null;
}

export interface RollbackVerdict {
  readonly decision: RollbackDecision;
  readonly reasons: readonly RollbackReason[];
  /** Present only when a concrete, known-good target exists. */
  readonly targetDeploymentId: string | null;
}

/**
 * Decides whether the current release should be rolled back.
 *
 * ---------------------------------------------------------------------------
 * NO GUESSING AT A TARGET
 * ---------------------------------------------------------------------------
 * "Roll back to latest" is not a decision this can make. Without a known
 * verified-good previous deployment the verdict is `REVIEW_REQUIRED`, even
 * when the current release is plainly unhealthy — rolling forward into an
 * unknown state is not a recovery, and a human deciding takes minutes while
 * an automated wrong guess can take the product down twice.
 *
 * Triggers are Phase 13 signals only: readiness and open critical alerts.
 * An AI opinion is not among them and there is no field for one.
 */
export function evaluateRollback(signals: RollbackSignals): RollbackVerdict {
  const reasons: RollbackReason[] = [];

  const unhealthy = signals.currentReadiness === "UNREADY" || signals.currentReadiness === "UNKNOWN";
  if (signals.currentReadiness === "UNREADY") reasons.push("runtime_unready");
  else if (signals.currentReadiness === "UNKNOWN") reasons.push("readiness_regression");

  const criticalOpen = signals.openCriticalAlerts.length > 0;
  if (criticalOpen) reasons.push("critical_alert_open");

  if (!unhealthy && !criticalOpen) {
    return { decision: "NO_ROLLBACK", reasons: ["healthy"], targetDeploymentId: null };
  }

  // Something is wrong. Now: is there anywhere safe to go?
  if (!signals.current) {
    return { decision: "REVIEW_REQUIRED", reasons: [...reasons, "deployment_identity_missing"], targetDeploymentId: null };
  }
  if (!signals.previousGood || !signals.previousGood.verifiedGood) {
    return { decision: "REVIEW_REQUIRED", reasons: [...reasons, "unknown_previous_good"], targetDeploymentId: null };
  }

  // A known-good target exists. Readiness failure is the stronger signal —
  // the runtime cannot serve — so it REQUIRES rollback; an alert alone
  // recommends it, leaving room for an operator who knows more.
  return {
    decision: unhealthy ? "ROLLBACK_REQUIRED_EXTERNAL_EXECUTION" : "ROLLBACK_RECOMMENDED",
    reasons,
    targetDeploymentId: signals.previousGood.deploymentId,
  };
}
