/**
 * The first real `RestoreEvidenceSource` implementation (Phase 15-C/2).
 *
 * ---------------------------------------------------------------------------
 * LOCAL / TEST TOOLING ONLY — NEVER IMPORTED BY PRODUCTION CODE
 * ---------------------------------------------------------------------------
 * This file shells out to `docker exec ... psql`. It is invoked exclusively
 * from `scripts/dr-restore-proof-verify.ts`, itself invoked exclusively from
 * `supabase/tests/run_pg_restore_proof.sh` — the same manual-invocation,
 * Docker-required pattern `run_pg_tests.sh` already uses for its SQL proofs.
 * `src/trigger/operational/operational-services.ts` never imports this file;
 * `defaultOperationalDeps.getRestoreEvidenceSource` keeps returning `null` in
 * every real deployment. A structural test in
 * `phase-15c2-throwaway-adapter.e2e.test.ts` asserts that import boundary
 * directly, so it cannot drift silently.
 *
 * ---------------------------------------------------------------------------
 * EVERY READ GOES TO THE TARGET. NOTHING IS EVER COPIED FROM "EXPECTED".
 * ---------------------------------------------------------------------------
 * This module has no field, parameter, or closure that could hold a
 * source-side or precomputed value. Every method below issues a fresh query
 * against `params.exec`, which the caller points at the RESTORED container's
 * database — never the source. There is no `matches: boolean` shortcut
 * anywhere in `RestoreEvidenceSource` for an adapter to exploit even if one
 * wanted to (see restore-target.ts) — but the deeper guarantee is that this
 * file simply never receives a source-side value to echo. Mutating the
 * restored target's data changes what these methods return, because they
 * have nothing else to consult.
 */

import { execFile } from "node:child_process";
import { isDurableTable, type DurableTable } from "../restore-evidence-contract";
import type { RestoreEvidenceSource } from "../restore-target";

export interface ExecPsqlResult {
  readonly ok: boolean;
  readonly stdout: string;
}

/**
 * Runs one SQL statement against a target and returns its trimmed, unaligned
 * tuple output. Injectable so the adapter's PARSING logic is unit-testable
 * without Docker — see the fake implementations in
 * `phase-15c2-throwaway-adapter.e2e.test.ts`. The real implementation below
 * is exercised only by the Docker-requiring shell script.
 */
export type ExecPsql = (sql: string) => Promise<ExecPsqlResult>;

/**
 * The real `docker exec ... psql` runner.
 *
 * Reuses the exact invocation shape `supabase/tests/run_pg_tests.sh` already
 * proves works (`psql -qtA -c "<sql>"`) rather than adding a `pg` client
 * dependency for a tool nothing in production ever runs.
 */
export function dockerExecPsql(container: string, database: string): ExecPsql {
  return (sql) =>
    new Promise((resolve) => {
      execFile(
        "docker",
        ["exec", container, "psql", "-U", "postgres", "-d", database, "-qtA", "-c", sql],
        (error, stdout) => {
          resolve(error ? { ok: false, stdout: "" } : { ok: true, stdout: stdout.trim() });
        }
      );
    });
}

/** UUID shape. Interpolated identifiers are checked against this before use. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ThrowawayPostgresSourceParams {
  readonly restoreId: string;
  readonly backupId: string;
  /** Bounded label, e.g. "docker-pg-restore-target". Never a connection string. */
  readonly label: string;
  readonly exec: ExecPsql;
}

/**
 * Builds a `RestoreEvidenceSource` over a live Postgres reachable through
 * `params.exec`.
 *
 * ---------------------------------------------------------------------------
 * TABLE NAMES ARE INTERPOLATED FROM A CLOSED TYPE, NEVER FROM INPUT
 * ---------------------------------------------------------------------------
 * `getActualRowCount`'s `table` parameter is typed `DurableTable` — a closed
 * sixteen-member union — and is additionally checked at runtime with
 * `isDurableTable` before it ever reaches a SQL string, because TypeScript's
 * types do not survive into the running JavaScript. There is no path from
 * caller input to an arbitrary identifier in the query.
 *
 * `getActualChecksum`'s `subjectId` is externally supplied (a media asset
 * id), so it is validated against `UUID_PATTERN` before interpolation. A
 * non-UUID value is refused as unreadable, not sanitized and used anyway.
 */
export function createThrowawayPostgresSource(params: ThrowawayPostgresSourceParams): RestoreEvidenceSource {
  const { exec } = params;

  return {
    environment: { environmentClass: "isolated_throwaway", label: params.label },
    restoreId: params.restoreId,
    backupId: params.backupId,

    async isRestoreReady() {
      const result = await exec("SELECT 1");
      return result.ok && result.stdout === "1";
    },

    async getActualRowCount(table: DurableTable): Promise<number | null> {
      if (!isDurableTable(table)) return null;
      const result = await exec(`SELECT count(*) FROM "${table}"`);
      // `Number("")` is 0 in JavaScript, not NaN — checked explicitly so an
      // anomalous empty response (which a real `count(*)` never produces)
      // cannot silently become "the table restored empty".
      if (!result.ok || result.stdout.length === 0) return null;
      const count = Number(result.stdout);
      return Number.isInteger(count) && count >= 0 ? count : null;
    },

    async getActualChecksum(subjectId: string): Promise<string | null> {
      if (!UUID_PATTERN.test(subjectId)) return null;
      const result = await exec(`SELECT checksum_sha256 FROM media_assets WHERE id = '${subjectId}'::uuid`);
      if (!result.ok || result.stdout.length === 0) return null;
      return result.stdout;
    },

    async getConstraintHealth() {
      // PostgreSQL's own authority, read verbatim: `pg_constraint.convalidated`
      // for every FOREIGN KEY constraint in the public schema. No relationship
      // graph is asserted here — only what Postgres itself already decided.
      const totalResult = await exec(
        `SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace ` +
          `WHERE c.contype = 'f' AND n.nspname = 'public'`
      );
      if (!totalResult.ok) return null;
      const totalForeignKeys = Number(totalResult.stdout);
      if (!Number.isInteger(totalForeignKeys) || totalForeignKeys < 0) return null;

      const invalidResult = await exec(
        `SELECT coalesce(string_agg(c.conname, ','), '') FROM pg_constraint c ` +
          `JOIN pg_namespace n ON n.oid = c.connamespace ` +
          `WHERE c.contype = 'f' AND n.nspname = 'public' AND NOT c.convalidated`
      );
      if (!invalidResult.ok) return null;

      const invalidConstraints = invalidResult.stdout.length === 0 ? [] : invalidResult.stdout.split(",");
      return { totalForeignKeys, invalidConstraints };
    },
  };
}
