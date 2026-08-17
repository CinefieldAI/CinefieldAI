import "server-only";
import { auth } from "@clerk/nextjs/server";
import { decideAdminAccess, type AdminAccessResult } from "./admin-auth";

/**
 * The real I/O boundary for Phase 16 admin authorization (Phase 16/1).
 *
 * This is the ONE function every Phase 16 admin page and admin API route
 * calls — never a re-implementation of the check. It resolves the Clerk
 * session and defers entirely to `decideAdminAccess` (`admin-auth.ts`),
 * which owns every actual decision branch.
 *
 * Kept in its own file, separate from the pure decision core, purely because
 * importing `@clerk/nextjs/server` pulls in the Next.js app-router runtime —
 * fine in a real request, but it makes a module unloadable by a plain
 * `node:test` process. `admin-auth.ts` stays test-loadable by never
 * importing this file; this file is the only place `auth()` is called.
 */
export async function requireAdminAccess(): Promise<AdminAccessResult> {
  let clerkUserId: string | null;
  try {
    const session = await auth();
    clerkUserId = session.userId ?? null;
  } catch {
    return { allowed: false, clerkUserId: null, reasonCode: "admin_source_unavailable" };
  }
  return decideAdminAccess(clerkUserId);
}
