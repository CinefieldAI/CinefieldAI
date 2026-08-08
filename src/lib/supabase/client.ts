import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  );
}

/**
 * Browser-side Supabase client factory.
 * Must be called within a component tree where useAuth() is available.
 *
 * Uses a custom fetch wrapper to inject the current Clerk session token
 * dynamically for each request. This ensures expired JWTs are refreshed
 * automatically by Clerk before each Supabase operation.
 */
export async function getClerkSupabaseClient(
  getToken: (options?: { template?: string }) => Promise<string | null>
): Promise<SupabaseClient> {
  // Create a custom fetch function that injects the current Clerk token
  // into every Supabase request, dynamically fetching a fresh token each time
  const customFetch = async (
    url: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    // Get the current Clerk session token (refreshed if needed)
    const token = await getToken();

    // Build headers
    const headers = new Headers(init?.headers || {});

    // Inject authorization header if token is available
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    // Make the request with the fresh token
    return fetch(url, {
      ...init,
      headers,
    });
  };

  // Create Supabase client with custom fetch that injects fresh tokens
  return createClient(supabaseUrl, supabaseKey, {
    global: {
      fetch: customFetch,
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
