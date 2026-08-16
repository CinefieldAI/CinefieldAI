import type { ReadinessReport } from "@/lib/health/health-contract";

/**
 * Phase 13 health reuse (Phase 15-D/2).
 *
 * Recovery measurement needs to know "has this runtime come back", and
 * Phase 13's `rollUp()` already answers exactly that question — this file
 * does not redefine `HealthStatus`, does not re-derive readiness from
 * dependency reports, and does not track transitions itself (that state
 * belongs to `alert-sources.ts`'s own `lastStatus` map and stays there).
 *
 * `DEGRADED` is deliberately NOT treated as recovered: Phase 13's own
 * contract already means "still ready, but not fully healthy" by that
 * status, and a recovery that lands in a permanently degraded state has not
 * finished — treating it as recovered here would contradict what
 * `rollUp()` itself decided.
 *
 * WIRING NOTE
 * This is a pure predicate over an already-obtained `ReadinessReport`. It
 * does not poll anything itself. A future caller stamps
 * `RecoveryIncidentEvidence.serviceRestoredAt` at the moment a fresh
 * `ReadinessReport` first makes this return `true` — that wiring is not
 * built in this batch, the same way Phase 15-C/1 shipped
 * `RestoreEvidenceSource` with no adapter.
 */
export function isRuntimeConsideredRecovered(report: ReadinessReport): boolean {
  return report.status === "HEALTHY";
}
