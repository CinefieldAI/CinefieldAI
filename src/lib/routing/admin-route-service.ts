import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrchestrationError } from "@/lib/orchestration/errors";

/**
 * Route administration — NARROW SCOPE (Phase 7-B).
 *
 * Three operations, and only three: enable/disable a route, change its static
 * priority, and read the model↔provider mapping. That is what the router
 * needs to be operable. Phase 16's Admin Operations Center is not being built
 * here, and stubbing a piece of it would be worse than leaving it absent.
 *
 * THE AUTHORIZATION BOUNDARY IS REAL, AND IT FAILS CLOSED
 * The repository has no admin role, no admin claim, and no admin route — I
 * looked. So `assertRouteAdmin` denies EVERY caller unless
 * ROUTE_ADMIN_CLERK_USER_IDS explicitly lists them, and denies everyone when
 * that variable is unset, which is its state today.
 *
 * An allowlist is not the admin model this platform will end up with; a Clerk
 * organization role almost certainly is. But inventing a role system as a side
 * effect of a routing phase would be the wrong place to make that decision,
 * and shipping these mutations with NO boundary would hand every signed-in
 * user a switch that redirects production traffic. Deny-by-default is the only
 * honest position while the real answer is undecided, and the missing UI and
 * missing role source are reported rather than papered over.
 *
 * NO SECRET EVER LEAVES HERE. The tables hold no credentials by design, and
 * the read below selects columns explicitly rather than `*`, so a column added
 * later is not exposed by default.
 */

/** Reads the allowlist. Absent or empty means nobody is an admin. */
function routeAdmins(): Set<string> {
  const raw = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  if (typeof raw !== "string" || raw.trim().length === 0) return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );
}

export function isRouteAdmin(clerkUserId: string): boolean {
  if (typeof clerkUserId !== "string" || clerkUserId.length === 0) return false;
  return routeAdmins().has(clerkUserId);
}

/**
 * Gate for every mutation below.
 *
 * Throws FORBIDDEN, which this codebase maps to 404 — an ordinary user
 * probing an admin surface learns nothing about whether it exists.
 */
export function assertRouteAdmin(clerkUserId: string): void {
  if (!isRouteAdmin(clerkUserId)) {
    throw new OrchestrationError("FORBIDDEN", {
      context: { operation: "route_admin" },
    });
  }
}

export interface RouteAdminView {
  routeId: string;
  cinefieldModelId: string;
  modelVersion: number;
  providerId: string;
  providerModelId: string;
  priority: number;
  enabled: boolean;
  status: string;
}

/** The model↔provider mapping, for an operator deciding what to change. */
export async function listRoutesForAdmin(
  admin: SupabaseClient,
  clerkUserId: string,
  cinefieldModelId?: string
): Promise<RouteAdminView[]> {
  assertRouteAdmin(clerkUserId);

  let query = admin
    .from("model_routes")
    // Explicit columns, never `*`.
    .select(
      `id, model_id, priority, enabled, status,
       model_versions ( version ),
       provider_models ( provider_id, provider_model_id )`
    )
    .order("model_id", { ascending: true })
    .order("priority", { ascending: false });

  if (cinefieldModelId) query = query.eq("model_id", cinefieldModelId);

  const { data, error } = await query;
  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { operation: "listRoutesForAdmin" },
    });
  }

  return ((data ?? []) as unknown as {
    id: string;
    model_id: string;
    priority: number;
    enabled: boolean;
    status: string;
    model_versions: { version: number } | null;
    provider_models: { provider_id: string; provider_model_id: string } | null;
  }[])
    .filter((row) => row.model_versions && row.provider_models)
    .map((row) => ({
      routeId: row.id,
      cinefieldModelId: row.model_id,
      modelVersion: row.model_versions!.version,
      providerId: row.provider_models!.provider_id,
      providerModelId: row.provider_models!.provider_model_id,
      priority: row.priority,
      enabled: row.enabled,
      status: row.status,
    }));
}

/**
 * Enables or disables one route.
 *
 * Disabling the last enabled route for a model is permitted and NOT silently
 * prevented: taking a model offline is a legitimate operational act. What
 * happens next is the router refusing with NO_ELIGIBLE_ROUTE before any
 * generation row is created — a clean, visible refusal rather than a queue of
 * work nothing can run.
 */
export async function setRouteEnabled(
  admin: SupabaseClient,
  clerkUserId: string,
  routeId: string,
  enabled: boolean
): Promise<boolean> {
  assertRouteAdmin(clerkUserId);

  const { data, error } = await admin
    .from("model_routes")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", routeId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { operation: "setRouteEnabled", routeId },
    });
  }
  return data !== null;
}

/** Static priority. Higher wins; the router's tie-break handles equals. */
export async function setRoutePriority(
  admin: SupabaseClient,
  clerkUserId: string,
  routeId: string,
  priority: number
): Promise<boolean> {
  assertRouteAdmin(clerkUserId);

  // Bounded in the application as well as by the CHECK constraint, so a bad
  // value is a typed refusal rather than a database error surfacing upward.
  if (!Number.isInteger(priority) || priority < 0 || priority > 10_000) {
    throw new OrchestrationError("INVALID_INPUT", {
      userMessage: "Priority must be an integer between 0 and 10000.",
    });
  }

  const { data, error } = await admin
    .from("model_routes")
    .update({ priority, updated_at: new Date().toISOString() })
    .eq("id", routeId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { operation: "setRoutePriority", routeId },
    });
  }
  return data !== null;
}
