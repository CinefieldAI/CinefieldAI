import { raiseAlert, resolveAlert, type RaiseResult } from "@/lib/alerts/alert-router";
import type { SloSnapshot } from "./slo-snapshot";

/**
 * SLO breach → existing Central Alert Router (Phase 15-A → Phase 13-D).
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT AN ALERT ROUTER
 * ---------------------------------------------------------------------------
 * It has no dedupe state, no severity table, no channel logic, no escalation
 * ladder and no delivery. It converts a snapshot into a candidate and hands it
 * to `raiseAlert` — the same 13-D router every other producer uses. Dedupe,
 * suppression, escalation and routing all remain 13-D's, so an SLO breach that
 * repeats behaves like every other repeated alert instead of inventing its own
 * storm behaviour.
 *
 * Severity is NOT decided here either: `slo_budget_low` is WARNING and
 * `slo_budget_exhausted` is ERROR in 13-D's catalogue, which is the only place
 * severity is ever set. This file chooses WHICH catalogued type applies; it
 * cannot make one louder.
 *
 * ---------------------------------------------------------------------------
 * WHAT CROSSES, AND WHAT CANNOT
 * ---------------------------------------------------------------------------
 * The candidate carries the SLI id, a short reason code and a burn-rate
 * bucket. It carries no counts of individual rows, no error text, no provider
 * response, no user, workspace, generation or request id — a snapshot has no
 * field for any of those (see `slo-snapshot.ts`), so there is nothing to leak
 * even if this file were careless. 13-E's guard applies on top.
 */

/**
 * Raises an alert for a breached or at-risk objective, or clears a recovered
 * one. Returns null when the snapshot warrants no alert at all.
 *
 * HEALTHY resolves any open alert for the same SLI, so recovery clears the
 * dedupe entry and a relapse alerts immediately rather than being swallowed
 * by the window of an incident that already ended — the same recovery
 * semantics the health producer uses.
 *
 * INSUFFICIENT_DATA and UNAVAILABLE deliberately raise NOTHING and clear
 * NOTHING. "We could not measure" is not evidence of a breach, and it is
 * certainly not evidence of recovery; treating it as either would make the
 * alert stream lie in one direction or the other. Those states are visible in
 * the snapshot itself, which is where an operator should read them.
 */
export function alertOnSloSnapshot(snapshot: SloSnapshot): RaiseResult | null {
  // The SLI id is the alert resource: a bounded catalogue value, which is what
  // keeps the dedupe key (and therefore any downstream label) bounded too.
  const resource = snapshot.sliId;

  if (snapshot.state === "HEALTHY") {
    resolveAlert("slo_budget_low", resource);
    resolveAlert("slo_budget_exhausted", resource);
    return null;
  }

  if (snapshot.state === "BREACHED") {
    return raiseAlert({
      type: "slo_budget_exhausted",
      resource,
      reasonCode: snapshot.reasonCode,
    });
  }

  if (snapshot.state === "AT_RISK") {
    return raiseAlert({
      type: "slo_budget_low",
      resource,
      reasonCode: snapshot.reasonCode,
    });
  }

  // INSUFFICIENT_DATA / UNAVAILABLE — see the note above.
  return null;
}
