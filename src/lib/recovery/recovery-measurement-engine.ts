import type { RestoreValidationState } from "@/lib/dr/restore-evidence-contract";
import {
  requiresRestoreValidation,
  resolveRpoTargetSeconds,
  resolveRtoTargetMs,
  type RpoRegistry,
  type RtoRegistry,
} from "./recovery-target-registry";
import type { RecoveryEvidence, RecoveryIncidentEvidence, RecoveryResultState } from "./recovery-contract";

/**
 * The recovery measurement engine (Phase 15-D/2).
 *
 * ---------------------------------------------------------------------------
 * PURE, DETERMINISTIC ARITHMETIC — `now` IS ALWAYS AN INPUT
 * ---------------------------------------------------------------------------
 * This function never calls `Date.now()` or `new Date()` internally. Every
 * timestamp it reasons about, including the evaluation instant stamped onto
 * the result, is either part of the incident evidence or the caller-supplied
 * `now`. Given the same input twice, it returns byte-identical output.
 *
 * ---------------------------------------------------------------------------
 * CALL ORDER IS THE SAFETY PROPERTY
 * ---------------------------------------------------------------------------
 * Mirrors `restore-verification-engine.ts` and
 * `dlq-redrive-decision-engine.ts`: the order below IS the fail-closed
 * guarantee.
 *
 *   1. startedAt missing/unparseable                -> INVALID_EVIDENCE
 *   2. any other provided timestamp unparseable      -> INVALID_EVIDENCE
 *   3. timestamps out of order                       -> INVALID_EVIDENCE
 *   4. observedDataLossSeconds present but malformed -> INVALID_EVIDENCE
 *   5. serviceRestoredAt absent                      -> RECOVERY_INCOMPLETE
 *   6. validation required, state unknown            -> EVIDENCE_UNAVAILABLE
 *   7. validation required, state != PASSED           -> RECOVERY_INCOMPLETE
 *   8. compute durations, RTO/RPO evaluation, combine -> the remaining three states
 *
 * Step 8's combining rule: a PROVEN breach on either axis (RTO or RPO)
 * always wins over a met target on the other axis — `RECOVERED_OUTSIDE_TARGET`
 * is never hidden behind a "within target" headline the way
 * `runRestoreValidation`'s MISMATCH already outranks MATCH. Absent both
 * targets, `RECOVERED_NO_TARGET` — never silently `RECOVERED_WITHIN_TARGET`.
 */

export interface MeasureRecoveryInput {
  readonly incident: RecoveryIncidentEvidence;
  /** The evaluation instant. Never derived internally — see the header above. */
  readonly now: Date;
  readonly rtoRegistry?: RtoRegistry;
  readonly rpoRegistry?: RpoRegistry;
  /** `undefined`/`null` when no observation exists. Never fabricated as 0. */
  readonly observedDataLossSeconds?: number | null;
  /**
   * Phase 15-C's own `RestoreValidationState`, already computed by
   * `runRestoreValidation` — this engine consumes it, it does not recompute
   * row-count/checksum/referential-integrity logic. `undefined` means the
   * caller could not obtain a validation state at all (distinct from a
   * validation state that was obtained and says something other than
   * PASSED). Ignored entirely for a `recoveryClass` that does not require
   * restore validation.
   */
  readonly restoreValidationState?: RestoreValidationState;
}

/** `undefined` = absent, `null` = present but unparseable, number = valid epoch ms. */
function parseIso(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function measureRecovery(input: MeasureRecoveryInput): RecoveryEvidence {
  const { incident } = input;

  const finish = (
    result: RecoveryResultState,
    reasonCode: string,
    extra: Partial<RecoveryEvidence> = {}
  ): RecoveryEvidence => ({
    incidentId: incident.incidentId,
    correlationId: incident.correlationId,
    recoveryClass: incident.recoveryClass,
    affectedComponent: incident.affectedComponent,
    result,
    reasonCode,
    evaluatedAt: input.now.toISOString(),
    ...extra,
  });

  // ---- 1/2. Every provided timestamp must parse ---------------------------
  const startedMs = parseIso(incident.startedAt);
  if (startedMs === undefined || startedMs === null) {
    return finish("INVALID_EVIDENCE", "started_at_unparseable");
  }
  const recoveryStartedMs = parseIso(incident.recoveryStartedAt);
  if (recoveryStartedMs === null) {
    return finish("INVALID_EVIDENCE", "recovery_started_at_unparseable");
  }
  const serviceRestoredMs = parseIso(incident.serviceRestoredAt);
  if (serviceRestoredMs === null) {
    return finish("INVALID_EVIDENCE", "service_restored_at_unparseable");
  }
  const validationCompletedMs = parseIso(incident.validationCompletedAt);
  if (validationCompletedMs === null) {
    return finish("INVALID_EVIDENCE", "validation_completed_at_unparseable");
  }

  // ---- 3. Chronological order among whichever timestamps are present ------
  const ordered = [startedMs, recoveryStartedMs, serviceRestoredMs, validationCompletedMs].filter(
    (v): v is number => v !== undefined
  );
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i] < ordered[i - 1]) {
      return finish("INVALID_EVIDENCE", "timestamp_order_invalid");
    }
  }

  // ---- 4. Any supplied data-loss observation must be a real, non-negative,
  // finite number. Absent (undefined/null) is fine and handled later; a
  // NUMBER that is NaN, negative or infinite is malformed EVIDENCE, not an
  // absent one, and must never be coerced into 0. ---------------------------
  const rawLoss = input.observedDataLossSeconds;
  if (
    rawLoss !== undefined &&
    rawLoss !== null &&
    (typeof rawLoss !== "number" || Number.isNaN(rawLoss) || !Number.isFinite(rawLoss) || rawLoss < 0)
  ) {
    return finish("INVALID_EVIDENCE", "observed_data_loss_malformed");
  }

  // ---- 5. Not yet restored --------------------------------------------------
  if (serviceRestoredMs === undefined) {
    return finish("RECOVERY_INCOMPLETE", "service_not_yet_restored");
  }

  // ---- 6/7. Required validation gate (Phase 15-C reuse, never re-derived) --
  if (requiresRestoreValidation(incident.recoveryClass)) {
    if (input.restoreValidationState === undefined) {
      return finish("EVIDENCE_UNAVAILABLE", "restore_validation_evidence_unavailable");
    }
    if (input.restoreValidationState !== "VALIDATION_PASSED") {
      return finish("RECOVERY_INCOMPLETE", `restore_validation_not_passed:${input.restoreValidationState}`);
    }
  }

  // ---- 8. Durations and target evaluation ----------------------------------
  const recoveryDurationMs = serviceRestoredMs - startedMs;
  const validationDurationMs =
    validationCompletedMs !== undefined ? validationCompletedMs - serviceRestoredMs : undefined;
  if (recoveryDurationMs < 0 || (validationDurationMs !== undefined && validationDurationMs < 0)) {
    // Unreachable given the ordering check above; defensive rather than
    // trusting the earlier check to be the only guard against a negative
    // duration ever surfacing.
    return finish("INVALID_EVIDENCE", "computed_duration_negative");
  }

  const targetRtoMs = resolveRtoTargetMs(incident.recoveryClass, input.rtoRegistry);
  const rtoMet = targetRtoMs !== null ? recoveryDurationMs <= targetRtoMs : undefined;

  const targetRpoSeconds = resolveRpoTargetSeconds(incident.affectedComponent, input.rpoRegistry);
  const observedDataLossSeconds = rawLoss === null ? undefined : rawLoss;
  const rpoMet =
    targetRpoSeconds !== null && observedDataLossSeconds !== undefined
      ? observedDataLossSeconds <= targetRpoSeconds
      : undefined;

  const computed: Partial<RecoveryEvidence> = {
    recoveryDurationMs,
    validationDurationMs,
    targetRtoMs: targetRtoMs ?? undefined,
    rtoMet,
    observedDataLossSeconds,
    targetRpoSeconds: targetRpoSeconds ?? undefined,
    rpoMet,
  };

  if (rtoMet === false && rpoMet === false) {
    return finish("RECOVERED_OUTSIDE_TARGET", "rto_and_rpo_breached", computed);
  }
  if (rtoMet === false) {
    return finish("RECOVERED_OUTSIDE_TARGET", "rto_breached", computed);
  }
  if (rpoMet === false) {
    return finish("RECOVERED_OUTSIDE_TARGET", "rpo_breached", computed);
  }
  if (rtoMet === true || rpoMet === true) {
    return finish("RECOVERED_WITHIN_TARGET", "recovery_within_target", computed);
  }
  return finish("RECOVERED_NO_TARGET", "no_target_configured", computed);
}
