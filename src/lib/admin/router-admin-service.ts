import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listRoutesForAdmin, setRouteEnabled } from "@/lib/routing/admin-route-service";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { createLogger } from "@/lib/observability/logger";
import { authorizeTier0Action, recordTier0Execution } from "./tier0-authorization";
import { requirePolicy } from "@/lib/policy/policy-gate";
import { PolicyDenied } from "@/lib/policy/policy-contract";
import type { AssuranceEvidence, ElevationVerdict } from "./step-up-auth";
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

/**
 * Phase 16-E. `route.disable` is catalogued `HIGH_RISK_TIER0` +
 * step-up-required + (as of the Phase 19 closure fix) two-person —
 * named explicitly in the 16-B/16-E handoff
 * (`docs/security-gates.md`'s "The minimum safe action gate (Phase 16-B,
 * not 16-E)" section) and in the roadmap's own Phase 19 Two-Person Approval
 * list. See `tier0-authorization.ts`'s header for the shadow/enforce mode
 * split; `setRouteEnabled` (Phase 7-B) is called completely unmodified
 * either way.
 *
 * PHASE 19 CLOSURE FIX. `requirePolicy` (action `route.disable`) is the
 * FIRST gate — matching `admin-route-service.ts`'s `routing.control.set`
 * convention ("the gate lands here first") — and is a NECESSARY but not
 * SUFFICIENT condition: Tier-0 role/step-up/two-person still independently
 * gates the same call, and neither layer substitutes for the other.
 *
 * `requestId` is optional so a caller can RESUME a pending two-person
 * request (returned on the prior `TIER0_AUTHORIZATION_REQUIRED` response)
 * rather than minting a fresh one every attempt, which could never be
 * satisfied.
 */
export async function setAdminRouteEnabled(
  admin: SupabaseClient,
  actorClerkUserId: string,
  routeId: string,
  enabled: boolean,
  reason: string,
  stepUp: { assurance: AssuranceEvidence; elevation: ElevationVerdict } = {
    assurance: { state: "NOT_CONFIGURED", verifiedAt: null },
    elevation: { elevated: false, reasonCode: "no_elevation" },
  },
  requestId: string = randomUUID()
): Promise<RouterAdminSetEnabledResult> {
  if (!ROUTE_ID_PATTERN.test(routeId) || !isValidRouteActionReason(reason)) {
    return { outcome: "INVALID_TARGET" };
  }

  try {
    await requirePolicy({
      action: "route.disable",
      actor: { id: actorClerkUserId, role: "route_admin", kind: "human" },
      resource: { type: "model_route", id: routeId },
      correlationId: requestId,
    });
  } catch (caught) {
    if (!(caught instanceof PolicyDenied)) throw caught;
    auditLog.info("route_enabled_set_attempted", { actorClerkUserId, routeId, enabled, reason, outcome: "POLICY_DENIED", policyReasonCode: caught.reason });
    return { outcome: "POLICY_DENIED", reasonCode: caught.reason };
  }

  const decision = await authorizeTier0Action(admin, {
    requestId,
    action: "route.disable",
    actorClerkUserId,
    target: { type: "model_route", id: routeId },
    reasonCode: null,
    correlationId: null,
    assurance: stepUp.assurance,
    elevation: stepUp.elevation,
  });
  if (!decision.allowed) {
    auditLog.info("route_enabled_set_attempted", { actorClerkUserId, routeId, enabled, reason, outcome: "TIER0_AUTHORIZATION_REQUIRED", tier0ReasonCode: decision.reasonCode });
    return { outcome: "TIER0_AUTHORIZATION_REQUIRED", reasonCode: decision.reasonCode, requestId };
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
    await recordTier0Execution(admin, {
      requestId,
      action: "route.disable",
      actorClerkUserId,
      target: { type: "model_route", id: routeId },
      outcome: "execution_failed",
      outcomeDetail: outcome.toLowerCase(),
    });
    return outcome === "ROUTE_AUTHORITY_DENIED"
      ? { outcome }
      : { outcome, reasonCode: "route_update_failed" };
  }

  const outcome = applied ? "APPLIED" : "ROUTE_NOT_FOUND";
  auditLog.info("route_enabled_set_attempted", { actorClerkUserId, routeId, enabled, reason, outcome });
  await recordTier0Execution(admin, {
    requestId,
    action: "route.disable",
    actorClerkUserId,
    target: { type: "model_route", id: routeId },
    outcome: applied ? "executed" : "execution_failed",
    outcomeDetail: outcome.toLowerCase(),
  });

  return applied ? { outcome: "APPLIED", routeId, enabled } : { outcome: "ROUTE_NOT_FOUND" };
}
