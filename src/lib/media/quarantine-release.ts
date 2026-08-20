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
 * THE DELIVERY GATE — implementation moved, authority unchanged.
 *
 * The predicate now lives in `asset-delivery-gate.ts` so the storage layer and
 * the URL route can ask it without importing this file's policy gate,
 * route-admin allowlist and signal emitter. Re-exported here because this is
 * where a reader looks for it, and because there must remain exactly ONE
 * implementation rather than two copies that agree today.
 */
export { isAssetDeliverable, deliverableOutputIndexes } from "./asset-delivery-gate";

/**
 * AUTOMATED RELEASE — the normal lifecycle, and narrower than the human lane.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A HOLE IN THE TWO-PERSON RULE
 * ---------------------------------------------------------------------------
 * Read this function next to `approveMediaRelease` above, which is why it is
 * placed here rather than in the Phase 28 package. The header of this file
 * states the rule it must not break: "An admin has authority to release a
 * CLEARED asset, never to declare one cleared." Two people are required
 * because a HUMAN must not single-handedly release media.
 *
 * This releases only what a classifier ALREADY cleared, and it declares
 * nothing. Three properties make that structural:
 *
 *   `moderation_status = 'passed'` ONLY, checked in SQL. Not `approved` —
 *   that value belongs to the human lane, and consuming it here would let an
 *   automated path finish a job two administrators started.
 *
 *   NO ACTOR PARAMETER. There is no argument through which a human identity
 *   could be supplied, so this cannot be used to launder an admin decision.
 *
 *   No policy gate and no `assertRouteAdmin`, because there is no actor to
 *   authorize. The authority is the classifier verdict, and the verdict is
 *   re-read from the row inside the transaction rather than passed in.
 *
 * Before Phase 28 nothing could produce `passed`, so nothing could ever be
 * released. This is the missing half of that lifecycle, not a relaxation of it.
 */
export async function releaseAfterModeration(
  admin: SupabaseClient,
  params: { assetId: string; traceId?: string | null }
): Promise<{ released: boolean; reason?: string }> {
  const { data, error } = await admin.rpc("release_media_after_moderation", {
    p_asset_id: params.assetId,
    p_trace_id: params.traceId ?? null,
  });

  // A failed release is NOT a failed generation. The asset simply stays
  // quarantined, which is the safe state — so this reports rather than throws.
  if (error) return { released: false, reason: "release_call_failed" };

  const result = data as { released?: boolean; reason?: string };
  if (result?.released) {
    reportMediaSafetyDecision({
      decision: "released",
      assetId: params.assetId,
      traceId: params.traceId ?? null,
    });
    return { released: true };
  }

  return { released: false, reason: result?.reason ?? "not_released" };
}

/**
 * An owner asks for a human to look at a decision (Phase 28-D).
 *
 * ---------------------------------------------------------------------------
 * AN APPEAL RELEASES NOTHING
 * ---------------------------------------------------------------------------
 * The line in this file's own header — "the roadmap defines no appeal or
 * reopen flow, so none exists here" — was true for Phase 9-E. Phase 28-D
 * defines one, and its done-criterion is deliberately modest: "False-positive
 * case insan incelemesine gidebiliyor" — a false positive can REACH human
 * review. Not "is released", not "is re-classified".
 *
 * So this records a request and nothing else. The SQL changes no quarantine
 * status, no moderation status, and has no path to `released`; the two-person
 * human lane above remains the only way anything leaves quarantine by hand.
 * One open appeal per asset, so the review queue cannot be flooded.
 *
 * NOT ADMIN-GATED, and that is correct: the appellant is the OWNER, not an
 * administrator. Ownership is verified in SQL against the durable row rather
 * than trusted from the caller, and a non-owner is answered `not_found` — the
 * same disclosure posture the asset-url route uses.
 */
export async function requestMediaAppeal(
  admin: SupabaseClient,
  params: { assetId: string; ownerClerkUserId: string; reasonCode?: string }
): Promise<{ recorded: boolean; reason?: string }> {
  validateReason(params.reasonCode);

  const { data, error } = await admin.rpc("request_media_appeal", {
    p_asset_id: params.assetId,
    p_owner_clerk_user_id: params.ownerClerkUserId,
    p_reason_code: params.reasonCode ?? null,
  });

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { operation: "request_media_appeal" },
    });
  }

  return data as { recorded: boolean; reason?: string };
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
