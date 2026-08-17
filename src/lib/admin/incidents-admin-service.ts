import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listTrackedAlerts } from "@/lib/alerts/alert-router";
import {
  AUDIT_MAX_ITEMS,
  type IncidentsAdminResult,
  type MediaSafetyAuditItem,
  type PolicyDecisionAuditItem,
} from "./incidents-admin-contract";

/**
 * Phase 16-D Incidents/Audit read service.
 *
 * Three independent reads, combined defensively (the same discipline
 * `risk-investigation-service.ts` and `workspace-investigation-service.ts`
 * already use): the alert router's own in-memory snapshot (never fails —
 * it is a `Map` read, not I/O), the `security_events` policy-decision
 * audit trail, and `media_safety_audit`. A failed database read still
 * returns the (always-available) alert snapshot rather than discarding it.
 */
export async function getAdminIncidents(admin: SupabaseClient): Promise<IncidentsAdminResult> {
  const alerts = listTrackedAlerts();

  const [policyResult, mediaResult] = await Promise.all([
    admin
      .from("security_events")
      .select("event_id, kind, reason_code, occurred_at, actor_clerk_user_id, resource_type, resource_id, policy_version")
      .in("kind", ["policy_decision_allowed", "policy_decision_denied"])
      .order("occurred_at", { ascending: false })
      .limit(AUDIT_MAX_ITEMS),
    admin
      .from("media_safety_audit")
      .select("asset_id, action, actor_clerk_user_id, created_at, reason_code")
      .order("created_at", { ascending: false })
      .limit(AUDIT_MAX_ITEMS),
  ]);

  if (policyResult.error && mediaResult.error) {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "audit_read_failed" };
  }

  const policyDecisions: PolicyDecisionAuditItem[] = policyResult.error
    ? []
    : ((policyResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
        eventId: row.event_id as string,
        kind: row.kind as PolicyDecisionAuditItem["kind"],
        reasonCode: row.reason_code as string,
        occurredAt: row.occurred_at as string,
        actorClerkUserId: (row.actor_clerk_user_id as string | null) ?? null,
        resourceType: (row.resource_type as string | null) ?? null,
        resourceId: (row.resource_id as string | null) ?? null,
        policyVersion: (row.policy_version as string | null) ?? null,
      }));

  const mediaSafetyActions: MediaSafetyAuditItem[] = mediaResult.error
    ? []
    : ((mediaResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
        assetId: row.asset_id as string,
        action: row.action as string,
        actorClerkUserId: row.actor_clerk_user_id as string,
        createdAt: row.created_at as string,
        reasonCode: (row.reason_code as string | null) ?? null,
      }));

  return {
    outcome: "FOUND",
    alerts,
    alertHistoryPersisted: false,
    policyDecisions,
    mediaSafetyActions,
  };
}
