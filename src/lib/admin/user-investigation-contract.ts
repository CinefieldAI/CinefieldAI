/**
 * Phase 16-A/3 admin user investigation contract.
 *
 * Pure types only — no I/O. This is the bounded, UI-facing shape the admin
 * "what has happened for this user recently, and which generation can I
 * inspect end-to-end?" surface renders. Every field is an id, a short enum
 * label, a display name, or a timestamp — there is no field capable of
 * holding an email, a raw Clerk object, a token, or a prompt.
 *
 * ---------------------------------------------------------------------------
 * THE CANONICAL USER OWNER, VERIFIED AGAINST SCHEMA REALITY
 * ---------------------------------------------------------------------------
 * `public.profiles` (`supabase/migrations/20260805132704_remote_schema.sql`)
 * is the one user-identity table in this schema — `clerk_user_id` is its
 * primary key, and both `generations.clerk_user_id` and
 * `projects.clerk_user_id` carry a `REFERENCES public.profiles(clerk_user_id)
 * ON DELETE CASCADE` foreign key. There is no second user directory, no
 * `users` table, and no workspace table anywhere in this schema — "workspace"
 * only ever means `projects` here, and this slice does not build a
 * Workspaces screen, so a project is surfaced only as the same bounded
 * `projectId` reference `generation-investigation-contract.ts` already
 * exposes per generation, never expanded into its own view.
 *
 * ---------------------------------------------------------------------------
 * A REAL GRANT ASYMMETRY, NOT ASSUMED AWAY
 * ---------------------------------------------------------------------------
 * The same migration that defines `profiles` also states its live grants,
 * and they are NOT symmetric with `generations` (`GRANT ALL ... TO
 * service_role`) or `projects` (`GRANT SELECT, ... TO service_role`):
 * `profiles` grants `service_role` only `REFERENCES,TRIGGER,TRUNCATE,
 * MAINTAIN` — no `SELECT`. If that reflects the live database (this batch
 * cannot connect to production Postgres to confirm either way, and adding a
 * migration to fix it is explicitly out of scope for this slice), a read of
 * `profiles` through the admin service-role client fails with a real
 * Postgres permission error, not an empty result. `user-investigation-
 * service.ts` therefore treats the `profiles` read and the `generations`
 * read as two INDEPENDENT fallible reads rather than one combined
 * `Promise.all` + single catch — the pattern `generation-investigation-
 * service.ts` uses is safe there because all four of its reads share one
 * `service_role`-granted table family; it is not safe to copy here verbatim.
 * `PARTIAL_DATA` exists specifically to name "we have generation evidence
 * for this identity but the profile enrichment could not be read" — a real,
 * anticipated shape, not a hypothetical.
 */

export type UserAccountLifecycleStatus = "unknown";

export interface UserSummaryView {
  readonly clerkUserId: string;
  /** `profiles.display_name`. Null when the profile has none set. */
  readonly displayName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecentGenerationSummaryView {
  readonly generationId: string;
  readonly status: string;
  readonly generationType: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  /** Reference only, per the 16-A Users/Workspaces boundary — not a project lookup. */
  readonly projectId: string;
}

export type UserInvestigationResult =
  | { readonly outcome: "USER_NOT_FOUND" }
  | { readonly outcome: "EVIDENCE_UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "PARTIAL_DATA";
      /** Null when even identity confirmation (the profile read) failed. */
      readonly user: UserSummaryView | null;
      readonly recentGenerations: readonly RecentGenerationSummaryView[];
      readonly reasonCode: string;
    }
  | { readonly outcome: "NO_GENERATIONS"; readonly user: UserSummaryView }
  | {
      readonly outcome: "FOUND";
      readonly user: UserSummaryView;
      readonly recentGenerations: readonly RecentGenerationSummaryView[];
    };

/**
 * A Clerk user id, matching the `user_<id>` shape every Clerk-issued
 * identity in this codebase already uses (`admin-auth.ts`'s own tests use
 * `"user_admin_1"`/`"user_not_listed"`, `e2e-harness.ts`'s `seedGeneration`
 * defaults to `"user_e2e"`) — underscores and hyphens are included in the
 * suffix class specifically because those existing fixtures already rely on
 * them. Bounded so an oversized or shell-metacharacter-laden string never
 * reaches a query.
 */
export const CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9_-]{1,60}$/;
