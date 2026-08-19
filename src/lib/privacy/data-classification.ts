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
  /** Financial record — retained per legal_obligation, never scrubbed by account deletion. */
  | "retain_immutable"
  /** Security/audit evidence — retained for its own retention window regardless of account deletion. */
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
    retentionPolicy: "audit_window_only",
    deletionPolicy: "retain_for_audit_window",
  },
  {
    table: "admin_privileged_action_events",
    dataClass: "security_audit",
    purpose: "Privileged Tier-0 admin action lifecycle audit, including data.export/data.delete decisions.",
    legalBasis: "legal_obligation",
    owner: "phase-16",
    storageLocation: "supabase_postgres",
    retentionPolicy: "audit_window_only",
    deletionPolicy: "retain_for_audit_window",
  },
  {
    table: "feature_flag_audit",
    dataClass: "security_audit",
    purpose: "Feature flag change audit trail.",
    legalBasis: "legitimate_interest",
    owner: "phase-21",
    storageLocation: "supabase_postgres",
    retentionPolicy: "audit_window_only",
    deletionPolicy: "retain_for_audit_window",
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
    retentionPolicy: "audit_window_only",
    deletionPolicy: "retain_for_audit_window",
  },
] as const;

export function classificationFor(table: string): DataClassificationEntry | null {
  return DATA_CLASSIFICATION_MATRIX.find((entry) => entry.table === table) ?? null;
}
