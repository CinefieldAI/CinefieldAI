/**
 * Phase 16-C admin Moderation contract.
 *
 * ---------------------------------------------------------------------------
 * THE RELEASE ACTION IS REUSED VERBATIM FROM PHASE 9-E, NOT A NEW ONE
 * ---------------------------------------------------------------------------
 * `src/lib/media/quarantine-release.ts` already implements the complete,
 * tested, two-person-approval quarantine release lane (`requestMediaRelease`
 * / `approveMediaRelease` / `rejectMediaAsset`), gated by BOTH
 * `assertRouteAdmin` (the same separate `ROUTE_ADMIN_CLERK_USER_IDS`
 * authority `router-admin-service.ts` already distinguishes from Phase
 * 16's `requireAdminAccess()`) and a Phase 12-E policy gate
 * (`media.quarantine.request`/`.release`/`.reject`), called INSIDE those
 * three functions already — this file adds no new authorization layer, no
 * new policy gate, and no new two-person mechanism. It is real dual-
 * control, already built by Phase 9-E for exactly this reason (the
 * roadmap's own words, quoted in that file: quarantine release "tek admin
 * onayıyla çalıştırılamaz" — cannot run on one admin's approval alone), not
 * something Phase 16-C invents or something deferred to Phase 16-E.
 *
 * `readSafetyAudit` (same file) is a REAL, ALREADY-DURABLE, append-only
 * audit trail (`media_safety_audit`, trigger-enforced) — this is stronger
 * audit evidence than Phase 16-B's own action logging had available, and
 * this surface exposes it read-only rather than building a parallel one.
 */

export type ModerationActionKind = "request" | "approve" | "reject";

export interface SafetyAuditEntryView {
  readonly action: string;
  readonly actor: string;
  readonly createdAt: string;
  readonly reasonCode: string | null;
}

export type ModerationAuditResult =
  | { readonly outcome: "INVALID_IDENTIFIER" }
  | { readonly outcome: "AUDIT_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly entries: readonly SafetyAuditEntryView[] };

export type ModerationActionResult =
  | { readonly outcome: "INVALID_TARGET" }
  | { readonly outcome: "ROUTE_AUTHORITY_DENIED" }
  | { readonly outcome: "ACTION_UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "REQUEST_RECORDED";
      readonly recorded: boolean;
      readonly approvals?: number;
      readonly required?: number;
      readonly reason?: string;
    }
  | { readonly outcome: "RELEASED"; readonly assetId: string; readonly eventId: string | null }
  | {
      readonly outcome: "RELEASE_REFUSED";
      readonly reason: string;
      readonly approvals?: number;
      readonly required?: number;
      readonly moderationStatus?: string;
    }
  | { readonly outcome: "REJECTED"; readonly assetId: string; readonly eventId: string | null }
  | { readonly outcome: "REJECT_REFUSED"; readonly reason: string };

export const MODERATION_REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;

export function isValidModerationReasonCode(value: unknown): value is string {
  return typeof value === "string" && MODERATION_REASON_CODE_PATTERN.test(value);
}
