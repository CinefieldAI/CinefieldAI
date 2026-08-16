import { evaluateDlqRedriveDecision } from "./dlq-redrive-decision-engine";
import type { DlqRedriveDecision, DlqRedriveEvidenceSource } from "./dlq-redrive-contract";
import type { DlqMessageSource } from "./dlq-message-source-contract";

/**
 * Manual DLQ investigation orchestration (Phase 15-D/3).
 *
 * ---------------------------------------------------------------------------
 * OBSERVATION ONLY — FOUR OUTCOMES, NO FIFTH
 * ---------------------------------------------------------------------------
 * `NOT_CONFIGURED`    nothing to read from (no DLQ source wired)
 * `SOURCE_UNAVAILABLE` the DLQ could not be read (AWS error, timeout, etc.)
 * `NO_MESSAGE`         the DLQ has no message right now — an ordinary,
 *                       expected, non-error state, never conflated with a
 *                       failure
 * `DECIDED`            a message was found; `decision` is the EXISTING
 *                       Phase 15-D/1 engine's own bounded verdict, passed
 *                       through verbatim
 *
 * There is no "MAYBE_SAFE", no "LIKELY_SAFE", no auto-redrive path, and
 * this function calls exactly one queue method (`peekMessage`) and exactly
 * one decision function (`evaluateDlqRedriveDecision` — the SAME pure
 * engine `evaluateProviderDlqMessage` already calls in production, not a
 * second implementation of it). Nothing here can submit a provider, spend
 * money, or move a queue message — there is no import capable of any of
 * those in this file or in either of its two dependencies.
 */
export type DlqInvestigationResult =
  | { readonly outcome: "NOT_CONFIGURED" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "NO_MESSAGE" }
  | { readonly outcome: "DECIDED"; readonly decision: DlqRedriveDecision };

export interface InvestigateProviderDlqInput {
  /** `null` when no DLQ source is wired up. Never treated as "nothing to worry about". */
  readonly messageSource: DlqMessageSource | null;
  /** `null` when no evidence source is wired up — `evaluateDlqRedriveDecision` itself fails closed on this. */
  readonly evidenceSource: DlqRedriveEvidenceSource | null;
}

export async function investigateProviderDlq(
  input: InvestigateProviderDlqInput
): Promise<DlqInvestigationResult> {
  if (!input.messageSource) {
    return { outcome: "NOT_CONFIGURED" };
  }

  let message;
  try {
    message = await input.messageSource.peekMessage();
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "dlq_read_failed" };
  }

  if (!message) {
    return { outcome: "NO_MESSAGE" };
  }

  const decision = await evaluateDlqRedriveDecision({
    rawMessageBody: message.body,
    source: input.evidenceSource,
  });

  return { outcome: "DECIDED", decision };
}
