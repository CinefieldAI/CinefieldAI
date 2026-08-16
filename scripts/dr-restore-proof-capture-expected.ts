/**
 * Phase 15-C/2 — captures EXPECTED restore evidence from the SOURCE
 * container, before `pg_dump` runs.
 *
 * Invoked exclusively by `supabase/tests/run_pg_restore_proof.sh`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS QUERIES THE SOURCE INSTEAD OF TRUSTING THE FIXTURE SCRIPT
 * ---------------------------------------------------------------------------
 * The fixture SQL (`fixtures_restore_proof.sql`) inserts a known checksum
 * and prints the asset id it used. This script does not trust that printed
 * value — it queries `media_assets.checksum_sha256` back out of the SOURCE
 * database for that id. That is the same separation the whole 15-C package
 * insists on: "expected" evidence is a READ of durable state, not an
 * assumption about what a write was supposed to have done. A typo in the
 * fixture that silently inserted the wrong value would be caught by this
 * query reporting what was actually stored, not what was intended.
 *
 * Row counts use `DURABLE_TABLES` directly — the same allow-list
 * `runRestoreVerification` reads in production — so this proof cannot drift
 * from what the real code actually validates.
 *
 * Usage:
 *   npx tsx scripts/dr-restore-proof-capture-expected.ts \
 *     --source-container=<name> --source-db=<name> \
 *     --restore-id=<id> --backup-id=<id> --asset-id=<uuid> --out=<path>
 */

import { writeFileSync } from "node:fs";
import { dockerExecPsql } from "@/lib/dr/adapters/throwaway-postgres-source";
import { DURABLE_TABLES } from "@/lib/dr/restore-evidence-contract";

function arg(name: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) {
    process.stderr.write(`missing required argument --${name}\n`);
    process.exit(2);
  }
  return found.slice(prefix.length);
}

async function main(): Promise<void> {
  const sourceContainer = arg("source-container");
  const sourceDb = arg("source-db");
  const restoreId = arg("restore-id");
  const backupId = arg("backup-id");
  const assetId = arg("asset-id");
  const outPath = arg("out");

  const exec = dockerExecPsql(sourceContainer, sourceDb);

  const rowCounts = [];
  for (const entry of DURABLE_TABLES) {
    const result = await exec(`SELECT count(*) FROM "${entry.table}"`);
    if (!result.ok) {
      process.stderr.write(`failed to read expected row count for ${entry.table}\n`);
      process.exit(1);
    }
    rowCounts.push({ table: entry.table, rowCount: Number(result.stdout) });
  }

  const checksumResult = await exec(`SELECT checksum_sha256 FROM media_assets WHERE id = '${assetId}'::uuid`);
  if (!checksumResult.ok || checksumResult.stdout.length === 0) {
    process.stderr.write("failed to read expected checksum for the fixture asset\n");
    process.exit(1);
  }

  const expected = {
    restoreId,
    backupId,
    rowCounts,
    checksums: [{ subjectId: assetId, expectedDigest: checksumResult.stdout }],
  };

  writeFileSync(outPath, JSON.stringify(expected, null, 2));
  process.stdout.write(`expected evidence captured: ${rowCounts.length} tables, 1 checksum -> ${outPath}\n`);
}

main().catch((caught) => {
  process.stderr.write(`dr-restore-proof-capture-expected threw: ${String(caught)}\n`);
  process.exit(2);
});
