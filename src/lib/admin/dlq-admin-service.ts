import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { investigateProviderDlq } from "@/lib/aws/dlq-redrive/dlq-investigation-service";
import { createSqsDlqMessageSource } from "@/lib/aws/dlq-redrive/adapters/sqs-dlq-message-source";
import { createSupabaseDlqRedriveSource } from "@/lib/aws/dlq-redrive/adapters/supabase-dlq-redrive-source";
import { redriveOneProviderDlqMessage } from "@/lib/aws/dlq-redrive/adapters/sqs-dlq-redrive-executor";
import { createLogger } from "@/lib/observability/logger";
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

export async function executeAdminDlqRedrive(
  admin: SupabaseClient,
  actorClerkUserId: string,
  reason: string
): Promise<DlqAdminRedriveResult> {
  const evidenceSource = createSupabaseDlqRedriveSource(admin);
  const result = await redriveOneProviderDlqMessage(evidenceSource);

  const decision = "decision" in result ? result.decision : undefined;
  auditLog.info("dlq_redrive_attempted", {
    actorClerkUserId,
    reason,
    outcome: result.outcome,
    decisionState: decision?.state,
    decisionReasonCode: decision?.reasonCode,
    generationId: decision?.generationId,
    attemptId: decision?.attemptId,
  });

  return result;
}
