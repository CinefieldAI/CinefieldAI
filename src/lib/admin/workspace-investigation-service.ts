import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PROJECT_ID_PATTERN,
  type RecentWorkspaceGenerationView,
  type WorkspaceInvestigationResult,
  type WorkspaceSummaryView,
} from "./workspace-investigation-contract";

/**
 * The Phase 16-A/4 admin workspace/project investigation read service.
 *
 * ---------------------------------------------------------------------------
 * TWO NARROW, INDEPENDENT, EXPLICIT-COLUMN READS — NOTHING ELSE
 * ---------------------------------------------------------------------------
 * `projects` (one row, by `id`) and `generations` (up to
 * `MAX_RECENT_GENERATIONS` rows, by the SAME canonical `project_id`
 * relation `generation-investigation-service.ts` already exposes per
 * generation). No `.insert(`, `.update(`, `.upsert(`, or `.delete(` exists
 * anywhere in this file — this service can only ever read.
 *
 * Deliberately excluded from every select, even though the columns exist:
 * `projects.description`/`thumbnail_url` (see `workspace-investigation-
 * contract.ts`'s header for why); every `generations` column
 * `generation-investigation-service.ts` already excludes (`prompt`,
 * `negative_prompt`, `input_url`, `output_url`, `thumbnail_url`,
 * `error_message`, `metadata`) plus `provider`/`model`/`clerk_user_id`,
 * which belong to the per-generation or per-user investigation views, not
 * this workspace-level summary list — the workspace's own `ownerClerkUserId`
 * already carries the owner reference.
 *
 * The two reads are kept independent (not one `Promise.all` + single catch)
 * for the same reason `user-investigation-service.ts` keeps `profiles` and
 * `generations` independent: a `projects`-only failure with real generation
 * evidence still present should degrade to `PARTIAL_DATA`, not discard real
 * evidence because an unrelated read had a bad moment. Unlike the
 * `profiles` case, there is no known or suspected grant issue on `projects`
 * — repository evidence shows `service_role` already has `SELECT`
 * (`supabase/migrations/20260805132704_remote_schema.sql`) — this split is
 * ordinary defensive discipline, not a workaround for a documented gap.
 */

/** A project has few enough recent generations that this is generous, not limiting. */
const MAX_RECENT_GENERATIONS = 20;

interface RawReadResult<T> {
  readonly ok: boolean;
  readonly data: T | null;
}

async function readProject(
  admin: SupabaseClient,
  projectId: string
): Promise<RawReadResult<Record<string, unknown>>> {
  try {
    const { data, error } = await admin
      .from("projects")
      .select("id, title, status, clerk_user_id, created_at, updated_at")
      .eq("id", projectId)
      .maybeSingle();
    if (error) return { ok: false, data: null };
    return { ok: true, data: (data as Record<string, unknown> | null) ?? null };
  } catch {
    return { ok: false, data: null };
  }
}

async function readRecentGenerations(
  admin: SupabaseClient,
  projectId: string
): Promise<RawReadResult<Record<string, unknown>[]>> {
  try {
    const { data, error } = await admin
      .from("generations")
      .select("id, status, generation_type, created_at, updated_at, completed_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(MAX_RECENT_GENERATIONS);
    if (error) return { ok: false, data: null };
    return { ok: true, data: (data as Record<string, unknown>[] | null) ?? [] };
  } catch {
    return { ok: false, data: null };
  }
}

function projectWorkspace(row: Record<string, unknown>): WorkspaceSummaryView {
  return {
    projectId: row.id as string,
    title: row.title as string,
    status: row.status as string,
    ownerClerkUserId: row.clerk_user_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function projectGenerations(rows: readonly Record<string, unknown>[]): RecentWorkspaceGenerationView[] {
  return rows.map((row) => ({
    generationId: row.id as string,
    status: row.status as string,
    generationType: row.generation_type as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
  }));
}

export async function getAdminWorkspaceInvestigation(
  admin: SupabaseClient,
  projectId: string
): Promise<WorkspaceInvestigationResult> {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    // Malformed input never reaches the database — no wildcard/arbitrary
    // query is possible even in principle.
    return { outcome: "WORKSPACE_NOT_FOUND" };
  }

  const [projectResult, generationsResult] = await Promise.all([
    readProject(admin, projectId),
    readRecentGenerations(admin, projectId),
  ]);

  if (!projectResult.ok && !generationsResult.ok) {
    return { outcome: "EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" };
  }

  // The project read succeeded and genuinely found no row. Because
  // `generations.project_id` carries `ON DELETE CASCADE` back to
  // `projects.id`, no generation could exist for an id with no project row
  // — this is an authoritative "no such workspace," not a guess.
  if (projectResult.ok && projectResult.data === null) {
    return { outcome: "WORKSPACE_NOT_FOUND" };
  }

  if (projectResult.ok && projectResult.data !== null) {
    const workspace = projectWorkspace(projectResult.data);

    if (!generationsResult.ok) {
      return { outcome: "PARTIAL_DATA", workspace, recentGenerations: [], reasonCode: "generations_read_failed" };
    }

    const recentGenerations = projectGenerations(generationsResult.data ?? []);
    if (recentGenerations.length === 0) {
      return { outcome: "NO_GENERATIONS", workspace };
    }
    return { outcome: "FOUND", workspace, recentGenerations };
  }

  // projectResult failed for some reason but generationsResult succeeded.
  const recentGenerations = projectGenerations(generationsResult.data ?? []);
  if (recentGenerations.length === 0) {
    // No generation evidence either — cannot confirm existence one way or
    // the other, so this is reported as unavailable, never guessed as found
    // or not-found.
    return { outcome: "EVIDENCE_UNAVAILABLE", reasonCode: "project_read_failed" };
  }
  // Real generation evidence exists for this project id even though the
  // project row itself could not be read — an honest partial result, not a
  // discarded one.
  return { outcome: "PARTIAL_DATA", workspace: null, recentGenerations, reasonCode: "project_read_failed" };
}
