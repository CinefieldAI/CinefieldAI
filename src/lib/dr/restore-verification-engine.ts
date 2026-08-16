import { assertRestoreSafeEnvironment } from "./restore-isolation-guard";
import { validateRowCounts } from "./restore-row-count-validator";
import { validateChecksums } from "./restore-checksum-validator";
import { validateReferentialIntegrity } from "./restore-referential-integrity-validator";
import type {
  ChecksumItem,
  RestoreEvidence,
  RowCountItem,
} from "./restore-evidence-contract";
import type { RestoreEvidenceSource } from "./restore-target";

/**
 * The restore-verification orchestrator (Phase 15-C/1).
 *
 * This is the ONLY function in the package that decides the overall
 * `RestoreValidationState`. Every rule below exists to keep one promise:
 * `VALIDATION_PASSED` is reachable ONLY when every check that ran agreed,
 * and no check is ever skipped in a way that looks like agreement.
 *
 * ---------------------------------------------------------------------------
 * CALL ORDER IS THE SAFETY PROPERTY
 * ---------------------------------------------------------------------------
 *   1. no source at all                      -> NOT_CONFIGURED, stop
 *   2. environment declared unsafe            -> UNAVAILABLE, stop (NO reads happen)
 *   3. isRestoreReady() is false or throws    -> RESTORE_NOT_READY, stop
 *   4. run all three validations
 *   5. any PROVEN mismatch/invalid            -> VALIDATION_FAILED
 *   6. else any check UNAVAILABLE             -> UNAVAILABLE
 *   7. else                                   -> VALIDATION_PASSED
 *
 * Step 2 running before step 3 is deliberate and load-bearing: it means a
 * target declared `"production"` or `"unknown"` never has a single method
 * called on it, including the merely-informational `isRestoreReady()` — the
 * refusal is total, not "safe except for one read".
 */
export interface RunRestoreValidationInput {
  readonly source: RestoreEvidenceSource | null;
  readonly expectedRowCounts: readonly RowCountItem[];
  readonly expectedChecksums: readonly ChecksumItem[];
  readonly startedAt: Date;
}

export async function runRestoreValidation(input: RunRestoreValidationInput): Promise<RestoreEvidence> {
  const finish = (
    state: RestoreEvidence["state"],
    reasonCode: string,
    extra: Partial<RestoreEvidence> = {}
  ): RestoreEvidence => ({
    state,
    reasonCode,
    evaluatedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - input.startedAt.getTime()),
    ...extra,
  });

  const { source } = input;
  if (!source) {
    return finish("NOT_CONFIGURED", "restore_target_not_configured");
  }

  const isolation = assertRestoreSafeEnvironment(source.environment);
  if (!isolation.safe) {
    // No source method has been called yet. The refusal is the entire
    // response.
    return finish("UNAVAILABLE", isolation.reasonCode, {
      restoreId: source.restoreId,
      backupId: source.backupId,
      environmentClass: source.environment.environmentClass,
    });
  }

  let ready: boolean;
  try {
    ready = await source.isRestoreReady();
  } catch {
    ready = false;
  }
  if (!ready) {
    return finish("RESTORE_NOT_READY", "restore_not_ready", {
      restoreId: source.restoreId,
      backupId: source.backupId,
      environmentClass: source.environment.environmentClass,
    });
  }

  const [rowCount, checksum, referentialIntegrity] = await Promise.all([
    validateRowCounts(source, input.expectedRowCounts),
    validateChecksums(source, input.expectedChecksums),
    validateReferentialIntegrity(source),
  ]);

  const proven =
    rowCount.overall === "MISMATCH" ||
    checksum.overall === "MISMATCH" ||
    referentialIntegrity.outcome === "INVALID";

  const uncertain =
    rowCount.overall === "UNAVAILABLE" ||
    checksum.overall === "UNAVAILABLE" ||
    referentialIntegrity.outcome === "UNAVAILABLE";

  const base: Partial<RestoreEvidence> = {
    restoreId: source.restoreId,
    backupId: source.backupId,
    environmentClass: source.environment.environmentClass,
    rowCount,
    checksum,
    referentialIntegrity,
  };

  if (proven) {
    return finish("VALIDATION_FAILED", reasonForFailure(rowCount.overall, checksum.overall, referentialIntegrity.outcome), base);
  }
  if (uncertain) {
    return finish("UNAVAILABLE", "restore_validation_incomplete", base);
  }
  return finish("VALIDATION_PASSED", "restore_validation_passed", base);
}

function reasonForFailure(
  rowCount: "MATCH" | "MISMATCH" | "UNAVAILABLE",
  checksum: "MATCH" | "MISMATCH" | "UNAVAILABLE",
  referentialIntegrity: "VALID" | "INVALID" | "UNAVAILABLE"
): string {
  // Reported in a fixed, deterministic order so the same underlying failure
  // always produces the same reason code — never "whichever Promise settled
  // last".
  if (rowCount === "MISMATCH") return "row_count_mismatch";
  if (checksum === "MISMATCH") return "checksum_mismatch";
  if (referentialIntegrity === "INVALID") return "referential_integrity_invalid";
  // Unreachable given the caller's `proven` guard, but exhaustive rather than
  // asserting.
  return "restore_validation_failed";
}
