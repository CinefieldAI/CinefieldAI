import { boundInvalidConstraintSample } from "./restore-evidence-contract";
import type { ReferentialIntegrityValidation } from "./restore-evidence-contract";
import type { RestoreEvidenceSource } from "./restore-target";

/**
 * Referential-integrity validation (Phase 15-C/1).
 *
 * ---------------------------------------------------------------------------
 * POSTGRESQL IS THE AUTHORITY. THIS MODULE IS A READER OF ITS VERDICT.
 * ---------------------------------------------------------------------------
 * There is no TypeScript relationship graph here, and there must never be
 * one. Every relationship this repository has is already a `REFERENCES`
 * constraint, checked by Postgres on every write. Re-encoding "media_assets
 * references generations" as a second, hand-maintained fact in application
 * code would drift the moment a migration changed the real one — the
 * verification would keep testing what TypeScript believed the schema was,
 * not what it actually is.
 *
 * `ConstraintHealthEvidence.invalidConstraints` names constraints Postgres
 * itself marked `NOT VALID` (`pg_constraint.convalidated = false`) — a state
 * that only exists after `ADD CONSTRAINT ... NOT VALID` followed by
 * `VALIDATE CONSTRAINT` never completing, or a restore that skipped
 * validation. This function reports that verdict; it does not compute one.
 */
export async function validateReferentialIntegrity(
  source: RestoreEvidenceSource
): Promise<ReferentialIntegrityValidation> {
  let evidence: Awaited<ReturnType<RestoreEvidenceSource["getConstraintHealth"]>>;
  try {
    evidence = await source.getConstraintHealth();
  } catch {
    evidence = null;
  }

  if (!evidence) {
    return { outcome: "UNAVAILABLE", invalidConstraintSample: [] };
  }

  const invalidConstraintCount = evidence.invalidConstraints.length;
  return {
    outcome: invalidConstraintCount === 0 ? "VALID" : "INVALID",
    totalForeignKeys: evidence.totalForeignKeys,
    invalidConstraintCount,
    invalidConstraintSample: boundInvalidConstraintSample(evidence.invalidConstraints),
  };
}
