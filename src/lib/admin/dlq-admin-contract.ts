import type { DlqRedriveDecision } from "@/lib/aws/dlq-redrive/dlq-redrive-contract";

/**
 * Phase 16-B admin Failed Jobs / DLQ contract.
 *
 * Deliberately reuses `DlqRedriveDecision` (Phase 15-D/1) verbatim rather
 * than re-projecting it into a parallel "admin view" type — that type is
 * already bounded by construction (two ids, two queue names, a closed
 * state, a short reason code; no prompt, payload, secret, or raw AWS
 * response has anywhere to go in it, per its own header), so wrapping it in
 * a second shape would only add a translation step with nothing to protect
 * against.
 */

export type DlqAdminInvestigationResult =
  | { readonly outcome: "NOT_CONFIGURED" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "NO_MESSAGE" }
  | { readonly outcome: "DECIDED"; readonly decision: DlqRedriveDecision };

export type DlqAdminRedriveResult =
  | { readonly outcome: "NOT_CONFIGURED" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "NO_MESSAGE" }
  | { readonly outcome: "REFUSED"; readonly decision: DlqRedriveDecision }
  | { readonly outcome: "REDRIVEN"; readonly decision: DlqRedriveDecision; readonly messageId: string }
  /**
   * PHASE 19 CLOSURE FIX. The Phase 12-E policy gate (`requirePolicy`,
   * action `queue.dlq.redrive`) is now the FIRST check
   * `executeAdminDlqRedrive` makes — see that function's header. A policy
   * DENY blocks before Tier-0 is evaluated and before the real Phase 15-D
   * redrive decision is ever recomputed.
   */
  | { readonly outcome: "POLICY_DENIED"; readonly reasonCode: string }
  /**
   * Phase 16-E, extended by the Phase 19 closure fix. `requestId` carries
   * across retries so a second admin's approval (`decidePrivilegedAction`)
   * can satisfy the SAME pending request. Only reachable when
   * `CINEFIELD_TIER0_ENFORCEMENT_MODE=enforce` — see
   * `tier0-authorization.ts`'s header. `queue.dlq.redrive` is catalogued
   * `HIGH_RISK_TIER0` + step-up-required + two-person; in the default
   * "shadow" mode this branch is never returned (the redrive proceeds and
   * the real decision is only recorded to the durable audit trail).
   */
  | { readonly outcome: "TIER0_AUTHORIZATION_REQUIRED"; readonly reasonCode: string; readonly requestId: string };

/** Bounded operator-supplied intent. Never prose long enough to become a second free-text field to guard. */
export const DLQ_REDRIVE_REASON_MAX_LENGTH = 500;

export function isValidDlqRedriveReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= DLQ_REDRIVE_REASON_MAX_LENGTH;
}
