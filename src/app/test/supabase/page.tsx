"use client";

import { useClerkSupabaseClient } from "@/lib/supabase/useClerkSupabaseClient";

/**
 * Development-only test page to verify Supabase client creation.
 * Does not query any tables (they don't exist yet).
 * Safely reports Clerk auth state and Supabase client status.
 *
 * Access: http://localhost:3000/test/supabase
 * Remove this page before production.
 */
export default function SupabaseTestPage() {
  const { supabase, isLoaded, isSignedIn, error } = useClerkSupabaseClient();

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
