/**
 * Cinefield production model routing contracts (Phase 7-B).
 *
 * Pure types. No I/O, no database, no provider SDK — safe to import from the
 * router, the repository, the admin service and their tests alike.
 *
 * THE TWO QUESTIONS, KEPT APART
 *   Capability Registry  "what can this model do?"
 *                        src/lib/orchestration/model-registry.ts
 *   Provider Router      "where should this generation run?"
 *                        this module and its neighbours
 *
 * Nothing here describes a capability, and nothing in the capability registry
 * describes a provider's health, cost, priority or failover policy. Mixing
 * them is how "the model supports 4K" turns into "the model supports 4K on
 * whichever provider happened to be healthy", which is not a property of the
 * model at all.
 */

/** A candidate route as stored, before any selection has happened. */
export interface RouteCandidate {
  routeId: string;
  cinefieldModelId: string;
  modelVersionId: string;
  modelVersion: number;
  providerId: string;
  /** The provider's own model/endpoint identity. Never Cinefield identity. */
  providerModelId: string;
  priority: number;
  enabled: boolean;
  routeStatus: string;
  providerEnabled: boolean;
  providerModelEnabled: boolean;
  modelLifecycle: string;
  modelVersionStatus: string;
}

/**
 * What the router hands to execution.
 *
 * Identifiers and one human-readable reason. Deliberately NO credentials, no
 * endpoint URL, no cost figure, no health score, no list of the routes that
 * lost. This object is safe to log and safe to persist; it is not safe to
 * return to a browser, and nothing does.
 */
export interface RouteSelection {
  cinefieldModelId: string;
  modelVersionId: string;
  modelVersion: number;
  providerId: string;
  providerModelId: string;
  routeId: string;
  /** Why this route won, in terms a human reading a log can act on. */
  selectionReason: string;
  /** The static priority that decided it. Observability only. */
  priority: number;
}

export type RouteResolution =
  | { outcome: "selected"; selection: RouteSelection }
  /**
   * No route survived the eligibility filter. A typed refusal, never a
   * fallback: guessing a provider is how a generation runs somewhere nobody
   * approved and bills an account nobody expected.
   */
  | {
      outcome: "no_eligible_route";
      cinefieldModelId: string;
      /** Why each candidate was excluded. Codes only — safe to log. */
      rejected: { routeId: string; reason: RouteRejectionReason }[];
    };

export type RouteRejectionReason =
  | "route_disabled"
  | "route_not_active"
  | "provider_disabled"
  | "provider_model_disabled"
  | "model_version_not_usable"
  | "model_lifecycle_disabled"
  | "provider_not_registered"
  /**
   * Phase 8. The provider cannot prove it survives a worker restart, so it is
   * excluded from canonical production routing. Distinct from
   * `provider_disabled`: nobody turned this off, and turning anything on will
   * not change it — the integration has no proven recovery path.
   */
  | "provider_execution_not_restart_safe";

/**
 * What the router is allowed to know about the request.
 *
 * Note what is absent: there is no provider field, and no way to add one
 * without changing this type. A caller — including a browser, through any
 * number of layers — cannot name where its generation should run.
 */
export interface RouteRequest {
  cinefieldModelId: string;
  /** Pin a specific version. Omitted means "the active one". */
  modelVersion?: number;
  /**
   * Room for workspace / region / rollout context in 7-C without changing
   * every call site. Unread today; the router ignores what it does not
   * understand rather than guessing at it.
   */
  context?: Record<string, unknown>;
}
