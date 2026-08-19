import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteAssetObject } from "@/lib/media/r2-client";
import { LiveClerkUserDeleter, type ClerkUserDeleter } from "./clerk-account-service";

/**
 * AccountDeletionWorkflow (Phase 23-C).
 *
 * Orchestrates ONE deletion package across every system the roadmap names
 * ("Clerk/Postgres/R2/S3/analytics/log/third-party processors"):
 *
 *   1. Refuses to re-run against an already-tombstoned account (idempotent).
 *   2. Every media_assets row NOT under legal_hold: attempts a real R2
 *      hot-object delete, then tombstones the row regardless of whether the
 *      physical delete succeeded (the tombstone is compliance evidence;
 *      physical storage cleanup is best-effort and separately counted).
 *      A legal_hold row is excluded entirely — "retention dolsa bile
 *      istisna olarak korunur" (the roadmap's own exception language) — and
 *      recorded as such on the tombstone.
 *   3. Anonymizes profiles' PII columns (username/email/display_name/
 *      avatar_url). The row itself is NEVER deleted — every other table
 *      FKs to profiles.clerk_user_id, and credit_ledger in particular must
 *      remain addressable for financial record-keeping
 *      (data-classification.ts: deletionPolicy "retain_immutable").
 *   4. Records the durable deletion_tombstones row (ON CONFLICT DO NOTHING
 *      — a retried call against an already-tombstoned account is a safe
 *      no-op at this step too).
 *   5. Calls Clerk to delete the account itself, via the injected
 *      `ClerkUserDeleter` seam — see clerk-account-service.ts's header for
 *      why this is never invoked live by this repository's own tests.
 *
 * WHAT THIS DOES NOT DO, HONESTLY
 * S3 DR copies are never physically deleted — the DR client's own IAM
 * identity has no s3:DeleteObject (dr-backup-service.ts), and this batch is
 * not authorized to grant that. The tombstone is what makes an S3-restored
 * copy inert: `restore-redelete-guard.ts` re-applies this same anonymization
 * after any restore, so a resurrected pre-deletion row does not stay
 * resurrected. Third-party AI processors (fal.ai, Gemini, Cloudflare
 * Workers AI) expose no data-deletion API this codebase can call — see
 * `processor-inventory.ts`'s own header; that gap is disclosed, not
 * fabricated. `analytics`/`log` in the roadmap's own wording map to
 * `security_events`/`admin_privileged_action_events`, which are
 * INTENTIONALLY retained past account deletion for their own audit window
 * (data-classification.ts: "retain_for_audit_window") — deleting audit
 * evidence of a deletion because the account was deleted would defeat the
 * evidence's own purpose.
 *
 * Callers MUST have already cleared `data.delete`'s policy + Tier-0
 * dual-control gates (see privacy-execution-service.ts) — this function
 * performs no authorization of its own, the same "trusts the caller already
 * checked" contract `setRouteEnabled`/`deleteAssetObject` already state.
 */

export interface AccountDeletionParams {
  clerkUserId: string;
  reasonCode: string;
  requestedBy: string | null;
  executedBy: string;
  privacyRequestId?: string | null;
}

export interface AccountDeletionDeps {
  clerkDeleter?: ClerkUserDeleter;
  r2Delete?: (objectKey: string) => Promise<{ deleted: boolean }>;
}

export type AccountDeletionOutcome =
  | {
      outcome: "completed";
      tombstoneId: string;
      mediaAssetsTombstoned: number;
      mediaAssetsPhysicallyDeleted: number;
      mediaAssetsLegalHoldExcluded: number;
      clerkAccountDeleted: boolean;
    }
  | { outcome: "already_tombstoned"; tombstoneId: string };

const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;

export async function executeAccountDeletion(
  admin: SupabaseClient,
  params: AccountDeletionParams,
  deps: AccountDeletionDeps = {}
): Promise<AccountDeletionOutcome> {
  if (!REASON_CODE_PATTERN.test(params.reasonCode)) {
    throw new Error("invalid_reason_code");
  }

  const clerkDeleter = deps.clerkDeleter ?? LiveClerkUserDeleter;
  const r2Delete = deps.r2Delete ?? deleteAssetObject;

  // Step 1 — idempotent refusal.
  const { data: existingTombstone } = await admin
    .from("deletion_tombstones")
    .select("id")
    .eq("clerk_user_id", params.clerkUserId)
    .maybeSingle();
  if (existingTombstone) {
    return { outcome: "already_tombstoned", tombstoneId: String((existingTombstone as { id: string }).id) };
  }

  // Step 2 — media assets: tombstone eligible rows, skip legal_hold ones.
  const { data: mediaRows } = await admin
    .from("media_assets")
    .select("id, object_key, storage_backend, legal_hold, tombstoned_at")
    .eq("clerk_user_id", params.clerkUserId);

  const rows = (mediaRows ?? []) as { id: string; object_key: string; storage_backend: string; legal_hold: boolean; tombstoned_at: string | null }[];
  const eligible = rows.filter((r) => !r.legal_hold && !r.tombstoned_at);
  const legalHoldExcluded = rows.filter((r) => r.legal_hold);

  let physicallyDeleted = 0;
  for (const row of eligible) {
    if (row.storage_backend === "r2") {
      const result = await r2Delete(row.object_key);
      if (result.deleted) physicallyDeleted += 1;
    }
    await admin.from("media_assets").update({ tombstoned_at: new Date().toISOString() }).eq("id", row.id);
  }

  // Step 3 — anonymize profile PII. The row itself is never deleted.
  await admin
    .from("profiles")
    .update({ username: null, email: null, display_name: null, avatar_url: null })
    .eq("clerk_user_id", params.clerkUserId);

  // Step 4 — the durable tombstone.
  const { data: tombstoneResult } = await admin.rpc("record_deletion_tombstone", {
    p_clerk_user_id: params.clerkUserId,
    p_reason_code: params.reasonCode,
    p_executed_by: params.executedBy,
    p_requested_by: params.requestedBy,
    p_privacy_request_id: params.privacyRequestId ?? null,
    p_legal_hold_exception: legalHoldExcluded.length > 0,
  });
  const tombstoneId = String((tombstoneResult as { tombstone_id: string })?.tombstone_id);

  // Step 5 — Clerk. Best-effort recorded, never blocks the Postgres-side
  // erasure that already happened — a Clerk API outage must not leave the
  // account half-deleted with no durable record of what WAS done.
  const clerkResult = await clerkDeleter.deleteUser(params.clerkUserId);

  return {
    outcome: "completed",
    tombstoneId,
    mediaAssetsTombstoned: eligible.length,
    mediaAssetsPhysicallyDeleted: physicallyDeleted,
    mediaAssetsLegalHoldExcluded: legalHoldExcluded.length,
    clerkAccountDeleted: clerkResult.deleted,
  };
}
