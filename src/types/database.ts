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
