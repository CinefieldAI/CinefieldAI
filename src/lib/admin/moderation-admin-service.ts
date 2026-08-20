import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approveMediaRelease,
  readSafetyAudit,
  rejectMediaAsset,
  requestMediaRelease,
} from "@/lib/media/quarantine-release";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { ASSET_ID_PATTERN } from "./asset-admin-contract";
import {
  isValidModerationReasonCode,
  MODERATION_QUEUE_MAX_ITEMS,
  type ModerationActionKind,
  type ModerationActionResult,
  type ModerationAuditResult,
  type ModerationQueueItem,
  type ModerationQueueResult,
  type SafetyAuditEntryView,
} from "./moderation-admin-contract";

/**
 * The Phase 16-C admin Moderation action + audit-read service.
 *
 * A thin wrapper, not a second quarantine-release implementation —
 * `requestMediaRelease`/`approveMediaRelease`/`rejectMediaAsset` (Phase
 * 9-E) are called UNMODIFIED and do all the real work, including their
 * own internal `assertRouteAdmin` (separate `ROUTE_ADMIN_CLERK_USER_IDS`
 * authority) and Phase 12-E policy gate calls. This file adds only: input
 * validation before either function is ever called, and catching the
 * `FORBIDDEN` `OrchestrationError` into a bounded `ROUTE_AUTHORITY_DENIED`
 * outcome instead of an uncaught exception — the same pattern
 * `router-admin-service.ts` already established for the identical
 * authority layer.
 */

function isRouteAdminForbidden(error: unknown): boolean {
  return error instanceof OrchestrationError && error.code === "FORBIDDEN";
}

export async function getAdminSafetyAudit(admin: SupabaseClient, assetId: string): Promise<ModerationAuditResult> {
  if (!ASSET_ID_PATTERN.test(assetId)) {
    return { outcome: "INVALID_IDENTIFIER" };
  }

  try {
    const rows = await readSafetyAudit(admin, assetId);
    const entries: SafetyAuditEntryView[] = rows.map((row) => ({
      action: row.action,
      actor: row.actor,
      createdAt: row.createdAt,
      reasonCode: row.reasonCode,
    }));
    return { outcome: "FOUND", entries };
  } catch {
    return { outcome: "AUDIT_UNAVAILABLE", reasonCode: "read_failed" };
  }
}

/**
 * The Phase 28-D review queue: everything a human still has to decide.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS IN IT, AND WHY IT IS ONLY THIS
 * ---------------------------------------------------------------------------
 * `REVIEW_REQUIRED` decisions. Not blocks (a block is decided; re-presenting
 * it to a reviewer would invite the override the roadmap forbids) and not
 * allows (nothing to do). An asset the OWNER has appealed is surfaced with
 * `appealOpen`, which is how 28-D's own criterion — "False-positive case insan
 * incelemesine gidebiliyor" — actually becomes reachable.
 *
 * ---------------------------------------------------------------------------
 * IT SHOWS, IT DOES NOT DECIDE
 * ---------------------------------------------------------------------------
 * This is a READ. Acting on an item still goes through
 * `performModerationAction` and therefore through Phase 9-E's unmodified
 * two-person release, its policy gate and its route-admin allowlist. There is
 * no "release from the queue" shortcut here, because a queue that could
 * release would be a second authority.
 */
export async function getModerationQueue(
  admin: SupabaseClient,
  limit = 50
): Promise<ModerationQueueResult> {
  const bounded = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MODERATION_QUEUE_MAX_ITEMS) : 50;

  const { data, error } = await admin
    .from("media_safety_decisions")
    .select(
      "id,media_asset_id,generation_id,output_index,decision_stage,verdict,risk_categories,reason_code,created_at,provider_signal_source,provider_signal_flagged"
    )
    .eq("verdict", "REVIEW_REQUIRED")
    .order("created_at", { ascending: false })
    .limit(bounded);

  if (error) return { outcome: "QUEUE_UNAVAILABLE", reasonCode: "read_failed" };

  const rows = (data ?? []) as Record<string, unknown>[];
  const assetIds = rows
    .map((row) => row.media_asset_id)
    .filter((id): id is string => typeof id === "string");

  const appealed = await readOpenAppeals(admin, assetIds);

  const items: ModerationQueueItem[] = rows.map((row) => ({
    decisionId: String(row.id),
    mediaAssetId: typeof row.media_asset_id === "string" ? row.media_asset_id : null,
    generationId: typeof row.generation_id === "string" ? row.generation_id : null,
    outputIndex: typeof row.output_index === "number" ? row.output_index : null,
    stage: String(row.decision_stage),
    verdict: String(row.verdict),
    riskCategories: Array.isArray(row.risk_categories) ? (row.risk_categories as string[]) : [],
    reasonCode: String(row.reason_code),
    createdAt: String(row.created_at),
    providerSignalSource: String(row.provider_signal_source ?? "none"),
    providerSignalFlagged:
      typeof row.provider_signal_flagged === "boolean" ? row.provider_signal_flagged : null,
    appealOpen: typeof row.media_asset_id === "string" && appealed.has(row.media_asset_id),
  }));

  return { outcome: "FOUND", items };
}

/**
 * Which of these assets have an appeal the owner raised.
 *
 * Read from `media_safety_audit`, the same append-only trail every other
 * quarantine decision lives in — an appeal is a decision about an asset, and
 * putting it in a table of its own would give 28-D a second history to keep in
 * step with the first.
 */
async function readOpenAppeals(admin: SupabaseClient, assetIds: string[]): Promise<Set<string>> {
  const open = new Set<string>();
  if (assetIds.length === 0) return open;

  const { data, error } = await admin
    .from("media_safety_audit")
    .select("asset_id,action")
    .in("asset_id", assetIds)
    .eq("action", "appeal_requested");

  if (error) return open;
  for (const row of (data ?? []) as { asset_id?: string }[]) {
    if (typeof row.asset_id === "string") open.add(row.asset_id);
  }
  return open;
}

export async function performModerationAction(
  admin: SupabaseClient,
  actorClerkUserId: string,
  action: ModerationActionKind,
  assetId: string,
  reasonCode: string | undefined
): Promise<ModerationActionResult> {
  if (!ASSET_ID_PATTERN.test(assetId)) {
    return { outcome: "INVALID_TARGET" };
  }
  if (reasonCode !== undefined && !isValidModerationReasonCode(reasonCode)) {
    return { outcome: "INVALID_TARGET" };
  }

  try {
    if (action === "request") {
      const result = await requestMediaRelease(admin, { assetId, actorClerkUserId, reasonCode });
      return { outcome: "REQUEST_RECORDED", ...result };
    }

    if (action === "approve") {
      const result = await approveMediaRelease(admin, { assetId, actorClerkUserId, reasonCode });
      if (result.released) {
        return { outcome: "RELEASED", assetId: result.assetId, eventId: result.eventId };
      }
      return {
        outcome: "RELEASE_REFUSED",
        reason: result.reason,
        approvals: result.approvals,
        required: result.required,
        moderationStatus: result.moderationStatus,
      };
    }

    // action === "reject"
    const result = await rejectMediaAsset(admin, { assetId, actorClerkUserId, reasonCode });
    if (result.rejected) {
      return { outcome: "REJECTED", assetId: result.assetId, eventId: result.eventId };
    }
    return { outcome: "REJECT_REFUSED", reason: result.reason };
  } catch (error) {
    if (isRouteAdminForbidden(error)) return { outcome: "ROUTE_AUTHORITY_DENIED" };
    return { outcome: "ACTION_UNAVAILABLE", reasonCode: "action_failed" };
  }
}
