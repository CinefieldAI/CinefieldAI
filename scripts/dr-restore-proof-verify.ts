/**
 * Phase 15-C/2 local restore-proof verifier.
 *
 * Invoked exclusively by `supabase/tests/run_pg_restore_proof.sh`, itself
 * Docker-required and manually invoked — this script never runs as part of
 * `npx tsx --test "src/**\/*.test.ts"`.
 *
 * It builds a REAL `RestoreEvidenceSource` (createThrowawayPostgresSource,
 * shelling out to `docker exec ... psql`) pointed at the RESTORED target
 * container, reads "expected" evidence from a JSON file the shell script
 * captured from the SOURCE container BEFORE `pg_dump` ran, and calls
 * `runRestoreValidation` — the exact same production validation core
 * `runRestoreVerification` delegates to. This is not a reimplementation for
 * the proof's sake; it is the real engine, exercised against real restored
 * data for the first time.
 *
 * Usage:
 *   npx tsx scripts/dr-restore-proof-verify.ts \
 *     --target-container=<name> --target-db=<name> \
 *     --expected=<path-to-json> --expect-state=<RestoreValidationState>
 *
 * Exits 0 when the produced state matches --expect-state, 1 otherwise.
 * Always prints the full evidence as JSON, so a mismatch is diagnosable from
 * the shell script's own captured output.
 */

import { readFileSync } from "node:fs";
import {
  createThrowawayPostgresSource,
  dockerExecPsql,
} from "@/lib/dr/adapters/throwaway-postgres-source";
import { runRestoreValidation } from "@/lib/dr/restore-verification-engine";
import type { ChecksumItem, RestoreValidationState, RowCountItem } from "@/lib/dr/restore-evidence-contract";

interface ExpectedEvidence {
  readonly restoreId: string;
  readonly backupId: string;
  readonly rowCounts: readonly RowCountItem[];
  readonly checksums: readonly ChecksumItem[];
}

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
  const targetContainer = arg("target-container");
  const targetDb = arg("target-db");
  const expectedPath = arg("expected");
  const expectState = arg("expect-state") as RestoreValidationState;

  const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as ExpectedEvidence;

  const source = createThrowawayPostgresSource({
    restoreId: expected.restoreId,
    backupId: expected.backupId,
    label: "docker-pg-restore-target",
    exec: dockerExecPsql(targetContainer, targetDb),
  });

  const evidence = await runRestoreValidation({
    source,
    expectedRowCounts: expected.rowCounts,
    expectedChecksums: expected.checksums,
    startedAt: new Date(),
  });

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);

  const pass = evidence.state === expectState;
  process.stdout.write(
    `RESULT: ${pass ? "PASS" : "FAIL"} expected=${expectState} actual=${evidence.state} reasonCode=${evidence.reasonCode}\n`
  );
  process.exit(pass ? 0 : 1);
}

main().catch((caught) => {
  process.stderr.write(`dr-restore-proof-verify threw: ${String(caught)}\n`);
  process.exit(2);
});
