"use client";

import { useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useClerkSupabaseClient } from "@/lib/supabase/useClerkSupabaseClient";
import { ProfileUpsertPayload } from "@/types/database";

/**
 * ProfileSynchronizer - Background sync between Clerk and Supabase profiles.
 *
 * When a signed-in user mounts this component:
 * 1. Waits for Clerk to load and user object to be ready
 * 2. Waits for authenticated Supabase client to be ready
 * 3. Performs an upsert into public.profiles with safe fields only
 * 4. Prevents duplicate syncs via useRef tracking
 * 5. Re-syncs only when relevant Clerk profile data changes
 *
 * Does not block UI, does not show toasts/modals, fails silently on errors.
 */
export default function ProfileSynchronizer() {
  const { user, isLoaded } = useUser();
  const { supabase, isLoaded: supabaseLoaded, isSignedIn } = useClerkSupabaseClient();

  // Track the last synced profile data to prevent duplicate requests
  const lastSyncedRef = useRef<{
    clerkUserId: string | null;
    email: string | null;
    username: string | null;
    fullName: string | null;
    imageUrl: string | null;
  }>({
    clerkUserId: null,
    email: null,
    username: null,
    fullName: null,
    imageUrl: null,
  });

  // Track if a sync is in progress to prevent concurrent requests
  const syncInProgressRef = useRef(false);

  useEffect(() => {
    // Conditions: Clerk loaded, user signed in, user object available, Supabase ready
    if (!isLoaded || !user || !supabaseLoaded || !isSignedIn || !supabase) {
      return;
    }

    // Prevent re-entrancy during React StrictMode or rerenders
    if (syncInProgressRef.current) {
      return;
    }

    // Extract Clerk user data
    const clerkUserId = user.id;
    const email = user.primaryEmailAddress?.emailAddress || null;
    const username = user.username || null;
    const imageUrl = user.imageUrl || null;

    // Build display_name from available fields
    let displayName: string | null = null;
    if (user.fullName) {
      displayName = user.fullName;
    } else if (user.firstName && user.lastName) {
      displayName = `${user.firstName} ${user.lastName}`;
    } else if (user.firstName) {
      displayName = user.firstName;
    } else if (username) {
      displayName = username;
    }

    // Check if profile data has changed since last sync
    const hasChanged =
      lastSyncedRef.current.clerkUserId !== clerkUserId ||
      lastSyncedRef.current.email !== email ||
      lastSyncedRef.current.username !== username ||
      lastSyncedRef.current.fullName !== displayName ||
      lastSyncedRef.current.imageUrl !== imageUrl;

    if (!hasChanged) {
      return;
    }

    // Build upsert payload - only safe fields
    const payload: ProfileUpsertPayload = {
      clerk_user_id: clerkUserId,
      username,
      email,
      display_name: displayName,
      avatar_url: imageUrl,
    };

    // Perform upsert
    (async () => {
      syncInProgressRef.current = true;

      try {
        const { error } = await supabase
          .from("profiles")
          .upsert(payload, {
            onConflict: "clerk_user_id",
          });

        if (error) {
          // Fail silently in production, log in development
          if (process.env.NODE_ENV === "development") {
            console.debug(
              "[ProfileSync] Upsert error:",
              error.message
            );
          }
          return;
        }

        // Update last synced values to prevent re-syncing the same data
        lastSyncedRef.current = {
          clerkUserId,
          email,
          username,
          fullName: displayName,
          imageUrl,
        };

        if (process.env.NODE_ENV === "development") {
          console.debug("[ProfileSync] Profile synced successfully");
        }
      } catch (err) {
        // Unexpected error - fail silently
        if (process.env.NODE_ENV === "development") {
          console.debug(
            "[ProfileSync] Unexpected error:",
            err instanceof Error ? err.message : "Unknown error"
          );
        }
      } finally {
        syncInProgressRef.current = false;
      }
    })();
  }, [isLoaded, user, supabaseLoaded, isSignedIn, supabase]);

  // This component renders nothing - it's a background sync service
  return null;
}
