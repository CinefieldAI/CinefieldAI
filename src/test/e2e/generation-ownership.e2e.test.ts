import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, before, after, beforeEach } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { FakeSupabaseClient } from "./fake-supabase";
import { FakeSqsTransport, installFakeSupabase, uninstallFakeSupabase, seedGeneration,
  fakeR2Puts,
} from "./e2e-harness";
import { setCommandBus } from "@/lib/contracts/command-bus";
import { generationWorkflowId } from "@/lib/temporal/workflow-ids";
import { TASK_QUEUES } from "@/lib/temporal/task-queues";
import { __setTemporalClientForTesting } from "@/lib/temporal/client";
import { resolveGenerationOwner } from "@/lib/orchestration/execution-mode";
import { executeGenerationRequest } from "@/lib/orchestration/generation-execution-service";
import { startGenerationWorkflow } from "@/lib/temporal/generation-starter";
import { handleProviderCommand } from "../../../worker/provider-command-handler";
import * as activities from "../../../worker/activities/generation-activities";
import { setC2paSignerMode } from "@/lib/provenance/c2pa-embedder";

// ---------------------------------------------------------------------------
// PHASE 27 / 9-C: this suite drives the REAL finalization tail, which now
// embeds C2PA provenance into every canonical output. Production FAILS CLOSED
// with no signer configured — an unmarkable output is refused rather than
// completed unmarked — so these tests must install the DEVELOPMENT signer to
// exercise completion at all. That is exactly the dev/test allowance: it uses
// c2pa-node's own test certificate, which is never a production trust
// identity and is never the default (C2paSignerMode defaults to "none").
// ---------------------------------------------------------------------------
setC2paSignerMode("test");


/**
 * PRODUCTION GENERATION OWNERSHIP CUTOVER (Phase 6R-B).
 *
 * Drives the REAL production execution service — the same function
 * /api/orchestration/execute calls — against a real Temporal test server,
 * and proves the ownership invariants v1.6 makes binding:
 *
 *   Temporal is the only production owner
 *   Trigger.dev cannot be selected, by configuration or by request
 *   Temporal unavailable FAILS CLOSED, with no substitute owner
 *   a duplicate start joins one workflow identity, never a second
 *
 * Nothing is faked except the boundaries the rest of this suite already
 * fakes: the AWS transport, the Supabase/Storage network, and the provider
 * (via Cinefield's existing mock adapter). The owner resolution, the workflow
 * start, the workflow itself, its activities and the provider worker are all
 * production code.
 */

let env: TestWorkflowEnvironment;

/** Env keys this suite manipulates, restored after every test. */
const OWNED_ENV = [
  "TEMPORAL_GENERATION_ENABLED",
  "TEMPORAL_ADDRESS",
  "TEMPORAL_NAMESPACE",
  "TEMPORAL_API_KEY",
  "GENERATION_DIRECT_DEV_EXECUTION",
  "NODE_ENV",
] as const;

let savedEnv: Record<string, string | undefined> = {};

/**
 * Writes an env var. NODE_ENV is typed readonly, but the resolver's whole
 * production guard is `process.env.NODE_ENV !== "production"` — so a test
 * that cannot set it cannot prove the guard. The cast is confined here.
 */
function setEnv(key: string, value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[key];
  else env[key] = value;
}

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, { timeout: 240_000 });

after(async () => {
  __setTemporalClientForTesting(null);
  await env?.teardown();
  await uninstallFakeSupabase();
});

beforeEach(() => {
  savedEnv = Object.fromEntries(OWNED_ENV.map((k) => [k, process.env[k]]));
});

function restoreEnv(): void {
  for (const key of OWNED_ENV) {
    setEnv(key, savedEnv[key]);
  }
}

/**
 * Makes `resolveGenerationOwner()` return "temporal" for real — by setting
 * the same two keys production uses, not by stubbing the resolver. The
 * address is never dialled: `__setTemporalClientForTesting` primes the cache
 * with the test server's client first.
 */
function enableTemporalOwnership(): void {
  process.env.TEMPORAL_GENERATION_ENABLED = "true";
  process.env.TEMPORAL_ADDRESS = "test.invalid:7233";
  process.env.TEMPORAL_NAMESPACE = "cinefield-test";
  process.env.TEMPORAL_API_KEY = "not-a-real-key-unused-by-the-test-server";
  __setTemporalClientForTesting(env.client);
}

async function withWorker<T>(fn: () => Promise<T>): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUES.generation,
    workflowsPath: require.resolve("../../../worker/workflows/generation-workflow"),
    activities,
  });
  return worker.runUntil(fn());
}

async function scenario(mode = "async-success") {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const sqs = new FakeSqsTransport();
  setCommandBus(sqs);
  process.env.SQS_COMMAND_BUS_ENABLED = "true";
  process.env.CINEFIELD_SQS_PROVIDER_QUEUE_URL = "https://fake-sqs.invalid/queue.fifo";

  const { generationId, clerkUserId } = seedGeneration(db, { metadata: { mock_mode: mode } });

  sqs.consumer = async (raw) => {
    sqs.messages.push(raw);
    const next = sqs.receive();
    if (!next) return;
    const outcome = await handleProviderCommand(next.command);
    sqs.consumedReasons.push(outcome.reason);
  };

  return { db, sqs, generationId, clerkUserId };
}

const readSource = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

// ===========================================================================
// OWNER RESOLUTION
// ===========================================================================

test("6R-B: production resolves to Temporal when ownership is enabled and configured", () => {
  try {
    setEnv("NODE_ENV", "production");
    process.env.TEMPORAL_GENERATION_ENABLED = "true";
    process.env.TEMPORAL_ADDRESS = "ns.acct.tmprl.cloud:7233";
    process.env.TEMPORAL_NAMESPACE = "cinefield";
    process.env.TEMPORAL_API_KEY = "unused-by-this-assertion";
    assert.equal(resolveGenerationOwner(), "temporal");
  } finally {
    restoreEnv();
  }
});

test("6R-B: production with Temporal disabled resolves to unavailable, NEVER a fallback owner", () => {
  try {
    setEnv("NODE_ENV", "production");
    delete process.env.TEMPORAL_GENERATION_ENABLED;
    // Even with the dev escape explicitly set, a production build refuses it.
    process.env.GENERATION_DIRECT_DEV_EXECUTION = "true";

    assert.equal(
      resolveGenerationOwner(),
      "unavailable",
      "a production process must never adopt the dev execution path"
    );
  } finally {
    restoreEnv();
  }
});

test("6R-B: Temporal configured but not ENABLED is still unavailable - credentials never switch ownership", () => {
  try {
    setEnv("NODE_ENV", "production");
    delete process.env.TEMPORAL_GENERATION_ENABLED;
    process.env.TEMPORAL_ADDRESS = "ns.acct.tmprl.cloud:7233";
    process.env.TEMPORAL_NAMESPACE = "cinefield";
    process.env.TEMPORAL_API_KEY = "unused-by-this-assertion";
    assert.equal(resolveGenerationOwner(), "unavailable");
  } finally {
    restoreEnv();
  }
});

test("6R-B: the dev escape exists, but only outside production and only when asked for", () => {
  try {
    setEnv("NODE_ENV", "development");
    delete process.env.TEMPORAL_GENERATION_ENABLED;

    delete process.env.GENERATION_DIRECT_DEV_EXECUTION;
    assert.equal(resolveGenerationOwner(), "unavailable", "off by default even in dev");

    process.env.GENERATION_DIRECT_DEV_EXECUTION = "true";
    assert.equal(resolveGenerationOwner(), "direct-dev");
  } finally {
    restoreEnv();
  }
});

test("6R-B: no resolvable owner is named 'trigger' - Trigger.dev is not in the owner type at all", () => {
  const source = readSource("src/lib/orchestration/execution-mode.ts");
  // The union itself is the guarantee: there is no value a caller could pass
  // or an env var could produce that names Trigger.dev as an owner.
  assert.ok(
    /export type GenerationOwner\s*=[\s\S]*?;/.test(source),
    "the owner union is declared here"
  );
  const union = source.match(/export type GenerationOwner\s*=([\s\S]*?);/)![1];
  const members = [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(members, ["direct-dev", "temporal", "unavailable"]);
});

// ===========================================================================
// PRODUCTION SERVICE -> REAL TEMPORAL WORKFLOW
// ===========================================================================

test("6R-B: the production execution service starts the REAL GenerationWorkflow, which runs to a terminal generation", { timeout: 180_000 }, async () => {
  const { db, sqs, generationId, clerkUserId } = await scenario("async-success");
  try {
    enableTemporalOwnership();

    const result = await withWorker(async () => {
      // The production function the route calls. Nothing is stubbed.
      const outcome = await executeGenerationRequest({ generationId, clerkUserId });

      assert.equal(outcome.outcome, "started");
      assert.equal(outcome.outcome === "started" && outcome.owner, "temporal");
      assert.equal(
        outcome.outcome === "started" && outcome.workflowId,
        generationWorkflowId(generationId),
        "the workflow id is derived from the durable Cinefield generation id"
      );

      // Wait on the workflow the SERVICE started, by its deterministic id.
      return env.client.workflow.getHandle(generationWorkflowId(generationId)).result();
    });

    assert.equal(result.outcome, "completed", "the route-started workflow reached a terminal state");
    assert.equal(db.state.generations[0].status, "completed");
    assert.equal(db.state.generation_attempts[0].status, "succeeded");

    // The command plane was genuinely used on the way.
    assert.equal(sqs.enqueueCount, 1, "the workflow dispatched through the SQS command boundary");
    assert.deepEqual(sqs.consumedReasons, ["submitted:processing"]);
    assert.equal(fakeR2Puts.length, 1, "the real finalization stored exactly one canonical object");
  } finally {
    restoreEnv();
    __setTemporalClientForTesting(null);
  }
});

test("6R-B: the started workflow uses the SAME task queue and workflow type the existing worker serves", { timeout: 180_000 }, async () => {
  const { generationId, clerkUserId } = await scenario("async-pending");
  try {
    enableTemporalOwnership();

    // No worker is running here on purpose: a workflow that is merely
    // ACCEPTED proves the start parameters are well-formed, and describing it
    // proves the queue and type without needing it to execute.
    const outcome = await executeGenerationRequest({ generationId, clerkUserId });
    assert.equal(outcome.outcome, "started");

    const description = await env.client.workflow
      .getHandle(generationWorkflowId(generationId))
      .describe();

    assert.equal(description.taskQueue, TASK_QUEUES.generation, "same queue the worker consumes");
    assert.equal(description.type, "generationWorkflow", "same workflow type the worker registers");
    assert.equal(description.workflowId, generationWorkflowId(generationId));

    await env.client.workflow
      .getHandle(generationWorkflowId(generationId))
      .terminate("ownership scenario complete")
      .catch(() => {});
  } finally {
    restoreEnv();
    __setTemporalClientForTesting(null);
  }
});

// ===========================================================================
// DUPLICATE START
// ===========================================================================

test("6R-B: repeated and concurrent starts for one generation join ONE workflow identity", { timeout: 180_000 }, async () => {
  const { generationId, clerkUserId } = await scenario("async-pending");
  try {
    enableTemporalOwnership();

    const first = await executeGenerationRequest({ generationId, clerkUserId });
    const [second, third] = await Promise.all([
      executeGenerationRequest({ generationId, clerkUserId }),
      executeGenerationRequest({ generationId, clerkUserId }),
    ]);

    for (const outcome of [first, second, third]) {
      assert.equal(outcome.outcome, "started", "every duplicate attaches rather than failing");
      assert.equal(
        outcome.outcome === "started" && outcome.workflowId,
        generationWorkflowId(generationId),
        "one logical generation, one workflow identity"
      );
    }

    // Temporal itself is the authority here — USE_EXISTING means all three
    // bound to the same execution, which its own run id confirms.
    const runIds = new Set(
      [first, second, third].map((o) => (o.outcome === "started" ? o.runId : "?"))
    );
    assert.equal(runIds.size, 1, "no second execution was created");

    await env.client.workflow
      .getHandle(generationWorkflowId(generationId))
      .terminate("ownership scenario complete")
      .catch(() => {});
  } finally {
    restoreEnv();
    __setTemporalClientForTesting(null);
  }
});

test("6R-B: startGenerationWorkflow derives its id from the generation id, with no randomness", async () => {
  const source = readSource("src/lib/temporal/generation-starter.ts");
  assert.ok(source.includes("generationWorkflowId(params.generationId)"));
  assert.ok(
    source.includes("WorkflowIdConflictPolicy.USE_EXISTING"),
    "a duplicate start must join, never create a second workflow"
  );
  assert.ok(!/randomUUID|Math\.random|Date\.now/.test(source), "no non-deterministic id input");
  assert.equal(typeof startGenerationWorkflow, "function");
});

// ===========================================================================
// FAIL CLOSED
// ===========================================================================

test("6R-B: Temporal unavailable fails closed - no provider call, no Trigger dispatch, no second owner", async () => {
  const { db, sqs, generationId, clerkUserId } = await scenario("async-success");
  try {
    setEnv("NODE_ENV", "production");
    enableTemporalOwnership();

    // A client that cannot reach the server, exactly as an outage looks.
    let directRuns = 0;
    let intentRetirements = 0;
    const outcome = await executeGenerationRequest(
      { generationId, clerkUserId },
      {
        resolveOwner: resolveGenerationOwner,
        startWorkflow: async () => {
          throw Object.assign(new Error("connection refused to broker"), {
            name: "TransportError",
          });
        },
        runDirect: async () => {
          directRuns += 1;
          throw new Error("the dev path must never be reached as a fallback");
        },
        // A start that failed leaves the durable intent owed, so this must
        // not run at all — asserted below.
        resolveStartIntent: async () => {
          intentRetirements += 1;
        },
      }
    );

    assert.equal(
      intentRetirements,
      0,
      "a failed start must leave the workflow-start intent pending for the relay"
    );

    assert.equal(outcome.outcome, "unavailable");
    assert.equal(outcome.outcome === "unavailable" && outcome.reason, "temporal_start_failed");
    assert.equal(
      outcome.outcome === "unavailable" && outcome.errorCode,
      "TransportError",
      "a sanitized class name, never the message"
    );
    assert.ok(
      !JSON.stringify(outcome).includes("broker"),
      "no transport detail from the raw error reaches the caller"
    );

    assert.equal(directRuns, 0, "no fallback owner ran");
    assert.equal(sqs.enqueueCount, 0, "nothing was dispatched to the command plane");
    assert.equal(db.state.generation_attempts.length, 0, "no attempt was opened");
    assert.equal(db.state.generations[0].status, "queued", "the row is untouched and recoverable");
    assert.equal(fakeR2Puts.length, 0);
  } finally {
    restoreEnv();
    __setTemporalClientForTesting(null);
  }
});

test("6R-B: an unowned deployment refuses without touching anything", async () => {
  const { db, sqs, generationId, clerkUserId } = await scenario("async-success");
  try {
    setEnv("NODE_ENV", "production");
    delete process.env.TEMPORAL_GENERATION_ENABLED;
    process.env.GENERATION_DIRECT_DEV_EXECUTION = "true";

    const outcome = await executeGenerationRequest({ generationId, clerkUserId });

    assert.deepEqual(outcome, {
      outcome: "unavailable",
      reason: "temporal_generation_disabled",
    });
    assert.equal(sqs.enqueueCount, 0);
    assert.equal(db.state.generation_attempts.length, 0);
    assert.equal(db.state.generations[0].status, "queued");
  } finally {
    restoreEnv();
  }
});

// ===========================================================================
// ARCHITECTURE — TRIGGER IS NOT IN THE PRODUCTION OWNERSHIP GRAPH
// ===========================================================================

/** Resolves the repo-relative modules a file imports, one hop. */
function importedModules(relative: string): string[] {
  const source = readSource(relative);
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...withoutComments.matchAll(/(?:^|\s)(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g)]
    .map((m) => m[1])
    .concat([...withoutComments.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]));
}

test("6R-B ARCHITECTURE: the production ownership chain imports no Trigger.dev generation task", () => {
  // Walked as a module graph rather than a text scan, so the assertion cannot
  // match its own source and a Trigger import added ANYWHERE on the chain is
  // caught, not just one added to the route.
  const CHAIN = [
    "src/app/api/orchestration/execute/route.ts",
    "src/lib/orchestration/generation-execution-service.ts",
    "src/lib/orchestration/execution-mode.ts",
    "src/lib/temporal/generation-starter.ts",
    "src/lib/temporal/client.ts",
    "src/lib/temporal/config.ts",
  ];

  for (const file of CHAIN) {
    for (const specifier of importedModules(file)) {
      assert.ok(
        !/\/trigger\/generation-task|\/trigger\/async-continuation-task|@trigger\.dev/.test(specifier),
        `${file} imports ${specifier} — Trigger.dev must not appear in the production ownership chain`
      );
    }
  }
});

test("6R-B ARCHITECTURE: the route delegates ownership and decides nothing itself", () => {
  const specifiers = importedModules("src/app/api/orchestration/execute/route.ts");
  // Since Phase 5 convergence the route delegates one step further out, to
  // the shared canonical contract, so every generation route produces the
  // same response through the same function.
  assert.ok(
    specifiers.some((s) => s.includes("generation-api-contract")),
    "the route hands off to the canonical generation contract"
  );
  assert.ok(
    !specifiers.some((s) => s.includes("orchestration/orchestrator")),
    "the route must not be able to run a generation inline itself"
  );
  assert.ok(
    !specifiers.some((s) => s.includes("temporal/generation-starter")),
    "even the Temporal start goes through the service, so one place owns the rules"
  );
});

test("6R-B ARCHITECTURE: the retired Trigger tasks refuse to run in a production process", () => {
  for (const file of ["src/trigger/generation-task.ts", "src/trigger/async-continuation-task.ts"]) {
    const source = readSource(file);
    assert.ok(
      /NODE_ENV === "production"/.test(source),
      `${file} must refuse to execute in production`
    );
    assert.ok(
      /AbortTaskRunError/.test(source),
      `${file} must abort without retry — a retry cannot change the answer`
    );
    assert.ok(/Phase 6R-B/.test(source), `${file} must carry the cutover marker`);
  }
});

test("6R-B ARCHITECTURE: nothing in the repository dispatches a Trigger generation task any more", () => {
  const CALLERS = [
    "src/app/api/orchestration/execute/route.ts",
    "src/lib/orchestration/generation-execution-service.ts",
  ];
  for (const file of CALLERS) {
    const source = readSource(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/generationTask\s*\.\s*trigger\s*\(/.test(source), `${file} dispatches generationTask`);
    assert.ok(
      !/asyncContinuationTask\s*\.\s*trigger\s*\(/.test(source),
      `${file} dispatches asyncContinuationTask`
    );
  }
});

test("6R-B: the owner resolver takes no arguments - a client cannot influence it", () => {
  assert.equal(
    resolveGenerationOwner.length,
    0,
    "an argument-free resolver is the simplest guarantee that no request can name an owner"
  );

  // Body parsing now lives in the shared contract, so ONE reader enforces
  // "generationId and nothing else" for every generation route at once.
  const contract = readSource("src/lib/orchestration/generation-api-contract.ts");
  const bodyReads = [...contract.matchAll(/body as \{\s*(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(bodyReads, ["generationId"], "generationId is the only field read from a request");

  const routeSource = readSource("src/app/api/orchestration/execute/route.ts");
  for (const forbidden of ["executionMode", "mode", "owner", "useTemporal", "useTrigger"]) {
    assert.ok(
      !new RegExp(`body\\b[^\\n]*\\b${forbidden}\\b`).test(routeSource),
      `the route must not read "${forbidden}" from the request body`
    );
  }
});
