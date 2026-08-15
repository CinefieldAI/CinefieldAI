import "server-only";
import type { AlertEnvelope } from "@/lib/alerts/alert-contract";
import { analyzeIncident, type IncidentDiagnosis, type RootCauseProvider } from "./incident-diagnosis";
import {
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  isPrProposalInputShape,
  type PrProposalInput,
} from "./pr-proposal-contract";
import { evaluateAiPrProposal } from "./ai-pr-authority";
import type { PrProposalRecord } from "./pr-proposal-contract";

/**
 * Incident → diagnosis → fix-proposal bridge (Phase 14-A, code-only half).
 *
 * Completes the first half of the roadmap's canonical chain:
 *
 *   AlertEnvelope (13-D) → IncidentDiagnosis (14-A) → PrProposalInput (14-B)
 *     → change-risk (14-B) → policy gate (12-E) → REVIEW_REQUIRED
 *
 * and stops there. Everything after PR eligibility — branch, commit, push,
 * open PR, merge, deploy — is 14-A's external half and is NOT built. This
 * module imports no GitHub SDK, calls no network, and reads no token.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE BRIDGE MAY AND MAY NOT FILL IN
 * ---------------------------------------------------------------------------
 * It supplies only the four descriptive fields `PrProposalInput` declares:
 * title, summary, changed paths, rollback expectation, plus the correlation
 * id. It supplies NO risk class, NO required checks, NO approval — and it
 * could not if it tried, because `PrProposalInput` has no field for any of
 * them (see `pr-proposal-contract.ts`). Risk is re-derived from the paths by
 * 14-B's classifier and approval comes from a human, so a diagnosis that was
 * wrong about severity cannot make a change cheaper to land.
 */

/** The bounded reasons a bridge attempt can produce nothing. */
export type BridgeRefusal =
  | "human_investigation_required"
  | "analysis_unavailable"
  | "no_candidate_files"
  | "malformed_proposal";

export interface BridgeResult {
  readonly diagnosis: IncidentDiagnosis;
  /** Present only when the diagnosis was remediation-eligible AND well-formed. */
  readonly proposal: PrProposalInput | null;
  readonly refusal: BridgeRefusal | null;
}

/** Bounded, code-only summary text. Never a log line, stack or provider body. */
function describe(diagnosis: IncidentDiagnosis): { title: string; summary: string } {
  const title = `Investigate ${diagnosis.alertType} on ${diagnosis.dedupeKey}`.slice(0, MAX_TITLE_LENGTH);

  // Every element is an enum label, a short code or a count — the same
  // material a 13-E-guarded log line may carry. There is no interpolation of
  // anything that came from a user, a provider or an error object.
  const summary = [
    `Automated diagnosis of alert ${diagnosis.alertId}.`,
    `Category ${diagnosis.category}, severity ${diagnosis.severity}, confidence ${diagnosis.confidence}.`,
    `Reason code ${diagnosis.reasonCode}; seen ${diagnosis.occurrenceCount} time(s).`,
    `Candidate area: ${diagnosis.candidateFilePaths.join(", ")}.`,
    `Diagnosis is evidence only — risk class and required checks are derived server-side, and a human must approve.`,
  ]
    .join(" ")
    .slice(0, MAX_SUMMARY_LENGTH);

  return { title, summary };
}

/**
 * Turns one alert into a proposal, or explains why it did not.
 *
 * Pure and side-effect free: it writes nothing, opens nothing, and mutates no
 * business state. A refusal is the normal outcome for most incident classes.
 */
export function bridgeIncidentToProposal(
  envelope: AlertEnvelope,
  provider?: RootCauseProvider
): BridgeResult {
  const diagnosis = provider ? analyzeIncident(envelope, provider) : analyzeIncident(envelope);

  if (diagnosis.outcome === "ANALYSIS_UNAVAILABLE") {
    return { diagnosis, proposal: null, refusal: "analysis_unavailable" };
  }
  if (diagnosis.outcome !== "REMEDIATION_CANDIDATE" || diagnosis.requiresHumanInvestigation) {
    return { diagnosis, proposal: null, refusal: "human_investigation_required" };
  }
  if (diagnosis.candidateFilePaths.length === 0) {
    return { diagnosis, proposal: null, refusal: "no_candidate_files" };
  }

  const { title, summary } = describe(diagnosis);

  const proposal: PrProposalInput = {
    title,
    summary,
    changedFilePaths: diagnosis.candidateFilePaths,
    rollbackExpectation: "revert_pr",
    // Correlation is observational: it joins this proposal to the incident
    // timeline and authorizes nothing. 14-B's own test S14B-23 pins that a
    // correlation id cannot change a risk class or a policy outcome.
    ...(diagnosis.correlation.traceId ? { correlationId: diagnosis.correlation.traceId } : {}),
    ...(diagnosis.correlation.generationId ? { generationId: diagnosis.correlation.generationId } : {}),
  };

  // The bridge validates its own output against 14-B's shape guard rather
  // than trusting itself — if a future diagnosis produced an over-long title
  // or an unusable path, this refuses instead of handing a malformed
  // proposal to the policy gate.
  if (!isPrProposalInputShape(proposal)) {
    return { diagnosis, proposal: null, refusal: "malformed_proposal" };
  }

  return { diagnosis, proposal, refusal: null };
}

/**
 * The full read-only pipeline: alert → diagnosis → proposal → 14-B evaluation.
 *
 * Returns `null` for `record` when the bridge refused, so a caller can tell
 * "no proposal was made" apart from "a proposal was made and held for
 * review". Even on the success path the record's state is decided by 14-B and
 * 12-E, not here — with no human approval evidence supplied, that is
 * `REVIEW_REQUIRED` every time.
 */
export async function proposeFixForIncident(
  envelope: AlertEnvelope,
  ctx: { agentId: string; approvalEvidence?: { humanApproved: boolean } },
  provider?: RootCauseProvider
): Promise<{ bridge: BridgeResult; record: PrProposalRecord | null }> {
  const bridge = bridgeIncidentToProposal(envelope, provider);
  if (!bridge.proposal) return { bridge, record: null };

  const record = await evaluateAiPrProposal(bridge.proposal, ctx);
  return { bridge, record };
}
