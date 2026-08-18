import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { investigateProviderDlq } from "@/lib/aws/dlq-redrive/dlq-investigation-service";
import { createSqsDlqMessageSource } from "@/lib/aws/dlq-redrive/adapters/sqs-dlq-message-source";
import { createSupabaseDlqRedriveSource } from "@/lib/aws/dlq-redrive/adapters/supabase-dlq-redrive-source";
import { redriveOneProviderDlqMessage } from "@/lib/aws/dlq-redrive/adapters/sqs-dlq-redrive-executor";
import { createLogger } from "@/lib/observability/logger";
import { authorizeTier0Action, recordTier0Execution } from "./tier0-authorization";
import { requirePolicy } from "@/lib/policy/policy-gate";
import { PolicyDenied } from "@/lib/policy/policy-contract";
import type { AssuranceEvidence, ElevationVerdict } from "./step-up-auth";
import type { DlqAdminInvestigationResult, DlqAdminRedriveResult } from "./dlq-admin-contract";

/**
 * The Phase 16-B admin Failed Jobs / DLQ read + action service.
 *
 * ---------------------------------------------------------------------------
 * TWO CALLS TO EXISTING PHASE 15-D LOGIC. NOTHING REIMPLEMENTED.
 * ---------------------------------------------------------------------------
 * `getAdminDlqInvestigation` is `scripts/dlq-investigate.ts`'s exact same
 * three-line wiring (`createSqsDlqMessageSource` +
 * `createSupabaseDlqRedriveSource` + `investigateProviderDlq`), reused
 * verbatim so the admin surface's read and the manual script's read can
 * never quietly diverge. `executeAdminDlqRedrive` calls the new Phase 16-B
 * executor (`redriveOneProviderDlqMessage`), which itself calls the
 * UNMODIFIED Phase 15-D/1 decision engine fresh on every attempt — this
 * file adds only the audit log line and the actor/reason it carries.
 */

const auditLog = createLogger("admin-dlq");

export async function getAdminDlqInvestigation(admin: SupabaseClient): Promise<DlqAdminInvestigationResult> {
  const messageSource = createSqsDlqMessageSource();
  const evidenceSource = createSupabaseDlqRedriveSource(admin);
  return investigateProviderDlq({ messageSource, evidenceSource });
}

/**
 * Phase 16-E. `queue.dlq.redrive` is catalogued `HIGH_RISK_TIER0` +
 * step-up-required + (as of the Phase 19 closure fix) two-person, named
 * explicitly in the 16-B/16-E handoff and the roadmap's own Phase 19
 * Two-Person Approval list — see `tier0-action-catalogue.ts`. The Tier-0
 * authorization decision ALWAYS runs and is ALWAYS durably recorded;
 * whether a `false` decision actually blocks this function depends on
 * `CINEFIELD_TIER0_ENFORCEMENT_MODE` — see `tier0-authorization.ts`'s
 * header for why hard-enforcement is not the default in this batch. The
 * redrive executor itself (`redriveOneProviderDlqMessage`, Phase 15-D/16-B)
 * is called completely unmodified either way.
 *
 * PHASE 19 CLOSURE FIX. `requirePolicy` (action `queue.dlq.redrive`) is the
 * FIRST gate, unconditional (unlike Tier-0's enforcement-mode split) — a
 * policy DENY always blocks. It is a NECESSARY but not SUFFICIENT
 * condition: Tier-0 role/step-up/two-person still independently gates the
 * same call.
 *
 * `requestId` is optional so a caller can RESUME a pending two-person
 * request (returned on the prior `TIER0_AUTHORIZATION_REQUIRED` response)
 * rather than minting a fresh one every attempt, which could never be
 * satisfied.
 */
export async function executeAdminDlqRedrive(
  admin: SupabaseClient,
  actorClerkUserId: string,
  reason: string,
  // Resolved by the ROUTE layer (`require-step-up.ts`, which imports the
  // Clerk server SDK) and passed in — never resolved here, so this service
  // function stays loadable by a plain `node:test` process, exactly like
  // `temporal-admin-service.ts` keeps Temporal SDK calls out of
  // `admin-auth.ts`'s decision core. Omitted (e.g. by the existing 16-B
  // test, which predates step-up) defaults to the honest fail-closed state.
  stepUp: { assurance: AssuranceEvidence; elevation: ElevationVerdict } = {
    assurance: { state: "NOT_CONFIGURED", verifiedAt: null },
    elevation: { elevated: false, reasonCode: "no_elevation" },
  },
  requestId: string = randomUUID()
): Promise<DlqAdminRedriveResult> {
  try {
    await requirePolicy({
      action: "queue.dlq.redrive",
      actor: { id: actorClerkUserId, role: "route_admin", kind: "human" },
      resource: { type: "dlq_message", id: null },
      correlationId: requestId,
    });
  } catch (caught) {
    if (!(caught instanceof PolicyDenied)) throw caught;
    auditLog.info("dlq_redrive_attempted", { actorClerkUserId, reason, outcome: "POLICY_DENIED", policyReasonCode: caught.reason });
    return { outcome: "POLICY_DENIED", reasonCode: caught.reason };
  }

  const { assurance, elevation } = stepUp;
  const decision = await authorizeTier0Action(admin, {
    requestId,
    action: "queue.dlq.redrive",
    actorClerkUserId,
    target: { type: "dlq_message", id: null },
    reasonCode: null,
    assurance,
    elevation,
  });

  if (!decision.allowed) {
    auditLog.info("dlq_redrive_attempted", { actorClerkUserId, reason, outcome: "TIER0_AUTHORIZATION_REQUIRED", tier0ReasonCode: decision.reasonCode });
    return { outcome: "TIER0_AUTHORIZATION_REQUIRED", reasonCode: decision.reasonCode, requestId };
  }

  const evidenceSource = createSupabaseDlqRedriveSource(admin);
  const result = await redriveOneProviderDlqMessage(evidenceSource);

  const redriveDecision = "decision" in result ? result.decision : undefined;
  auditLog.info("dlq_redrive_attempted", {
    actorClerkUserId,
    reason,
    outcome: result.outcome,
    decisionState: redriveDecision?.state,
    decisionReasonCode: redriveDecision?.reasonCode,
    generationId: redriveDecision?.generationId,
    attemptId: redriveDecision?.attemptId,
  });

  await recordTier0Execution(admin, {
    requestId,
    action: "queue.dlq.redrive",
    actorClerkUserId,
    target: { type: "dlq_message", id: redriveDecision?.attemptId ?? null },
    outcome: result.outcome === "REDRIVEN" ? "executed" : "execution_failed",
    outcomeDetail: result.outcome.toLowerCase(),
  });

  return result;
}
