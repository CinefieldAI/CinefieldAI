import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Restore re-delete control (Phase 23-C's own package title: "backup
 * aging/restore re-delete kontrolünü tek silme paketi yap").
 *
 * THE PROBLEM THIS SOLVES
 * A Postgres restore (Phase 15 DR) reconstructs the database from a backup
 * taken at some point in the past. If that backup predates an account
 * deletion, the restored `profiles`/`media_assets` rows come back holding
 * the PRE-deletion PII and un-tombstoned media — the deletion is silently
 * undone by the restore, which is exactly what the roadmap's own done
 * criterion forbids: "restore'da tombstone nedeniyle silinmiş veri yeniden
 * aktif olmuyor" (restored data does not become active again, because of
 * the tombstone).
 *
 * WHY A SEPARATE FUNCTION, NOT A CHANGE TO restore-verification-engine.ts
 * That engine (Phase 15) is deliberately READ-ONLY — its own validators
 * (row-count/checksum/referential-integrity) PROVE a restore, they never
 * mutate one; no execute action exists anywhere in this repository to
 * classify (tier0-action-catalogue.ts's own header states this explicitly).
 * Adding a mutation there would make Phase 15's verification engine also a
 * write path, which is not this batch's authority to grant. This function
 * is Phase 23's OWN, separately-callable re-delete control: idempotent,
 * safe to run any number of times, and its live invocation after an actual
 * restore is `LIVE_DEFERRED` for the same reason every other "no cron/no
 * live trigger exists in this repository" gap already disclosed this
 * session is — there is no live restore-EXECUTION capability anywhere in
 * this codebase to hang a post-restore hook off of yet.
 *
 * WHAT IT DOES
 * For every `deletion_tombstones` row, re-applies EXACTLY the same
 * anonymization `account-deletion-workflow.ts`'s step 3 performs — a
 * restored profile matching a tombstone gets its PII columns nulled again,
 * and any restored media_assets row for that user that is not already
 * tombstoned gets `tombstoned_at` set. Never touches Clerk (a restore does
 * not resurrect a Clerk account — Clerk is not part of what Postgres
 * restore can undo) and never re-attempts a physical R2 delete (a restored
 * Postgres row does not un-delete an R2 object either; only the DATABASE
 * record could appear to "come back").
 */

export interface ReapplyTombstonesResult {
  readonly tombstoneCount: number;
  readonly profilesReanonymized: number;
  readonly mediaAssetsRetombstoned: number;
}

export async function reapplyTombstonesAfterRestore(admin: SupabaseClient): Promise<ReapplyTombstonesResult> {
  const { data: tombstoneRows } = await admin.from("deletion_tombstones").select("clerk_user_id");
  const clerkUserIds = ((tombstoneRows ?? []) as { clerk_user_id: string }[]).map((r) => r.clerk_user_id);

  let profilesReanonymized = 0;
  let mediaAssetsRetombstoned = 0;

  for (const clerkUserId of clerkUserIds) {
    const { data: profile } = await admin
      .from("profiles")
      .select("clerk_user_id, username, email, display_name, avatar_url")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    const p = profile as { username: string | null; email: string | null; display_name: string | null; avatar_url: string | null } | null;
    if (p && (p.username !== null || p.email !== null || p.display_name !== null || p.avatar_url !== null)) {
      await admin
        .from("profiles")
        .update({ username: null, email: null, display_name: null, avatar_url: null })
        .eq("clerk_user_id", clerkUserId);
      profilesReanonymized += 1;
    }

    const { data: mediaRows } = await admin
      .from("media_assets")
      .select("id, tombstoned_at")
      .eq("clerk_user_id", clerkUserId)
      .is("tombstoned_at", null);
    const toRetombstone = (mediaRows ?? []) as { id: string }[];
    for (const row of toRetombstone) {
      await admin.from("media_assets").update({ tombstoned_at: new Date().toISOString() }).eq("id", row.id);
    }
    mediaAssetsRetombstoned += toRetombstone.length;
  }

  return { tombstoneCount: clerkUserIds.length, profilesReanonymized, mediaAssetsRetombstoned };
}

/** True when a clerk_user_id has a durable deletion tombstone — the one check any read path that could reactivate a user should make. */
export async function isAccountTombstoned(admin: SupabaseClient, clerkUserId: string): Promise<boolean> {
  const { data } = await admin.from("deletion_tombstones").select("id").eq("clerk_user_id", clerkUserId).maybeSingle();
  return data !== null;
}
