import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The durable `privacy_requests` store (Phase 23-B).
 * Server-only, service-role only — RLS has no `authenticated` policy,
 * matching every other durable table in this repo
 * (20260910000000_privacy_lifecycle.sql).
 */

export type PrivacyRequestType = "export" | "deletion";
export type PrivacyRequestStatus = "pending" | "processing" | "completed" | "failed" | "rejected";

export interface PrivacyRequestRow {
  readonly id: string;
  readonly clerkUserId: string;
  readonly requestType: PrivacyRequestType;
  readonly status: PrivacyRequestStatus;
  readonly tier0RequestId: string | null;
  readonly requestedAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly reasonCode: string | null;
  /**
   * Whether a completed export bundle exists — NEVER the raw
   * `export_object_key` itself. The same "no raw storage path leaves this
   * codebase outside a short-lived presigned URL" discipline
   * `media_assets.object_key` already holds: a caller who needs the actual
   * download re-executes through `/api/admin/privacy/execute`, which signs
   * a fresh URL and returns THAT, never the key.
   */
  readonly hasExport: boolean;
  readonly exportExpiresAt: string | null;
}

/** Exported so privacy-admin-service.ts reads the exact same shape rather than a hand-duplicated second mapper. */
export function toPrivacyRequestRow(raw: Record<string, unknown>): PrivacyRequestRow {
  const exportExpiresAt = raw.export_expires_at ? String(raw.export_expires_at) : null;
  return {
    id: String(raw.id),
    clerkUserId: String(raw.clerk_user_id),
    requestType: raw.request_type as PrivacyRequestType,
    status: raw.status as PrivacyRequestStatus,
    tier0RequestId: raw.tier0_request_id ? String(raw.tier0_request_id) : null,
    requestedAt: String(raw.requested_at),
    resolvedAt: raw.resolved_at ? String(raw.resolved_at) : null,
    resolvedBy: raw.resolved_by ? String(raw.resolved_by) : null,
    reasonCode: raw.reason_code ? String(raw.reason_code) : null,
    // Derived from export_expires_at's presence, never from selecting the
    // raw export_object_key column at all — see PrivacyRequestRow's own
    // header for why.
    hasExport: exportExpiresAt !== null,
    exportExpiresAt,
  };
}

export type CreatePrivacyRequestOutcome = { outcome: "created"; requestId: string } | { outcome: "failed"; errorCode: string };

/** Self-service: a user creates a request FOR THEMSELVES. Not privileged — see the migration's own header for why asking is not the same as it happening. */
export async function createPrivacyRequest(
  admin: SupabaseClient,
  clerkUserId: string,
  requestType: PrivacyRequestType
): Promise<CreatePrivacyRequestOutcome> {
  const { data, error } = await admin.rpc("create_privacy_request", {
    p_clerk_user_id: clerkUserId,
    p_request_type: requestType,
  });
  if (error || !data) return { outcome: "failed", errorCode: "create_privacy_request_failed" };
  return { outcome: "created", requestId: String(data) };
}

export async function listPrivacyRequestsForUser(admin: SupabaseClient, clerkUserId: string): Promise<PrivacyRequestRow[]> {
  const { data } = await admin
    .from("privacy_requests")
    .select("id, clerk_user_id, request_type, status, tier0_request_id, requested_at, resolved_at, resolved_by, reason_code, export_expires_at")
    .eq("clerk_user_id", clerkUserId)
    .order("requested_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map(toPrivacyRequestRow);
}

export async function listPendingPrivacyRequests(admin: SupabaseClient): Promise<PrivacyRequestRow[]> {
  const { data } = await admin
    .from("privacy_requests")
    .select("id, clerk_user_id, request_type, status, tier0_request_id, requested_at, resolved_at, resolved_by, reason_code, export_expires_at")
    .in("status", ["pending", "processing"])
    .order("requested_at", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map(toPrivacyRequestRow);
}

export async function getPrivacyRequest(admin: SupabaseClient, requestId: string): Promise<PrivacyRequestRow | null> {
  const { data } = await admin
    .from("privacy_requests")
    .select("id, clerk_user_id, request_type, status, tier0_request_id, requested_at, resolved_at, resolved_by, reason_code, export_expires_at")
    .eq("id", requestId)
    .maybeSingle();
  return data ? toPrivacyRequestRow(data as Record<string, unknown>) : null;
}

/** Marks a still-pending request as being worked on — see the migration's header for why this is a distinct transition from resolution. */
export async function markPrivacyRequestProcessing(
  admin: SupabaseClient,
  requestId: string,
  tier0RequestId: string
): Promise<boolean> {
  const { data } = await admin.rpc("mark_privacy_request_processing", {
    p_request_id: requestId,
    p_tier0_request_id: tier0RequestId,
  });
  return data === true;
}

export interface ResolvePrivacyRequestParams {
  requestId: string;
  status: Extract<PrivacyRequestStatus, "completed" | "failed" | "rejected">;
  resolvedBy: string;
  tier0RequestId?: string | null;
  reasonCode?: string | null;
  exportObjectKey?: string | null;
  exportExpiresAt?: string | null;
}

/** Terminal transition. Only a still pending/processing row moves — see resolve_privacy_request()'s own WHERE predicate. */
export async function resolvePrivacyRequest(admin: SupabaseClient, params: ResolvePrivacyRequestParams): Promise<boolean> {
  const { data } = await admin.rpc("resolve_privacy_request", {
    p_request_id: params.requestId,
    p_status: params.status,
    p_resolved_by: params.resolvedBy,
    p_tier0_request_id: params.tier0RequestId ?? null,
    p_reason_code: params.reasonCode ?? null,
    p_export_object_key: params.exportObjectKey ?? null,
    p_export_expires_at: params.exportExpiresAt ?? null,
  });
  return data === true;
}
