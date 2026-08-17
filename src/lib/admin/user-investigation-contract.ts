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
 * TWO INDEPENDENT READS — DEFENSIVE ARCHITECTURE, NOT A WORKAROUND FOR A GAP
 * ---------------------------------------------------------------------------
 * Phase 16-A/3 originally claimed `profiles` grants `service_role` only
 * `REFERENCES,TRIGGER,TRUNCATE,MAINTAIN` — no `SELECT` — citing only
 * `20260805132704_remote_schema.sql`. The Phase 16-A/3 post-implementation
 * audit corrected this: a LATER migration, `20260811120000_credit_system.sql`
 * (line 127), issues `GRANT ALL ON TABLE "public"."profiles" TO
 * "service_role"`, and no migration anywhere in this repository ever revokes
 * anything from `service_role` on any table. Per full repository evidence,
 * `service_role` DOES have `SELECT` on `profiles`
 * (`PROFILE_SERVICE_ROLE_SELECT_REPOSITORY_STATUS: CONFIRMED_PRESENT`). Live
 * database state was not independently verified by that audit and remains
 * `NOT_VERIFIED` as a separate question from repository evidence.
 *
 * `user-investigation-service.ts` still treats the `profiles` read and the
 * `generations` read as two INDEPENDENT fallible reads rather than one
 * combined `Promise.all` + single catch. That split is kept deliberately,
 * not because a grant gap is expected: it costs nothing at runtime, it is
 * correct regardless of which grant state turns out to be true, and it means
 * a `profiles`-specific failure of ANY kind (a future grant change, a
 * transient error, an RLS regression) degrades to `PARTIAL_DATA` — real
 * generation evidence still shown, honestly labelled as missing identity
 * enrichment — instead of discarding real evidence because an unrelated
 * table had a bad moment. `PARTIAL_DATA` exists to name "we have generation
 * evidence for this identity but the profile enrichment could not be read" —
 * a real, anticipated shape under normal fallible-read discipline, not
 * evidence of a known gap.
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
