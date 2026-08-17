import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listTrackedAlerts } from "@/lib/alerts/alert-router";
import {
  SECURITY_CENTER_MAX_EVENTS,
  type SecurityCenterResult,
  type SecurityEventFeedItem,
} from "./security-center-contract";
import type { SecuritySeverity } from "@/lib/security/security-event-contract";

/**
 * Phase 16-D Security Center read service.
 *
 * One SELECT against `security_events` — most recent rows first, optionally
 * filtered by severity — plus a read of the alert router's own live tracked
 * state, filtered to `source: "security"`. No `.insert(`/`.update(`/
 * `.upsert(`/`.delete(` anywhere in this file, and no scoring: exactly the
 * same discipline `risk-investigation-service.ts` already established.
 */
export async function getAdminSecurityCenter(
  admin: SupabaseClient,
  severity?: SecuritySeverity
): Promise<SecurityCenterResult> {
  let query = admin
    .from("security_events")
    .select(
      "event_id, kind, severity, source, reason_code, risk_score, recommended_action, occurred_at, trace_id, resource_type, resource_id, actor_clerk_user_id"
    )
    .order("occurred_at", { ascending: false })
    .limit(SECURITY_CENTER_MAX_EVENTS);

  if (severity) query = query.eq("severity", severity);

  const { data, error } = await query;
  if (error) return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "security_events_read_failed" };

  const events: SecurityEventFeedItem[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    eventId: row.event_id as string,
    kind: row.kind as SecurityEventFeedItem["kind"],
    severity: row.severity as SecurityEventFeedItem["severity"],
    source: row.source as SecurityEventFeedItem["source"],
    reasonCode: row.reason_code as string,
    riskScore: (row.risk_score as number | null) ?? null,
    recommendedAction: (row.recommended_action as SecurityEventFeedItem["recommendedAction"]) ?? null,
    occurredAt: row.occurred_at as string,
    traceId: (row.trace_id as string | null) ?? null,
    resourceType: (row.resource_type as string | null) ?? null,
    resourceId: (row.resource_id as string | null) ?? null,
    actorClerkUserId: (row.actor_clerk_user_id as string | null) ?? null,
  }));

  const openSecurityAlerts = listTrackedAlerts().filter((a) => a.source === "security");

  return { outcome: "FOUND", events, openSecurityAlerts };
}
