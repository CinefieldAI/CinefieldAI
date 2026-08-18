import type { Tier0SecurityClassification } from "./tier0-action-catalogue";

/**
 * PHASE 19 CLOSURE FIX — the request/response shape for a SECOND, distinct
 * admin deciding a pending two-person privileged action.
 *
 * `decidePrivilegedAction` (`tier0-authorization.ts`) is the real decision
 * point; this contract only bounds what a route may accept and return —
 * same discipline as every other Phase 16 admin contract (bounded ids and
 * short codes, never free text, never a raw error).
 */

export const PRIVILEGED_ACTION_REASON_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;

export interface PrivilegedActionDecisionRequest {
  readonly requestId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly decision: "approve" | "reject";
  readonly reasonCode?: string | null;
}

export function isValidDecisionRequest(value: unknown): value is PrivilegedActionDecisionRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.requestId !== "string" || typeof v.action !== "string") return false;
  if (typeof v.targetType !== "string") return false;
  if (v.targetId !== undefined && v.targetId !== null && typeof v.targetId !== "string") return false;
  if (v.decision !== "approve" && v.decision !== "reject") return false;
  if (v.reasonCode !== undefined && v.reasonCode !== null && typeof v.reasonCode !== "string") return false;
  return true;
}

export type PrivilegedActionDecisionResult =
  | { readonly outcome: "INVALID_REQUEST" }
  | { readonly outcome: "UNKNOWN_ACTION" }
  | { readonly outcome: "ROLE_NOT_PERMITTED" }
  | { readonly outcome: "STEP_UP_REQUIRED"; readonly reasonCode: string }
  | { readonly outcome: "SELF_APPROVAL_BLOCKED" }
  | { readonly outcome: "NO_MATCHING_REQUEST" }
  | { readonly outcome: "REQUEST_EXPIRED" }
  | { readonly outcome: "REJECTED" }
  | {
      readonly outcome: "APPROVAL_RECORDED";
      readonly approvals: number;
      readonly required: number;
      readonly satisfied: boolean;
    }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string };

export type { Tier0SecurityClassification };
