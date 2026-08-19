import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * DSAR (Data Subject Access Request) export bundle builder (Phase 23-B).
 *
 * Gathers exactly the tables `data-classification.ts` marks
 * `deletionPolicy: "anonymize_on_deletion"` for a personal-data class,
 * plus a bounded ledger summary — the same data
 * AccountDeletionWorkflow (23-C) would otherwise touch, so "what would be
 * deleted" and "what gets exported" read from one consistent source rather
 * than two hand-maintained lists that could drift apart.
 *
 * UNLIKE an event payload elsewhere in this codebase, a DSAR bundle
 * DELIBERATELY includes the user's own prompt text — GDPR Article 15 (the
 * right of access) entitles a data subject to their own personal data
 * verbatim, and a prompt IS the user's own data. This is the one place in
 * the codebase that discipline is inverted, and it is inverted on purpose:
 * every OTHER prompt-bearing surface (events, eval evidence, audit logs)
 * still carries no prompt, because those are not "give the user their own
 * data back".
 *
 * Media BYTES are not re-delivered here — only the object key/media type/
 * timestamps, which is what "what is held" (GDPR Article 15) requires. A
 * user who wants the actual media already has it via the product's own
 * generation history; duplicating every byte into a second export bundle
 * would be a second, redundant copy of exactly the kind of sprawl this
 * whole phase exists to control.
 */

export interface DsarExportBundle {
  readonly clerkUserId: string;
  readonly generatedAt: string;
  readonly profile: Record<string, unknown> | null;
  readonly projects: readonly Record<string, unknown>[];
  readonly generations: readonly Record<string, unknown>[];
  readonly mediaAssets: readonly Record<string, unknown>[];
  readonly creditLedgerSummary: {
    readonly currentBalance: number | null;
    readonly entryCount: number;
  };
}

export async function buildDsarExportBundle(admin: SupabaseClient, clerkUserId: string): Promise<DsarExportBundle> {
  const [profileResult, projectsResult, generationsResult, mediaResult, walletResult, ledgerResult] = await Promise.all([
    admin.from("profiles").select("clerk_user_id, username, email, display_name, avatar_url, plan, created_at").eq("clerk_user_id", clerkUserId).maybeSingle(),
    admin.from("projects").select("id, title, description, status, created_at").eq("clerk_user_id", clerkUserId),
    admin
      .from("generations")
      .select("id, project_id, generation_type, provider, model, prompt, negative_prompt, status, created_at, completed_at")
      .eq("clerk_user_id", clerkUserId),
    admin.from("media_assets").select("id, generation_id, media_type, role, status, created_at").eq("clerk_user_id", clerkUserId),
    admin.from("credit_wallets").select("balance").eq("clerk_user_id", clerkUserId).maybeSingle(),
    admin.from("credit_ledger").select("id", { count: "exact", head: true }).eq("clerk_user_id", clerkUserId),
  ]);

  return {
    clerkUserId,
    generatedAt: new Date().toISOString(),
    profile: (profileResult.data as Record<string, unknown> | null) ?? null,
    projects: (projectsResult.data ?? []) as Record<string, unknown>[],
    generations: (generationsResult.data ?? []) as Record<string, unknown>[],
    mediaAssets: (mediaResult.data ?? []) as Record<string, unknown>[],
    creditLedgerSummary: {
      currentBalance: (walletResult.data as { balance?: number } | null)?.balance ?? null,
      entryCount: ledgerResult.count ?? 0,
    },
  };
}

/** Bounded — refuses to build a JSON.stringify string past this length rather than silently truncating mid-object. */
export const MAX_DSAR_BUNDLE_BYTES = 5 * 1024 * 1024;

export type SerializeDsarBundleOutcome =
  | { outcome: "serialized"; json: string; byteLength: number }
  | { outcome: "too_large"; byteLength: number };

export function serializeDsarBundle(bundle: DsarExportBundle): SerializeDsarBundleOutcome {
  const json = JSON.stringify(bundle, null, 2);
  const byteLength = Buffer.byteLength(json, "utf8");
  if (byteLength > MAX_DSAR_BUNDLE_BYTES) return { outcome: "too_large", byteLength };
  return { outcome: "serialized", json, byteLength };
}

const SAFE_ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * A distinct namespace from `asset-keys.ts`'s `buildAssetObjectKey` —
 * an export bundle is not a media asset, is never quarantined/moderated,
 * and forcing it through that key scheme's `source`/`role` vocabulary would
 * misrepresent what it is. `requestId` (a server-generated UUID) makes the
 * key deterministic per request, matching the same "retry rewrites the same
 * object" replay-safety `buildAssetObjectKey` already established.
 */
export function buildDsarExportObjectKey(clerkUserId: string, requestId: string): string {
  if (!SAFE_ID_SEGMENT.test(clerkUserId) || !SAFE_ID_SEGMENT.test(requestId)) {
    throw new Error("unsafe_dsar_export_key_segment");
  }
  return `privacy-exports/${clerkUserId}/${requestId}.json`;
}
