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
  type ModerationActionKind,
  type ModerationActionResult,
  type ModerationAuditResult,
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
