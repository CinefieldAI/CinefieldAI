import "server-only";
import { isTemporalGenerationEnabled } from "@/lib/temporal/config";

/**
 * Cinefield generation OWNER resolution (Phase 6R-B).
 *
 * v1.6 binding rule: for one generation, Temporal is the ONLY workflow/state
 * owner — workflow state, retry, cancel coordination, signal handling and
 * finalization coordination all belong to it. SQS is the durable command
 * transport underneath. Trigger.dev is operational only: cron, health,
 * reconciliation, cleanup, audit, restore verification, cost.
 *
 * WHAT THIS MODULE USED TO DO, AND WHY IT NO LONGER DOES
 * It resolved `"direct" | "trigger"`, defaulting to `"direct"` and switching
 * to Trigger.dev when GENERATION_EXECUTION_MODE said so. Both of those were
 * generation lifecycle owners: `direct` ran executeGeneration inline in the
 * HTTP request and finalized there; `trigger` handed the whole lifecycle,
 * including its async polling continuation, to Trigger.dev. Neither is a
 * legal production owner under v1.6, so neither is production-selectable now.
 *
 * FAIL CLOSED — THE POINT OF THE WHOLE PHASE
 * When Temporal ownership is not enabled, this returns "unavailable". It does
 * NOT fall back. A fallback owner is not a resilience feature: it is how one
 * generation acquires two lifecycle owners, and two owners is how a provider
 * job gets submitted — and billed — twice. An outage that produces no
 * generation is recoverable; one that produces a duplicate charge is not.
 *
 * SERVER-CONTROLLED, ALWAYS
 * Nothing here reads a request. The browser cannot name an owner, cannot ask
 * for the dev path, and cannot influence the answer at all — the resolver
 * takes no arguments, which is the simplest possible way to guarantee that.
 */

export type GenerationOwner =
  /** Temporal GenerationWorkflow. The only legal production owner. */
  | "temporal"
  /** Inline executeGeneration. NON-PRODUCTION ONLY — see below. */
  | "direct-dev"
  /** No owner is available. The boundary must refuse, never substitute one. */
  | "unavailable";

/**
 * The local-development escape hatch, and only that.
 *
 * Two independent conditions, both required:
 *   - NODE_ENV is not "production" — a deployed build cannot reach this path
 *     even if someone sets the flag on it
 *   - GENERATION_DIRECT_DEV_EXECUTION is exactly "true"
 *
 * It exists so a developer with no Temporal namespace can still exercise the
 * orchestration core against mock models. It is not a fallback: the resolver
 * below never reaches for it because Temporal failed, only because Temporal
 * was never enabled in a non-production environment.
 */
export function isDirectDevExecutionAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.GENERATION_DIRECT_DEV_EXECUTION === "true"
  );
}

/**
 * Resolves who owns a generation's lifecycle in this deployment.
 *
 * Deliberately argument-free: an owner is a property of the deployment, never
 * of a request.
 */
export function resolveGenerationOwner(): GenerationOwner {
  if (isTemporalGenerationEnabled()) return "temporal";
  if (isDirectDevExecutionAllowed()) return "direct-dev";
  return "unavailable";
}

/**
 * Safe description for health endpoints and logs: the owner name only. No
 * address, namespace, key presence, or any other configuration detail.
 */
export function describeGenerationOwner(): { owner: GenerationOwner } {
  return { owner: resolveGenerationOwner() };
}
