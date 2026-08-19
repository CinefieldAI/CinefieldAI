import type { DataClassificationEntry } from "./data-classification";

/**
 * Retention policy resolver (Phase 23 corrective batch).
 *
 * The roadmap's own phase-level done-criterion — "retention süresi geçen
 * veriler temizleniyor" (data past its retention period is cleaned up) —
 * needs a REAL mechanism that decides, per data class, whether cleanup is
 * even possible today, and per row, whether it has actually expired. This
 * module is that decision layer: pure, no I/O, no Supabase — the same
 * "classifies authority only, never a second owner" discipline
 * `tier0-action-catalogue.ts` already established for a different kind of
 * classification.
 *
 * NEVER INVENTS A DURATION. Every one of the 14 real
 * `DATA_CLASSIFICATION_MATRIX` entries has `retentionDurationDays ===
 * undefined` today — none of them resolves to `DELETE`/`ANONYMIZE` as a
 * result. That is the honest, current answer: the roadmap requires a
 * mechanism to EXIST and be correct, not that this batch invent a number
 * nobody decided. `resolveClassRetention` is fully exercised behaviorally
 * against a SYNTHETIC entry in its own test file to prove the row-level
 * logic genuinely works once a real duration is ever set.
 */

export type RetentionClassVerdict =
  | { readonly action: "KEEP"; readonly reasonCode: string }
  | { readonly action: "RETAIN_IMMUTABLE"; readonly reasonCode: string }
  | { readonly action: "NOT_APPLICABLE"; readonly reasonCode: string }
  | { readonly action: "BUSINESS_DECISION_REQUIRED"; readonly reasonCode: string }
  /** A real duration IS defined — the caller must now evaluate individual rows. */
  | { readonly action: "ROW_EVALUATION_REQUIRED"; readonly durationDays: number };

/**
 * Tables whose OWN migration already contains a real `BEFORE UPDATE OR
 * DELETE` trigger, confirmed by direct inspection, not inferred from a
 * label — `security_events`, `admin_privileged_action_events`,
 * `feature_flag_audit`, `deletion_tombstones`. Cleanup is not "pending a
 * window decision" for these; it is structurally impossible today without
 * a separate, deliberate schema change these entries' own comments
 * document. `data-classification.ts`'s `deletionPolicy` already reflects
 * this (`retain_immutable`) — this set exists so the resolver's own
 * correctness does not depend solely on that field never drifting back out
 * of sync, the same "belt and suspenders" reasoning `verdictForScore`
 * (Phase 22) applies to its own threshold check.
 */
const STRUCTURALLY_APPEND_ONLY_TABLES = new Set([
  "security_events",
  "admin_privileged_action_events",
  "feature_flag_audit",
  "deletion_tombstones",
]);

export function resolveClassRetention(entry: DataClassificationEntry): RetentionClassVerdict {
  if (entry.deletionPolicy === "not_applicable") {
    return { action: "NOT_APPLICABLE", reasonCode: "no_user_identity" };
  }

  if (entry.deletionPolicy === "retain_immutable" || STRUCTURALLY_APPEND_ONLY_TABLES.has(entry.table)) {
    return {
      action: "RETAIN_IMMUTABLE",
      reasonCode: STRUCTURALLY_APPEND_ONLY_TABLES.has(entry.table) ? "append_only_schema_constraint" : "financial_or_legal_record",
    };
  }

  if (entry.retentionPolicy === "account_lifetime") {
    // Not a symbolic label needing a number — a real, already-enforced
    // policy tied to a DIFFERENT event (account deletion, Phase 23-C),
    // not to an independent age cutoff. Inventing a standalone duration
    // for these rows would create a SECOND deletion trigger alongside
    // AccountDeletionWorkflow, contradicting "one deletion package."
    return { action: "KEEP", reasonCode: "tied_to_account_lifecycle_not_independently_time_expirable" };
  }

  if (entry.retentionDurationDays === undefined) {
    return { action: "BUSINESS_DECISION_REQUIRED", reasonCode: "no_explicit_retention_duration_defined" };
  }

  return { action: "ROW_EVALUATION_REQUIRED", durationDays: entry.retentionDurationDays };
}

export interface RetentionRowInput {
  readonly createdAt: string;
  readonly legalHold?: boolean;
}

export type RetentionRowVerdict =
  | { readonly action: "KEEP"; readonly reasonCode: "not_yet_expired" }
  | { readonly action: "LEGAL_HOLD"; readonly reasonCode: "legal_hold_active" }
  | { readonly action: "NOT_CONFIGURED"; readonly reasonCode: "invalid_created_at" }
  | { readonly action: "DELETE" | "ANONYMIZE"; readonly reasonCode: "retention_window_expired"; readonly cutoffAt: string };

/**
 * Row-level eligibility, given a class already resolved to
 * `ROW_EVALUATION_REQUIRED`. `legalHold` is checked FIRST and
 * unconditionally dominates — a held row is never eligible regardless of
 * age, matching the roadmap's own exception language
 * ("legal-hold işaretli asset'ler retention dolsa bile istisna olarak
 * korunur").
 */
export function resolveRowRetention(
  row: RetentionRowInput,
  durationDays: number,
  deletionAction: "DELETE" | "ANONYMIZE",
  now: Date
): RetentionRowVerdict {
  if (row.legalHold === true) {
    return { action: "LEGAL_HOLD", reasonCode: "legal_hold_active" };
  }

  const createdAtMs = Date.parse(row.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return { action: "NOT_CONFIGURED", reasonCode: "invalid_created_at" };
  }

  const cutoffMs = now.getTime() - durationDays * 24 * 60 * 60 * 1000;
  if (createdAtMs > cutoffMs) {
    return { action: "KEEP", reasonCode: "not_yet_expired" };
  }

  return { action: deletionAction, reasonCode: "retention_window_expired", cutoffAt: new Date(cutoffMs).toISOString() };
}
