import "server-only";
import type { AlertEnvelope } from "@/lib/alerts/alert-contract";
import { proposeFixForIncident } from "./incident-to-proposal";
import { evaluateRemediationAttempt, type RemediationRefusal } from "./remediation-guardrail";
import { recordRemediationProvenance } from "./remediation-provenance";
import type { PrProposalRecord } from "./pr-proposal-contract";

/**
 * The bounded remediation entry point (Phase 14-F).
 *
 * This is the ONE function a production caller may use to turn an alert into
 * a fix proposal, and it is the reason 14-A shipped deliberately unwired:
 * until 14-F existed there was no brake, so there was no safe caller.
 *
 * Order is the contract:
 *
 *   guardrail (14-F)  → may an attempt be made at all?
 *   seam      (14-A)  → diagnose, and build a bounded proposal
 *   risk+policy (14-B/12-E, inside the seam) → what does it cost, who approves
 *   provenance (14-F) → record what happened, either way
 *
 * The guardrail runs FIRST and its budget is consumed only when it says yes.
 * Asking the seam first and the brake second would mean a frozen system still
 * did diagnosis work, and a storm still produced N diagnoses before being
 * refused N times.
 *
 * ---------------------------------------------------------------------------
 * IT CANNOT REACH PRODUCTION, AND IT NEVER THROWS
 * ---------------------------------------------------------------------------
 * The furthest this goes is a `PrProposalRecord` whose state is decided by
 * 14-B and 12-E — with no human approval evidence, that is `REVIEW_REQUIRED`
 * every time. No branch, no commit, no PR, no deploy. Every failure direction
 * is toward no proposal, and nothing here can fail a generation, retry a
 * provider, move a credit or change a security decision.
 */

export interface RemediationOutcome {
  readonly attempted: boolean;
  readonly refusal: RemediationRefusal | null;
  readonly attemptNumber: number | null;
  readonly record: PrProposalRecord | null;
}

/**
 * Considers one alert for automatic remediation.
 *
 * `agentId` names the acting agent for the audit trail. `nowMs` is injectable
 * so cooldown and window expiry are testable without waiting an hour.
 */
export async function considerIncidentForRemediation(
  envelope: AlertEnvelope,
  ctx: { agentId: string; nowMs?: number }
): Promise<RemediationOutcome> {
  try {
    // 1. The brake, before any work at all.
    const verdict = evaluateRemediationAttempt({
      dedupeKey: envelope.dedupeKey,
      alertType: envelope.type,
      nowMs: ctx.nowMs,
      commit: true,
    });

    if (verdict.decision !== "ALLOW_ATTEMPT") {
      recordRemediationProvenance({
        dedupeKey: envelope.dedupeKey,
        actorClass: "ai_agent",
        agent: ctx.agentId,
        attemptNumber: null,
        decision: "REFUSE",
        reasonCode: verdict.refusal ?? "guardrail_unavailable",
        traceId: envelope.correlation.traceId,
      });
      return { attempted: false, refusal: verdict.refusal, attemptNumber: null, record: null };
    }

    // 2. The 14-A seam. Diagnosis, bounded proposal, 14-B risk, 12-E policy.
    //    No approval evidence is supplied here and none could be: this path
    //    has no human in it, which is precisely why its output stops at
    //    REVIEW_REQUIRED.
    const { bridge, record } = await proposeFixForIncident(envelope, { agentId: ctx.agentId });

    recordRemediationProvenance({
      dedupeKey: envelope.dedupeKey,
      actorClass: "ai_agent",
      agent: ctx.agentId,
      attemptNumber: verdict.attemptNumber,
      decision: record ? "REVIEW_REQUIRED" : "PROPOSED",
      reasonCode: bridge.refusal ?? bridge.diagnosis.reasonCode,
      policyVersion: record?.policyDecision?.policyVersion,
      riskClass: record?.riskClass,
      traceId: envelope.correlation.traceId,
    });

    return {
      attempted: true,
      refusal: null,
      attemptNumber: verdict.attemptNumber,
      record,
    };
  } catch {
    // Fail safe: no proposal. A broken remediation path must be inert, not
    // loud — the caller is a worker's error branch that is already backing off.
    return { attempted: false, refusal: "guardrail_unavailable", attemptNumber: null, record: null };
  }
}
