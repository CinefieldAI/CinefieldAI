import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { familyOf } from "@/lib/events/domain-event";
import { topicForEventType } from "@/lib/events/event-topics";
import { resolveSchema } from "@/lib/events/schema-registry";

/**
 * THE GUARD THAT SHOULD HAVE EXISTED BEFORE 9-E.
 *
 * SQL and TypeScript each hold half of the event contract and neither can see
 * the other. `emit_outbox_event` checks only that the type is non-empty
 * (20260812130000:181); every real rule — the dotted shape, the known family,
 * the registered schema — lives in TypeScript. So a migration can emit a name
 * the consumer side will refuse, the row commits cleanly, and nothing notices
 * until a publisher runs. That is exactly what happened: 9-E emitted
 * `media.asset.released`, which has three segments and an unknown family, and
 * 966 tests stayed green because no test read the SQL.
 *
 * This test reads the SQL.
 *
 * IT READS IT THE WAY POSTGRES DOES. Migrations apply in filename order and
 * `CREATE OR REPLACE FUNCTION` replaces what came before, so what a function
 * emits IN PRODUCTION is whatever its LAST definition says — not what its
 * first one said. A scanner that flattened every file would report a repaired
 * function as still broken forever, which would make the only way to satisfy
 * it a rewrite of history. Superseded definitions are therefore skipped, and
 * that is not leniency: the effective definition is checked strictly, and the
 * test below proves the resolver actually supersedes rather than ignores.
 */

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

interface Emission {
  file: string;
  line: number;
  eventType: string;
  fn: string;
}

/** Filename order IS apply order. */
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/**
 * Every emission, grouped by the function that contains it, keeping only the
 * emissions belonging to each function's final definition.
 */
function effectiveEmissions(): { effective: Emission[]; superseded: Emission[] } {
  const byFunction = new Map<string, Emission[]>();
  const superseded: Emission[] = [];

  for (const file of MIGRATION_FILES) {
    const lines = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8").split(/\r?\n/);
    let fn = `(top level in ${file})`;
    const seenThisFile = new Set<string>();

    for (let i = 0; i < lines.length; i += 1) {
      const declared = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+"?public"?\."?([a-z_]+)"?/i.exec(lines[i]);
      if (declared) {
        fn = declared[1];
        // A redefinition supersedes everything that function emitted before.
        if (!seenThisFile.has(fn)) {
          const previous = byFunction.get(fn);
          if (previous) superseded.push(...previous);
          byFunction.set(fn, []);
          seenThisFile.add(fn);
        }
      }

      if (!/emit_outbox_event\s*\(/.test(lines[i])) continue;
      if (/^\s*--/.test(lines[i])) continue;

      // The literal sits on this line or the next; both layouts are in use.
      const literal = /emit_outbox_event\s*\(\s*'([^']*)'/.exec(`${lines[i]}\n${lines[i + 1] ?? ""}`);
      if (!literal) continue;

      const emission: Emission = { file, line: i + 1, eventType: literal[1], fn };
      const bucket = byFunction.get(fn);
      if (bucket) bucket.push(emission);
      else byFunction.set(fn, [emission]);
    }
  }

  return { effective: [...byFunction.values()].flat(), superseded };
}

const { effective: EFFECTIVE, superseded: SUPERSEDED } = effectiveEmissions();

/**
 * Proof and probe affordances emit synthetic types on purpose: the rollback
 * probes pass an empty type so `emit_outbox_event` RAISES and PostgreSQL
 * unwinds the write above it, and `outbox_tx_proof_run` emits `proof.executed`
 * into a dedicated proof aggregate. Neither is a product fact, and adding a
 * `proof` family to the production event model to accommodate a test harness
 * would corrupt the thing being protected.
 *
 * They are excluded — and the exclusion is asserted, not assumed: the name
 * must match this pattern AND the function must remain revoked from every
 * browser-reachable role. A "probe" that anyone can call is not a probe.
 */
const AFFORDANCE = /_rollback_probe$|_proof_run$/;

const PRODUCTION = EFFECTIVE.filter((e) => !AFFORDANCE.test(e.fn));
const AFFORDANCES = EFFECTIVE.filter((e) => AFFORDANCE.test(e.fn));

test("the scanner found the emissions it is meant to guard", () => {
  // A scanner that silently matched nothing would pass everything below.
  assert.ok(PRODUCTION.length >= 5, `expected several production emissions, found ${PRODUCTION.length}`);
  assert.ok(new Set(PRODUCTION.map((e) => e.file)).size >= 2, "emissions should span several migrations");
  assert.ok(AFFORDANCES.length >= 2, "the known probe/proof affordances should still be found");
});

test("the supersede resolver actually supersedes", () => {
  // Guards the mechanism this whole file depends on. 9-E's original
  // media.asset.* emissions must be classified as superseded by the 11-A
  // repair, and must NOT appear as effective.
  const retired = SUPERSEDED.filter((e) => e.eventType.startsWith("media."));
  assert.ok(
    retired.length === 2,
    `expected 9-E's two media.* emissions to be superseded, found ${retired.length}`
  );
  assert.ok(
    retired.every((e) => e.file === "20260823000000_quarantine_release_lane.sql"),
    "the superseded media.* emissions must be the 9-E ones"
  );
  assert.equal(
    EFFECTIVE.filter((e) => e.eventType.startsWith("media.")).length,
    0,
    "no media.* emission may remain effective"
  );
});

test("probe and proof affordances stay locked to service_role", () => {
  for (const affordance of AFFORDANCES) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, affordance.file), "utf8");
    for (const role of ["PUBLIC", '"anon"', '"authenticated"']) {
      assert.match(
        sql,
        new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${affordance.fn}"[^;]*(?:${role})`),
        `${affordance.fn} must stay revoked from ${role}`
      );
    }
  }
});

test("P11A-1: every production event type resolves through the TypeScript contract", () => {
  const failures: string[] = [];

  for (const e of PRODUCTION) {
    const where = `${e.file}:${e.line} (${e.fn})`;

    // 1. The dotted shape the envelope enforces: two lowercase segments.
    if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(e.eventType)) {
      failures.push(`${where}: "${e.eventType}" fails EVENT_TYPE_PATTERN`);
      continue;
    }
    // 2. A known family, or no consumer can classify it.
    if (familyOf(e.eventType) === null) {
      failures.push(`${where}: "${e.eventType}" has no known family`);
      continue;
    }
    // 3. A resolvable topic, or a producer must refuse to publish.
    if (topicForEventType(e.eventType) === null) {
      failures.push(`${where}: "${e.eventType}" resolves to no topic`);
      continue;
    }
    // 4. A registered schema at v1 — the version every SQL emitter passes.
    const schema = resolveSchema(e.eventType, 1);
    if (!schema.ok) failures.push(`${where}: "${e.eventType}" v1 is ${schema.reason}`);
  }

  assert.deepEqual(
    failures,
    [],
    `SQL emits event types the TypeScript contract refuses:\n  ${failures.join("\n  ")}`
  );
});

test("the retired three-segment media family is gone from effective SQL", () => {
  assert.deepEqual(
    PRODUCTION.filter((e) => e.eventType.startsWith("media.")).map((o) => `${o.file}:${o.line}`),
    [],
    "media.* was retired in favour of the canonical asset.* family"
  );
});

test("a redefinition does not silently drop what its predecessor did", () => {
  // The failure this catches actually happened while writing 11-A. The
  // migration replaced `create_generation_tx` using the 20260816 body as its
  // base, not the EFFECTIVE 20260818 body — so the M6 `workflow_start_outbox`
  // insert, which closes the DB->Temporal dual-write gap, vanished. The
  // PostgreSQL suite caught it (PROOF W1), but only because M6 had a proof.
  //
  // A general "no statement was lost" check is not expressible. A named
  // invariant is: whatever definition wins, creating a generation must still
  // record the obligation to start it, in the same transaction.
  let winner: string | null = null;
  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    if (/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+"public"\."create_generation_tx"/.test(sql)) {
      winner = sql;
    }
  }

  assert.ok(winner, "create_generation_tx must be defined by some migration");
  assert.match(
    winner,
    /INSERT INTO workflow_start_outbox/,
    "the effective create_generation_tx must still record the workflow start obligation (M6)"
  );
});

test("the 11-A lifecycle producers exist and emit the canonical types", () => {
  const types = new Set(PRODUCTION.map((e) => e.eventType));
  for (const required of [
    "generation.created",
    "generation.processing",
    "generation.completed",
    "generation.failed",
    "generation.cancelled",
    "asset.released",
    "asset.rejected",
  ]) {
    assert.ok(types.has(required), `no SQL producer emits ${required}`);
  }
});
