import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLERK_USER_ID_PATTERN,
  type RecentGenerationSummaryView,
  type UserInvestigationResult,
  type UserSummaryView,
} from "./user-investigation-contract";

/**
 * The Phase 16-A/3 admin user investigation read service.
 *
 * ---------------------------------------------------------------------------
 * TWO NARROW, INDEPENDENT, EXPLICIT-COLUMN READS — NOTHING ELSE
 * ---------------------------------------------------------------------------
 * `profiles` (one row, by `clerk_user_id`) and `generations` (up to
 * `MAX_RECENT_GENERATIONS` rows, by the SAME canonical `clerk_user_id`
 * ownership column `generation-investigation-service.ts` already trusts).
 * No `.insert(`, `.update(`, `.upsert(`, or `.delete(` exists anywhere in
 * this file — this service can only ever read.
 *
 * Deliberately excluded from every select, even though the columns exist:
 * `profiles.email`/`username`/`avatar_url`/`credits`/`plan` (email/username/
 * avatar are PII this slice minimizes away entirely; credits/plan sit on the
 * same Phase 10 economic-truth boundary `generation-investigation-
 * service.ts` already draws around `cost_amount`/`cost_currency` — a future,
 * separately reviewed admin billing slice, not this one); every
 * `generations` column `generation-investigation-service.ts` already
 * excludes (`prompt`, `negative_prompt`, `input_url`, `output_url`,
 * `thumbnail_url`, `error_message`, `metadata`) plus `provider`/`model`,
 * which belong to the per-generation investigation view, not this
 * user-level summary list.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TWO READS ARE INDEPENDENT, NOT ONE Promise.all + ONE catch
 * ---------------------------------------------------------------------------
 * See `user-investigation-contract.ts`'s header: repository evidence, once
 * every migration is considered (not just the first one that defines
 * `profiles`), shows `service_role` DOES have `SELECT` on `profiles` — a
 * later migration grants it and nothing ever revokes it. This split is kept
 * anyway, as defensive discipline rather than a workaround for a known gap:
 * if a `profiles` read ever fails for any reason (a future grant change, a
 * transient error, an RLS regression), it is caught on its own so the
 * failure degrades to `PARTIAL_DATA` (recent-generation evidence still
 * shown, honestly labelled as missing identity enrichment) instead of
 * discarding real generation evidence just because an unrelated read had a
 * bad moment.
 */

/** A real user has few enough recent generations that this is generous, not limiting. */
const MAX_RECENT_GENERATIONS = 20;

interface RawReadResult<T> {
  readonly ok: boolean;
  readonly data: T | null;
}

async function readProfile(
  admin: SupabaseClient,
  clerkUserId: string
): Promise<RawReadResult<Record<string, unknown>>> {
  try {
    const { data, error } = await admin
      .from("profiles")
      .select("clerk_user_id, display_name, created_at, updated_at")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    if (error) return { ok: false, data: null };
    return { ok: true, data: (data as Record<string, unknown> | null) ?? null };
  } catch {
    return { ok: false, data: null };
  }
}

async function readRecentGenerations(
  admin: SupabaseClient,
  clerkUserId: string
): Promise<RawReadResult<Record<string, unknown>[]>> {
  try {
    const { data, error } = await admin
      .from("generations")
      .select("id, status, generation_type, created_at, updated_at, completed_at, project_id")
      .eq("clerk_user_id", clerkUserId)
      .order("created_at", { ascending: false })
      .limit(MAX_RECENT_GENERATIONS);
    if (error) return { ok: false, data: null };
    return { ok: true, data: (data as Record<string, unknown>[] | null) ?? [] };
  } catch {
    return { ok: false, data: null };
  }
}

function projectUser(row: Record<string, unknown>): UserSummaryView {
  return {
    clerkUserId: row.clerk_user_id as string,
    displayName: (row.display_name as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function projectGenerations(rows: readonly Record<string, unknown>[]): RecentGenerationSummaryView[] {
  return rows.map((row) => ({
    generationId: row.id as string,
    status: row.status as string,
    generationType: row.generation_type as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
    projectId: row.project_id as string,
  }));
}

export async function getAdminUserInvestigation(
  admin: SupabaseClient,
  clerkUserId: string
): Promise<UserInvestigationResult> {
  if (!CLERK_USER_ID_PATTERN.test(clerkUserId)) {
    // Malformed input never reaches the database — no wildcard/arbitrary
    // query is possible even in principle.
    return { outcome: "USER_NOT_FOUND" };
  }

  const [profileResult, generationsResult] = await Promise.all([
    readProfile(admin, clerkUserId),
    readRecentGenerations(admin, clerkUserId),
  ]);

  if (!profileResult.ok && !generationsResult.ok) {
    return { outcome: "EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" };
  }

  // The profile read succeeded and genuinely found no row. Because
  // `generations.clerk_user_id` carries `ON DELETE CASCADE` back to
  // `profiles.clerk_user_id`, no generation could exist for an id with no
  // profile row — this is an authoritative "no such user", not a guess.
  if (profileResult.ok && profileResult.data === null) {
    return { outcome: "USER_NOT_FOUND" };
  }

  if (profileResult.ok && profileResult.data !== null) {
    const user = projectUser(profileResult.data);

    if (!generationsResult.ok) {
      return { outcome: "PARTIAL_DATA", user, recentGenerations: [], reasonCode: "generations_read_failed" };
    }

    const recentGenerations = projectGenerations(generationsResult.data ?? []);
    if (recentGenerations.length === 0) {
      return { outcome: "NO_GENERATIONS", user };
    }
    return { outcome: "FOUND", user, recentGenerations };
  }

  // profileResult failed for some reason (see this service's header for why
  // that is treated as a real, anticipated shape rather than assumed away)
  // but generationsResult succeeded.
  const recentGenerations = projectGenerations(generationsResult.data ?? []);
  if (recentGenerations.length === 0) {
    // No generation evidence either — cannot confirm existence one way or
    // the other, so this is reported as unavailable, never guessed as found
    // or not-found.
    return { outcome: "EVIDENCE_UNAVAILABLE", reasonCode: "profile_read_failed" };
  }
  // Real generation evidence exists for this identity even though the
  // profile enrichment could not be read — an honest partial result, not a
  // discarded one.
  return { outcome: "PARTIAL_DATA", user: null, recentGenerations, reasonCode: "profile_read_failed" };
}
