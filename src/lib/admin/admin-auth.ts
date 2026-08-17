import "server-only";

/**
 * The Phase 16 admin authorization DECISION core (Phase 16/1).
 *
 * Deliberately has NO import of `@clerk/nextjs/server` — the same choice
 * `admin-route-service.ts` (Phase 7-B) already made, and for the same
 * reason: a module that imports the Clerk server SDK cannot be loaded by a
 * plain `node:test` process (it transitively requires a live Next.js/React
 * app-router context this test harness does not provide), so the decision
 * logic that actually matters would become untestable the moment Clerk's
 * import joined it. `require-admin-access.ts` is the thin real caller that
 * resolves a Clerk session and hands the id here — it is not imported by any
 * test, `decideAdminAccess` is.
 *
 * ---------------------------------------------------------------------------
 * BOOTSTRAP, NOT `ROUTE_ADMIN_CLERK_USER_IDS`
 * ---------------------------------------------------------------------------
 * `admin-route-service.ts` (Phase 7-B) already has an allowlist env var, but
 * it is a NARROW seam scoped to route enable/priority mutations, and its own
 * comment says outright that Phase 16's Admin Operations Center is not being
 * built there. Promoting it into the universal Phase 16 authority would
 * quietly widen what that variable controls without anyone deciding it
 * should. `CINEFIELD_ADMIN_CLERK_USER_IDS` is a SEPARATE variable for this
 * reason, even though the shape is deliberately identical.
 *
 * This IS a bootstrap, not the intended end state. The repository has no
 * admin role, no admin claim and no org-based RBAC today (the same
 * observation `admin-route-service.ts` already made). An env-var allowlist
 * of Clerk user ids is the smallest HONEST authorization source available
 * right now — it is server-only, it cannot be set by a request, and it
 * defaults to denying everyone. `decideAdminAccess` is written to take a
 * resolved identity and answer a yes/no question; when a real role/claim
 * system exists, only `isBootstrapAdmin`'s replacement changes — every
 * caller of `requireAdminAccess()` stays untouched.
 *
 * ---------------------------------------------------------------------------
 * DEFAULT DENY, NEVER FAIL OPEN
 * ---------------------------------------------------------------------------
 * No session -> deny. Session but not on the list -> deny. The list itself
 * unreadable/malformed -> deny. There is no branch that returns `allowed:
 * true` without a Clerk session AND an explicit allowlist match, and no
 * catch block anywhere in this file resolves to `true`.
 */

export type AdminAccessReasonCode = "allowed" | "no_session" | "not_admin" | "admin_source_unavailable";

export interface AdminAccessResult {
  readonly allowed: boolean;
  /** Present whenever a Clerk session was resolved, even when denied. */
  readonly clerkUserId: string | null;
  readonly reasonCode: AdminAccessReasonCode;
}

/**
 * The allowlist, parsed. Defaults to reading the real environment variable,
 * but accepts an override so the parsing/decision logic is testable without
 * mutating `process.env`.
 */
export function bootstrapAdminIds(
  rawEnv: string | undefined = process.env.CINEFIELD_ADMIN_CLERK_USER_IDS
): ReadonlySet<string> {
  if (typeof rawEnv !== "string" || rawEnv.trim().length === 0) return new Set();
  return new Set(
    rawEnv
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );
}

export function isBootstrapAdmin(clerkUserId: string, rawEnv?: string): boolean {
  if (typeof clerkUserId !== "string" || clerkUserId.length === 0) return false;
  return bootstrapAdminIds(rawEnv).has(clerkUserId);
}

/**
 * Pure decision core: given an already-resolved Clerk user id (or `null` for
 * no session), decide access. Kept separate from `requireAdminAccess` so the
 * decision logic — the part that matters — is testable without mocking
 * `@clerk/nextjs/server`, which nothing else in this codebase does either.
 */
export function decideAdminAccess(clerkUserId: string | null): AdminAccessResult {
  if (!clerkUserId) {
    return { allowed: false, clerkUserId: null, reasonCode: "no_session" };
  }

  let isAdmin: boolean;
  try {
    isAdmin = isBootstrapAdmin(clerkUserId);
  } catch {
    // The allowlist source itself could not be read/parsed. Unreadable is
    // not "no restriction" — deny, the same direction as every other
    // fail-closed boundary in this codebase.
    return { allowed: false, clerkUserId, reasonCode: "admin_source_unavailable" };
  }

  if (!isAdmin) {
    return { allowed: false, clerkUserId, reasonCode: "not_admin" };
  }

  return { allowed: true, clerkUserId, reasonCode: "allowed" };
}
