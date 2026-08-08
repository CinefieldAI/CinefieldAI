import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only privileged Supabase client using the service-role key.
 *
 * NEVER import this file from a client component, and never expose
 * SUPABASE_SERVICE_ROLE_KEY via a NEXT_PUBLIC_ variable. This client
 * bypasses RLS and is required only for trusted server code that must:
 *  - update protected generation fields (status, output_url, etc.), which
 *    the browser-authenticated client is intentionally blocked from doing
 *  - upload into the private generation-outputs bucket, which the browser
 *    is intentionally blocked from doing
 *
 * The browser-authenticated Supabase client (useClerkSupabaseClient) must
 * continue to be used for all user-initiated, RLS-scoped operations —
 * this admin client is not a replacement for it.
 */

let cachedAdminClient: SupabaseClient | null = null;

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/** Throws SUPABASE_ADMIN_NOT_CONFIGURED if the service-role key is not set. */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  }
  if (!cachedAdminClient) {
    cachedAdminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }
    );
  }
  return cachedAdminClient;
}
