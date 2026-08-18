import { raiseAlert, resolveAlert, type RaiseResult } from "@/lib/alerts/alert-router";
import type { DriftReport } from "./drift-report-contract";

/**
 * Drift report -> the existing Central Alert Router (18-D -> 13-D).
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT AN ALERT ROUTER
 * ---------------------------------------------------------------------------
 * No dedupe state, no severity table, no channel logic, no escalation
 * ladder, no delivery. It picks which catalogued type applies and hands a
 * candidate to `raiseAlert` — the same 13-D router every other producer
 * uses. Severity is set once, in `alert-contract.ts`'s catalogue; this file
 * cannot make it louder.
 *
 * ---------------------------------------------------------------------------
 * A TOOL FAILURE IS NEVER "NO DRIFT"
 * ---------------------------------------------------------------------------
 * UNAVAILABLE raises `infra_drift_check_unavailable` — WARNING, distinct
 * from a proven-clean plan — rather than being silently dropped or, worse,
 * treated as though nothing was wrong. The one thing this bridge must never
 * do is let a broken checker report the same outcome as a clean one.
 *
 * A positively-known NO_DRIFT resolves a standing drift alert for that
 * environment; UNAVAILABLE does NOT resolve anything, because going
 * uncertain must not look like recovery — the same rule dr-alert-bridge.ts
 * already follows for restore evidence.
 */

function resourceFor(environment: string): string {
  return `infra_${environment}`;
}

export function alertOnDriftReport(report: DriftReport): RaiseResult | null {
  const resource = resourceFor(report.environment);

  if (report.status === "DRIFT_DETECTED") {
    return raiseAlert({
      type: "infra_drift_detected",
      resource,
      reasonCode: report.reasonCode,
    });
  }

  if (report.status === "UNAVAILABLE") {
    return raiseAlert({
      type: "infra_drift_check_unavailable",
      resource,
      reasonCode: report.reasonCode,
    });
  }

  // NO_DRIFT: a proven-clean plan resolves any standing drift alert for
  // this environment. It does not resolve infra_drift_check_unavailable —
  // a clean plan this run says nothing about whether an earlier run's
  // tooling problem has actually been fixed.
  resolveAlert("infra_drift_detected", resource);
  return null;
}
