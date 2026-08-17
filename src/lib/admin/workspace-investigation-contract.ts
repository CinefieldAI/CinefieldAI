/**
 * Phase 16-A/4 admin workspace/project investigation contract.
 *
 * Pure types only — no I/O. This is the bounded, UI-facing shape the admin
 * "what belongs to this project/workspace, who owns it, and which
 * generations can I inspect end-to-end?" surface renders. Every field is an
 * id, a short enum/label, or a timestamp — there is no field capable of
 * holding a prompt, a raw project payload, or a signed URL.
 *
 * ---------------------------------------------------------------------------
 * ROADMAP "WORKSPACE" RECONCILED TO THE REAL SCHEMA: `public.projects`
 * ---------------------------------------------------------------------------
 * The official 16-A package names a "Workspaces" screen. No `workspaces`
 * table, `workspace_members` table, or any second workspace-identity system
 * exists anywhere in this repository's migrations — `user-investigation-
 * contract.ts` (Phase 16-A/3) already established this, and Phase 16-A/4
 * does not create one now either. The closest, and only, canonical concept
 * is `public.projects` (`supabase/migrations/20260805132704_remote_schema.sql`):
 * `id` (uuid, primary key), `clerk_user_id` (`NOT NULL`, `REFERENCES
 * profiles(clerk_user_id)` — a direct, unambiguous owner reference, not an
 * inferred one), `title` (`NOT NULL`, 1–150 chars — the one canonical safe
 * display label), `status` (`NOT NULL` enum: draft/processing/completed/
 * failed/archived), `created_at`, `updated_at`. `generations.project_id`
 * carries `REFERENCES projects(id) ON DELETE CASCADE`, indexed by
 * `generations_project_id_idx` and `generations_project_created_at_idx` —
 * exactly the FK 16-A/2 already exposes per generation as a bounded
 * reference, never expanded into its own view until this slice.
 *
 * This surface therefore labels itself "Workspace / Project" — naming the
 * roadmap concept honestly without pretending a separate workspace entity
 * exists. `description` and `thumbnail_url` also exist on `projects` but are
 * deliberately excluded: `description` is free-form user-authored prose (up
 * to 2000 chars) with no operational value to an investigation, and
 * `thumbnail_url` points at rendered media, the same category of field
 * `generation-investigation-service.ts` already excludes for generations.
 *
 * ---------------------------------------------------------------------------
 * OWNER REFERENCE, NOT A REIMPLEMENTED USER LOOKUP
 * ---------------------------------------------------------------------------
 * `projects.clerk_user_id` is exposed here as a bare id reference — the same
 * "reference only" treatment `generation-investigation-contract.ts` already
 * gives `clerkUserId` on a generation. No profile enrichment is read here:
 * an operator who needs display-name-level detail follows the reference into
 * the existing `/admin/users` investigation surface (Phase 16-A/3), which
 * already owns that read. Because `projects.clerk_user_id` is a `NOT NULL`
 * column on the very row this service reads to establish the workspace's
 * existence, it can never independently fail once the workspace itself is
 * found — there is no `OWNER_NOT_AVAILABLE` outcome in the result union
 * below because inventing one would fabricate a failure mode this schema
 * cannot actually produce (the same "NOT_APPLICABLE, not invented" standard
 * `generation-investigation-contract.ts` already applies to `artifact_id`).
 *
 * ---------------------------------------------------------------------------
 * WHY OWNER-BASED (list-all-projects-for-a-user) LOOKUP IS NOT IN THIS SLICE
 * ---------------------------------------------------------------------------
 * `projects.clerk_user_id` ownership is not ambiguous — it is a direct,
 * `NOT NULL`, FK-backed column — so listing a user's projects would be safe
 * to build. It is deliberately deferred anyway: this slice's brief asks for
 * "the narrowest service," and a by-owner list is a second query shape (list
 * rather than single-resource fetch) with its own bounding, ordering, and UI
 * needs. Project-id lookup alone already satisfies the primary goal (a
 * workspace/project investigation surface); by-owner listing is left for a
 * future slice if an operator workflow actually needs "which projects does
 * this user own" as a starting point rather than following a project id
 * already in hand.
 */

export type WorkspaceStatus = "draft" | "processing" | "completed" | "failed" | "archived";

export interface WorkspaceSummaryView {
  readonly projectId: string;
  /** `projects.title`. Always present — `NOT NULL`, 1–150 chars in schema. */
  readonly title: string;
  readonly status: string;
  /** `projects.clerk_user_id`. A bare reference — follow into `/admin/users` for enrichment. */
  readonly ownerClerkUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecentWorkspaceGenerationView {
  readonly generationId: string;
  readonly status: string;
  readonly generationType: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export type WorkspaceInvestigationResult =
  | { readonly outcome: "WORKSPACE_NOT_FOUND" }
  | { readonly outcome: "EVIDENCE_UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "PARTIAL_DATA";
      /** Null when even existence confirmation (the project read) failed. */
      readonly workspace: WorkspaceSummaryView | null;
      readonly recentGenerations: readonly RecentWorkspaceGenerationView[];
      readonly reasonCode: string;
    }
  | { readonly outcome: "NO_GENERATIONS"; readonly workspace: WorkspaceSummaryView }
  | {
      readonly outcome: "FOUND";
      readonly workspace: WorkspaceSummaryView;
      readonly recentGenerations: readonly RecentWorkspaceGenerationView[];
    };

/**
 * A project id, the same UUID shape `generation-api-contract.ts`'s
 * `GENERATION_ID_PATTERN` already validates (`projects.id` is `uuid DEFAULT
 * gen_random_uuid()`, identical format). Defined locally rather than
 * imported, the same choice `user-investigation-contract.ts` made for
 * `CLERK_USER_ID_PATTERN` — each investigation surface owns the shape of the
 * id it accepts. Bounded so a malformed or shell-metacharacter-laden string
 * never reaches a query.
 */
export const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
