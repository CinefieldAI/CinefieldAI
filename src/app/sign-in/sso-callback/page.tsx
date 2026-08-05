"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

/**
 * Used only by the OAuth popup opened from the Cinefield auth modal
 * (see PasswordSignIn.tsx's handleOAuth). Clerk navigates the popup window
 * here at the end of the provider redirect chain; this component finalizes
 * the auth state and the popup closes itself. It does not render a second
 * full application auth page — the main window/modal is never affected.
 */
export default function SsoCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
