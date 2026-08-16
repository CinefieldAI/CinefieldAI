import { raiseAlert, resolveAlert, type RaiseResult } from "@/lib/alerts/alert-router";
import type { RestoreEvidence } from "./restore-evidence-contract";

/**
 * Restore-verification evidence -> the existing Central Alert Router
 * (15-C/1 -> 13-D).
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT AN ALERT ROUTER
 * ---------------------------------------------------------------------------
 * No dedupe state, no severity table, no channel logic, no escalation
 * ladder, no delivery. It picks WHICH catalogued type applies and hands a
 * candidate to `raiseAlert` — the same 13-D router every other producer uses.
 * `dr_restore_validation_failed` is ERROR in 13-D's catalogue, the only
 * place severity is ever set; this file cannot make it louder.
 *
 * ---------------------------------------------------------------------------
 * ONLY A PROVEN FAILURE ALERTS
 * ---------------------------------------------------------------------------
 * NOT_CONFIGURED, UNAVAILABLE and RESTORE_NOT_READY all raise nothing. Those
 * are the expected, ordinary state of a subsystem that has no production
 * restore target wired up yet — alerting on them would be the exact "fake
 * alert for a subsystem that cannot report" this codebase's own alert
 * catalogue explicitly refuses to create (`alert-contract.ts`'s note on DR
 * backup debt having no producer). Only `VALIDATION_FAILED` — a PROVEN
 * mismatch, not an absence of evidence — is worth paging anyone about.
 *
 * A positively-known `VALIDATION_PASSED` resolves a standing alert; every
 * other state changes nothing, because going uncertain must not look like
 * recovery.
 */

/** Bounded alert resource. Not per-restore: one subsystem, one resource slug. */
const RESTORE_VALIDATION_RESOURCE = "restore_validation";

export function alertOnRestoreEvidence(evidence: RestoreEvidence): RaiseResult | null {
  if (evidence.state === "VALIDATION_FAILED") {
    return raiseAlert({
      type: "dr_restore_validation_failed",
      resource: RESTORE_VALIDATION_RESOURCE,
      reasonCode: evidence.reasonCode,
    });
  }
  if (evidence.state === "VALIDATION_PASSED") {
    resolveAlert("dr_restore_validation_failed", RESTORE_VALIDATION_RESOURCE);
    return null;
  }
  return null;
}
