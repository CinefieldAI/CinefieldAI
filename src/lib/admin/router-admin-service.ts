import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listRoutesForAdmin, setRouteEnabled } from "@/lib/routing/admin-route-service";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { createLogger } from "@/lib/observability/logger";
import {
  isValidRouteActionReason,
  ROUTE_ID_PATTERN,
  type RouterAdminListResult,
  type RouterAdminSetEnabledResult,
} from "./router-admin-contract";

/**
 * The Phase 16-B admin Router Controls read + action service.
 *
 * ---------------------------------------------------------------------------
 * A THIN WRAPPER, NOT A SECOND ROUTING AUTHORITY
 * ---------------------------------------------------------------------------
 * `listRoutesForAdmin`/`setRouteEnabled` (Phase 7-B) are called UNMODIFIED
 * and do all the real work — this file adds only: catching the
 * `FORBIDDEN` `OrchestrationError` `assertRouteAdmin` throws internally and
 * turning it into a bounded `ROUTE_AUTHORITY_DENIED` outcome instead of an
 * uncaught exception, input validation before either function is ever
 * called, and an audit log line. No route mutation logic lives here.
 *
 * ---------------------------------------------------------------------------
 * WHY `setRouteEnabled`, NOT `setRuntimeRoutingControl`
 * ---------------------------------------------------------------------------
 * Two Phase 7 mutation paths could plausibly answer "disable a route":
 * `setRouteEnabled` (persistent `model_routes.enabled` flag, reversible by
 * calling it again with `true`) and `setRuntimeRoutingControl` (a Redis A,
 * TTL-based, policy-gated temporary exclusion). This slice uses
 * `setRouteEnabled` — it is literally named for this action, and its own
 * boolean parameter already gives a single reversible mutation for both
 * disable and re-enable, matching the roadmap's "reversible enable/clear
 * semantics" requirement without adding a second mutation path.
 * `setRuntimeRoutingControl`/`clearRuntimeRoutingControl` (with their own
 * built-in Phase 12-E policy gate, reason, and TTL) remain available,
 * unmodified, real Phase 7 capability — deliberately not wired into this
 * UI, to keep the 16-B action surface to exactly what the done criterion
 * asks for ("disable a route") rather than building a second, broader
 * temporary-exclusion console alongside it.
 */

const auditLog = createLogger("admin-router");

function isRouteAdminForbidden(error: unknown): boolean {
  return error instanceof OrchestrationError && error.code === "FORBIDDEN";
}

export async function getAdminRouterView(
  admin: SupabaseClient,
  actorClerkUserId: string,
  cinefieldModelId?: string
): Promise<RouterAdminListResult> {
  try {
    const routes = await listRoutesForAdmin(admin, actorClerkUserId, cinefieldModelId);
    return { outcome: "FOUND", routes };
  } catch (error) {
    if (isRouteAdminForbidden(error)) return { outcome: "ROUTE_AUTHORITY_DENIED" };
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "route_read_failed" };
  }
}

export async function setAdminRouteEnabled(
  admin: SupabaseClient,
  actorClerkUserId: string,
  routeId: string,
  enabled: boolean,
  reason: string
): Promise<RouterAdminSetEnabledResult> {
  if (!ROUTE_ID_PATTERN.test(routeId) || !isValidRouteActionReason(reason)) {
    return { outcome: "INVALID_TARGET" };
  }

  let applied: boolean;
  try {
    applied = await setRouteEnabled(admin, actorClerkUserId, routeId, enabled);
  } catch (error) {
    const outcome = isRouteAdminForbidden(error) ? "ROUTE_AUTHORITY_DENIED" : "SOURCE_UNAVAILABLE";
    auditLog.info("route_enabled_set_attempted", {
      actorClerkUserId,
      routeId,
      enabled,
      reason,
      outcome,
    });
    return outcome === "ROUTE_AUTHORITY_DENIED"
      ? { outcome }
      : { outcome, reasonCode: "route_update_failed" };
  }

  const outcome = applied ? "APPLIED" : "ROUTE_NOT_FOUND";
  auditLog.info("route_enabled_set_attempted", { actorClerkUserId, routeId, enabled, reason, outcome });

  return applied ? { outcome: "APPLIED", routeId, enabled } : { outcome: "ROUTE_NOT_FOUND" };
}
