import "server-only";
import { classifyChangeRisk } from "./change-risk";
import { resolveRequiredChecks, type RequiredCheckId } from "./required-checks";
import {
  isPrProposalInputShape,
  type PrProposalInput,
  type PrProposalRecord,
  type PrProposalState,
} from "./pr-proposal-contract";
import { requireAiWritePolicy } from "@/lib/policy/policy-gate";
import { PolicyDenied } from "@/lib/policy/policy-contract";

/**
 * AI PR-scoped write authority (Phase 14-B).
 *
 * The composition point: change-risk taxonomy + required-check registry +
 * the EXISTING Phase 12-E policy gate, over exactly one action —
 * `code.pr.create`. This module calls `requireAiWritePolicy`; it does not
 * reimplement policy evaluation, risk-state resolution, or audit logging —
 * all three already exist in `policy-gate.ts` and are reused unmodified.
 * "Do not create a second competing policy engine."
 *
 * ---------------------------------------------------------------------------
 * NO GITHUB INTEGRATION
 * ---------------------------------------------------------------------------
 * Nothing in this file imports a GitHub SDK, calls the GitHub API, invokes
 * `gh`, or reads a token. `evaluateAiPrProposal` returns a `PrProposalRecord`
 * — a decision about whether a PR MAY be opened, never the PR itself.
 *
 * ---------------------------------------------------------------------------
 * FORBIDDEN_AUTOMATION NEVER REACHES THE POLICY GATE
 * ---------------------------------------------------------------------------
 * This is the strongest guarantee this module makes, and it is structural
 * rather than a runtime check: the code path for `riskClass ===
 * "FORBIDDEN_AUTOMATION"` returns before `requireAiWritePolicy` is ever
 * called. There is no branch, flag, or future policy change that could turn
 * a forbidden change into an ALLOW, because the call that could produce ALLOW
 * is never made. Section 7 of the batch this implements: "Do not allow policy
 * engine to convert forbidden automation into ALLOW" — satisfied by never
 * asking it.
 */

/**
 * Evaluates a proposed change and returns what may happen to it — never what
 * DID happen. No branch is created, no commit is made, no PR is opened.
 *
 * `agentId` and `approvalEvidence` are supplied by the SERVER caller, exactly
 * as every other `requireAiWritePolicy` call site would — this function
 * accepts no risk claim, no check selection and no approval claim from the
 * proposal itself, which has no fields for any of those (see
 * `pr-proposal-contract.ts`).
 */
export async function evaluateAiPrProposal(
  input: PrProposalInput,
  ctx: { agentId: string; approvalEvidence?: { humanApproved: boolean } }
): Promise<PrProposalRecord> {
  if (!isPrProposalInputShape(input)) {
    throw new Error("ai-pr-authority: malformed proposal input");
  }

  const { riskClass, drivingDomains } = classifyChangeRisk(input.changedFilePaths);
  const requiredCheckIds = resolveRequiredChecks(riskClass, input.changedFilePaths);

  if (riskClass === "FORBIDDEN_AUTOMATION") {
    // Recommendation only. No policy call, no PR eligibility, no path to ALLOW.
    return {
      input,
      riskClass,
      drivingDomains,
      requiredCheckIds,
      state: "REVIEW_REQUIRED",
      policyDecision: null,
    };
  }

  try {
    const decision = await requireAiWritePolicy({
      action: "code.pr.create",
      agentId: ctx.agentId,
      resource: { type: "pull_request", id: null },
      approvalEvidence: ctx.approvalEvidence,
      correlationId: input.correlationId ?? null,
    });

    // requireAiWritePolicy only returns (rather than throws) on ALLOW.
    return {
      input,
      riskClass,
      drivingDomains,
      requiredCheckIds,
      state: "PR_ELIGIBLE",
      policyDecision: { decision: decision.decision, reason: decision.reason, policyVersion: decision.policyVersion },
    };
  } catch (error) {
    if (error instanceof PolicyDenied) {
      // DENY and REQUIRE_APPROVAL both mean the same thing to this contract:
      // not yet eligible for a PR, and a human is the only way past it.
      return {
        input,
        riskClass,
        drivingDomains,
        requiredCheckIds,
        state: "REVIEW_REQUIRED",
        policyDecision: { decision: error.decision, reason: error.reason, policyVersion: error.policyVersion },
      };
    }
    // Anything else is a real fault in the gate itself, not a policy
    // decision — it must not be silently reinterpreted as a proposal state.
    throw error;
  }
}

/**
 * Advances a proposal once real CI results exist.
 *
 * A pure function: no check is executed here, and none ever will be by this
 * module — running checks is 14-C's ownership. `outcomes` is supplied by
 * whatever future caller actually ran them.
 *
 * Only a proposal already `PR_ELIGIBLE` can move to `CI_BLOCKED`; a
 * `REVIEW_REQUIRED` proposal needs a human, not a check result, so it is
 * returned unchanged.
 */
export function advanceAfterChecks(
  record: PrProposalRecord,
  outcomes: Readonly<Partial<Record<RequiredCheckId, "pass" | "fail" | "pending">>>
): PrProposalRecord {
  if (record.state !== "PR_ELIGIBLE") return record;

  const anyBlockingFailed = record.requiredCheckIds.some((id) => outcomes[id] === "fail");
  if (!anyBlockingFailed) return record;

  const nextState: PrProposalState = "CI_BLOCKED";
  return { ...record, state: nextState };
}
