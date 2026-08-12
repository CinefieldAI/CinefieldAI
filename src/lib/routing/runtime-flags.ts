/**
 * Runtime routing controls — the consumer contract (Phase 7-E).
 *
 * THE QUESTION THIS ANSWERS
 * Can an operator stop traffic to a model, a provider, a provider endpoint or
 * a single route RIGHT NOW, without a deploy and without touching browser
 * code? Durable configuration in PostgreSQL is the permanent answer; this is
 * the immediate one.
 *
 * WHAT IT IS NOT
 * Not Phase 21. There is no governance here: no approval workflow, no flag
 * registry, no expiry policy, no canary percentages, no SLO rollback, no
 * experimentation, and no MCP or AI-agent write path. This is the router
 * reading a small set of operational switches, nothing more.
 *
 * TIGHTEN ONLY, NEVER LOOSEN
 * A runtime control can take a route OUT of rotation. It cannot put one back
 * in. Effective availability is
 *
 *     durable_enabled AND NOT runtime_disabled
 *
 * so a route disabled in PostgreSQL stays disabled no matter what any flag
 * says. That asymmetry is the whole safety story: the fast path can only ever
 * reduce what is reachable, so a compromised, misconfigured or simply
 * unavailable flag source can never widen production's blast radius.
 *
 * SEPARATE FROM THE CIRCUIT BREAKER, ON PURPOSE. They answer different
 * questions and must stay distinguishable in types, storage, explanation and
 * tests: a breaker says "this route has been failing", a runtime control says
 * "a person decided this route must not be used". Merging them would make an
 * operator's deliberate decision look like an automatic one, and make an
 * outage look like a policy.
 *
 * Pure. Storage lives in routing-control-store.ts.
 */

export type FlagTargetKind = "model" | "provider" | "provider-model" | "route";

export interface FlagTarget {
  kind: FlagTargetKind;
  /**
   * The entity's identifier. Never a prompt, never a user, never a secret —
   * see the context rules below.
   */
  id: string;
}

/** Why a control exists. Operational vocabulary, not free text. */
export type ControlReason =
  /** Routine operational disable. */
  | "disabled"
  /** Emergency stop: get traffic off this target now. */
  | "emergency_kill";

export interface RuntimeControl {
  kind: FlagTargetKind;
  targetId: string;
  reason: ControlReason;
  /** ISO-8601. When the control was set. */
  setAt: string;
  /** Short operator note. Free text, but never secret-bearing. */
  note?: string;
}

/** Where an evaluation's answer came from. Recorded in the decision. */
export type ControlSource =
  /** No runtime override; PostgreSQL configuration governs. */
  | "database_baseline"
  /** A live runtime control was read. */
  | "runtime_flag"
  /** A control served from a bounded local cache. */
  | "cached_runtime_flag"
  /** The source could not be reached. Baseline governs; see the policy below. */
  | "unavailable";

export interface RuntimeControlSnapshot {
  /** Keyed by `${kind}:${id}`. Absent means no control on that target. */
  controls: ReadonlyMap<string, RuntimeControl>;
  source: ControlSource;
}

export function controlKeyFor(kind: FlagTargetKind, id: string): string {
  return `${kind}:${id}`;
}

/** An empty snapshot: nothing is runtime-disabled, and we know it. */
export function emptySnapshot(source: ControlSource = "database_baseline"): RuntimeControlSnapshot {
  return { controls: new Map(), source };
}

/** What the router needs to check for one candidate route. */
export interface RouteControlTargets {
  cinefieldModelId: string;
  providerId: string;
  providerModelId: string;
  routeId: string;
}

/**
 * Every target that governs one route, most specific first.
 *
 * Order matters only for reporting — a route disabled at both the provider
 * and the route level should report the route, the narrower fact. Exclusion
 * itself is a plain OR: any control on any level takes the route out.
 */
export function targetsForRoute(route: RouteControlTargets): FlagTarget[] {
  return [
    { kind: "route", id: route.routeId },
    { kind: "provider-model", id: route.providerModelId },
    { kind: "provider", id: route.providerId },
    { kind: "model", id: route.cinefieldModelId },
  ];
}

export interface RuntimeExclusion {
  control: RuntimeControl;
  /** The level that produced the exclusion. */
  matchedTarget: FlagTarget;
}

/**
 * Does any runtime control exclude this route?
 *
 * A control on a PROVIDER excludes every route through it, which is what
 * makes "stop sending anything to fal" a single action rather than an
 * operator editing rows one at a time during an incident.
 */
export function findRuntimeExclusion(
  route: RouteControlTargets,
  snapshot: RuntimeControlSnapshot
): RuntimeExclusion | null {
  for (const target of targetsForRoute(route)) {
    const control = snapshot.controls.get(controlKeyFor(target.kind, target.id));
    if (control) return { control, matchedTarget: target };
  }
  return null;
}

/**
 * How a control turns into a rejection reason.
 *
 * Two reasons rather than one so the decision record distinguishes a planned
 * disable from an emergency stop. During an incident, "who turned this off
 * and was it on purpose" is the first question asked.
 */
export function rejectionForControl(control: RuntimeControl): "runtime_disabled" | "emergency_kill" {
  return control.reason === "emergency_kill" ? "emergency_kill" : "runtime_disabled";
}

/**
 * The source of runtime controls.
 *
 * An interface, so a real OpenFeature or LaunchDarkly client can be attached
 * later without the router changing at all. No SDK is installed today and no
 * credentials are invented; the shipped implementation reads Redis A, which
 * is a real operable mechanism rather than a placeholder.
 */
export interface RuntimeFlagSource {
  /**
   * Reads controls for the given targets.
   *
   * MUST NOT THROW. An unreachable source returns
   * `{ controls: empty, source: "unavailable" }`, which leaves the durable
   * PostgreSQL configuration in charge — see the availability policy in
   * routing-control-store.ts.
   */
  read(targets: readonly FlagTarget[]): Promise<RuntimeControlSnapshot>;
}

/**
 * The no-op source, used when no runtime control backend is configured.
 *
 * Returns "database_baseline", not "unavailable": nothing is wrong, there is
 * simply no override layer, and the difference matters in the decision record.
 */
export const NO_RUNTIME_FLAG_SOURCE: RuntimeFlagSource = {
  async read(): Promise<RuntimeControlSnapshot> {
    return emptySnapshot("database_baseline");
  },
};
