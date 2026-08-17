import "server-only";
import { auth } from "@clerk/nextjs/server";
import { resolveAssuranceEvidence, verifyElevatedSession, type ElevationVerdict } from "./step-up-auth";
import { readElevatedSession } from "@/lib/redis/admin-elevation-store";

/**
 * The real I/O boundary for Phase 16-E step-up assurance — mirrors
 * `require-admin-access.ts`'s split from `admin-auth.ts` exactly, and for
 * the identical reason: importing `@clerk/nextjs/server` makes a module
 * unloadable by a plain `node:test` process, so the decision logic
 * (`step-up-auth.ts`) stays Clerk-free and this file is the only place
 * `auth()` is called for step-up purposes.
 */

/** Resolves CURRENT-REQUEST assurance evidence from the live Clerk session. */
export async function getCurrentAssuranceEvidence() {
  try {
    const session = await auth();
    return resolveAssuranceEvidence(session.sessionClaims ?? null);
  } catch {
    return resolveAssuranceEvidence(null);
  }
}

/**
 * Resolves whether the CURRENT actor has a valid elevated session on file.
 * Fails closed on any resolution error — an unreadable session or store is
 * "not elevated", never "elevated".
 */
export async function getCurrentElevationVerdict(clerkUserId: string | null): Promise<ElevationVerdict> {
  if (typeof clerkUserId !== "string" || clerkUserId.length === 0) {
    return { elevated: false, reasonCode: "no_elevation" };
  }
  try {
    const record = await readElevatedSession(clerkUserId);
    return verifyElevatedSession(record, clerkUserId);
  } catch {
    return { elevated: false, reasonCode: "no_elevation" };
  }
}
