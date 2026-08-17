import type {
  RiskAction,
  SecurityEventKind,
  SecuritySeverity,
  SecuritySource,
} from "@/lib/security/security-event-contract";
import type { TrackedAlertSnapshot } from "@/lib/alerts/alert-router";

/**
 * Phase 16-D Security Center admin contract — read-only.
 *
 * ---------------------------------------------------------------------------
 * TWO CANONICAL SOURCES, BOTH ALREADY OWNED, NEITHER RE-SCORED
 * ---------------------------------------------------------------------------
 * `security_events` (Phase 12-C) — the same append-only evidence log
 * `risk-investigation-service.ts` (Phase 16-A) already reads, with the SAME
 * bounded column list and the SAME rule: `risk_score`/`recommended_action`
 * are read verbatim from the row the Risk Engine wrote at record time, never
 * recomputed. Risk Investigation answers "show me evidence FOR this
 * identifier"; Security Center answers a different operator question —
 * "what is happening right now, system-wide, ordered by severity?" — so it
 * reads the most recent N rows (optionally filtered by severity) instead of
 * requiring an identifier up front. Same table, same columns, a different
 * query shape for a different incident-response moment.
 *
 * The alert router's live in-memory tracked state (Phase 13-D,
 * `src/lib/alerts/alert-router.ts`'s `listTrackedAlerts()`, extended in
 * 16-D) — filtered to `source: "security"` here, so this screen also shows
 * whether a security signal is currently OPEN in the router's own dedupe
 * window. Honestly EPHEMERAL: this is one process's memory, not a durable
 * timeline — see `listTrackedAlerts()`'s own header and the Incidents/Audit
 * screen, which reads the FULL tracked-alert list.
 *
 * No secret/token, no raw payload, no provider result, no prompt — the same
 * bounded projection `risk-investigation-contract.ts` already established.
 */

export interface SecurityEventFeedItem {
  readonly eventId: string;
  readonly kind: SecurityEventKind;
  readonly severity: SecuritySeverity;
  readonly source: SecuritySource;
  readonly reasonCode: string;
  readonly riskScore: number | null;
  readonly recommendedAction: RiskAction | null;
  readonly occurredAt: string;
  readonly traceId: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly actorClerkUserId: string | null;
}

export const SECURITY_SEVERITY_FILTERS: readonly SecuritySeverity[] = ["info", "low", "medium", "high"];

export function isSecuritySeverity(value: string | null): value is SecuritySeverity {
  return value !== null && (SECURITY_SEVERITY_FILTERS as readonly string[]).includes(value);
}

export const SECURITY_CENTER_MAX_EVENTS = 100;

export type SecurityCenterResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "FOUND";
      readonly events: readonly SecurityEventFeedItem[];
      /** Bounded to `source: "security"` — see this file's header. */
      readonly openSecurityAlerts: readonly TrackedAlertSnapshot[];
    };
