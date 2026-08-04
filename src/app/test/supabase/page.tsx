"use client";

import { useEffect, useState } from "react";
import { useClerkSupabaseClient } from "@/lib/supabase/useClerkSupabaseClient";
import { Profile } from "@/types/database";

/**
 * Development-only test page to verify Supabase client creation and profile sync.
 * Queries the profiles table to verify ProfileSynchronizer is working.
 *
 * Access: http://localhost:3000/test/supabase
 * Remove this page before production.
 */
export default function SupabaseTestPage() {
  const { supabase, isLoaded, isSignedIn, error } = useClerkSupabaseClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  // Fetch profile data when authenticated
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !supabase) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    setIsLoadingProfile(true);
    setProfileError(null);

    (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from("profiles")
          .select("*")
          .single();

        if (queryError) {
          setProfileError(`Query error: ${queryError.message}`);
          setProfile(null);
          return;
        }

        setProfile(data as Profile);
      } catch (err) {
        setProfileError(
          err instanceof Error ? err.message : "Failed to fetch profile"
        );
        setProfile(null);
      } finally {
        setIsLoadingProfile(false);
      }
    })();
  }, [isLoaded, isSignedIn, supabase]);

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Supabase Connection Test</h1>

        <div className="space-y-6 bg-zinc-900 rounded-lg p-6">
          {/* Clerk Auth State */}
          <div>
            <h2 className="text-xl font-semibold mb-2">Clerk Authentication</h2>
            <div className="space-y-2 text-sm text-zinc-300">
              <p>
                <span className="font-medium">Loaded:</span>{" "}
                <code className="bg-zinc-800 px-2 py-1 rounded">
                  {isLoaded ? "✓ true" : "⏳ false"}
                </code>
              </p>
              <p>
                <span className="font-medium">Signed In:</span>{" "}
                <code className="bg-zinc-800 px-2 py-1 rounded">
                  {isLoaded ? (isSignedIn ? "✓ true" : "✗ false") : "⏳ unknown"}
                </code>
              </p>
            </div>
          </div>

          {/* Supabase Client State */}
          <div>
            <h2 className="text-xl font-semibold mb-2">Supabase Client</h2>
            <div className="space-y-2 text-sm text-zinc-300">
              {!isLoaded && <p>⏳ Waiting for Clerk to load...</p>}

              {isLoaded && !isSignedIn && (
                <p className="text-amber-400">
                  ℹ️ Signed out: Supabase client created without auth headers.
                </p>
              )}

              {isLoaded && isSignedIn && !supabase && (
                <p className="text-red-400">
                  ✗ Error: Supabase client failed to initialize.
                  {error && (
                    <code className="block bg-red-900 px-2 py-1 rounded mt-2 text-xs">
                      {error}
                    </code>
                  )}
                </p>
              )}

              {isLoaded && isSignedIn && supabase && (
                <p className="text-green-400">✓ Supabase client ready.</p>
              )}

              {isLoaded && !isSignedIn && supabase && (
                <p className="text-green-400">
                  ✓ Supabase client ready (unsigned).
                </p>
              )}
            </div>
          </div>

          {/* Profile Sync Status */}
          <div>
            <h2 className="text-xl font-semibold mb-2">Profile Synchronization</h2>
            <div className="space-y-2 text-sm text-zinc-300">
              {!isLoaded && <p>⏳ Waiting for Clerk to load...</p>}

              {isLoaded && !isSignedIn && (
                <p className="text-amber-400">
                  ℹ️ Signed out: Profile sync not active.
                </p>
              )}

              {isLoaded && isSignedIn && isLoadingProfile && (
                <p className="text-blue-400">⏳ Fetching profile...</p>
              )}

              {isLoaded && isSignedIn && profileError && (
                <p className="text-red-400">
                  ✗ Profile fetch error: {profileError}
                </p>
              )}

              {isLoaded && isSignedIn && !isLoadingProfile && profile && (
                <div className="space-y-1">
                  <p className="text-green-400">✓ Profile row found</p>
                  <p>
                    <span className="font-medium">Clerk User ID:</span>{" "}
                    <code className="bg-zinc-800 px-2 py-1 rounded text-xs">
                      {profile.clerk_user_id ? "✓ configured" : "✗ missing"}
                    </code>
                  </p>
                  <p>
                    <span className="font-medium">Username:</span>{" "}
                    <code className="bg-zinc-800 px-2 py-1 rounded text-xs">
                      {profile.username ? "✓ configured" : "✗ missing"}
                    </code>
                  </p>
                  <p>
                    <span className="font-medium">Email:</span>{" "}
                    <code className="bg-zinc-800 px-2 py-1 rounded text-xs">
                      {profile.email ? "✓ configured" : "✗ missing"}
                    </code>
                  </p>
                  <p>
                    <span className="font-medium">Display Name:</span>{" "}
                    <code className="bg-zinc-800 px-2 py-1 rounded text-xs">
                      {profile.display_name ? "✓ configured" : "✗ missing"}
                    </code>
                  </p>
                  <p>
                    <span className="font-medium">Avatar:</span>{" "}
                    <code className="bg-zinc-800 px-2 py-1 rounded text-xs">
                      {profile.avatar_url ? "✓ configured" : "✗ missing"}
                    </code>
                  </p>
                  <p>
                    <span className="font-medium">Credits:</span>{" "}
                    <code className="bg-zinc-800 px-2 py-1 rounded text-xs">
                      {profile.credits}
                    </code>
                  </p>
                  <p>
                    <span className="font-medium">Plan:</span>{" "}
                    <code className="bg-zinc-800 px-2 py-1 rounded text-xs">
                      {profile.plan}
                    </code>
                  </p>
                </div>
              )}

              {isLoaded && isSignedIn && !isLoadingProfile && !profile && !profileError && (
                <p className="text-amber-400">
                  ℹ️ No profile row found. ProfileSynchronizer may not have synced yet.
                </p>
              )}
            </div>
          </div>

          {/* Environment Check */}
          <div>
            <h2 className="text-xl font-semibold mb-2">Environment</h2>
            <div className="space-y-2 text-sm text-zinc-300">
              <p>
                <span className="font-medium">NEXT_PUBLIC_SUPABASE_URL:</span>{" "}
                <code className="bg-zinc-800 px-2 py-1 rounded">
                  {process.env.NEXT_PUBLIC_SUPABASE_URL
                    ? "✓ configured"
                    : "✗ missing"}
                </code>
              </p>
              <p>
                <span className="font-medium">
                  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
                </span>{" "}
                <code className="bg-zinc-800 px-2 py-1 rounded">
                  {process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
                    ? "✓ configured"
                    : "✗ missing"}
                </code>
              </p>
            </div>
          </div>

          {/* Instructions */}
          <div className="mt-8 pt-6 border-t border-zinc-700">
            <p className="text-sm text-zinc-400">
              This page verifies that the Supabase client can be created with
              Clerk&apos;s session token. It does not query any database tables
              (they don&apos;t exist yet).
            </p>
            <p className="text-xs text-zinc-500 mt-2">
              Before production: delete{" "}
              <code className="bg-zinc-800 px-1 rounded">
                /src/app/test/supabase/
              </code>
              directory.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
