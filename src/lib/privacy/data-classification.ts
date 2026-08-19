/**
 * Cinefield data classification + retention matrix (Phase 23-A).
 *
 * Source-controlled TypeScript, not a database table — the same "golden
 * dataset is code, reviewable via PR diff" precedent Phase 22 established
 * for `golden-dataset.ts`. This is the roadmap's own "Retention Matrix":
 * purpose/legal basis/owner/storage/retention/deletion per real data class,
 * for every Supabase table that stores anything user-identifying or
 * user-generated. Read by the admin privacy view (23-D) and by
 * `AccountDeletionWorkflow` (23-C) to decide what "delete this account"
 * actually touches.
 *
 * `dataClass` values match the roadmap's own enumeration and
 * `media_assets.data_class`'s CHECK constraint (20260910000000_privacy_
 * lifecycle.sql) exactly — one vocabulary, never two.
 */

export type DataClass = "public" | "internal" | "personal" | "sensitive" | "billing" | "security_audit";

export type LegalBasis = "contract" | "legitimate_interest" | "legal_obligation" | "consent";

export type DeletionPolicy =
  /** Hard-deleted or PII-anonymized by AccountDeletionWorkflow. */
  | "anonymize_on_deletion"
  /**
   * Financial record, OR a table whose own migration already enforces a
   * real `BEFORE UPDATE OR DELETE` trigger — retained per legal_obligation
   * or by structural schema constraint, never scrubbed by account deletion
   * OR by any retention-expiry cleanup this codebase can build without a
   * separate, deliberate schema change.
   */
  | "retain_immutable"
  /**
   * A retention window is intended but no explicit duration has been
   * decided yet, and nothing in the schema prevents cleanup once one is —
   * `retention-policy-resolver.ts` resolves this to
   * `BUSINESS_DECISION_REQUIRED`, never a fabricated default duration.
   */
  | "retain_for_audit_window"
  /** Catalog/reference data with no user identity — deletion is not applicable. */
  | "not_applicable";

export interface DataClassificationEntry {
  readonly table: string;
  readonly dataClass: DataClass;
  readonly purpose: string;
  readonly legalBasis: LegalBasis;
  /** Free-text owner label — the phase/team responsible, not a Clerk id. */
  readonly owner: string;
  readonly storageLocation: string;
  /** A short retention-policy key, matching media_assets.retention_policy's CHECK shape when applicable. */
  readonly retentionPolicy: string;
  readonly deletionPolicy: DeletionPolicy;
  /**
   * PHASE 23 CORRECTIVE BATCH — the roadmap's own phase-level done-criterion
   * ("retention süresi geçen veriler temizleniyor" — data past its
   * retention period is cleaned up) requires an actual EXPIRY DURATION to
   * evaluate, not just a policy label. Undefined here on every entry today,
   * deliberately: `retention-policy-resolver.ts` never invents a number —
   * an undefined duration resolves to `BUSINESS_DECISION_REQUIRED`, not a
   * fabricated default. Setting this on a real entry is itself the
   * business decision, made once, by whoever owns that table.
   */
  readonly retentionDurationDays?: number;
}

/**
 * Every table `data-classification.test.ts` cross-checks this list against
 * (see that test for the enumeration source) is represented here — the test
 * fails if a table with a `clerk_user_id`-shaped column is added to a
 * migration without a matching entry, so this cannot silently rot out of
 * sync with the real schema.
 */
export const DATA_CLASSIFICATION_MATRIX: readonly DataClassificationEntry[] = [
  {
    table: "profiles",
    dataClass: "personal",
    purpose: "Account identity — username, email, display name, avatar.",
    legalBasis: "contract",
    owner: "phase-2",
    storageLocation: "supabase_postgres",
    retentionPolicy: "account_lifetime",
    deletionPolicy: "anonymize_on_deletion",
  },
  {
    table: "projects",
    dataClass: "personal",
    purpose: "User-created project containers for generations.",
    legalBasis: "contract",
    owner: "phase-2",
    storageLocation: "supabase_postgres",
    retentionPolicy: "account_lifetime",
    deletionPolicy: "anonymize_on_deletion",
  },
  {
    table: "generations",
    dataClass: "personal",
    purpose: "Generation requests: prompt, settings, provider routing decision.",
    legalBasis: "contract",
    owner: "phase-5",
    storageLocation: "supabase_postgres",
    retentionPolicy: "account_lifetime",
    deletionPolicy: "anonymize_on_deletion",
  },
  {
    table: "generation_attempts",
    dataClass: "personal",
    purpose: "Per-attempt execution evidence for one generation.",
    legalBasis: "contract",
    owner: "phase-6r",
    storageLocation: "supabase_postgres",
    retentionPolicy: "account_lifetime",
    deletionPolicy: "anonymize_on_deletion",
  },
  {
    table: "media_assets",
    dataClass: "personal",
    purpose: "Durable pointer to every stored media object (R2 hot + S3 DR copy + derivative variants).",
    legalBasis: "contract",
    owner: "phase-9",
    storageLocation: "cloudflare_r2_aws_s3",
    retentionPolicy: "account_lifetime",
    deletionPolicy: "anonymize_on_deletion",
  },
  {
    table: "credit_wallets",
    dataClass: "billing",
    purpose: "Current credit balance.",
    legalBasis: "contract",
    owner: "phase-10",
    storageLocation: "supabase_postgres",
    retentionPolicy: "account_lifetime",
    deletionPolicy: "anonymize_on_deletion",
  },
  {
    table: "credit_reservations",
    dataClass: "billing",
    purpose: "In-flight credit holds for a generation in progress.",
    legalBasis: "contract",
    owner: "phase-10",
    storageLocation: "supabase_postgres",
    retentionPolicy: "account_lifetime",
    deletionPolicy: "anonymize_on_deletion",
  },
  {
    table: "credit_ledger",
    dataClass: "billing",
    purpose: "Immutable financial ledger of every credit movement.",
    legalBasis: "legal_obligation",
    owner: "phase-10",
    storageLocation: "supabase_postgres",
    retentionPolicy: "financial_record_keeping",
    // Deliberately NOT anonymized/deleted with the account: an immutable
    // ledger is retained for accounting/legal record-keeping regardless of
    // account deletion — the same reasoning credit_ledger.test.ts already
    // asserts for the ledger's own append-only guarantee.
    deletionPolicy: "retain_immutable",
  },
  {
    table: "security_events",
    dataClass: "security_audit",
    purpose: "Security signal log: rate limits, auth failures, policy decisions.",
    legalBasis: "legitimate_interest",
    owner: "phase-12",
    storageLocation: "supabase_postgres",
    // PHASE 23 CORRECTIVE BATCH: this table's own migration
    // (20260826000000_security_events.sql) has a real BEFORE UPDATE OR
    // DELETE trigger raising an exception on every row, always — cleanup
    // is not "pending a window decision", it is structurally impossible
    // today without a separate, deliberate schema change. The original
    // "audit_window_only" label predates this correction and implied a
    // decidable duration that was never actually enforceable.
    retentionPolicy: "append_only_permanent",
    deletionPolicy: "retain_immutable",
  },
  {
    table: "admin_privileged_action_events",
    dataClass: "security_audit",
    purpose: "Privileged Tier-0 admin action lifecycle audit, including data.export/data.delete decisions.",
    legalBasis: "legal_obligation",
    owner: "phase-16",
    storageLocation: "supabase_postgres",
    // Same correction — real append-only trigger, 20260829000000_tier0_admin_action_audit.sql.
    retentionPolicy: "append_only_permanent",
    deletionPolicy: "retain_immutable",
  },
  {
    table: "feature_flag_audit",
    dataClass: "security_audit",
    purpose: "Feature flag change audit trail.",
    legalBasis: "legitimate_interest",
    owner: "phase-21",
    storageLocation: "supabase_postgres",
    // Same correction — real append-only trigger, 20260901000000_feature_flags.sql.
    retentionPolicy: "append_only_permanent",
    deletionPolicy: "retain_immutable",
  },
  {
    table: "model_eval_runs",
    dataClass: "internal",
    purpose: "Golden-dataset model quality evaluation runs — no user identity.",
    legalBasis: "legitimate_interest",
    owner: "phase-22",
    storageLocation: "supabase_postgres",
    retentionPolicy: "not_applicable",
    deletionPolicy: "not_applicable",
  },
  {
    table: "privacy_requests",
    dataClass: "sensitive",
    purpose: "A data subject's own export/deletion request record.",
    legalBasis: "legal_obligation",
    owner: "phase-23",
    storageLocation: "supabase_postgres",
    retentionPolicy: "audit_window_only",
    deletionPolicy: "retain_for_audit_window",
  },
  {
    table: "deletion_tombstones",
    dataClass: "sensitive",
    purpose: "Durable proof an account was deleted — must survive the account's own deletion.",
    legalBasis: "legal_obligation",
    owner: "phase-23",
    storageLocation: "supabase_postgres",
    // Same correction — real append-only trigger, this table's own
    // migration (20260910000000_privacy_lifecycle.sql). A tombstone
    // "aging out" would defeat the exact guarantee it exists to make.
    retentionPolicy: "append_only_permanent",
    deletionPolicy: "retain_immutable",
  },
] as const;

export function classificationFor(table: string): DataClassificationEntry | null {
  return DATA_CLASSIFICATION_MATRIX.find((entry) => entry.table === table) ?? null;
}
