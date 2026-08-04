"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { getClerkSupabaseClient } from "./client";

/**
 * React hook that returns a Supabase client authenticated with Clerk's current session.
 * Handles:
 * - Loading state (Clerk not loaded yet)
 * - Signed-out users (no token)
 * - Signed-in users (token from Clerk)
 * - Token refresh (re-creates client when Clerk session changes)
 *
 * Returns: { supabase, isLoaded, isSignedIn, error }
 *
 * Example:
 *   const { supabase, isLoaded, isSignedIn } = useClerkSupabaseClient();
 *   if (!isLoaded) return <div>Loading...</div>;
 *   if (!isSignedIn) return <div>Not signed in</div>;
 *   // Use supabase to query
 */
export function useClerkSupabaseClient() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    (async () => {
      try {
        const client = await getClerkSupabaseClient(getToken);
        setSupabase(client);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to create Supabase client"
        );
        setSupabase(null);
      }
    })();
  }, [isLoaded, isSignedIn, getToken]);

  return {
    supabase,
    isLoaded,
    isSignedIn,
    error,
  };
}
