import type { FlagRecord } from "@/lib/feature-flags/flag-contract";

/**
 * Phase 21-B admin Feature Flags contract.
 *
 * Mirrors `router-admin-contract.ts`'s shape exactly: a closed discriminated
 * union per operation, never a raw error object, and the SAME
 * `POLICY_DENIED` / `TIER0_AUTHORIZATION_REQUIRED` outcomes
 * `router-admin-service.ts` already established for `route.disable` — this
 * is the second caller of that exact pattern, not a new one.
 */

export type FeatureFlagAdminListResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly flags: readonly FeatureFlagAdminView[] };

export interface FeatureFlagAdminView {
  readonly key: string;
  readonly riskTier: "OPERATOR" | "HIGH_RISK_TIER0";
  readonly valueType: "boolean" | "string" | "enum";
  readonly allowedValues?: readonly string[];
  readonly description: string;
  /** Null when the flag has never been written — the definition's own default is in effect. */
  readonly record: FlagRecord | null;
}

export type FeatureFlagAdminSetResult =
  | { readonly outcome: "INVALID_TARGET" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "WRITE_FAILED"; readonly reasonCode: string }
  | { readonly outcome: "APPLIED"; readonly key: string; readonly value: boolean | string; readonly previousValue: boolean | string | null }
  | { readonly outcome: "POLICY_DENIED"; readonly reasonCode: string }
  | { readonly outcome: "TIER0_AUTHORIZATION_REQUIRED"; readonly reasonCode: string; readonly requestId: string };

export const FLAG_SET_REASON_MAX_LENGTH = 500;

export function isValidFlagSetReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= FLAG_SET_REASON_MAX_LENGTH;
}

export const FLAG_SET_TICKET_MAX_LENGTH = 120;

export function isValidTicketRef(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= FLAG_SET_TICKET_MAX_LENGTH);
}
