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

/**
 * ---------------------------------------------------------------------------
 * PHASE 28-D — THE REVIEW QUEUE
 * ---------------------------------------------------------------------------
 * Phase 16-C gave administrators the three ACTIONS and the audit read, but
 * every one of them needs an asset id the operator already has. There was no
 * way to find out WHICH assets were waiting — the queue 28-D asks for
 * ("Admin moderation/quarantine/report status queue"), and the thing a
 * false-positive appeal needs in order to reach a human at all.
 *
 * The item below is deliberately narrow. It carries identifiers, a verdict, a
 * bounded category list and a reason CODE. It carries no prompt, no thumbnail,
 * no object key, no signed URL and no provider payload — a reviewer decides
 * from the asset itself through the existing asset surface, not from a queue
 * row that would otherwise become a second place media metadata leaks from.
 */
export interface ModerationQueueItem {
  readonly decisionId: string;
  readonly mediaAssetId: string | null;
  readonly generationId: string | null;
  readonly outputIndex: number | null;
  readonly stage: string;
  readonly verdict: string;
  readonly riskCategories: readonly string[];
  readonly reasonCode: string;
  readonly createdAt: string;
  /** What the PROVIDER said, kept distinct from Cinefield's verdict above. */
  readonly providerSignalSource: string;
  readonly providerSignalFlagged: boolean | null;
  /** Whether the owner has an appeal open on this asset. */
  readonly appealOpen: boolean;
}

export type ModerationQueueResult =
  | { readonly outcome: "QUEUE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly items: readonly ModerationQueueItem[] };

/** Bounded. A queue read must never become an unpaged table scan. */
export const MODERATION_QUEUE_MAX_ITEMS = 100;

export const MODERATION_REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;

export function isValidModerationReasonCode(value: unknown): value is string {
  return typeof value === "string" && MODERATION_REASON_CODE_PATTERN.test(value);
}
