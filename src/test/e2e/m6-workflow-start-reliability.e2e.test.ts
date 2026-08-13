import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runWorkflowStartRelay, type RelayDeps } from "@/lib/orchestration/workflow-start-relay";
import { generationWorkflowId } from "@/lib/temporal/workflow-ids";
import type { WorkflowStartIntent } from "@/lib/orchestration/workflow-start-intent";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * M6 — DB commit must not be able to mean "started" on its own.
 *
 * These exercise the relay against doubles rather than a live Temporal
 * namespace: the property under test is what the relay DOES with each
 * outcome Temporal can produce, and a real server cannot be made to crash on
 * cue. The database-side guarantees (atomic intent creation, claim races,
 * lease recovery) are proven separately in PostgreSQL — see
 * supabase/tests/workflow_start_outbox_test.sql — because they are
 * constraint and locking behaviour, not application logic.
 */

const ROOT = process.cwd();
const admin = {} as SupabaseClient;

function intent(overrides: Partial<WorkflowStartIntent> = {}): WorkflowStartIntent {
  const generationId = overrides.generationId ?? "11111111-1111-4111-8111-111111111111";
  return {
    generationId,
    workflowId: generationWorkflowId(generationId),
    clerkUserId: "user_test",
    attempts: 1,
    claimToken: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  };
}

function deps(overrides: Partial<RelayDeps> = {}): RelayDeps {
  return {
    temporalEnabled: () => true,
    claim: async () => [intent()],
    start: async () => ({ workflowId: "gen:x", runId: "run" }),
    markDelivered: async () => true,
    markFailed: async () => true,
    ...overrides,
  };
}

test("H. the workflow id is a pure function of the generation id", () => {
  const a = generationWorkflowId("abc");
  const b = generationWorkflowId("abc");
  assert.equal(a, b);
  assert.notEqual(a, generationWorkflowId("abd"));
});

test("D. a start that Temporal already has is DELIVERED, not a failure", async () => {
  // WorkflowIdConflictPolicy.USE_EXISTING makes the SDK return normally for a
  // workflow that is already running. The obligation was that a workflow
  // exists — not that this caller created it.
  let delivered = 0;
  const result = await runWorkflowStartRelay(
    admin,
    {},
    deps({
      start: async () => ({ workflowId: "gen:already-running", runId: "earlier-run" }),
      markDelivered: async () => {
        delivered += 1;
        return true;
      },
    })
  );

  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 0);
  assert.equal(delivered, 1);
});

test("F. Temporal unavailable leaves the intent OWED, never terminal", async () => {
  let failedCalls = 0;
  let terminalCalls = 0;
  const result = await runWorkflowStartRelay(
    admin,
    {},
    deps({
      start: async () => {
        throw Object.assign(new Error("connection refused"), { name: "TransportError" });
      },
      markFailed: async (_a, _g, _t, code) => {
        failedCalls += 1;
        assert.equal(code, "TransportError", "sanitized class name, never the message");
        return true;
      },
      markDelivered: async () => {
        terminalCalls += 1;
        return true;
      },
    })
  );

  assert.equal(result.delivered, 0);
  assert.equal(result.failed, 1);
  assert.equal(failedCalls, 1);
  assert.equal(terminalCalls, 0);
});

test("F. a failed delivery never falls back to another execution owner", async () => {
  // The relay's only collaborator is the workflow starter. If a fallback ever
  // appeared it would have to be imported here, so the import list is the
  // assertion.
  const source = readFileSync(
    path.join(ROOT, "src/lib/orchestration/workflow-start-relay.ts"),
    "utf8"
  );
  // Import STATEMENTS only. Matching the whole prelude would match the
  // header comment, which names these things precisely to say it does not
  // use them.
  const imports = source.match(/^import .*$/gm)?.join("\n") ?? "";

  assert.ok(!/executeGeneration|orchestrator/.test(imports), "no inline execution path");
  assert.ok(!/trigger|bullmq/i.test(imports), "no auxiliary-plane owner");
  assert.ok(!/submitToProvider|provider-registry/.test(imports), "no provider submission");
  assert.ok(!/credit|settle|reserve/i.test(imports), "no billing authority");
});

test("J. the relay cannot create a generation or submit provider work", () => {
  const source = readFileSync(
    path.join(ROOT, "src/lib/orchestration/workflow-start-relay.ts"),
    "utf8"
  );
  // Comments are stripped: the relay's header names create_generation_tx to
  // explain where intents come from, and matching prose would fail on the
  // documentation rather than on the behaviour.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.ok(!/rpc\(\s*["']create_generation_tx/.test(code), "cannot create a generation");
  assert.ok(!/\.submit\(/.test(code), "cannot submit to a provider");
  assert.ok(!/from\(["']generations["']\)/.test(code), "does not write generation state");
  assert.ok(!/from\(["']credit_/.test(code), "does not touch credit tables");
});

test("E. a lost claim lease is not treated as a delivered start", async () => {
  // markDelivered returning false means another relay reclaimed the row while
  // this one was working. Counting it as delivered would let two relays both
  // believe they own the outcome.
  const result = await runWorkflowStartRelay(
    admin,
    {},
    deps({ markDelivered: async () => false })
  );

  assert.equal(result.delivered, 0);
  assert.equal(result.failed, 1);
});

test("a stored workflow id that disagrees with the derived one is refused", async () => {
  let started = 0;
  let failureCode: string | undefined;
  await runWorkflowStartRelay(
    admin,
    {},
    deps({
      claim: async () => [intent({ workflowId: "gen:something-else" })],
      start: async () => {
        started += 1;
        return { workflowId: "x", runId: "y" };
      },
      markFailed: async (_a, _g, _t, code) => {
        failureCode = code;
        return true;
      },
    })
  );

  assert.equal(started, 0, "never start a workflow id nothing can correlate back");
  assert.equal(failureCode, "workflow_id_mismatch");
});

test("the relay declines entirely when Temporal does not own generations here", async () => {
  let claims = 0;
  const result = await runWorkflowStartRelay(
    admin,
    {},
    deps({
      temporalEnabled: () => false,
      claim: async () => {
        claims += 1;
        return [intent()];
      },
    })
  );

  assert.equal(result.skipped, true);
  assert.equal(claims, 0, "claiming would burn the attempt counter for nothing");
  assert.equal(result.claimed, 0);
});

test("backoff grows with attempts and is capped", async () => {
  const delays: number[] = [];
  for (const attempts of [1, 2, 3, 10]) {
    await runWorkflowStartRelay(
      admin,
      {},
      deps({
        claim: async () => [intent({ attempts })],
        start: async () => {
          throw new Error("down");
        },
        markFailed: async (_a, _g, _t, _c, delay) => {
          delays.push(delay as number);
          return true;
        },
      })
    );
  }

  assert.deepEqual(delays.slice(0, 3), [30, 60, 120]);
  assert.equal(delays[3], 900, "capped rather than growing without bound");
});

test("A/B. the start intent is created inside create_generation_tx, not after it", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260818000000_workflow_start_outbox.sql"),
    "utf8"
  );

  const fnStart = migration.indexOf("CREATE OR REPLACE FUNCTION \"public\".\"create_generation_tx\"");
  const fnEnd = migration.indexOf("ALTER FUNCTION \"public\".\"create_generation_tx\"");
  assert.ok(fnStart > 0 && fnEnd > fnStart);

  const body = migration.slice(fnStart, fnEnd);
  assert.ok(
    /INSERT INTO workflow_start_outbox/.test(body),
    "the intent must be written by the same function, in the same transaction"
  );

  // The insert must sit after the generations insert and before the success
  // return — i.e. inside the created branch, not in a replay branch.
  const genInsert = body.indexOf("INSERT INTO generations");
  const intentInsert = body.indexOf("INSERT INTO workflow_start_outbox");
  assert.ok(genInsert > 0 && intentInsert > genInsert);
});

test("the relay cannot resurrect generations that predate the mechanism", () => {
  // The 20260818000000 backfill left an intent pending for every existing
  // non-terminal generation, which on the live database meant 91 abandoned
  // `queued` rows from early August. Pending means owed, so the relay's first
  // pass would have started 91 workflows for work nobody asked for. The
  // correction retires them; this locks that in.
  const correction = readFileSync(
    path.join(ROOT, "supabase/migrations/20260818010000_retire_historical_start_intents.sql"),
    "utf8"
  );

  assert.ok(/UPDATE "public"."workflow_start_outbox"/.test(correction));
  assert.ok(/'delivered'/.test(correction), "historical intents are retired, not left owed");
  assert.ok(
    /g\."created_at" < TIMESTAMPTZ/.test(correction),
    "cut off by generation age, so new generations keep their obligation"
  );
  // It must not touch generation state — deciding what to do with the
  // stranded rows themselves is a human call.
  assert.ok(!/UPDATE "public"."generations"/.test(correction));
});

test("K. one generation can hold at most one start intent", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260818000000_workflow_start_outbox.sql"),
    "utf8"
  );
  assert.ok(
    /CONSTRAINT "workflow_start_outbox_pkey" PRIMARY KEY \("generation_id"\)/.test(migration),
    "the primary key is what makes a second intent impossible"
  );
});

test("the intent table carries no secret", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260818000000_workflow_start_outbox.sql"),
    "utf8"
  );
  const table = migration.slice(
    migration.indexOf('CREATE TABLE IF NOT EXISTS "public"."workflow_start_outbox"'),
    migration.indexOf('ALTER TABLE "public"."workflow_start_outbox" OWNER')
  );

  // Column NAMES only. `claim_token` is a lease id, not a credential, and
  // `..._pkey` is a constraint name — neither is a payload field.
  const columns = [...table.matchAll(/^\s{4}"([a-z_]+)"\s/gm)].map((m) => m[1]);

  assert.ok(columns.length > 0, "column list must be parseable");
  assert.deepEqual(
    columns.filter((c) => /secret|password|session|jwt|api_key|credential/i.test(c)),
    [],
    "no credential-bearing column"
  );
  // And the payload is identifiers only — no free-form blob to hide one in.
  assert.ok(!/jsonb/.test(table), "no arbitrary payload column");
});

test("the intent table is server-only", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260818000000_workflow_start_outbox.sql"),
    "utf8"
  );
  assert.ok(/ENABLE ROW LEVEL SECURITY/.test(migration));
  assert.ok(/REVOKE ALL ON TABLE "public"."workflow_start_outbox" FROM "anon"/.test(migration));
  assert.ok(
    /REVOKE ALL ON TABLE "public"."workflow_start_outbox" FROM "authenticated"/.test(migration)
  );
  assert.ok(!/CREATE POLICY[^;]*workflow_start_outbox/.test(migration), "no permissive policy");
});

test("the inline fast path retires the intent only AFTER a successful start", () => {
  const source = readFileSync(
    path.join(ROOT, "src/lib/orchestration/generation-execution-service.ts"),
    "utf8"
  );
  const startCall = source.indexOf("await deps.startWorkflow(");
  const retire = source.indexOf("await deps.resolveStartIntent(");

  assert.ok(startCall > 0 && retire > startCall, "clearing the obligation first would lose it");
});
