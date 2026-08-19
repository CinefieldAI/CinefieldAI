import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DATA_CLASSIFICATION_MATRIX, type DataClassificationEntry } from "./data-classification";
import { resolveClassRetention, resolveRowRetention, type RetentionRowVerdict } from "./retention-policy-resolver";
import { deleteAssetObject } from "@/lib/media/r2-client";

/**
 * Retention-expiry cleanup executor (Phase 23 corrective batch).
 *
 * MANUAL_OPERATOR_CALLER, admin-triggered — no scheduler, per the roadmap's
 * own text naming no automatic cadence and this repository's own
 * established "no cron/scheduler exists, do not invent one" precedent
 * (Phase 21's `canary-guardrail.ts`, Phase 22's `production-sample.ts`).
 * `evaluateRetentionCleanup()` is a REAL dry-run: it runs the full
 * class-then-row resolution for every one of the 14
 * `DATA_CLASSIFICATION_MATRIX` entries and returns bounded evidence,
 * mutating nothing. `executeRetentionCleanup()` performs the mutations a
 * prior dry-run found — but ONLY for a table this file has an explicit,
 * hand-written performer for (`CLEANUP_PERFORMERS`, keyed by table name).
 * A class that resolves to `ROW_EVALUATION_REQUIRED` for a table with NO
 * registered performer fails closed (`NOT_CONFIGURED`) rather than
 * attempting a generic mutation — there is no code path anywhere in this
 * file that accepts a table name or SQL fragment from a caller.
 *
 * TODAY, EVERY REAL ENTRY IS INERT. `resolveClassRetention` never reaches
 * `ROW_EVALUATION_REQUIRED` for any of the 14 real entries (see that
 * module's own tests) — this executor's row-mutation path is real,
 * tested, and ready, but has nothing to do until a real
 * `retentionDurationDays` is set on some entry as a deliberate business
 * decision. The one registered performer (`media_assets`) exists so that
 * decision, when made, activates a REAL mechanism immediately rather than
 * requiring new code — the same "quality signal real but inert by policy"
 * shape Phase 22's router-quality seam already established.
 */

export type RetentionCleanupOutcome =
  | { readonly kind: "class_verdict"; readonly table: string; readonly action: string; readonly reasonCode: string }
  | {
      readonly kind: "row_evidence";
      readonly table: string;
      readonly rowId: string;
      readonly verdict: RetentionRowVerdict;
    }
  | { readonly kind: "row_executed"; readonly table: string; readonly rowId: string; readonly action: "DELETE" | "ANONYMIZE"; readonly succeeded: boolean }
  | { readonly kind: "unsupported_table"; readonly table: string; readonly reasonCode: "no_registered_performer" };

export const MAX_CLEANUP_BATCH_SIZE = 500;

interface CleanupPerformer {
  /** Selects exactly the bounded columns this performer needs — never `*`. */
  readonly selectColumns: string;
  readonly legalHoldColumn: string | null;
  fetchRows(admin: SupabaseClient, batchSize: number): Promise<{ id: string; createdAt: string; legalHold: boolean }[]>;
  perform(admin: SupabaseClient, rowId: string, action: "DELETE" | "ANONYMIZE"): Promise<boolean>;
}

/**
 * The ONE registered performer today — `media_assets`, reusing
 * `account-deletion-workflow.ts`'s own real object-removal seam
 * (`deleteAssetObject`) rather than inventing a second R2-deletion path.
 * `legal_hold`/`tombstoned_at` are both respected: an already-tombstoned
 * row (deleted via AccountDeletionWorkflow already) is excluded from
 * fetch so this never re-processes it.
 */
const CLEANUP_PERFORMERS: Readonly<Record<string, CleanupPerformer>> = {
  media_assets: {
    selectColumns: "id, created_at, legal_hold, object_key, storage_backend",
    legalHoldColumn: "legal_hold",
    async fetchRows(admin, batchSize) {
      const { data } = await admin
        .from("media_assets")
        .select("id, created_at, legal_hold, object_key, storage_backend")
        .is("tombstoned_at", null)
        .order("created_at", { ascending: true })
        .limit(batchSize);
      return ((data ?? []) as { id: string; created_at: string; legal_hold: boolean }[]).map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        legalHold: r.legal_hold === true,
      }));
    },
    async perform(admin, rowId, action) {
      if (action === "DELETE") {
        const { data: row } = await admin.from("media_assets").select("object_key, storage_backend").eq("id", rowId).maybeSingle();
        const r = row as { object_key: string; storage_backend: string } | null;
        if (r?.storage_backend === "r2") await deleteAssetObject(r.object_key);
      }
      const { error } = await admin.from("media_assets").update({ tombstoned_at: new Date().toISOString() }).eq("id", rowId);
      return !error;
    },
  },
};

export interface RetentionCleanupOptions {
  readonly dryRun: boolean;
  readonly batchSize?: number;
  readonly now?: Date;
  /**
   * Test-only seam — defaults to the real `DATA_CLASSIFICATION_MATRIX`.
   * Lets `retention-cleanup-executor.test.ts` exercise the row-evaluation
   * and performer paths against a SYNTHETIC entry with a real duration,
   * the same way `retention-policy-resolver.test.ts` does for the pure
   * resolver — without ever setting a real duration on a real entry.
   */
  readonly entries?: readonly DataClassificationEntry[];
}

/**
 * The single entry point for both dry-run and execute — `dryRun: true`
 * (the default a caller should reach for first) never mutates anything;
 * `dryRun: false` performs exactly the mutations the SAME resolution logic
 * found, keeping the two paths from ever disagreeing about what "expired"
 * means.
 */
export async function evaluateRetentionCleanup(
  admin: SupabaseClient,
  options: RetentionCleanupOptions
): Promise<readonly RetentionCleanupOutcome[]> {
  const batchSize = Math.min(options.batchSize ?? MAX_CLEANUP_BATCH_SIZE, MAX_CLEANUP_BATCH_SIZE);
  const now = options.now ?? new Date();
  const entries = options.entries ?? DATA_CLASSIFICATION_MATRIX;
  const outcomes: RetentionCleanupOutcome[] = [];

  for (const entry of entries) {
    const classVerdict = resolveClassRetention(entry);

    if (classVerdict.action !== "ROW_EVALUATION_REQUIRED") {
      outcomes.push({ kind: "class_verdict", table: entry.table, action: classVerdict.action, reasonCode: classVerdict.reasonCode });
      continue;
    }

    const performer = CLEANUP_PERFORMERS[entry.table];
    if (!performer) {
      outcomes.push({ kind: "unsupported_table", table: entry.table, reasonCode: "no_registered_performer" });
      continue;
    }

    const rows = await performer.fetchRows(admin, batchSize);
    const deletionAction: "DELETE" | "ANONYMIZE" = entry.deletionPolicy === "anonymize_on_deletion" ? "ANONYMIZE" : "DELETE";

    for (const row of rows) {
      const verdict = resolveRowRetention({ createdAt: row.createdAt, legalHold: row.legalHold }, classVerdict.durationDays, deletionAction, now);
      outcomes.push({ kind: "row_evidence", table: entry.table, rowId: row.id, verdict });

      if (!options.dryRun && (verdict.action === "DELETE" || verdict.action === "ANONYMIZE")) {
        const succeeded = await performer.perform(admin, row.id, verdict.action);
        outcomes.push({ kind: "row_executed", table: entry.table, rowId: row.id, action: verdict.action, succeeded });
      }
    }
  }

  return outcomes;
}

/** Convenience wrapper — identical evaluation, `dryRun: false`. */
export async function executeRetentionCleanup(
  admin: SupabaseClient,
  options: Omit<RetentionCleanupOptions, "dryRun"> = {}
): Promise<readonly RetentionCleanupOutcome[]> {
  return evaluateRetentionCleanup(admin, { ...options, dryRun: false });
}
