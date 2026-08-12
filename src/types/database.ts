/**
 * Database table types matching Supabase public.profiles schema.
 */

export interface Profile {
  clerk_user_id: string;
  username: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  credits: number;
  plan: string;
  created_at: string;
  updated_at: string;
}

/**
 * Upsert payload for profile synchronization.
 * Excludes credits, plan, created_at, updated_at to prevent browser overwrites.
 */
export interface ProfileUpsertPayload {
  clerk_user_id: string;
  username: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * Database type for public.projects table.
 */
export interface Project {
  id: string;
  clerk_user_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  status: "draft" | "processing" | "completed" | "failed" | "archived";
  created_at: string;
  updated_at: string;
}

/**
 * Insert payload for project creation.
 * Excludes id, clerk_user_id, status, created_at, updated_at.
 */
export interface ProjectInsertPayload {
  title: string;
  description?: string | null;
}

/**
 * Update payload for project editing.
 * Excludes clerk_user_id, status, created_at, updated_at.
 */
export interface ProjectUpdatePayload {
  title: string;
  description?: string | null;
}

/**
 * Database type for public.generations table.
 */
export interface Generation {
  id: string;
  project_id: string;
  clerk_user_id: string;
  generation_type: "image" | "video" | "audio";
  provider: string;
  model: string;
  prompt: string;
  negative_prompt: string | null;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  input_url: string | null;
  output_url: string | null;
  thumbnail_url: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /**
   * Deterministic Temporal workflow id (`gen:<generationId>`) when this
   * generation is owned by a Temporal workflow. NULL for rows created before
   * Phase 6R.3 and for rows still running the direct/trigger paths.
   */
  temporal_workflow_id: string | null;
}

/**
 * One provider submission for a generation (Phase 6R.6).
 *
 * Server-only: RLS is enabled with no `authenticated` policy, so only the
 * service-role client can read or write this table.
 */
export type GenerationAttemptStatus =
  | "pending"
  | "claimed"
  | "submitting"
  | "submitted"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

/** What Cinefield can prove about whether an external provider job exists. */
export type GenerationAttemptEvidence = "none" | "ambiguous" | "job";

export interface GenerationAttempt {
  id: string;
  generation_id: string;
  attempt_no: number;
  provider: string;
  provider_model: string;
  provider_job_id: string | null;
  status: GenerationAttemptStatus;
  submission_evidence: GenerationAttemptEvidence;
  submission_error_code: string | null;
  workflow_id: string | null;
  workflow_run_id: string | null;
  cost_amount: number | null;
  cost_currency: string | null;
  latency_ms: number | null;
  error_code: string | null;
  /**
   * Phase 7-A/7-C routing correlation. Nullable and additive: an attempt for
   * a generation created before routing existed carries null, and nothing
   * reads these to decide behaviour — they answer "which route ran this?"
   * after the fact, and let a failover avoid a route it already burned.
   */
  model_version_id: string | null;
  model_route_id: string | null;
  started_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Insert payload for generation creation.
 * Only these fields are permitted via browser client due to RLS policies.
 * Other fields are assigned or defaulted by backend/triggers.
 */
export interface GenerationInsertPayload {
  project_id: string;
  generation_type: "image" | "video" | "audio";
  provider: string;
  model: string;
  prompt: string;
  negative_prompt?: string | null;
  input_url?: string | null;
  metadata?: Record<string, unknown> | null;
}
