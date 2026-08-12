import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Architectural regression tests for the Trigger.dev role boundary
 * (Phase 6R.11, Step 17).
 *
 * These assert against the SOURCE TEXT rather than runtime behavior,
 * because the property being protected is structural: an operational task
 * must not even be able to reach generation-ownership code. A runtime test
 * can only show that a particular call path did not happen this time; a
 * static import check shows the capability is absent entirely, and it will
 * fail loudly the day someone adds the import.
 *
 * Pure filesystem reads — no network, no database, no Trigger.dev SDK.
 */

const OPERATIONAL_DIR = join(process.cwd(), "src", "trigger", "operational");
const TRIGGER_DIR = join(process.cwd(), "src", "trigger");

function operationalSourceFiles(): { name: string; source: string }[] {
  return readdirSync(OPERATIONAL_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((name) => ({ name, source: readFileSync(join(OPERATIONAL_DIR, name), "utf8") }));
}

/** Strips block and line comments so a doc comment mentioning a symbol never trips a check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The capabilities that would make a task a generation lifecycle owner. */
const FORBIDDEN_IMPORTS = [
  "executeGeneration",
  "submitAttempt",
  "claimAttemptForSubmission",
  "startGenerationWorkflow",
  "getTemporalClient",
  "getCommandBus",
  "provider-adapter",
  "provider-registry",
  "checkAsyncGeneration",
  "markCompleted",
  "recordProviderJob",
];

test("no operational file imports any generation-ownership capability", () => {
  for (const { name, source } of operationalSourceFiles()) {
    const code = stripComments(source);
    for (const forbidden of FORBIDDEN_IMPORTS) {
      assert.ok(
        !code.includes(forbidden),
        `${name} must not reference ${forbidden} — an operational task cannot own generation lifecycle`
      );
    }
  }
});

test("no operational file can submit to a provider or finalize a generation", () => {
  for (const { name, source } of operationalSourceFiles()) {
    const code = stripComments(source);
    assert.ok(!/\badapter\.submit\s*\(/.test(code), `${name} must not call a provider adapter`);
    assert.ok(!/\bfinalize\w*\s*\(/i.test(code), `${name} must not finalize a generation`);
    assert.ok(!/signalWithStart/.test(code), `${name} must not start a workflow`);
  }
});

test("no operational file writes generation or attempt STATE - reads and one allow-listed RPC only", () => {
  for (const { name, source } of operationalSourceFiles()) {
    const code = stripComments(source);
    // No direct table writes on the generation lifecycle tables.
    assert.ok(!/\.update\s*\(/.test(code), `${name} must not UPDATE any table directly`);
    assert.ok(!/\.insert\s*\(/.test(code), `${name} must not INSERT any row`);
    assert.ok(!/\.delete\s*\(/.test(code), `${name} must not DELETE any row`);
    assert.ok(!/\.upsert\s*\(/.test(code), `${name} must not UPSERT any row`);
  }
});

test("the ONLY RPC any operational file may call is the existing idempotent credit-expiry function", () => {
  const rpcNames = new Set<string>();
  for (const { source } of operationalSourceFiles()) {
    const code = stripComments(source);
    for (const match of code.matchAll(/\.rpc\(\s*["'`]([^"'`]+)["'`]/g)) {
      rpcNames.add(match[1]);
    }
  }
  assert.deepEqual(
    [...rpcNames].sort(),
    ["expire_stale_reservations"],
    "any new RPC must be reviewed against the operational boundary before being added"
  );
});

test("operational tasks are task(), never schedules.task() - no cadence is silently enabled", () => {
  const source = readFileSync(join(OPERATIONAL_DIR, "operational-tasks.ts"), "utf8");
  const code = stripComments(source);
  assert.ok(!code.includes("schedules."), "no recurring schedule may be enabled without explicit review");
  assert.ok(code.includes("task({"), "operational jobs are defined as manually invokable tasks");
});

test("no operational file performs a storage delete or a restore", () => {
  for (const { name, source } of operationalSourceFiles()) {
    const code = stripComments(source);
    assert.ok(!/storage[\s\S]{0,40}\.remove\s*\(/.test(code), `${name} must not remove storage objects`);
    assert.ok(!/\brestore\s*\(/i.test(code), `${name} must not perform a restore`);
  }
});

test("no operational file invents a provider price or mutates a balance", () => {
  for (const { name, source } of operationalSourceFiles()) {
    const code = stripComments(source);
    assert.ok(!/reserve_credits|grant_credits|settle_reservation|refund_reservation/.test(code),
      `${name} must not call a credit mutation function`);
    assert.ok(!/creditPricePerUnit\s*[:=]\s*[0-9]/.test(code), `${name} must not hardcode a credit price`);
    assert.ok(!/providerUnitCost\s*[:=]\s*[0-9]/.test(code), `${name} must not hardcode a provider cost`);
  }
});

// ---------------------------------------------------------------------------
// LEGACY BOUNDARY
// ---------------------------------------------------------------------------

test("the retired generation tasks are marked retired AND cannot run in production", () => {
  // Strengthened at the Phase 6R-B cutover. Until then these tasks were the
  // live production owner and the only assertable property was a doc marker.
  // Now they have no production caller, so the real invariant is enforceable:
  // they refuse to execute in a production process at all.
  for (const file of ["generation-task.ts", "async-continuation-task.ts"]) {
    const source = readFileSync(join(TRIGGER_DIR, file), "utf8");
    assert.ok(
      source.includes("RETIRED") && source.includes("Phase 6R-B"),
      `${file} must carry the 6R-B retirement marker so its ownership status is unambiguous`
    );
    assert.ok(
      /NODE_ENV === "production"/.test(stripComments(source)),
      `${file} must refuse to run in production — a dormant second owner is still a second owner`
    );
    assert.ok(
      /AbortTaskRunError/.test(stripComments(source)),
      `${file} must abort without retry: retrying cannot change the refusal`
    );
  }
});

test("the legacy continuation task still cannot submit - it imports only the check path", () => {
  // This property predates 6R.11 and must be preserved for as long as the
  // file exists: a continuation retry must never produce a second billable
  // provider job.
  const source = readFileSync(join(TRIGGER_DIR, "async-continuation-task.ts"), "utf8");
  const code = stripComments(source);
  assert.ok(code.includes("checkAsyncGeneration"), "the continuation reads status");
  assert.ok(!/\bexecuteGeneration\b/.test(code), "the continuation must never reach the submit path");
});

test("operational tasks do not import the legacy generation tasks", () => {
  for (const { name, source } of operationalSourceFiles()) {
    const code = stripComments(source);
    assert.ok(!code.includes("generation-task"), `${name} must not import the legacy generation task`);
    assert.ok(
      !code.includes("async-continuation-task"),
      `${name} must not import the legacy continuation task`
    );
  }
});
