import type { TrackedAlertSnapshot } from "@/lib/alerts/alert-router";

/**
 * Phase 16-D Incidents/Audit admin contract — read-only.
 *
 * ---------------------------------------------------------------------------
 * INCIDENTS: PHASE 13-D'S OWN LIVE STATE, HONESTLY EPHEMERAL
 * ---------------------------------------------------------------------------
 * `alerts` below is `listTrackedAlerts()` (Phase 13-D, extended in 16-D) —
 * the SAME in-memory dedupe map `raiseAlert`/`resolveAlert` already
 * maintain. Per the 16-D spec section 8: this is audited honestly as
 * ephemeral. It is ONE PROCESS's memory, cleared on every restart or
 * redeploy, never shared across instances, and never durably queryable
 * beyond "what is this process tracking right now." No second alert router,
 * no new alert-history table — `alertHistoryPersisted` is always `false`
 * today and is a field precisely so this page can say so instead of
 * silently looking like a full incident timeline.
 *
 * ---------------------------------------------------------------------------
 * AUDIT: EXISTING CANONICAL EVIDENCE ONLY, NO NEW TABLE
 * ---------------------------------------------------------------------------
 * Two REAL, ALREADY-DURABLE audit trails, combined for display and nothing
 * else:
 *   - `security_events` rows with `kind IN
 *     ('policy_decision_allowed','policy_decision_denied')` — Phase 12-E's
 *     own decision log, which its own migration comment states lives here
 *     "rather than in a table of its own" (see `security-event-contract.ts`).
 *   - `media_safety_audit` — Phase 9-E's quarantine release/reject trail
 *     (`src/lib/media/quarantine-release.ts`'s `readSafetyAudit`, which
 *     reads it scoped to one asset; this reads the same bounded columns
 *     system-wide, most-recent-first, for the same reason Security Center
 *     reads `security_events` system-wide instead of by identifier).
 *
 * No `admin_actions` table, no new audit store — section 9 of the 16-D spec
 * is explicit about this, and the 16-E handoff is named in the doc comment
 * below rather than built early.
 */

export interface PolicyDecisionAuditItem {
  readonly eventId: string;
  readonly kind: "policy_decision_allowed" | "policy_decision_denied";
  readonly reasonCode: string;
  readonly occurredAt: string;
  readonly actorClerkUserId: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly policyVersion: string | null;
}

export interface MediaSafetyAuditItem {
  readonly assetId: string;
  readonly action: string;
  readonly actorClerkUserId: string;
  readonly createdAt: string;
  readonly reasonCode: string | null;
}

export const AUDIT_MAX_ITEMS = 100;

export type IncidentsAdminResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "FOUND";
      readonly alerts: readonly TrackedAlertSnapshot[];
      /** Always `false` today — see this file's header. Reserved for a future durable store. */
      readonly alertHistoryPersisted: false;
      readonly policyDecisions: readonly PolicyDecisionAuditItem[];
      readonly mediaSafetyActions: readonly MediaSafetyAuditItem[];
    };
