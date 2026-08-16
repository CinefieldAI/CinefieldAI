import type { RestoreEnvironmentIdentity } from "./restore-evidence-contract";
import { isValidEnvironmentLabel } from "./restore-evidence-contract";

/**
 * Restore-target safety gate (Phase 15-C/1).
 *
 * ---------------------------------------------------------------------------
 * IDENTITY IS DECLARED, NEVER INFERRED
 * ---------------------------------------------------------------------------
 * This function takes an `environmentClass` the CALLER asserted and checks it
 * against a closed allow-list. It does not read `NODE_ENV`, does not parse a
 * hostname, does not guess from a database name. Inference is exactly how a
 * validator ends up "helpfully" treating an unrecognised target as safe: the
 * hostname didn't look like production, so it must be fine. A declaration
 * that defaults to unsafe when absent cannot make that mistake, because there
 * is no default — `"unknown"` is a value the caller must have written
 * deliberately, and it is never treated as safe.
 *
 * ---------------------------------------------------------------------------
 * "production" IS REJECTED BY NAME, NOT BY EXCLUSION
 * ---------------------------------------------------------------------------
 * `RestoreEnvironmentClass` includes `"production"` as a real value rather
 * than omitting it, so a caller that mistakenly points this engine at the
 * live database gets a named, loud refusal — `environment_declared_production`
 * — instead of falling through an exhaustiveness gap into "unrecognised,
 * therefore unknown, therefore also refused, but for the wrong reason".
 */

export type IsolationRefusalReason =
  | "environment_declared_production"
  | "environment_class_unrecognised"
  | "environment_label_invalid";

export interface IsolationCheck {
  readonly safe: boolean;
  readonly reasonCode: string;
}

const SAFE_CLASSES = new Set(["isolated_throwaway", "isolated_staging"]);

/**
 * The one function every restore-validation entry point must call before
 * touching a `RestoreEvidenceSource`. See `restore-verification-engine.ts`
 * for where this sits in the call order — it runs BEFORE `isRestoreReady()`
 * or any read, so a rejected environment never causes a single query.
 */
export function assertRestoreSafeEnvironment(identity: RestoreEnvironmentIdentity): IsolationCheck {
  if (identity.environmentClass === "production") {
    return { safe: false, reasonCode: "environment_declared_production" };
  }
  if (!SAFE_CLASSES.has(identity.environmentClass)) {
    // Covers "unknown" and anything a future enum member might add. Ambiguity
    // refuses by the same path as an explicit rejection — there is no third
    // outcome.
    return { safe: false, reasonCode: "environment_class_unrecognised" };
  }
  if (!isValidEnvironmentLabel(identity.label)) {
    // A malformed label is itself suspicious: a real throwaway harness names
    // itself with a short bounded string, not something that fails the
    // pattern a connection string or a stray secret might also fail.
    return { safe: false, reasonCode: "environment_label_invalid" };
  }
  return { safe: true, reasonCode: "environment_isolated" };
}
