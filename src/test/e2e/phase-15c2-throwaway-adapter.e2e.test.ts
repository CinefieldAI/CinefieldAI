import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  createThrowawayPostgresSource,
  type ExecPsql,
  type ExecPsqlResult,
} from "@/lib/dr/adapters/throwaway-postgres-source";

/**
 * Phase 15-C/2 — the first real `RestoreEvidenceSource` adapter.
 *
 * These tests require NO Docker: `exec` is injected, matching the pattern
 * `dockerExecPsql` is deliberately kept separate for. The real, Docker-
 * executed round trip lives in `supabase/tests/run_pg_restore_proof.sh`,
 * manually invoked exactly like `run_pg_tests.sh` — this file proves the
 * adapter's PARSING and BOUNDARY behaviour is correct independent of Docker
 * ever being available, so the fast suite stays fast and Docker-free.
 */

const ROOT = process.cwd();
const DR_DIR = path.join(ROOT, "src", "lib", "dr");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Strips `#` comments from shell source, so prose about a pattern is not read as the pattern. */
function stripShellComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
}

/** Directory walk (including the adapters/ subdirectory), not `git ls-files`. */
function walkTs(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTs(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push({ file: path.relative(ROOT, full).replace(/\\/g, "/"), text: stripComments(readFileSync(full, "utf8")) });
    }
  }
  return out;
}
const drCode = walkTs(DR_DIR);

function fakeExec(handler: (sql: string) => ExecPsqlResult): { exec: ExecPsql; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    exec: async (sql: string) => {
      calls.push(sql);
      return handler(sql);
    },
  };
}

const ok = (stdout: string): ExecPsqlResult => ({ ok: true, stdout });
const fail: ExecPsqlResult = { ok: false, stdout: "" };

function source(exec: ExecPsql) {
  return createThrowawayPostgresSource({
    restoreId: "r1",
    backupId: "b1",
    label: "docker-pg-restore-target",
    exec,
  });
}

// ---------------------------------------------------------------------------
// 1–3  IDENTITY AND isRestoreReady
// ---------------------------------------------------------------------------

test("S15C2-1  the adapter declares an isolated_throwaway environment, never inferred", () => {
  const { exec } = fakeExec(() => ok("1"));
  const s = source(exec);
  assert.equal(s.environment.environmentClass, "isolated_throwaway");
  assert.equal(s.restoreId, "r1");
  assert.equal(s.backupId, "b1");
});

test("S15C2-2  isRestoreReady is true only for a genuine SELECT 1 -> '1'", async () => {
  assert.equal(await source(fakeExec(() => ok("1")).exec).isRestoreReady(), true);
  assert.equal(await source(fakeExec(() => ok("0")).exec).isRestoreReady(), false, "wrong value");
  assert.equal(await source(fakeExec(() => fail).exec).isRestoreReady(), false, "unreachable target");
  assert.equal(await source(fakeExec(() => ok("")).exec).isRestoreReady(), false, "empty response");
});

test("S15C2-3  isRestoreReady issues exactly the readiness probe, nothing else", async () => {
  const { exec, calls } = fakeExec(() => ok("1"));
  await source(exec).isRestoreReady();
  assert.deepEqual(calls, ["SELECT 1"]);
});

// ---------------------------------------------------------------------------
// 4–8  ROW COUNT
// ---------------------------------------------------------------------------

test("S15C2-4  a valid count parses to a number", async () => {
  const { exec } = fakeExec(() => ok("42"));
  assert.equal(await source(exec).getActualRowCount("generations"), 42);
});

test("S15C2-5  a non-durable table is refused before any query runs", async () => {
  const { exec, calls } = fakeExec(() => ok("999"));
  const result = await source(exec).getActualRowCount("not_a_real_table" as never);
  assert.equal(result, null);
  assert.deepEqual(calls, [], "an invalid table must never reach a query");
});

test("S15C2-6  a query failure is null, never a fabricated zero", async () => {
  const { exec } = fakeExec(() => fail);
  assert.equal(await source(exec).getActualRowCount("profiles"), null);
});

test("S15C2-7  malformed count output is null, not coerced", async () => {
  for (const bad of ["not-a-number", "", "-1", "1.5", "NaN"]) {
    const { exec } = fakeExec(() => ok(bad));
    assert.equal(await source(exec).getActualRowCount("profiles"), null, `bad=${bad}`);
  }
});

test("S15C2-8  the row-count query names the requested table, quoted", async () => {
  const { exec, calls } = fakeExec(() => ok("1"));
  await source(exec).getActualRowCount("media_release_approvals");
  assert.match(calls[0]!, /count\(\*\).*"media_release_approvals"/);
});

// ---------------------------------------------------------------------------
// 9–13  CHECKSUM — NO ECHOING
// ---------------------------------------------------------------------------

const REAL_UUID = "5d28e1e7-2188-472e-8adc-f68b5a6a9fbc";
const REAL_DIGEST = "a".repeat(64);

test("S15C2-9  a valid digest is returned as read", async () => {
  const { exec } = fakeExec(() => ok(REAL_DIGEST));
  assert.equal(await source(exec).getActualChecksum(REAL_UUID), REAL_DIGEST);
});

test("S15C2-10  a non-UUID subject is refused before any query runs", async () => {
  const { exec, calls } = fakeExec(() => ok(REAL_DIGEST));
  const s = source(exec);
  for (const bad of ["'; DROP TABLE media_assets; --", "not-a-uuid", "", "12345"]) {
    assert.equal(await s.getActualChecksum(bad), null, `bad=${bad}`);
  }
  assert.deepEqual(calls, [], "a malformed subject id must never reach a query");
});

test("S15C2-11  an unreadable checksum is null, never echoed from elsewhere", async () => {
  assert.equal(await source(fakeExec(() => fail).exec).getActualChecksum(REAL_UUID), null);
  assert.equal(await source(fakeExec(() => ok("")).exec).getActualChecksum(REAL_UUID), null);
});

test("S15C2-12  the checksum query reads FROM THE TARGET, by id, cast to uuid", async () => {
  const { exec, calls } = fakeExec(() => ok(REAL_DIGEST));
  await source(exec).getActualChecksum(REAL_UUID);
  assert.match(calls[0]!, /checksum_sha256 FROM media_assets WHERE id = '.*'::uuid/);
  assert.ok(calls[0]!.includes(REAL_UUID));
});

test("S15C2-13  nothing in the adapter can hold or return a source-side value", () => {
  // No field, parameter or closure exists for a caller to pass a
  // precomputed "expected" or "matches" value into. The only way this
  // function can produce a checksum is by querying `exec` — proven
  // structurally (no second data path) and behaviourally (S15C2-9..12: the
  // returned value is always exactly what `exec` reported, per call).
  const adapterSrc = stripComments(read("src/lib/dr/adapters/throwaway-postgres-source.ts"));
  assert.ok(!/expectedDigest|matches\s*:\s*boolean|precomputed/i.test(adapterSrc),
    "the adapter must not accept an expected/matches shortcut");
});

// ---------------------------------------------------------------------------
// 14–17  REFERENTIAL INTEGRITY
// ---------------------------------------------------------------------------

test("S15C2-15  a healthy target reports zero invalid constraints", async () => {
  const { exec } = fakeExec((sql) =>
    /NOT c\.convalidated/.test(sql) ? ok("") : ok("21")
  );
  const evidence = await source(exec).getConstraintHealth();
  assert.deepEqual(evidence, { totalForeignKeys: 21, invalidConstraints: [] });
});

test("S15C2-16  a broken target reports the constraint names, comma-split", async () => {
  const { exec } = fakeExec((sql) =>
    /NOT c\.convalidated/.test(sql) ? ok("fk_a,fk_b") : ok("22")
  );
  const evidence = await source(exec).getConstraintHealth();
  assert.deepEqual(evidence, { totalForeignKeys: 22, invalidConstraints: ["fk_a", "fk_b"] });
});

test("S15C2-17  either query failing makes constraint health unavailable, not healthy", async () => {
  const totalFails = fakeExec((sql) => (/NOT c\.convalidated/.test(sql) ? ok("") : fail));
  assert.equal(await source(totalFails.exec).getConstraintHealth(), null);

  const invalidFails = fakeExec((sql) => (/NOT c\.convalidated/.test(sql) ? fail : ok("21")));
  assert.equal(await source(invalidFails.exec).getConstraintHealth(), null);
});

// ---------------------------------------------------------------------------
// 18–22  BOUNDARIES: import graph, writes, side effects
// ---------------------------------------------------------------------------

test("S15C2-18  the adapter is never imported by production operational code", () => {
  const services = stripComments(read("src/trigger/operational/operational-services.ts"));
  assert.ok(!/throwaway-postgres-source/.test(services),
    "operational-services.ts must not import the local-only adapter");
  assert.match(services, /getRestoreEvidenceSource:\s*\(\)\s*=>\s*null/,
    "defaultOperationalDeps must still default to no restore source");
});

test("S15C2-19  the adapter performs no INSERT, UPDATE, or DELETE", () => {
  const adapterSrc = stripComments(read("src/lib/dr/adapters/throwaway-postgres-source.ts"));
  for (const verb of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i, /\bDROP\b/i, /\bALTER\b/i]) {
    assert.ok(!verb.test(adapterSrc), `the adapter must not write: ${verb}`);
  }
});

test("S15C2-20  no side-effect-capable import exists anywhere under src/lib/dr", () => {
  for (const { file, text } of drCode) {
    assert.ok(!/executeGeneration|TemporalClient|@\/lib\/temporal|@\/lib\/aws\/sqs|SendMessageCommand/i.test(text),
      `${file} reaches for a side effect`);
    assert.ok(!/reserveCredits|settleReservation|releaseReservation/.test(text), `${file} touches Phase 10 truth`);
    assert.ok(!/notification-service|webhook|PutObjectCommand|S3Client/i.test(text), `${file} reaches a delivery/write path`);
  }
});

test("S15C2-21  child_process is used only inside dockerExecPsql, and only to invoke docker", () => {
  const adapterSrc = stripComments(read("src/lib/dr/adapters/throwaway-postgres-source.ts"));
  const execFileCalls = [...adapterSrc.matchAll(/execFile\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(execFileCalls, ["docker"], "the only process this file ever spawns is docker");
});

test("S15C2-22  the verify/capture scripts never run as part of the default test glob", () => {
  // Neither script matches src/**/*.test.ts, so `npx tsx --test` never picks
  // them up and the fast suite never requires Docker.
  assert.ok(!("dr-restore-proof-verify.test.ts" in {}));
  const verify = read("scripts/dr-restore-proof-verify.ts");
  const capture = read("scripts/dr-restore-proof-capture-expected.ts");
  assert.ok(!verify.includes("node:test") && !capture.includes("node:test"),
    "these are standalone entry scripts, not test-runner files");
});

// ---------------------------------------------------------------------------
// 23–25  MIGRATION HARNESS DRIFT GUARD
// ---------------------------------------------------------------------------

test("S15C2-23  both throwaway-Postgres harnesses discover migrations dynamically, not by a hard-coded list", () => {
  const lib = read("supabase/tests/lib_pg_migrations.sh");
  assert.match(lib, /find\s+"\$root\/supabase\/migrations"/, "must enumerate the real migrations directory");
  assert.match(lib, /-name\s+'\*\.sql'/, "must glob for .sql files, not name them");

  const runTests = read("supabase/tests/run_pg_tests.sh");
  const runRestoreProof = read("supabase/tests/run_pg_restore_proof.sh");
  for (const [name, text] of [["run_pg_tests.sh", runTests], ["run_pg_restore_proof.sh", runRestoreProof]] as const) {
    assert.match(text, /apply_all_migrations/, `${name} must call the shared routine`);
    assert.match(text, /source .*lib_pg_migrations\.sh/, `${name} must source the shared library`);
  }
});

test("S15C2-24  the only migration filename the shared library may ever name IN CODE is the documented base-schema exclusion", () => {
  // Comment-stripped: the file's own header narrates the bug this rewrite
  // fixes, including the exact filename that was once missing — that prose
  // must not be read as the library re-hard-coding it.
  const lib = stripShellComments(read("supabase/tests/lib_pg_migrations.sh"));
  const migrationFiles = readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));

  for (const file of migrationFiles) {
    if (file === "20260805132704_remote_schema.sql") continue;
    assert.ok(!lib.includes(file), `${file} must not be named literally — it should be discovered by the glob`);
  }
  assert.ok(lib.includes("20260805132704_remote_schema.sql"),
    "the one documented exclusion must still be named, in code, with its reason");
});

test("S15C2-25  the migration list is NUL-delimited, so a path containing a space cannot break discovery", () => {
  // This exact bug was hit during implementation: `for f in $(find ...)`
  // word-splits on the space in this repository's own path ("Wep sitem"),
  // silently truncating every filename after the first space. -print0/-d ''
  // is the fix, pinned here so it cannot regress. Comment-stripped for the
  // same reason as S15C2-24 — the fix's own explanatory comment quotes the
  // anti-pattern in backticks as an example of what NOT to write.
  const lib = stripShellComments(read("supabase/tests/lib_pg_migrations.sh"));
  assert.match(lib, /-print0/);
  assert.match(lib, /read\s+-r\s+-d\s+''/);
  assert.ok(!/for f in \$\(find/.test(lib), "must not word-split a find(1) substitution");
});
