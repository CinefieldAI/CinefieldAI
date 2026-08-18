import "server-only";
import { evaluateDeployment, type DeploymentCandidate, type DeployVerdict } from "./deployment-guard";
import { requirePolicy } from "@/lib/policy/policy-gate";
import { PolicyDenied, type PolicyDecision } from "@/lib/policy/policy-contract";

/**
 * Deployment gate x policy composition point (Phase 19-C).
 *
 * `deployment-guard.ts` (Phase 14-D) already implements a complete,
 * self-sufficient eligibility decision — candidate/artifact/CI/security/
 * readiness checks, plus its own human-approval-for-HIGH_RISK rule. This
 * file does not touch it, duplicate it, or replace its reasoning: it adds
 * the EXISTING Phase 12-E/19 policy gate as a second, independent
 * condition, over exactly one new registered action —
 * `deployment.production.apply`. Same composition shape
 * `ai-pr-authority.ts` already established for `code.pr.create`: call the
 * existing gate, do not reimplement policy evaluation, risk-state
 * resolution, or decision-log audit — all three already exist in
 * `policy-gate.ts` and are reused unmodified.
 *
 * ---------------------------------------------------------------------------
 * BOTH MUST AGREE
 * ---------------------------------------------------------------------------
 * `eligible` is true only when `deployment.decision ===
 * "ELIGIBLE_FOR_EXTERNAL_DEPLOY"` AND policy separately allows. Either one
 * alone blocking is enough to block the whole verdict — this is "additional
 * condition, never a replacement for one," the same rule every other
 * `requirePolicy` call site in this repository already follows.
 *
 * ---------------------------------------------------------------------------
 * STILL DECIDES, NEVER EXECUTES
 * ---------------------------------------------------------------------------
 * Same as `deployment-guard.ts` itself: no deploy call, no Vercel client, no
 * network primitive here. The strongest thing this can produce is
 * `eligible: true` — a statement handed to whatever external system (or
 * human, via `infra-apply.yml`-style protected workflow) actually deploys.
 */

export interface DeploymentPolicyContext {
  actor: { id: string; role: "route_admin" | "service"; kind: "human" | "service" };
  /** Evidence a human approved, resolved from durable state by the caller — never "assume yes". */
  approvalEvidence?: { humanApproved: boolean };
  correlationId?: string | null;
}

export interface DeploymentPolicyVerdict {
  /** Phase 14-D's own verdict, completely unmodified. */
  readonly deployment: DeployVerdict;
  /** Phase 12-E/19's own decision for `deployment.production.apply`. */
  readonly policy: PolicyDecision;
  /** True only when both the deployment guard and policy independently agree. */
  readonly eligible: boolean;
}

export async function evaluateDeploymentWithPolicy(
  candidate: DeploymentCandidate,
  ctx: DeploymentPolicyContext
): Promise<DeploymentPolicyVerdict> {
  const deployment = evaluateDeployment(candidate);

  let policy: PolicyDecision;
  try {
    // requirePolicy() throws PolicyDenied on anything short of ALLOW; caught
    // below rather than propagated, so this composer can return one
    // structured verdict rather than making the caller catch an exception
    // for what is, from here, an ordinary decision outcome.
    policy = await requirePolicy({
      action: "deployment.production.apply",
      actor: ctx.actor,
      resource: { type: "deployment_candidate", id: candidate.artifact?.digest ?? null },
      approvalEvidence: ctx.approvalEvidence,
      correlationId: ctx.correlationId,
    });
  } catch (caught) {
    if (caught instanceof PolicyDenied) {
      policy = { decision: caught.decision, reason: caught.reason, policyVersion: caught.policyVersion, engine: "embedded" };
    } else {
      // A real fault in the gate itself, not a policy decision — fail
      // closed rather than silently treating it as an ALLOW.
      throw caught;
    }
  }

  return {
    deployment,
    policy,
    eligible: deployment.decision === "ELIGIBLE_FOR_EXTERNAL_DEPLOY" && policy.decision === "ALLOW",
  };
}
