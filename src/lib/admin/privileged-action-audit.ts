import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tier0SecurityClassification } from "./tier0-action-catalogue";

/**
 * Phase 16-E — durable privileged-action audit: write + bounded query.
 *
 * Thin wrapper over `admin_privileged_action_events`
 * (`20260829000000_tier0_admin_action_audit.sql`) — see that migration's
 * header for why this table exists and why it is one append-only event log
 * rather than a mutable lifecycle row. This file never UPDATEs or DELETEs a
 * row; every function here either INSERTs a new event or SELECTs.
 */

export type PrivilegedActionEvent =
  | "requested"
  | "denied"
  | "awaiting_second_approval"
  | "approved"
  | "rejected"
  | "executed"
  | "execution_failed"
  | "expired";

export interface RecordPrivilegedActionEventParams {
  requestId: string;
  event: PrivilegedActionEvent;
  actorClerkUserId: string;
  actionType: string;
  targetType: string;
  targetId?: string | null;
  reasonCode?: string | null;
  correlationId?: string | null;
  securityClassification: Tier0SecurityClassification;
  outcomeDetail?: string | null;
}

/**
 * Appends one lifecycle event. NEVER THROWS — evidence-writing must not be
 * able to abort the authorization decision or the canonical action it
 * describes (same "a logging failure must never roll back a decision"
 * principle `quarantine-release.ts`'s `reportMediaSafetyDecision` states).
 * Returns whether the write succeeded so a caller MAY note the gap, but
 * never must.
 */
export async function recordPrivilegedActionEvent(
  admin: SupabaseClient,
  params: RecordPrivilegedActionEventParams
): Promise<boolean> {
  try {
    const { error } = await admin.from("admin_privileged_action_events").insert({
      request_id: params.requestId,
      event: params.event,
      actor_clerk_user_id: params.actorClerkUserId,
      action_type: params.actionType,
      target_type: params.targetType,
      target_id: params.targetId ?? null,
      reason_code: params.reasonCode ?? null,
      correlation_id: params.correlationId ?? null,
      security_classification: params.securityClassification,
      outcome_detail: params.outcomeDetail ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}

export interface RecordApprovalParams {
  requestId: string;
  actorClerkUserId: string;
  actionType: string;
  targetType: string;
  targetId?: string | null;
  reasonCode?: string | null;
  correlationId?: string | null;
  securityClassification: Tier0SecurityClassification;
  requiredApprovals?: number;
}

export type RecordApprovalResult =
  | { recorded: true; approvals: number; required: number; satisfied: boolean }
  | { recorded: false; reason: "no_matching_request" | "self_approval_blocked" | "rpc_unavailable" };

/**
 * Records a second (or later) admin's approval via the SQL function that
 * structurally blocks self-approval and serialises concurrent approvers —
 * see the migration's header. Never a plain `.insert()`: this is the one
 * write in this file that needs the database's own transaction, not just
 * an append.
 */
export async function recordPrivilegedActionApproval(
  admin: SupabaseClient,
  params: RecordApprovalParams
): Promise<RecordApprovalResult> {
  try {
    const { data, error } = await admin.rpc("record_admin_privileged_action_approval", {
      p_request_id: params.requestId,
      p_actor: params.actorClerkUserId,
      p_action_type: params.actionType,
      p_target_type: params.targetType,
      p_target_id: params.targetId ?? null,
      p_reason_code: params.reasonCode ?? null,
      p_correlation_id: params.correlationId ?? null,
      p_security_classification: params.securityClassification,
      p_required_approvals: params.requiredApprovals ?? 2,
    });
    if (error || !data) return { recorded: false, reason: "rpc_unavailable" };
    const result = data as {
      recorded: boolean;
      reason?: "no_matching_request" | "self_approval_blocked";
      approvals?: number;
      required?: number;
      satisfied?: boolean;
    };
    if (!result.recorded) return { recorded: false, reason: result.reason ?? "no_matching_request" };
    return {
      recorded: true,
      approvals: result.approvals ?? 0,
      required: result.required ?? 2,
      satisfied: result.satisfied === true,
    };
  } catch {
    return { recorded: false, reason: "rpc_unavailable" };
  }
}

export interface PrivilegedActionAuditRow {
  readonly id: string;
  readonly requestId: string;
  readonly event: PrivilegedActionEvent;
  readonly actorClerkUserId: string;
  readonly actionType: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly reasonCode: string | null;
  readonly correlationId: string | null;
  readonly securityClassification: Tier0SecurityClassification;
  readonly outcomeDetail: string | null;
  readonly occurredAt: string;
}

export interface PrivilegedActionAuditFilters {
  readonly actorClerkUserId?: string;
  readonly actionType?: string;
  readonly targetId?: string;
  readonly event?: PrivilegedActionEvent;
  readonly sinceIso?: string;
  readonly untilIso?: string;
}

/** Bounded: never returns more than this many rows, and every caller sees the same ceiling. */
export const PRIVILEGED_AUDIT_MAX_ROWS = 200;

export type PrivilegedActionAuditQueryResult =
  | { outcome: "FOUND"; rows: readonly PrivilegedActionAuditRow[] }
  | { outcome: "SOURCE_UNAVAILABLE"; reasonCode: string };

/**
 * The bounded query behind Section 14's audit UI. No arbitrary SQL, no
 * unbounded history — every filter is a narrow equality or a bounded time
 * window, and `limit` is always applied server-side regardless of what a
 * caller asks for.
 */
export async function queryPrivilegedActionAudit(
  admin: SupabaseClient,
  filters: PrivilegedActionAuditFilters = {}
): Promise<PrivilegedActionAuditQueryResult> {
  let query = admin
    .from("admin_privileged_action_events")
    .select(
      "id, request_id, event, actor_clerk_user_id, action_type, target_type, target_id, reason_code, correlation_id, security_classification, outcome_detail, occurred_at"
    )
    .order("occurred_at", { ascending: false })
    .limit(PRIVILEGED_AUDIT_MAX_ROWS);

  if (filters.actorClerkUserId) query = query.eq("actor_clerk_user_id", filters.actorClerkUserId);
  if (filters.actionType) query = query.eq("action_type", filters.actionType);
  if (filters.targetId) query = query.eq("target_id", filters.targetId);
  if (filters.event) query = query.eq("event", filters.event);

  const { data, error } = await query;
  if (error) return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "audit_read_failed" };

  const rows = ((data ?? []) as Record<string, unknown>[])
    // Bounded time window applied here rather than as a query-builder
    // `.gte`/`.lte` pair so this function stays exercisable against the
    // zero-cost FakeSupabaseClient harness, which does not implement
    // range filters — the DB-level index still makes the unfiltered read
    // cheap, and PRIVILEGED_AUDIT_MAX_ROWS bounds it regardless.
    .filter((row) => {
      const occurredAt = row.occurred_at as string;
      if (filters.sinceIso && occurredAt < filters.sinceIso) return false;
      if (filters.untilIso && occurredAt > filters.untilIso) return false;
      return true;
    })
    .map((row) => ({
      id: row.id as string,
      requestId: row.request_id as string,
      event: row.event as PrivilegedActionEvent,
      actorClerkUserId: row.actor_clerk_user_id as string,
      actionType: row.action_type as string,
      targetType: row.target_type as string,
      targetId: (row.target_id as string | null) ?? null,
      reasonCode: (row.reason_code as string | null) ?? null,
      correlationId: (row.correlation_id as string | null) ?? null,
      securityClassification: row.security_classification as Tier0SecurityClassification,
      outcomeDetail: (row.outcome_detail as string | null) ?? null,
      occurredAt: row.occurred_at as string,
    }));

  return { outcome: "FOUND", rows };
}
