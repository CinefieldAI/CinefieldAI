import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * PHASE 6R CLOSURE AUDIT (6R-G / 6R-A).
 *
 * The parts of 6R-G that a TypeScript test can honestly prove, plus the
 * ownership matrix as an executable artifact rather than a paragraph in a
 * report that drifts the week after it is written.
 *
 * WHAT IS DELIBERATELY NOT HERE: every guarantee that depends on database
 * concurrency. Those live in supabase/tests/ and run against a throwaway
 * PostgreSQL with genuinely parallel connections — attempt claim race,
 * duplicate reserve, duplicate settle, settle-vs-refund, TOCTOU overdraw,
 * terminal transition race, outbox claim. A sequential JavaScript test
 * calling a function twice would prove idempotency under no contention and
 * nothing about locks, and calling that "concurrency" would be a lie.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

// ===========================================================================
// G1 — THE REAL CONCURRENCY HARNESS EXISTS AND IS WIRED
// ===========================================================================

test("G1: the real-PostgreSQL harness exists, applies the real migrations, and races real connections", () => {
  const runner = readSource("supabase/tests/run_pg_tests.sh");

  // Throwaway container, never Supabase.
  assert.ok(/postgres:16-alpine/.test(runner), "an isolated PostgreSQL image is used");
  assert.ok(/docker rm -f/.test(runner) && /trap cleanup EXIT/.test(runner), "it is destroyed after");
  assert.ok(!/supabase\.co|SUPABASE_/.test(runner), "the harness must never reach production Supabase");

  // The REAL migrations, not copies.
  for (const migration of [
    "20260810120000_generation_attempts.sql",
    "20260811120000_credit_system.sql",
    "20260812130000_outbox_events.sql",
    "20260813000000_cancellation_outbox.sql",
    "20260814000000_finalization_outbox.sql",
  ]) {
    assert.ok(runner.includes(migration), `${migration} must be applied verbatim`);
  }

  // Genuinely parallel processes, joined with wait — not sequential calls.
  assert.ok(/race\(\)/.test(runner), "a parallel race helper exists");
  assert.ok(/>\/dev\/null 2>&1 &/.test(runner), "racers are launched as background processes");
  assert.ok(/wait "\$pid"/.test(runner) || /wait "\$\{pids/.test(runner), "and joined");

  // Every race the closure depends on is actually invoked.
  for (const race of [
    "provider attempt claim",
    "duplicate credit reserve",
    "duplicate settle",
    "settle vs refund",
    "insufficient funds",
    "terminal transition",
    "claim concurrency",
  ]) {
    assert.ok(runner.includes(race), `the "${race}" race must be driven by the harness`);
  }
});

test("G1: no database concurrency claim is made by the in-memory double", () => {
  // The double is a transport stand-in. Its own header must say so, and the
  // suites that use it must not describe its results as DB concurrency.
  const fake = readSource("src/test/e2e/fake-supabase.ts");
  assert.ok(
    /NOT prove the transactional guarantee|not a logic double/i.test(fake),
    "the double must state its scope"
  );

  const dataEvent = readSource("src/test/e2e/data-event-foundation.e2e.test.ts");
  assert.ok(
    /cannot be: a\s*\n?\s*\* TypeScript double has no transactions|has no transactions/.test(dataEvent),
    "the suite using it must disclaim the transactional guarantee"
  );
});

// ===========================================================================
// G8 — PROVIDER EVENT UNIQUENESS: REPORTED, NOT ASSUMED
// ===========================================================================

test("G8: there is no provider_event_id table, and nothing pretends there is", () => {
  const migrations = readdirSync(join(root, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readSource(join("supabase/migrations", f)))
    .join("\n");

  assert.ok(
    !/provider_event_id/.test(migrations),
    "no provider_event_id column or table exists — PROVIDER_EVENT_DB_UNIQUENESS is false"
  );

  // What DOES dedupe a callback today, at the database level: one external
  // provider job may be claimed by at most one attempt.
  assert.ok(
    /generation_attempts_provider_job_uniq/.test(migrations),
    "UNIQUE(provider, provider_job_id) is the database-level correlation guard"
  );

  // Plus the attempt-state guard in the bridge, which is application level.
  const bridge = strip(readSource("src/lib/orchestration/webhook-temporal-bridge.ts"));
  assert.ok(
    /OBSERVABLE_ATTEMPT_STATUSES/.test(bridge),
    "replay protection above that is attempt-state based, i.e. application level"
  );
});

// ===========================================================================
// G16 — GENERATION STATE vs PROVIDER STATE: EVERY WRITER CLASSIFIED
// ===========================================================================

test("G16: every production writer of generations.status is enumerated and classified", () => {
  // Specifically a STATUS write. Writing the generations table is not by
  // itself a lifecycle transition — recordWorkflowCorrelation sets
  // temporal_workflow_id and is correct — so the scan targets updates whose
  // payload actually contains `status`.
  const WRITE = /from\(\s*["'`]generations["'`]\s*\)[\s\S]{0,120}?\.update\(\s*\{[^}]*\bstatus\s*:/g;

  const production = [
    ...walk(join(root, "src/lib")),
    ...walk(join(root, "src/app")),
    ...walk(join(root, "worker")),
    ...walk(join(root, "src/trigger")),
  ];

  const writers: string[] = [];
  for (const file of production) {
    const code = strip(readFileSync(file, "utf8"));
    if (WRITE.test(code)) writers.push(file.slice(root.length + 1).replace(/\\/g, "/"));
    WRITE.lastIndex = 0;
  }

  // Exactly two, and both are known:
  //   status-manager.ts   the sanctioned state machine, whose terminal
  //                       transitions now all go through SQL functions
  //   the legacy Gemini route — the documented second lifecycle owner,
  //                       Phase 5 convergence scope, deliberately untouched
  assert.deepEqual(
    writers.sort(),
    [
      "src/app/api/generations/[generationId]/execute/route.ts",
      "src/lib/orchestration/status-manager.ts",
    ],
    "a NEW writer of generations.status appeared — every one must be classified against Temporal ownership"
  );
});

test("G16: the provider-facing surfaces write attempt state only, never generation state", () => {
  for (const file of [
    "worker/provider-command-handler.ts",
    "worker/provider-worker.ts",
    "src/lib/orchestration/webhook-temporal-bridge.ts",
  ]) {
    const code = strip(readSource(file));
    assert.ok(
      !/from\(\s*["'`]generations["'`]\s*\)[\s\S]{0,200}?\.update\(/.test(code),
      `${file} must not write generation state`
    );
    assert.ok(
      !/markCompleted|markFailed|markCancelled/.test(code),
      `${file} must not invoke a generation transition`
    );
  }
});

// ===========================================================================
// G18 — TENANT BINDING, AS IT ACTUALLY IS
// ===========================================================================

test("G18: the 6R objects are user-bound server-side; workspace binding is still absent", () => {
  const migrations = readdirSync(join(root, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readSource(join("supabase/migrations", f)))
    .join("\n");

  // The honest state: no workspace column anywhere. 6R.21 remains open.
  assert.ok(!/"workspace_id"/.test(migrations), "no workspace_id exists — 6R.21 is open");

  // What binds today, and where it comes from.
  assert.ok(/generations[\s\S]{0,3000}"clerk_user_id"/.test(migrations), "generations is user-bound");

  // generation_attempts is bound TRANSITIVELY via generation_id with an FK —
  // it has no owner column of its own, which is correct but must be stated.
  const attempts = readSource("supabase/migrations/20260810120000_generation_attempts.sql");
  assert.ok(
    /FOREIGN KEY \("generation_id"\) REFERENCES "public"\."generations"/.test(attempts),
    "attempts are tenant-bound transitively through the generation FK"
  );
  assert.ok(!/clerk_user_id/.test(attempts), "and deliberately carry no second copy of the owner");

  // Nothing accepts an owner from a message or a request body.
  const wire = readSource("src/lib/contracts/command-wire.ts");
  assert.ok(!/clerkUserId|workspaceId|userId/.test(wire), "no owner travels on the command wire");

  const handler = readSource("worker/provider-command-handler.ts");
  assert.ok(
    /clerkUserId: generation\.clerk_user_id/.test(handler),
    "the worker derives the owner from the durable row"
  );
});

// ===========================================================================
// G27 — THE KNOWN CONVERGENCE BLOCKERS, RE-AUDITED
// ===========================================================================

test("G27: /api/generate still does not exist, and the legacy owner is still present", () => {
  assert.equal(
    existsSync(join(root, "src/app/api/generate/route.ts")),
    false,
    "API_GENERATE_EXISTS=false — Phase 5 convergence is still outstanding"
  );

  const legacy = join(root, "src/app/api/generations/[generationId]/execute/route.ts");
  assert.ok(statSync(legacy).isFile(), "the legacy Gemini route is still present");

  const code = strip(readFileSync(legacy, "utf8"));
  // It genuinely is a second lifecycle owner: it claims, calls a paid
  // provider, uploads, and finalizes inline. Asserted so the blocker cannot
  // quietly disappear from a report while remaining in the code.
  assert.ok(/\.eq\("status", "queued"\)/.test(code), "it performs its own claim");
  assert.ok(/status: "completed"/.test(code), "and its own completion");
  assert.ok(
    !/startGenerationWorkflow|getCommandBus|submitAttempt/.test(code),
    "bypassing Temporal, SQS and the attempt ledger entirely"
  );
});

test("G27: the browser hook still keys its polling off the retired trigger contract", () => {
  const hook = readSource("src/hooks/useGeneration.ts");
  assert.ok(
    /execJson\.mode === "trigger"/.test(hook),
    "CLIENT_TEMPORAL_CONTRACT_CONVERGED=false — the hook polls only on the retired mode field, " +
      "so enabling Temporal ownership would show a failure for a generation that succeeded"
  );
});

// ===========================================================================
// G26 / G28 — THE OWNERSHIP MATRIX, AS AN EXECUTABLE ARTIFACT
// ===========================================================================

/**
 * Intended role per v1.6, and how the claim is checked. `compliant` records
 * the state of the repository, not an aspiration — one entry is deliberately
 * false, and the matrix is honest about which.
 */
const OWNERSHIP_MATRIX = [
  {
    plane: "Temporal",
    intended: "the only generation lifecycle owner",
    check: () => {
      const service = strip(readSource("src/lib/orchestration/generation-execution-service.ts"));
      return /startWorkflow/.test(service) && !/generationTask|runDirect\(\)\s*fallback/.test(service);
    },
    compliant: true,
  },
  {
    plane: "AWS SQS + DLQ",
    intended: "the only critical generation/provider command transport",
    check: () => {
      const activities = strip(readSource("worker/activities/generation-activities.ts"));
      const topology = readSource("src/lib/aws/sqs-topology.ts");
      return /getCommandBus\(\)\.enqueue/.test(activities) && /dlqName/.test(topology);
    },
    compliant: true,
  },
  {
    plane: "Provider Worker",
    intended: "executes commands; owns no lifecycle",
    check: () => {
      const handler = strip(readSource("worker/provider-command-handler.ts"));
      return !/markCompleted|startGenerationWorkflow/.test(handler);
    },
    compliant: true,
  },
  {
    plane: "BullMQ + Redis B",
    intended: "auxiliary short jobs only",
    check: () =>
      walk(join(root, "src/lib/bullmq")).every((file) => {
        const code = strip(readFileSync(file, "utf8"));
        return !/executeGeneration|submitAttempt|markCompleted|reserve_credits/.test(code);
      }),
    compliant: true,
  },
  {
    plane: "Trigger.dev",
    intended: "operations only — cron, health, reconciliation, cleanup, audit, cost",
    check: () =>
      walk(join(root, "src/trigger/operational")).every((file) => {
        const code = strip(readFileSync(file, "utf8"));
        return !/executeGeneration|startGenerationWorkflow|markCompleted/.test(code);
      }),
    compliant: true,
  },
  {
    plane: "PostgreSQL",
    intended: "the durable source of truth",
    check: () => {
      const manager = readSource("src/lib/orchestration/status-manager.ts");
      return (
        manager.includes('admin.rpc("complete_generation_tx"') &&
        manager.includes('admin.rpc("fail_generation_tx"') &&
        manager.includes('admin.rpc("cancel_generation_tx"')
      );
    },
    compliant: true,
  },
  {
    plane: "Postgres Outbox",
    intended: "the durable event reliability boundary",
    check: () => {
      const migration = readSource("supabase/migrations/20260814000000_finalization_outbox.sql");
      return /emit_outbox_event\(/.test(migration) && /IF NOT FOUND THEN/.test(migration);
    },
    compliant: true,
  },
  {
    plane: "Kafka/MSK",
    intended: "optional, scale-triggered distribution — never required for durability",
    check: () => {
      const manager = strip(readSource("src/lib/orchestration/status-manager.ts"));
      return !/kafka/i.test(manager);
    },
    compliant: true,
  },
  {
    plane: "Redis A",
    intended: "application transient state only",
    check: () =>
      walk(join(root, "src/lib/redis")).every((file) => {
        const code = strip(readFileSync(file, "utf8"));
        return !/from\(["'`]generations["'`]\)/.test(code);
      }),
    compliant: true,
  },
  {
    plane: "Legacy Gemini route",
    intended: "must not exist as a lifecycle owner",
    // The one non-compliant entry, recorded rather than omitted. Marking the
    // matrix "all green" while this route still claims, calls a paid
    // provider, uploads and finalizes would be the single most misleading
    // thing this audit could do.
    check: () => existsSync(join(root, "src/app/api/generations/[generationId]/execute/route.ts")),
    compliant: false,
  },
] as const;

test("G26/G28: the ownership matrix matches the repository, including where it does not comply", () => {
  for (const entry of OWNERSHIP_MATRIX) {
    assert.equal(
      entry.check(),
      true,
      `${entry.plane}: the matrix's own check failed — intended role "${entry.intended}"`
    );
  }

  const nonCompliant = OWNERSHIP_MATRIX.filter((e) => !e.compliant).map((e) => e.plane);
  assert.deepEqual(
    nonCompliant,
    ["Legacy Gemini route"],
    "exactly one known non-compliant plane; a new one must be declared, not discovered later"
  );
});

test("G32: Phase 6R cannot be declared complete while a second lifecycle owner exists", () => {
  const secondOwnerExists = existsSync(
    join(root, "src/app/api/generations/[generationId]/execute/route.ts")
  );
  const apiGenerateExists = existsSync(join(root, "src/app/api/generate/route.ts"));

  // The completion rule, expressed as code so it cannot be argued around in
  // prose: while the second owner is present, PHASE_6R_COMPLETE is false.
  const phase6rComplete = !secondOwnerExists && apiGenerateExists;
  assert.equal(
    phase6rComplete,
    false,
    "if this ever passes as true, update the closure report — do not relax the rule"
  );
});

// ===========================================================================
// SECRET AND MIGRATION REVIEW (G24 / G25)
// ===========================================================================

test("G24: no tracked Phase 6R file carries a real secret", () => {
  const SECRET_PATTERNS: [string, RegExp][] = [
    ["aws access key", /AKIA[0-9A-Z]{16}/],
    ["openai-style key", /\bsk-[A-Za-z0-9]{20,}/],
    ["redis url with credentials", /rediss?:\/\/[^\s"']*:[^\s"'@]+@(?!(?:shared|app|queue|h)\.example)/],
    ["jwt", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
    ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY/],
    ["slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ];

  const files = [
    ...walk(join(root, "src")),
    ...walk(join(root, "worker")),
    ...readdirSync(join(root, "supabase/migrations")).map((f) => join(root, "supabase/migrations", f)),
    ...readdirSync(join(root, "supabase/tests")).map((f) => join(root, "supabase/tests", f)),
    join(root, ".env.example"),
  ];

  for (const file of files) {
    if (!existsSync(file) || statSync(file).isDirectory()) continue;
    const content = readFileSync(file, "utf8");
    for (const [label, pattern] of SECRET_PATTERNS) {
      assert.ok(
        !pattern.test(content),
        // The path and the kind only — never the matched value.
        `possible ${label} in ${file.slice(root.length + 1)}`
      );
    }
  }
});

test("G25: every Phase 6R migration is additive, idempotent, and search_path-safe", () => {
  const PHASE_6R = readdirSync(join(root, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql") && f > "20260810")
    .sort();

  assert.ok(PHASE_6R.length >= 5, "the Phase 6R migrations are present");

  // Ordering: filenames sort chronologically, so a later migration can rely
  // on an earlier one's objects.
  assert.deepEqual(PHASE_6R, [...PHASE_6R].sort(), "migrations must apply in filename order");

  for (const name of PHASE_6R) {
    const sql = readSource(join("supabase/migrations", name));

    // Nothing destructive.
    assert.ok(
      !/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bDROP\s+COLUMN\b/i.test(sql),
      `${name} contains a destructive statement`
    );

    // Re-runnable.
    const creates = sql.match(/CREATE\s+(TABLE|INDEX|UNIQUE INDEX)\s+(?!IF NOT EXISTS)/gi) ?? [];
    assert.equal(creates.length, 0, `${name} has a CREATE without IF NOT EXISTS`);

    // Every SECURITY DEFINER function pins search_path — otherwise a caller
    // could shadow the tables and functions it references.
    //
    // Counted from the function DEFINITION, not from every occurrence of the
    // phrase: these migrations explain the risk in their own comments, and a
    // naive count flags the explanation as if it were an unpinned function.
    const definers = (sql.match(/LANGUAGE "plpgsql" SECURITY DEFINER/g) ?? []).length;
    const pinned = (sql.match(/SET "search_path" TO 'public'/g) ?? []).length;
    assert.ok(
      definers === 0 || pinned >= definers,
      `${name}: ${definers} SECURITY DEFINER function(s) but only ${pinned} search_path pin(s)`
    );
  }
});

test("G25: the new finalization functions are least-privilege", () => {
  const migration = readSource("supabase/migrations/20260814000000_finalization_outbox.sql");
  for (const fn of ["complete_generation_tx", "fail_generation_tx"]) {
    assert.ok(
      new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${fn}"[^;]*FROM PUBLIC`).test(migration),
      `${fn} must be revoked from PUBLIC`
    );
    assert.ok(
      new RegExp(`GRANT EXECUTE ON FUNCTION "public"\\."${fn}"[^;]*TO "service_role"`).test(migration),
      `${fn} must be granted only to service_role`
    );
  }

  // The rollback probe is a test affordance and must reach nobody.
  assert.ok(
    /REVOKE ALL ON FUNCTION "public"\."finalization_rollback_probe"[^;]*FROM PUBLIC/.test(migration),
    "the test probe must not be callable by an application role"
  );
  assert.ok(
    !/GRANT EXECUTE ON FUNCTION "public"\."finalization_rollback_probe"/.test(migration),
    "the test probe must have no grant at all"
  );
});
