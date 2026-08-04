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
