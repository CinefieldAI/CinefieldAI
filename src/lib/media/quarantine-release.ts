import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRouteAdmin } from "@/lib/routing/admin-route-service";
import { reportMediaSafetyDecision } from "@/lib/security/security-signals";
import { requirePolicy } from "@/lib/policy/policy-gate";
import { OrchestrationError } from "@/lib/orchestration/errors";

/**
 * The quarantine release lane (Phase 9-E).
 *
 * THE ONE WAY OUT. Every asset created by 9-A/9-B starts `quarantined`, and
 * these three functions are the only code that changes that. No product path
 * performs a direct UPDATE — the transitions live in SQL where they are
 * transactional, and the outbox event shares their transaction.
 *
 * TWO PEOPLE. The roadmap lists quarantine release among the actions that
 * "tek admin onayıyla çalıştırılamaz". So release is a request one admin
 * raises and a DIFFERENT admin approves; the primary key on
 * (asset, approver) is what makes a single human unable to reach the
 * threshold by approving twice.
 *
 * NO MODERATION OVERRIDE. An admin has authority to release a CLEARED asset,
 * never to declare one cleared. Two approvals of an unmoderated asset still
 * fail, with `moderation_not_passed`. Nothing in this file, in the SQL, or in
 * any environment flag can turn a missing engine into a pass.
 *
 * AUTHORIZATION IS SERVER-SIDE. `assertRouteAdmin` reads an allowlist of
 * Clerk user ids from the environment and denies everyone when it is unset —
 * which is its state today. A browser cannot reach these functions at all:
 * there is no route, and the SQL is `service_role` only.
 *
 * POLICY GATE (Phase 12-E). Each of the three now evaluates policy before it
 * touches anything, and a non-ALLOW throws. The gate is an ADDITIONAL
 * condition — `assertRouteAdmin` stays, the SQL predicates stay, the
 * two-person primary key stays, the moderation gate stays. An ALLOW means
 * policy raises no objection; it grants nothing on its own, and the release
 * path returns `allowed_two_person_enforced_downstream` precisely so a reader
 * of the decision log cannot mistake it for a satisfied approval.
 */

export type ReleaseRefusal =
  | "not_found"
  | "already_released"
  | "asset_rejected"
  | "ingest_not_verified"
  | "asset_not_finalized"
  | "missing_verified_mime"
  | "missing_checksum"
  | "asset_tombstoned"
  | "moderation_not_passed"
  | "awaiting_second_approval";

export type ReleaseOutcome =
  | { released: true; assetId: string; eventId: string | null }
  | {
      released: false;
      reason: ReleaseRefusal;
      approvals?: number;
      required?: number;
      moderationStatus?: string;
    };

export type RejectOutcome =
  | { rejected: true; assetId: string; eventId: string | null }
  | { rejected: false; reason: "not_found" | "already_rejected" | "already_released" };

/** Short codes only, matching the SQL validator. Never free text. */
const REASON_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;

function validateReason(reasonCode?: string): void {
  if (reasonCode !== undefined && !REASON_PATTERN.test(reasonCode)) {
    throw new OrchestrationError("INVALID_INPUT", {
      userMessage: "Invalid reason code.",
      context: { operation: "media_safety_reason" },
    });
  }
}

/**
 * Records one administrator's approval. Does not release, even when it
 * completes the pair — the caller must call `approveMediaRelease`, so
 * "I approved" and "it is out" can never be the same act by accident.
 */
export async function requestMediaRelease(
  admin: SupabaseClient,
  params: { assetId: string; actorClerkUserId: string; reasonCode?: string }
): Promise<{ recorded: boolean; approvals?: number; required?: number; reason?: string }> {
  // Throws FORBIDDEN (surfaced as 404) for anyone not on the allowlist.
  assertRouteAdmin(params.actorClerkUserId);
  // BEFORE any mutation: a refusal cannot have banked an approval.
  await requirePolicy({
    action: "media.quarantine.request",
    actor: { id: params.actorClerkUserId, role: "route_admin", kind: "human" },
    resource: { type: "media_asset", id: params.assetId },
  });
  validateReason(params.reasonCode);

  const { data, error } = await admin.rpc("request_media_release", {
    p_asset_id: params.assetId,
    p_actor: params.actorClerkUserId,
    p_reason_code: params.reasonCode ?? null,
  });

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { operation: "request_media_release" },
    });
  }

  return data as { recorded: boolean; approvals?: number; required?: number; reason?: string };
}

/**
 * Releases an asset, if every piece of evidence is present AND a second
 * administrator has already approved.
 *
 * Returns a refusal REASON rather than a boolean: an operator whose release
 * did not happen needs to know which evidence is missing, and
 * `awaiting_second_approval` is a different situation from
 * `moderation_not_passed`.
 */
export async function approveMediaRelease(
  admin: SupabaseClient,
  params: {
    assetId: string;
    actorClerkUserId: string;
    reasonCode?: string;
    traceId?: string;
  }
): Promise<ReleaseOutcome> {
  assertRouteAdmin(params.actorClerkUserId);
  // BEFORE any mutation. Policy allowing a release does not release it: the
  // second approval and the moderation check are still ahead, in SQL.
  await requirePolicy({
    action: "media.quarantine.release",
    actor: { id: params.actorClerkUserId, role: "route_admin", kind: "human" },
    resource: { type: "media_asset", id: params.assetId },
    correlationId: params.traceId ?? null,
  });
  validateReason(params.reasonCode);

  const { data, error } = await admin.rpc("approve_media_release", {
    p_asset_id: params.assetId,
    p_actor: params.actorClerkUserId,
    p_reason_code: params.reasonCode ?? null,
    p_trace_id: params.traceId ?? null,
  });

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { operation: "approve_media_release" },
    });
  }

  const result = data as {
    released: boolean;
    reason?: ReleaseRefusal;
    approvals?: number;
    required?: number;
    moderation_status?: string;
    event_id?: string;
  };

  if (result.released) {
    // Phase 12-C. Recorded AFTER the decision has committed, and detached:
    // this is a trail entry, and a logging failure must never roll back a
    // moderation decision two administrators already agreed to.
    //
    // The approver is deliberately absent. `media_safety_audit` holds who
    // approved what, behind service_role; copying an identity into a second
    // table doubles the places it can leak from and adds no capability. The
    // asset id is the join.
    reportMediaSafetyDecision({
      decision: "released",
      assetId: params.assetId,
      traceId: params.traceId ?? null,
    });
    return { released: true, assetId: params.assetId, eventId: result.event_id ?? null };
  }

  return {
    released: false,
    reason: result.reason ?? "not_found",
    approvals: result.approvals,
    required: result.required,
    moderationStatus: result.moderation_status,
  };
}

/**
 * Rejects an asset. Single-admin by design: the two-person rule exists to
 * make releasing media harder, not refusing it. Terminal for the normal
 * lane — the roadmap defines no appeal or reopen flow, so none exists here.
 */
export async function rejectMediaAsset(
  admin: SupabaseClient,
  params: {
    assetId: string;
    actorClerkUserId: string;
    reasonCode?: string;
    traceId?: string;
  }
): Promise<RejectOutcome> {
  assertRouteAdmin(params.actorClerkUserId);
  // Gated too, although rejection is the safe direction: an action that can
  // permanently close off an asset belongs in the decision log, and a gate
  // applied only to the permissive path is a gate someone will route around.
  await requirePolicy({
    action: "media.quarantine.reject",
    actor: { id: params.actorClerkUserId, role: "route_admin", kind: "human" },
    resource: { type: "media_asset", id: params.assetId },
    correlationId: params.traceId ?? null,
  });
  validateReason(params.reasonCode);

  const { data, error } = await admin.rpc("reject_media_asset", {
    p_asset_id: params.assetId,
    p_actor: params.actorClerkUserId,
    p_reason_code: params.reasonCode ?? null,
    p_trace_id: params.traceId ?? null,
  });

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { operation: "reject_media_asset" },
    });
  }

  const result = data as { rejected: boolean; reason?: RejectOutcome extends { rejected: false } ? never : string; event_id?: string };

  if (result.rejected) {
    // The safe direction, and scored `info` for that reason — but still part
    // of the trail, because "nothing was ever rejected" and "rejections were
    // not recorded" must not look the same.
    reportMediaSafetyDecision({
      decision: "rejected",
      assetId: params.assetId,
      traceId: params.traceId ?? null,
    });
    return { rejected: true, assetId: params.assetId, eventId: result.event_id ?? null };
  }

  return {
    rejected: false,
    reason: (result as { reason: "not_found" | "already_rejected" | "already_released" }).reason,
  };
}

/**
 * THE DELIVERY GATE.
 *
 * Asked immediately before any normal user-facing access URL is minted, and
 * answered by the database rather than by a cached flag — a stale `true` here
 * would serve media that was rejected a second ago.
 *
 * `released` is the only state that qualifies. Quarantined, rejected, failed,
 * unverified, moderation-pending: all of them mean not yet.
 */
export async function isAssetDeliverable(
  admin: SupabaseClient,
  assetId: string
): Promise<boolean> {
  const { data } = await admin
    .from("media_assets")
    .select("quarantine_status,ingest_status,status,tombstoned_at")
    .eq("id", assetId)
    .maybeSingle();

  const row = data as {
    quarantine_status?: string;
    ingest_status?: string;
    status?: string;
    tombstoned_at?: string | null;
  } | null;

  if (!row) return false;
  if (row.tombstoned_at) return false;

  return (
    row.quarantine_status === "released" &&
    row.ingest_status === "verified" &&
    row.status === "finalized"
  );
}

/**
 * Reads the safety trail for one asset. Operations surface only — never a
 * product response, because approver identities and reason codes are
 * security data rather than something an owner is entitled to see.
 */
export async function readSafetyAudit(
  admin: SupabaseClient,
  assetId: string
): Promise<{ action: string; actor: string; createdAt: string; reasonCode: string | null }[]> {
  const { data } = await admin
    .from("media_safety_audit")
    .select("action,actor_clerk_user_id,created_at,reason_code")
    .eq("asset_id", assetId)
    .order("created_at", { ascending: true });

  return ((data ?? []) as Record<string, string | null>[]).map((row) => ({
    action: row.action as string,
    actor: row.actor_clerk_user_id as string,
    createdAt: row.created_at as string,
    reasonCode: row.reason_code,
  }));
}
