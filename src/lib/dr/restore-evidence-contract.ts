/**
 * Restore-verification evidence contract (Phase 15-C/1).
 *
 * Pure types plus the one piece of durable domain knowledge this batch adds:
 * which tables are restore-significant. No I/O, no clock, no database.
 *
 * ---------------------------------------------------------------------------
 * THE PRINCIPLE THIS WHOLE PACKAGE EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 *   BACKUP_EXISTS       != RESTORE_SUCCEEDED
 *   RESTORE_STARTED      != RESTORE_VALIDATED
 *
 * A backup existing (Phase 9-D's `backup_status = 'backed_up'`) says bytes
 * were written to S3 and S3 answered a HeadObject. It says nothing about
 * whether those bytes, or a database restored from a PITR snapshot, would
 * actually reconstitute a working Cinefield. Only a validated restore does —
 * and "started" is not "validated" for the same reason "backed up" is not
 * "restorable": a process completing without error is not proof of outcome.
 */

/**
 * The five states a restore-verification pass can conclude with.
 *
 * Ordered here from "we cannot even attempt this" to "proven correct". Only
 * `VALIDATION_PASSED` is ever produced when every check ran and every check
 * agreed — nothing upgrades to it by omission.
 */
export type RestoreValidationState =
  /** No restore target is wired up at all. Not a failure — an unbuilt path. */
  | "NOT_CONFIGURED"
  /** A target is configured but could not be read (query failed, timed out). */
  | "UNAVAILABLE"
  /** The target answered, but the restore itself has not finished. */
  | "RESTORE_NOT_READY"
  /** The restore is ready and at least one check found a proven mismatch. */
  | "VALIDATION_FAILED"
  /** The restore is ready and every check that ran agreed. */
  | "VALIDATION_PASSED";

/**
 * What kind of Postgres instance a `RestoreEvidenceSource` claims to be.
 *
 * This is a DECLARATION, not an inference. Nothing in this package derives it
 * from `NODE_ENV`, a hostname pattern, or any other guess — see
 * `restore-isolation-guard.ts` for why guessing is exactly the failure mode
 * this type exists to prevent.
 */
export type RestoreEnvironmentClass =
  /** The disposable, Docker-based harness `supabase/tests/run_pg_tests.sh` already uses. */
  | "isolated_throwaway"
  /** A future dedicated staging project, never serving application traffic. */
  | "isolated_staging"
  /** The live application database. Never a valid validation target. */
  | "production"
  /** Not declared, or declared in a shape this module does not recognise. */
  | "unknown";

/** Bounded, human-readable label. Never a connection string, host, or credential. */
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;

export function isValidEnvironmentLabel(label: string): boolean {
  return typeof label === "string" && LABEL_PATTERN.test(label);
}

export interface RestoreEnvironmentIdentity {
  readonly environmentClass: RestoreEnvironmentClass;
  /** e.g. "docker-pg-test". Never a connection string, host, or credential. */
  readonly label: string;
}

/**
 * Durable tables eligible for row-count comparison, and why each qualifies.
 *
 * ---------------------------------------------------------------------------
 * NOT EVERY TABLE BELONGS HERE
 * ---------------------------------------------------------------------------
 * Excluded deliberately: `outbox_events` and `workflow_start_outbox`, whose
 * own migrations document that rows "may still be deleted by a future
 * retention/archival job" and that abandoned rows were explicitly RETIRED
 * (`20260818010000_retire_historical_start_intents.sql`) — a restore taken
 * before or after a purge legitimately has a different count, so comparing
 * them would flag healthy behaviour as corruption. `outbox_tx_proof` and
 * `credit_reservations` are the same shape: transient claim/lease state, not
 * durable record.
 */
export type DurableTable =
  | "generations"
  | "generation_attempts"
  | "profiles"
  | "projects"
  | "credit_wallets"
  | "credit_ledger"
  | "media_assets"
  | "models"
  | "providers"
  | "provider_models"
  | "model_versions"
  | "model_pricing"
  | "plan_limits"
  | "security_events"
  | "media_safety_audit"
  | "media_release_approvals";

export interface DurableTableEntry {
  readonly table: DurableTable;
  readonly why: string;
}

export const DURABLE_TABLES: readonly DurableTableEntry[] = [
  { table: "generations", why: "The user-visible record of every request. Never purged." },
  { table: "generation_attempts", why: "Provider-call evidence; billing-adjacent, never purged." },
  { table: "profiles", why: "Account identity. Losing rows here is losing users." },
  { table: "projects", why: "Ownership grouping for generations. Never purged." },
  { table: "credit_wallets", why: "Phase 10 economic truth. A miscount here is a financial defect." },
  { table: "credit_ledger", why: "Append-only economic history. Never purged, never mutated." },
  { table: "media_assets", why: "Storage-location and provenance record for every stored object." },
  { table: "models", why: "Catalogue of orchestratable models. Small, static, durable." },
  { table: "providers", why: "Catalogue of provider identities. Small, static, durable." },
  { table: "provider_models", why: "Provider-side identity mapping. Phase 7 routing depends on it." },
  { table: "model_versions", why: "Version history backing Phase 7 routing. Never purged." },
  { table: "model_pricing", why: "Phase 15-B's own cost truth. A missing row silently changes budgets." },
  { table: "plan_limits", why: "Billing-plan configuration. Small, static, durable." },
  { table: "security_events", why: "Phase 12 evidence trail. Losing rows is losing an audit trail." },
  { table: "media_safety_audit", why: "Moderation evidence. Compliance-adjacent, never purged." },
  { table: "media_release_approvals", why: "Human approval record. Never purged, append-only." },
];

const DURABLE_TABLE_SET = new Set<string>(DURABLE_TABLES.map((e) => e.table));

export function isDurableTable(table: string): table is DurableTable {
  return DURABLE_TABLE_SET.has(table);
}

/** Per-table row-count outcome. Counts only — never a row, never a diff of contents. */
export interface RowCountItem {
  readonly table: DurableTable;
  readonly rowCount: number;
}

export type RowCountOutcome = "MATCH" | "MISMATCH" | "UNAVAILABLE";

export interface RowCountItemResult {
  readonly table: DurableTable;
  readonly outcome: RowCountOutcome;
  readonly expected?: number;
  readonly actual?: number;
}

export interface RowCountValidation {
  readonly overall: RowCountOutcome;
  readonly results: readonly RowCountItemResult[];
  /** Deterministic digest of the EXPECTED manifest — see restore-canonical-digest.ts. */
  readonly expectedManifestDigest: string;
  /** Deterministic digest of the ACTUAL manifest. Absent when any read failed. */
  readonly actualManifestDigest?: string;
}

/**
 * A checksum comparison subject.
 *
 * `subjectId` is bounded identity, never content: a media asset id today,
 * never a prompt, never bytes, never a signed URL.
 */
export interface ChecksumItem {
  readonly subjectId: string;
  readonly expectedDigest: string;
}

export type ChecksumOutcome = "MATCH" | "MISMATCH" | "UNAVAILABLE";

export interface ChecksumItemResult {
  readonly subjectId: string;
  readonly outcome: ChecksumOutcome;
  readonly expectedDigest?: string;
  readonly actualDigest?: string;
}

export interface ChecksumValidation {
  readonly overall: ChecksumOutcome;
  readonly results: readonly ChecksumItemResult[];
}

/**
 * What a restore target reports about its own constraint health.
 *
 * `invalidConstraints` names constraints PostgreSQL itself considers
 * NOT VALID (`pg_constraint.convalidated = false`) — this module verifies
 * evidence of Postgres's own authority, it does not recreate a relational
 * model to check against.
 */
export interface ConstraintHealthEvidence {
  readonly totalForeignKeys: number;
  readonly invalidConstraints: readonly string[];
}

export type ReferentialIntegrityOutcome = "VALID" | "INVALID" | "UNAVAILABLE";

export interface ReferentialIntegrityValidation {
  readonly outcome: ReferentialIntegrityOutcome;
  readonly totalForeignKeys?: number;
  readonly invalidConstraintCount?: number;
  /** Bounded sample, truncated. The count above is always complete. */
  readonly invalidConstraintSample: readonly string[];
}

const MAX_INVALID_CONSTRAINT_SAMPLE = 50;

export function boundInvalidConstraintSample(names: readonly string[]): readonly string[] {
  return names.slice(0, MAX_INVALID_CONSTRAINT_SAMPLE);
}

/**
 * The complete evidence produced by one restore-verification pass.
 *
 * Bounded by construction: every field is an id, a count, an enum label, or a
 * digest. No row, no dump, no prompt, no PII, no credential, no connection
 * string has anywhere to go in this shape.
 */
export interface RestoreEvidence {
  readonly state: RestoreValidationState;
  readonly reasonCode: string;
  readonly restoreId?: string;
  readonly backupId?: string;
  readonly environmentClass?: RestoreEnvironmentClass;
  readonly rowCount?: RowCountValidation;
  readonly checksum?: ChecksumValidation;
  readonly referentialIntegrity?: ReferentialIntegrityValidation;
  readonly evaluatedAt: string;
  readonly durationMs: number;
}
