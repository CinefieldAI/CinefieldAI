import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Static migration-safety scanner (Phase 14-A).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The Phase 14-B required-check registry listed `migration_safety` with
 * `status: "available"`, but its `command` was the parenthetical string
 * "(static review of touched supabase/migrations/ files)" — a description of
 * a human reading files, not anything a CI runner can execute. The Phase 14
 * post-14B audit flagged that as a real (LOW) defect: a registry that names a
 * check and marks it available, while nothing can run it, misreports its own
 * coverage. This file is the honest fix — the check is now real.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES AND DOES NOT PROVE
 * ---------------------------------------------------------------------------
 * It flags DESTRUCTIVE SQL SHAPES in migration files. That is a narrow claim,
 * deliberately:
 *
 *   - It does NOT prove a migration is correct, reversible, or safe to run.
 *   - It does NOT detect a migration that rewrites an ALREADY-APPLIED
 *     migration; applied state lives in the database, not in the files, so a
 *     static reader cannot see it. `postgres_proofs` (which applies the real
 *     migrations to a throwaway PostgreSQL) plus human review cover that.
 *
 * Like the other two scanners in this directory, a green run is not proof of
 * absence — it is proof that no KNOWN destructive shape is present.
 *
 * ---------------------------------------------------------------------------
 * COMMENTS ARE STRIPPED BEFORE MATCHING, AND THAT IS LOAD-BEARING
 * ---------------------------------------------------------------------------
 * `20260828000000_rls_grant_hardening.sql` opens with the comment
 * `-- RLS grant hardening: TRUNCATE removal + ...`. A scanner that matched raw
 * text would flag a file for the prose describing what it does — the exact
 * false-positive shape this repository has hit repeatedly in its other
 * scanners. Comments are blanked (newline-preserving, so line numbers stay
 * true) before any rule runs.
 *
 * TRUNCATE ALSO APPEARS AS A PRIVILEGE NAME. `GRANT ...,TRUNCATE,... ON TABLE`
 * and `REVOKE TRUNCATE ON ALL TABLES` are grant management, not data
 * destruction, and both exist in this repository today. The rule therefore
 * matches TRUNCATE only in STATEMENT position (start of file or after `;`),
 * never as a bare word.
 *
 *   npx tsx scripts/scan-migration-safety.ts            # all migrations
 *   npx tsx scripts/scan-migration-safety.ts <file.sql> # one file
 */

const MIGRATIONS_DIR = "supabase/migrations";

export interface MigrationFinding {
  file: string;
  line: number;
  rule: string;
}

/**
 * Blanks `--` line comments and block comments while preserving newlines, so
 * a finding's reported line number still points at the real statement.
 */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

/**
 * Destructive shapes. Each one is something that discards data or rewrites a
 * table, and each is absent from every migration in this repository today —
 * verified before these rules were written, so the scanner starts green
 * against real history rather than against an empty directory.
 *
 * DELIBERATELY NOT FLAGGED, because all four appear legitimately here:
 *   DROP POLICY / DROP FUNCTION / DROP TRIGGER / DROP CONSTRAINT (all
 *   `IF EXISTS`, all re-created in the same migration or intentionally
 *   removed). They change rules, not rows.
 */
const RULES: { name: string; pattern: RegExp; why: string }[] = [
  { name: "drop_table", pattern: /\bDROP\s+TABLE\b/i, why: "Discards a table and every row in it." },
  { name: "drop_column", pattern: /\bDROP\s+COLUMN\b/i, why: "Discards a column and every value in it." },
  { name: "drop_schema", pattern: /\bDROP\s+SCHEMA\b/i, why: "Discards an entire schema." },
  { name: "drop_database", pattern: /\bDROP\s+DATABASE\b/i, why: "Discards an entire database." },
  {
    // Statement position only: start of input or immediately after a `;`.
    name: "truncate_statement",
    pattern: /(?:^|;)\s*TRUNCATE\b/i,
    why: "Empties a table. The privilege NAME in GRANT/REVOKE is not this.",
  },
  {
    name: "delete_without_where",
    pattern: /\bDELETE\s+FROM\s+[^;]*?;/i,
    why: "An unqualified DELETE removes every row.",
  },
  {
    name: "alter_column_type",
    pattern: /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    why: "Rewrites the table and can fail or truncate values in place.",
  },
];

export function scanMigrationText(file: string, raw: string): MigrationFinding[] {
  const code = stripSqlComments(raw);
  const findings: MigrationFinding[] = [];
  const lines = code.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.name === "delete_without_where") {
        // Needs statement scope, not line scope: the WHERE may be on the next
        // line. Only evaluated when the line opens a DELETE.
        if (!/\bDELETE\s+FROM\b/i.test(line)) continue;
        const rest = lines.slice(i).join("\n");
        const stmt = rest.slice(0, rest.indexOf(";") + 1 || rest.length);
        if (!/\bWHERE\b/i.test(stmt)) findings.push({ file, line: i + 1, rule: rule.name });
        continue;
      }
      if (rule.name === "truncate_statement") {
        // Re-test against the statement boundary rather than the bare line.
        const before = lines.slice(0, i).join("\n");
        const atStatementStart = /(?:^|;)\s*$/.test(before + "\n") || /(?:^|;)\s*TRUNCATE\b/i.test(line);
        if (atStatementStart && /^\s*TRUNCATE\b/i.test(line)) {
          findings.push({ file, line: i + 1, rule: rule.name });
        }
        continue;
      }
      if (rule.pattern.test(line)) findings.push({ file, line: i + 1, rule: rule.name });
    }
  }

  return findings;
}

export function scanMigrationFile(file: string): MigrationFinding[] {
  try {
    const rel = path.isAbsolute(file) ? path.relative(process.cwd(), file) : file;
    return scanMigrationText(rel.replace(/\\/g, "/"), readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/** Every migration on disk — tracked or not, so new files are never invisible. */
export function migrationFiles(root: string): string[] {
  try {
    return readdirSync(path.join(root, MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => `${MIGRATIONS_DIR}/${f}`);
  } catch {
    return [];
  }
}

export function scanMigrationRepository(root: string): MigrationFinding[] {
  return migrationFiles(root).flatMap((rel) =>
    scanMigrationText(rel, (() => {
      try {
        return readFileSync(path.join(root, rel), "utf8");
      } catch {
        return "";
      }
    })())
  );
}

if (process.argv[1] && process.argv[1].endsWith("scan-migration-safety.ts")) {
  const target = process.argv[2];
  const findings = target ? scanMigrationFile(target) : scanMigrationRepository(process.cwd());

  if (findings.length === 0) {
    console.log("migration safety scan: no destructive statements in migrations");
    console.log("NOTE: shape-matching only. It cannot prove a migration is correct or reversible.");
  } else {
    for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}`);
    console.log(`migration safety scan: ${findings.length} destructive statement(s)`);
    process.exit(1);
  }
}
