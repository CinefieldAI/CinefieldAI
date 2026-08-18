import type { RouteAdminView } from "@/lib/routing/admin-route-service";

/**
 * Phase 16-B admin Router Controls contract.
 *
 * ---------------------------------------------------------------------------
 * TWO SEPARATE AUTHORITY LAYERS, NEVER MERGED
 * ---------------------------------------------------------------------------
 * A caller can be a valid Phase 16 admin (`requireAdminAccess()`,
 * `CINEFIELD_ADMIN_CLERK_USER_IDS`) without being a Phase 7-B route admin
 * (`assertRouteAdmin()`, `ROUTE_ADMIN_CLERK_USER_IDS`) — these are two
 * deliberately separate allowlists (`admin-route-service.ts`'s own header:
 * "I looked" — no admin role exists in this schema, so each narrow
 * capability got its own env-var gate rather than one shared one).
 * `ROUTE_AUTHORITY_DENIED` names exactly that second, distinct refusal —
 * never collapsed into the opaque 404 `requireAdminAccess()` denial uses,
 * because the caller here already passed that check and deserves an honest
 * "you don't hold this specific authority," not a fake "not found."
 */

export type RouterAdminListResult =
  | { readonly outcome: "ROUTE_AUTHORITY_DENIED" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly routes: readonly RouteAdminView[] };

export type RouterAdminSetEnabledResult =
  | { readonly outcome: "ROUTE_AUTHORITY_DENIED" }
  | { readonly outcome: "INVALID_TARGET" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "ROUTE_NOT_FOUND" }
  | { readonly outcome: "APPLIED"; readonly routeId: string; readonly enabled: boolean }
  /**
   * PHASE 19 CLOSURE FIX. The Phase 12-E policy gate (`requirePolicy`,
   * action `route.disable`) is now the FIRST check `setAdminRouteEnabled`
   * makes — see that function's header. A policy DENY blocks before Tier-0
   * is ever evaluated and before `setRouteEnabled` is ever called.
   */
  | { readonly outcome: "POLICY_DENIED"; readonly reasonCode: string }
  /**
   * Phase 16-E, extended by the Phase 19 closure fix. `requestId` is the
   * SAME id across every attempt for one pending action — carrying it back
   * to the caller is what lets a retry, after a second admin approves via
   * `decidePrivilegedAction`, resume the SAME two-person request instead of
   * minting a fresh one that could never be satisfied.
   */
  | { readonly outcome: "TIER0_AUTHORIZATION_REQUIRED"; readonly reasonCode: string; readonly requestId: string };

export const ROUTE_DISABLE_REASON_MAX_LENGTH = 500;

export function isValidRouteActionReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= ROUTE_DISABLE_REASON_MAX_LENGTH;
}

/** `model_routes.id` is a uuid. */
export const ROUTE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
