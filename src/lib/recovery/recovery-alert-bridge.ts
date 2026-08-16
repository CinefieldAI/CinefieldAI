import { raiseAlert, resolveAlert, type RaiseResult } from "@/lib/alerts/alert-router";
import type { RecoveryEvidence } from "./recovery-contract";

/**
 * Recovery evidence -> the existing Central Alert Router (Phase 15-D/2 -> 13-D).
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT AN ALERT ROUTER
 * ---------------------------------------------------------------------------
 * No dedupe state, no severity table, no channel logic, no delivery. It
 * picks WHICH catalogued type applies and hands a candidate to `raiseAlert`
 * — the same 13-D router every other producer uses. Severity is set once,
 * in `alert-contract.ts`'s catalogue; this file cannot make it louder.
 *
 * ---------------------------------------------------------------------------
 * ONLY A PROVEN BREACH, OR PROVEN MISSING REQUIRED EVIDENCE, ALERTS
 * ---------------------------------------------------------------------------
 * `RECOVERED_NO_TARGET` raises nothing — an absent business-approved target
 * is an ordinary, expected, non-alerting state, not an incident. So does
 * `RECOVERY_INCOMPLETE` and `INVALID_EVIDENCE` — the first is "not finished
 * yet", not a breach, and the second is a caller bug, not an operational
 * signal a human should be paged for at 3am for the same reason. Only
 * `RECOVERED_OUTSIDE_TARGET` (a PROVEN RTO or RPO breach) and
 * `EVIDENCE_UNAVAILABLE` (required Phase 15-C evidence proven unobtainable
 * for an actively-measured recovery) raise anything.
 *
 * A positively-known `RECOVERED_WITHIN_TARGET` resolves any standing alert
 * for this component; every other state changes nothing, because going
 * uncertain must not look like recovery.
 */
export function alertOnRecoveryEvidence(evidence: RecoveryEvidence): RaiseResult[] {
  const resource = evidence.affectedComponent;
  const shared = {
    resource,
    reasonCode: evidence.reasonCode,
    ...(evidence.correlationId ? { traceId: evidence.correlationId } : {}),
  };

  if (evidence.result === "RECOVERED_OUTSIDE_TARGET") {
    const raised: RaiseResult[] = [];
    if (evidence.rtoMet === false) {
      raised.push(raiseAlert({ type: "recovery_rto_breached", ...shared }));
    }
    if (evidence.rpoMet === false) {
      raised.push(raiseAlert({ type: "recovery_rpo_breached", ...shared }));
    }
    return raised;
  }

  if (evidence.result === "EVIDENCE_UNAVAILABLE") {
    return [raiseAlert({ type: "recovery_evidence_unavailable", ...shared })];
  }

  if (evidence.result === "RECOVERED_WITHIN_TARGET") {
    resolveAlert("recovery_rto_breached", resource);
    resolveAlert("recovery_rpo_breached", resource);
    resolveAlert("recovery_evidence_unavailable", resource);
  }

  return [];
}
