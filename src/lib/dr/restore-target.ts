import type {
  ConstraintHealthEvidence,
  DurableTable,
  RestoreEnvironmentIdentity,
} from "./restore-evidence-contract";

/**
 * The narrow interface a restore-validation target must satisfy (Phase 15-C/1).
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ENTIRE COUPLING SURFACE
 * ---------------------------------------------------------------------------
 * `restore-verification-engine.ts` knows nothing about Docker, `psql`, the
 * Supabase Dashboard API, or an AWS SDK. It knows this interface. The
 * `supabase/tests/run_pg_tests.sh` throwaway harness could implement it by
 * shelling out to `psql`; a future isolated staging project could implement
 * it over its own read replica; a unit test implements it with an in-memory
 * fake. None of those implementations exist in this batch — this is the
 * CONTRACT they will be written against, which is what lets the pure
 * validators in this package be written and tested today, before any of
 * them exist.
 *
 * ---------------------------------------------------------------------------
 * EVERY METHOD IS A READ
 * ---------------------------------------------------------------------------
 * There is no `restore()`, no `mutate()`, no write of any kind. A restore
 * VALIDATOR that could also trigger a restore, or write to the target it is
 * inspecting, would be exactly the kind of privileged actor a verification
 * step is supposed to be independent of.
 */
export interface RestoreEvidenceSource {
  /** Declared, never inferred. See restore-isolation-guard.ts. */
  readonly environment: RestoreEnvironmentIdentity;
  /** Bounded id naming this restore attempt. */
  readonly restoreId: string;
  /** Bounded id naming the backup this restore was taken from. */
  readonly backupId: string;

  /**
   * Whether the restore process itself has finished (data loaded, the
   * instance is up and queryable) — independent of whether that data is
   * CORRECT. A `false` here means "nothing to validate yet", not "invalid".
   */
  isRestoreReady(): Promise<boolean>;

  /**
   * Exact row count for one durable table.
   *
   * Returns `null` when the read failed (connection error, timeout, missing
   * table) — never a fabricated `0`. A failed read and a genuinely empty
   * table are different findings; collapsing them would let a broken
   * connection masquerade as "the table restored empty".
   */
  getActualRowCount(table: DurableTable): Promise<number | null>;

  /**
   * The content digest a restored subject actually has, to compare against
   * an expected digest. `subjectId` today is a media asset id and the digest
   * is the same `checksum_sha256` shape the Phase 9-B ingest gate produces —
   * this method does not compute a NEW kind of digest, it reports what the
   * restore target has under the identity Phase 9-B already established.
   *
   * Returns `null` when unreadable, never an empty-string digest.
   */
  getActualChecksum(subjectId: string): Promise<string | null>;

  /**
   * PostgreSQL's own verdict on its foreign-key constraints
   * (`pg_constraint.convalidated`). Returns `null` when the query itself
   * could not run — never a synthesized "no constraints, therefore fine".
   */
  getConstraintHealth(): Promise<ConstraintHealthEvidence | null>;
}
