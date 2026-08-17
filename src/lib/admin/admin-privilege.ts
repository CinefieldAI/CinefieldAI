import "server-only";
import { bootstrapAdminIds } from "./admin-auth";

/**
 * Phase 16-E — privileged-admin role separation, on top of the Phase 16/1
 * bootstrap.
 *
 * ---------------------------------------------------------------------------
 * WHY A NEW FILE, NOT A CHANGE TO decideAdminAccess()
 * ---------------------------------------------------------------------------
 * `requireAdminAccess()`/`decideAdminAccess()` (Phase 16/1) answer ONE
 * question — "may this identity see the Operations Center at all?" — and 49
 * call sites across every Phase 16 package depend on that boolean meaning
 * exactly that and nothing more. Folding role separation into that function
 * would either change what `allowed: true` has meant since Phase 16/1 (a
 * regression for every already-closed 16-A/B/C/D surface) or require a
 * second, incompatible return shape. Neither is worth it: this file adds a
 * NEW, finer question — "which privilege tier?" — as a pure function next to
 * the existing one, so every existing caller is untouched and every NEW
 * Tier-0 caller (`tier0-authorization.ts`) can ask the sharper question.
 *
 * ---------------------------------------------------------------------------
 * BOOTSTRAP ADMIN, BOUNDED — NOT SILENTLY THE FINAL TIER-0 MODEL
 * ---------------------------------------------------------------------------
 * Before this file, EVERY identity in `CINEFIELD_ADMIN_CLERK_USER_IDS`
 * implicitly had the same authority as every other — there was one tier.
 * That is the exact "compromise of a normal admin session is automatically
 * sufficient" shape Phase 16-E's own roadmap section names as the problem.
 * This file narrows it: Tier-0 authority now requires explicit membership in
 * a SEPARATE, narrower env-var allowlist
 * (`CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS`) that nothing defaults into. An id
 * that is only in the legacy base list is now honestly a VIEWER — it can see
 * the console (unchanged, via `requireAdminAccess()`), but
 * `resolveAdminPrivilegeRole` will not report it as `operator` or
 * `tier0_admin`, and nothing new built on this file grants it a mutation it
 * could not already reach through the pre-existing, unmodified action
 * owners.
 *
 * Still a bootstrap, still not a Clerk organization role or custom session
 * claim — the repository has neither (verified: no `sessionClaims`,
 * `orgRole`, `publicMetadata`/`privateMetadata` read anywhere outside the
 * Phase 16-A closure tests' NEGATIVE assertions that such a thing does not
 * exist). An env-var allowlist remains the smallest HONEST source available
 * without provisioning external Clerk configuration this phase is not
 * permitted to add. When a real Clerk org-role/claim system exists, only the
 * three `*Ids()` readers below change; every caller of
 * `resolveAdminPrivilegeRole`/`requireAdminPrivilege` stays untouched — the
 * same seam `isBootstrapAdmin` already proved out for Phase 16/1.
 *
 * DEFAULT DENY. An id on none of the three lists resolves to `null` — never a
 * fallback tier. An unset or malformed env var is an empty set, never "no
 * restriction".
 */

/** Ordered least to most privileged. Three tiers, not an enterprise ladder. */
export type AdminPrivilegeRole = "viewer" | "operator" | "tier0_admin";

const ROLE_RANK: Readonly<Record<AdminPrivilegeRole, number>> = {
  viewer: 0,
  operator: 1,
  tier0_admin: 2,
};

/** True when `role` meets or exceeds `minimum` on the viewer<operator<tier0_admin ladder. */
export function roleAtLeast(role: AdminPrivilegeRole, minimum: AdminPrivilegeRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

function parseIdList(raw: string | undefined): ReadonlySet<string> {
  if (typeof raw !== "string" || raw.trim().length === 0) return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );
}

/** OPERATOR tier: may perform OPERATOR_MUTATION-classified actions (see the catalogue). */
export function operatorAdminIds(
  rawEnv: string | undefined = process.env.CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS
): ReadonlySet<string> {
  return parseIdList(rawEnv);
}

/**
 * TIER0 tier: may perform HIGH_RISK_TIER0-classified actions, subject to
 * step-up assurance and dual control where the catalogue requires it. This
 * is deliberately the NARROWEST of the three lists and the one most likely
 * to stay empty in a development environment — an empty list here means "no
 * one can perform a Tier-0 action", which is the correct, honest default
 * when no operator has been explicitly promoted.
 */
export function tier0AdminIds(
  rawEnv: string | undefined = process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS
): ReadonlySet<string> {
  return parseIdList(rawEnv);
}

/**
 * Resolves the privilege tier for an ALREADY Clerk-authenticated id.
 *
 * Pure and Clerk-free (same reason `decideAdminAccess` is): testable without
 * mocking `@clerk/nextjs/server`. Does NOT re-check whether the id is a
 * console admin at all — callers that need that use `requireAdminAccess()`
 * first, exactly as every existing Phase 16 route does; this function only
 * ever narrows from there.
 */
export function resolveAdminPrivilegeRole(clerkUserId: string | null): AdminPrivilegeRole | null {
  if (typeof clerkUserId !== "string" || clerkUserId.length === 0) return null;

  try {
    if (tier0AdminIds().has(clerkUserId)) return "tier0_admin";
    if (operatorAdminIds().has(clerkUserId)) return "operator";
    if (bootstrapAdminIds().has(clerkUserId)) return "viewer";
  } catch {
    // Unreadable allowlist source: deny, never "no restriction" — the same
    // fail-closed direction `decideAdminAccess` takes on the identical
    // failure.
    return null;
  }
  return null;
}

export type AdminPrivilegeReasonCode = "allowed" | "no_role" | "role_below_minimum";

export interface AdminPrivilegeDecision {
  readonly allowed: boolean;
  readonly role: AdminPrivilegeRole | null;
  readonly reasonCode: AdminPrivilegeReasonCode;
}

/**
 * The privilege-tier gate. Distinct from — and layered ON TOP OF —
 * `requireAdminAccess()`: a caller failing this has already passed console
 * admission and is being refused a SPECIFIC tier, which is a different,
 * narrower fact than "not an admin at all" and must never be conflated with
 * it (the opaque-404 `requireAdminAccess()` denial stays exactly as it was).
 */
export function requireAdminPrivilege(
  clerkUserId: string | null,
  minimum: AdminPrivilegeRole
): AdminPrivilegeDecision {
  const role = resolveAdminPrivilegeRole(clerkUserId);
  if (!role) return { allowed: false, role: null, reasonCode: "no_role" };
  if (!roleAtLeast(role, minimum)) return { allowed: false, role, reasonCode: "role_below_minimum" };
  return { allowed: true, role, reasonCode: "allowed" };
}
