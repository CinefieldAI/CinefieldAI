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
