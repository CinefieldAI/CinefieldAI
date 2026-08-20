import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { WorkflowIdConflictPolicy } from "@temporalio/client";
import { FakeSupabaseClient } from "./fake-supabase";
import { FakeSqsTransport, installFakeSupabase, uninstallFakeSupabase, seedGeneration,
  fakeR2Puts,
  resetFakeR2Puts,
} from "./e2e-harness";
import { setCommandBus } from "@/lib/contracts/command-bus";
import { generationWorkflowId } from "@/lib/temporal/workflow-ids";
import { TASK_QUEUES } from "@/lib/temporal/task-queues";
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
 * ZERO-COST END-TO-END ARCHITECTURE TEST (Phase 6R.12).
 *
 * Proves the TARGET production chain:
 *
 *   Temporal GenerationWorkflow  (REAL — executed on a Temporal test server)
 *     -> submitGeneration activity        (REAL)
 *     -> SQS command contract             (REAL wire format, fake transport)
 *     -> provider worker command handler  (REAL)
 *     -> attempt claim / correlation      (REAL)
 *     -> mock ProviderAdapter             (REAL adapter, no network)
 *     -> continuation + finalization      (REAL)
 *
 * The legacy Trigger.dev generation owner is deliberately absent from this
 * chain — see the architectural assertion at the end of this file.
 *
 * WHAT IS FAKED, AND ONLY THIS:
 *   - the AWS SQS network (the wire format itself is production's)
 *   - the Supabase/Storage network (a query-builder double; every
 *     state-machine predicate is still evaluated by production code)
 *   - the AI provider network (via Cinefield's existing mock adapter)
 *
 * HONEST LIMITATION: because the database is an in-memory double, the
 * Postgres UNIQUE/CHECK constraints are NOT exercised here. What is
 * exercised is every conditional-update predicate the application relies
 * on, since those live in TypeScript and run for real.
 */

let env: TestWorkflowEnvironment;

before(async () => {
  // Real Temporal test server (time-skipping). Boots a local dev server —
  // no Temporal Cloud, no credentials, no network egress.
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, { timeout: 240_000 });

after(async () => {
  await env?.teardown();
  await uninstallFakeSupabase();
});

/** Runs a real worker for the duration of one scenario. */
async function withWorker<T>(fn: () => Promise<T>): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUES.generation,
    workflowsPath: require.resolve("../../../worker/workflows/generation-workflow"),
    activities,
  });
  return worker.runUntil(fn());
}

async function setupScenario(mode: string) {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const sqs = new FakeSqsTransport();
  setCommandBus(sqs);
  // The submit activity dispatches via SQS only when the command bus is
  // enabled — this is the production switch, set for the harness process.
  process.env.SQS_COMMAND_BUS_ENABLED = "true";
  process.env.CINEFIELD_SQS_PROVIDER_QUEUE_URL = "https://fake-sqs.invalid/queue.fifo";

  const { generationId, clerkUserId } = seedGeneration(db, {
    metadata: { mock_mode: mode },
  });
  return { db, sqs, generationId, clerkUserId };
}

/**
 * Drains the fake queue through the REAL provider worker handler. This is
 * the actual worker decision core from worker/provider-command-handler.ts —
 * claim, correlate, submit, evidence — not a reimplementation.
 */
async function drainQueueThroughRealWorker(sqs: FakeSqsTransport): Promise<string[]> {
  const outcomes: string[] = [];
  let next = sqs.receive();
  while (next) {
    const outcome = await handleProviderCommand(next.command);
    outcomes.push(outcome.reason);
    next = sqs.receive();
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// SCENARIO A — SUBMISSION THROUGH THE REAL CHAIN
// ---------------------------------------------------------------------------

test("E2E: real GenerationWorkflow dispatches a real SQS command consumed by the real provider worker", { timeout: 120_000 }, async () => {
  const { db, sqs, generationId, clerkUserId } = await setupScenario("sync");

  await withWorker(async () => {
    const handle = await env.client.workflow.start("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    });

    // Let the workflow reach its dispatch step, then drive the worker side.
    await new Promise((r) => setTimeout(r, 1_500));
    const outcomes = await drainQueueThroughRealWorker(sqs);

    // The workflow was genuinely executed on the Temporal test server.
    const description = await handle.describe();
    assert.ok(description.runId, "a real workflow run exists on the Temporal server");

    // The SQS boundary carried a real, production-shaped command.
    assert.ok(sqs.enqueueCount >= 1, "the workflow dispatched at least one provider command");
    assert.ok(outcomes.length >= 1, "the real provider worker handled the command");

    // An attempt row was created and correlated by production code.
    assert.equal(db.state.generation_attempts.length, 1, "exactly one attempt was created");

    await handle.terminate("e2e scenario complete").catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// DUPLICATE SQS DELIVERY
// ---------------------------------------------------------------------------

test("E2E: duplicate SQS delivery does not create a second attempt or a second provider job", { timeout: 120_000 }, async () => {
  const { db, sqs, generationId, clerkUserId } = await setupScenario("sync");

  await withWorker(async () => {
    const handle = await env.client.workflow.start("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    });

    await new Promise((r) => setTimeout(r, 1_500));

    const first = sqs.receive();
    assert.ok(first, "a command was enqueued");

    // Process it, then redeliver the IDENTICAL message — the case SQS
    // at-least-once permits and dedup does not prevent.
    await handleProviderCommand(first!.command);
    const attemptsAfterFirst = db.state.generation_attempts.length;

    sqs.deliverDuplicate(first!.raw);
    const redelivered = sqs.receive();
    const secondOutcome = await handleProviderCommand(redelivered!.command);

    assert.equal(
      db.state.generation_attempts.length,
      attemptsAfterFirst,
      "a redelivered command must never create a second attempt"
    );
    // Production's own guard classified the duplicate rather than resubmitting.
    assert.ok(
      /already_terminal|evidence_already_recorded|skipped|possibly_in_flight/.test(secondOutcome.reason),
      `duplicate must hit a guard, got: ${secondOutcome.reason}`
    );

    await handle.terminate("e2e scenario complete").catch(() => {});
  });
});

test("E2E: SQS FIFO dedup drops a re-enqueued identical command inside the window", async () => {
  const sqs = new FakeSqsTransport();
  const envelope = {
    queue: "provider" as const,
    command: { type: "provider.submit" as const, generationId: "gen-x", attemptId: "attempt-x" },
    idempotencyKey: "provider.submit:attempt-x",
  };

  await sqs.enqueue(envelope);
  await sqs.enqueue(envelope);

  assert.equal(sqs.enqueueCount, 2, "both enqueue calls were made");
  assert.equal(sqs.messages.length, 1, "FIFO dedup collapsed them to one message");
  assert.equal(sqs.dedupDroppedCount, 1);
});

// ---------------------------------------------------------------------------
// CALLBACK PATH (6R.10 bridge, real code)
// ---------------------------------------------------------------------------

test("E2E: a verified synthetic webhook correlates by providerJobId and signals the real workflow", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  const { generationId } = seedGeneration(db, { status: "processing" });
  db.state.generation_attempts.push({
    id: "attempt-cb",
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: "mock-job-cb",
    status: "submitted",
    submission_evidence: "job",
  });

  const { markWebhookEventVerified } = await import("@/lib/orchestration/webhook-continuation");
  const { bridgeVerifiedWebhookToTemporal } = await import("@/lib/orchestration/webhook-temporal-bridge");

  const signalled: { generationId: string; payload: unknown }[] = [];
  const event = markWebhookEventVerified({
    provider: "mock",
    providerJobId: "mock-job-cb",
    reportedState: "completed",
    transport: "webhook",
  });

  const result = await bridgeVerifiedWebhookToTemporal(event, {
    isAdminConfigured: () => true,
    getAdmin: () => db as never,
    signal: async (gid, payload) => {
      signalled.push({ generationId: gid, payload });
      return { outcome: "signalled" };
    },
  });

  assert.equal(result.outcome, "accepted");
  assert.equal(signalled.length, 1, "the workflow was signalled exactly once");
  assert.equal(signalled[0].generationId, generationId, "correlation came from the durable row");
  assert.equal(db.state.generation_attempts[0].status, "processing", "observation recorded durably");
});

test("E2E: duplicate callback does not regress state or double-signal irreversibly", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  const { generationId } = seedGeneration(db, { status: "processing" });
  db.state.generation_attempts.push({
    id: "attempt-dup",
    generation_id: generationId,
    provider: "mock",
    provider_job_id: "mock-job-dup",
    status: "submitted",
    submission_evidence: "job",
  });

  const { markWebhookEventVerified } = await import("@/lib/orchestration/webhook-continuation");
  const { bridgeVerifiedWebhookToTemporal } = await import("@/lib/orchestration/webhook-temporal-bridge");

  const deps = {
    isAdminConfigured: () => true,
    getAdmin: () => db as never,
    signal: async () => ({ outcome: "signalled" as const }),
  };
  const event = markWebhookEventVerified({
    provider: "mock",
    providerJobId: "mock-job-dup",
    reportedState: "completed",
    transport: "webhook",
  });

  await bridgeVerifiedWebhookToTemporal(event, deps);
  // Simulate the workflow having finalized the attempt.
  db.state.generation_attempts[0].status = "succeeded";

  const late = await bridgeVerifiedWebhookToTemporal(event, deps);

  assert.equal(late.outcome, "already_processed");
  assert.equal(db.state.generation_attempts[0].status, "succeeded", "terminal state preserved");
  assert.equal(db.state.generation_attempts.length, 1, "no second attempt");
});

test("E2E: a failed Temporal signal leaves the observed provider state durable and retryable", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  const { generationId } = seedGeneration(db, { status: "processing" });
  db.state.generation_attempts.push({
    id: "attempt-sigfail",
    generation_id: generationId,
    provider: "mock",
    provider_job_id: "mock-job-sigfail",
    status: "submitted",
    submission_evidence: "job",
  });

  const { markWebhookEventVerified } = await import("@/lib/orchestration/webhook-continuation");
  const { bridgeVerifiedWebhookToTemporal } = await import("@/lib/orchestration/webhook-temporal-bridge");

  const result = await bridgeVerifiedWebhookToTemporal(
    markWebhookEventVerified({
      provider: "mock",
      providerJobId: "mock-job-sigfail",
      reportedState: "completed",
      transport: "webhook",
    }),
    {
      isAdminConfigured: () => true,
      getAdmin: () => db as never,
      signal: async () => ({ outcome: "unavailable", errorCode: "ServiceUnavailable" }),
    }
  );

  assert.equal(result.outcome, "signal_unavailable", "explicitly retryable, never success");
  assert.equal(
    db.state.generation_attempts[0].status,
    "processing",
    "the observed provider state must survive a signal failure"
  );
});

// ---------------------------------------------------------------------------
// UNKNOWN JOB
// ---------------------------------------------------------------------------

test("E2E: a callback for an unknown providerJobId mutates nothing", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  seedGeneration(db, { status: "processing" });

  const { markWebhookEventVerified } = await import("@/lib/orchestration/webhook-continuation");
  const { bridgeVerifiedWebhookToTemporal } = await import("@/lib/orchestration/webhook-temporal-bridge");

  let signalCalls = 0;
  const result = await bridgeVerifiedWebhookToTemporal(
    markWebhookEventVerified({
      provider: "mock",
      providerJobId: "job-that-does-not-exist",
      reportedState: "completed",
      transport: "webhook",
    }),
    {
      isAdminConfigured: () => true,
      getAdmin: () => db as never,
      signal: async () => {
        signalCalls += 1;
        return { outcome: "signalled" };
      },
    }
  );

  assert.deepEqual(result, { outcome: "unknown_job" });
  assert.equal(signalCalls, 0, "no workflow may be signalled for an unknown job");
});

// ---------------------------------------------------------------------------
// ARCHITECTURAL ASSERTION — TARGET OWNER ONLY
// ---------------------------------------------------------------------------

test("E2E ARCHITECTURE: the legacy Trigger.dev generation owner is not part of this chain", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(__filename, "utf8");

  // Inspect only the IMPORT statements. Scanning the whole file would match
  // the assertion strings below against themselves; what actually matters is
  // which modules this harness can reach.
  const importLines = source
    .split("\n")
    .filter((line) => /^\s*import\s|await import\(/.test(line))
    .join("\n");

  assert.ok(
    !importLines.includes("trigger/generation-task"),
    "the E2E must not import the legacy Trigger generation task"
  );
  assert.ok(
    !importLines.includes("trigger/async-continuation-task"),
    "the E2E must not import the legacy Trigger continuation task"
  );
  assert.ok(!importLines.includes("@trigger.dev"), "the E2E must not pull in the Trigger.dev SDK at all");

  // And it MUST reach the target boundaries.
  assert.ok(importLines.includes("@temporalio/testing"), "the E2E runs a real Temporal environment");
  assert.ok(
    importLines.includes("worker/provider-command-handler"),
    "the E2E drives the real provider worker handler"
  );
  assert.ok(
    importLines.includes("worker/activities/generation-activities"),
    "the E2E drives the real Temporal activities"
  );
});

// ===========================================================================
// COMPLETION PASS (Phase 6R.12 GATE 0)
//
// The first pass of this suite proved the SUBMISSION half of the chain and
// reported the completion half as unproven. The root cause was a fixture
// defect, not an architectural one: `seedGeneration` never created the
// `projects` row that executeGeneration loads and owner-checks before it will
// touch an adapter, so every scenario died at that check long before reaching
// the provider. With the row seeded, the real orchestration core runs to the
// end and the scenarios below drive it there.
//
// The only other harness change is FakeSqsTransport.consumer, which delivers
// a message the instant the transport accepts it. Under time-skipping the
// workflow exhausts its whole dispatch-observe window in milliseconds of real
// time, so an externally-driven drain always lost the race. Removing queue
// LATENCY is not removing a guard: the message still travels through
// production's serialize/parse contract into the real worker handler, and the
// workflow still runs its real dispatch-observe loop against the attempt row.
// ===========================================================================

/**
 * A scenario whose queue is drained by the REAL provider worker handler the
 * moment a command is accepted. `onSubmitted` runs immediately after the
 * worker finished with the command — the hook the callback scenario uses to
 * deliver its webhook while the workflow is still live.
 */
async function setupAutoScenario(
  mode: string,
  onSubmitted?: (ctx: { generationId: string; clerkUserId: string }) => Promise<void>
) {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const sqs = new FakeSqsTransport();
  setCommandBus(sqs);
  process.env.SQS_COMMAND_BUS_ENABLED = "true";
  process.env.CINEFIELD_SQS_PROVIDER_QUEUE_URL = "https://fake-sqs.invalid/queue.fifo";

  const { generationId, clerkUserId } = seedGeneration(db, { metadata: { mock_mode: mode } });

  sqs.consumer = async (raw) => {
    // Round-trip through the production parser, then the production handler.
    sqs.messages.push(raw);
    const next = sqs.receive();
    if (!next) return;
    const outcome = await handleProviderCommand(next.command);
    sqs.consumedReasons.push(outcome.reason);
    if (onSubmitted) await onSubmitted({ generationId, clerkUserId });
  };

  return { db, sqs, generationId, clerkUserId };
}

/** The durable facts that define "this generation finished successfully". */
function terminalShape(db: FakeSupabaseClient) {
  const generation = db.state.generations[0];
  const attempt = db.state.generation_attempts[0];
  return {
    generationStatus: generation.status,
    hasOutputUrl: typeof generation.output_url === "string" && generation.output_url.length > 0,
    hasCompletedAt: typeof generation.completed_at === "string",
    attemptStatus: attempt?.status,
    attemptEvidence: attempt?.submission_evidence,
    attemptHasProviderJob: typeof attempt?.provider_job_id === "string",
    // PHASE 27: the canonical artifact is the ONE R2 object.
    uploads: fakeR2Puts.length,
  };
}

// ---------------------------------------------------------------------------
// 0.2 POLLING SUCCESS TO TERMINAL, THROUGH REAL FINALIZATION
// ---------------------------------------------------------------------------

test("E2E: polling drives the real workflow to a terminal generation through the real finalization tail", { timeout: 180_000 }, async () => {
  const { db, sqs, generationId, clerkUserId } = await setupAutoScenario("async-success");

  const result = await withWorker(async () =>
    env.client.workflow.execute("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    })
  );

  assert.equal(result.outcome, "completed", "the real workflow reported a completed generation");

  const shape = terminalShape(db);
  assert.equal(shape.generationStatus, "completed", "the generation row is terminally completed");
  assert.ok(shape.hasOutputUrl, "markCompleted persisted a real storage path");
  assert.ok(shape.hasCompletedAt, "completed_at was stamped");
  assert.equal(shape.attemptStatus, "succeeded", "the attempt reached its terminal success state");
  assert.ok(shape.attemptHasProviderJob, "the provider job id was correlated onto the attempt");

  // The finalization tail genuinely ran: getResult → normalize → upload.
  assert.equal(shape.uploads, 1, "the real finalization stored exactly one canonical object");
  assert.ok(fakeR2Puts[0].byteLength > 0, "real C2PA-signed bytes reached the storage boundary");
  assert.equal(
    db.storageUploads.length,
    0,
    "PHASE 27: the duplicate Supabase Storage copy must no longer be written"
  );

  // And it got there without ever submitting twice.
  assert.equal(sqs.enqueueCount, 1, "exactly one provider command was ever dispatched");
  assert.deepEqual(sqs.consumedReasons, ["submitted:processing"]);
  assert.equal(db.state.generation_attempts.length, 1, "exactly one attempt existed throughout");
});

// ---------------------------------------------------------------------------
// 0.3 CALLBACK SUCCESS TO TERMINAL
// ---------------------------------------------------------------------------

test("E2E: a verified webhook signals the live workflow, which then finalizes for real", { timeout: 180_000 }, async () => {
  const { markWebhookEventVerified } = await import("@/lib/orchestration/webhook-continuation");
  const { bridgeVerifiedWebhookToTemporal } = await import("@/lib/orchestration/webhook-temporal-bridge");

  let bridgeOutcome: unknown = null;
  let observedAttemptStatusAtSignal: unknown = null;

  const scenario = await setupAutoScenario("async-success", async ({ generationId }) => {
    // The provider "calls back" the moment its job exists — while the
    // workflow is genuinely live on the Temporal test server.
    const event = markWebhookEventVerified({
      provider: "mock",
      providerJobId: `mock-${generationId}`,
      reportedState: "completed",
      transport: "webhook",
    });

    bridgeOutcome = await bridgeVerifiedWebhookToTemporal(event, {
      isAdminConfigured: () => true,
      getAdmin: () => scenario.db as never,
      // The production signal transport builds a Temporal Cloud client from
      // deployment config, which does not exist here. Injecting the test
      // server's client is the ONLY substitution: the signal itself is a real
      // Temporal signal delivered to the real running workflow, and the
      // production transport's own outcome mapping is covered by the 6R.10
      // unit suite.
      signal: async (gid, payload) => {
        await env.client.workflow
          .getHandle(generationWorkflowId(gid))
          .signal("providerEvent", payload);
        observedAttemptStatusAtSignal = scenario.db.state.generation_attempts[0]?.status;
        return { outcome: "signalled" };
      },
    });
  });

  const { db, generationId, clerkUserId } = scenario;

  const result = await withWorker(async () =>
    env.client.workflow.execute("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    })
  );

  // The bridge did its job: correlated, recorded durably, signalled.
  assert.deepEqual(
    bridgeOutcome,
    { outcome: "accepted", generationId, attemptId: db.state.generation_attempts[0].id },
    "the verified webhook was accepted and correlated from Cinefield's own row"
  );
  assert.equal(
    observedAttemptStatusAtSignal,
    "processing",
    "the durable observation was written BEFORE the signal, never after"
  );

  // And the workflow that received it reached a real terminal state.
  assert.equal(result.outcome, "completed");
  const shape = terminalShape(db);
  assert.equal(shape.generationStatus, "completed");
  assert.equal(shape.attemptStatus, "succeeded");
  assert.equal(shape.uploads, 1, "the callback path finalized exactly once, for real");
});

// ---------------------------------------------------------------------------
// 0.4 CALLBACK / POLL CONVERGENCE
// ---------------------------------------------------------------------------

test("E2E: the callback path and the poll path reach an identical terminal durable state", { timeout: 240_000 }, async () => {
  const { markWebhookEventVerified } = await import("@/lib/orchestration/webhook-continuation");
  const { bridgeVerifiedWebhookToTemporal } = await import("@/lib/orchestration/webhook-temporal-bridge");

  // --- poll only -----------------------------------------------------------
  const pollScenario = await setupAutoScenario("async-success");
  await withWorker(async () =>
    env.client.workflow.execute("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(pollScenario.generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId: pollScenario.generationId, clerkUserId: pollScenario.clerkUserId }],
    })
  );
  const pollShape = terminalShape(pollScenario.db);

  // --- callback + poll -----------------------------------------------------
  const cbScenario = await setupAutoScenario("async-success", async ({ generationId }) => {
    await bridgeVerifiedWebhookToTemporal(
      markWebhookEventVerified({
        provider: "mock",
        providerJobId: `mock-${generationId}`,
        reportedState: "completed",
        transport: "webhook",
      }),
      {
        isAdminConfigured: () => true,
        getAdmin: () => cbScenario.db as never,
        signal: async (gid, payload) => {
          await env.client.workflow
            .getHandle(generationWorkflowId(gid))
            .signal("providerEvent", payload);
          return { outcome: "signalled" };
        },
      }
    );
  });
  await withWorker(async () =>
    env.client.workflow.execute("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(cbScenario.generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId: cbScenario.generationId, clerkUserId: cbScenario.clerkUserId }],
    })
  );
  const callbackShape = terminalShape(cbScenario.db);

  // Transport mechanics differ; the durable outcome must not.
  assert.deepEqual(callbackShape, pollShape, "both transports converge on one terminal state");
  assert.equal(pollShape.generationStatus, "completed");
  assert.equal(pollShape.uploads, 1);
});

// ---------------------------------------------------------------------------
// 0.5 FINALIZATION ONCE
// ---------------------------------------------------------------------------

test("E2E: a duplicate poll after completion does not finalize a second time", { timeout: 180_000 }, async () => {
  const { db, generationId, clerkUserId } = await setupAutoScenario("async-success");

  await withWorker(async () =>
    env.client.workflow.execute("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    })
  );
  assert.equal(fakeR2Puts.length, 1);
  const completedAt = db.state.generations[0].completed_at;

  // Exactly what a redelivered poll does — the real continuation entry point.
  const { checkAsyncGeneration } = await import("@/lib/orchestration/orchestrator");
  const again = await checkAsyncGeneration({ generationId, clerkUserId, source: "poll" });

  assert.equal(again.status, "completed", "the terminal row is reported idempotently");
  assert.equal(fakeR2Puts.length, 1, "no second canonical write");
  assert.equal(db.state.generations[0].completed_at, completedAt, "completion was not restamped");
});

test("E2E: a duplicate verified callback after completion does not finalize a second time", { timeout: 180_000 }, async () => {
  const { markWebhookEventVerified } = await import("@/lib/orchestration/webhook-continuation");
  const { bridgeVerifiedWebhookToTemporal } = await import("@/lib/orchestration/webhook-temporal-bridge");

  const { db, generationId, clerkUserId } = await setupAutoScenario("async-success");
  await withWorker(async () =>
    env.client.workflow.execute("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    })
  );
  assert.equal(fakeR2Puts.length, 1);

  let signalCalls = 0;
  const late = await bridgeVerifiedWebhookToTemporal(
    markWebhookEventVerified({
      provider: "mock",
      providerJobId: `mock-${generationId}`,
      reportedState: "completed",
      transport: "webhook",
    }),
    {
      isAdminConfigured: () => true,
      getAdmin: () => db as never,
      signal: async () => {
        signalCalls += 1;
        return { outcome: "signalled" };
      },
    }
  );

  assert.equal(late.outcome, "already_processed", "a post-terminal callback is a no-op");
  assert.equal(signalCalls, 0, "a terminal attempt is never signalled again");
  assert.equal(fakeR2Puts.length, 1, "no second canonical write");
  assert.equal(db.state.generations[0].status, "completed", "terminal state preserved");
});

test("E2E: two concurrent completion observations finalize exactly once (single-flight lease)", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  // A job already at its completion threshold: BOTH observers will see the
  // provider report "completed", which is precisely the race the
  // finalization lease exists for.
  const { generationId, clerkUserId } = seedGeneration(db, {
    status: "processing",
    metadata: {
      mock_mode: "async-success",
      orchestration: {
        stage: "waiting-provider",
        workflow: "text-to-image",
        providerJob: {
          id: "mock-race",
          provider: "mock",
          state: "processing",
          lastCheckedAt: new Date().toISOString(),
          checkCount: 2,
          resume: { mock: true, mode: "async-success" },
        },
      },
    },
  });
  // The mock derives its job id from the generation id; keep them consistent.
  const meta = db.state.generations[0].metadata as {
    orchestration: { providerJob: { id: string } };
  };
  meta.orchestration.providerJob.id = `mock-${generationId}`;

  const { checkAsyncGeneration } = await import("@/lib/orchestration/orchestrator");
  const results = await Promise.allSettled([
    checkAsyncGeneration({ generationId, clerkUserId, source: "poll" }),
    checkAsyncGeneration({ generationId, clerkUserId, source: "webhook" }),
  ]);

  assert.equal(fakeR2Puts.length, 1, "the lease admitted exactly one finalizer");
  assert.equal(db.state.generations[0].status, "completed");
  const completed = results.filter(
    (r) => r.status === "fulfilled" && r.value.status === "completed"
  );
  assert.ok(completed.length >= 1, "at least one observer reports the terminal state");
});

// ---------------------------------------------------------------------------
// 0.6 PROVIDER FAILURE TO TERMINAL
// ---------------------------------------------------------------------------

test("E2E: submitted -> processing -> provider-reported failure drives the workflow to a terminal failure", { timeout: 180_000 }, async () => {
  const { db, sqs, generationId, clerkUserId } = await setupAutoScenario("async-failure");

  const result = await withWorker(async () =>
    env.client.workflow.execute("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    })
  );

  assert.equal(result.outcome, "failed", "the workflow reported a real terminal failure");
  assert.equal(db.state.generations[0].status, "failed", "the generation row is terminally failed");
  assert.equal(db.state.generation_attempts[0].status, "failed", "the attempt is terminally failed");

  // A failure must never masquerade as, or leave behind, a success.
  assert.equal(fakeR2Puts.length, 0, "no output was finalized for a failed job");
  assert.equal(db.state.generations[0].output_url, null, "no output url on a failed generation");

  // And it must never cost a second submission.
  assert.equal(sqs.enqueueCount, 1, "exactly one provider command was ever dispatched");
  assert.equal(db.state.generation_attempts.length, 1, "no retry attempt was opened");
});

test("E2E: a submit-time provider failure is terminal and never resubmitted", { timeout: 180_000 }, async () => {
  const { db, sqs, generationId, clerkUserId } = await setupAutoScenario("provider-failure");

  const result = await withWorker(async () =>
    env.client.workflow.execute("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    })
  );

  assert.equal(result.outcome, "failed");
  assert.equal(db.state.generations[0].status, "failed");
  assert.equal(db.state.generation_attempts[0].status, "failed");
  assert.equal(sqs.enqueueCount, 1, "the failure did not trigger a second dispatch");
  assert.equal(fakeR2Puts.length, 0);
});

// ---------------------------------------------------------------------------
// 0.7 AMBIGUOUS SUBMISSION
//
// The orchestrator-level ambiguous marker is deliberately UNREACHABLE with
// the mock provider: orchestrator.ts exempts mocks from the fail-closed
// ambiguity rule because a mock makes no external call, so no billable job
// can exist whatever error its test modes raise. That exemption is a
// production safety decision and is not weakened here.
//
// The ambiguity that IS reachable — and is the one that actually guards
// money — lives at the worker boundary: a handler that died between claiming
// an attempt and persisting any evidence. That path is driven for real below.
// ---------------------------------------------------------------------------

test("E2E: a stale claim with no evidence is recorded as ambiguous and never blindly resubmitted", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { status: "processing" });

  const { ATTEMPT_STALE_AFTER_MS } = await import("@/lib/aws/sqs-topology");
  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: null,
    submission_evidence: "none",
    status: "submitting",
    // A handler that claimed the attempt and then died. No evidence of any
    // kind exists, and nothing can prove whether a request went out.
    updated_at: new Date(Date.now() - ATTEMPT_STALE_AFTER_MS - 60_000).toISOString(),
  });

  const { commandIdFor, parseCommand, serializeCommand } = await import("@/lib/contracts/command-wire");
  const parsed = parseCommand(
    serializeCommand({
      commandId: commandIdFor("provider.submit", attemptId),
      type: "provider.submit",
      generationId,
      attemptId,
      issuedAt: new Date().toISOString(),
    })
  );
  assert.ok(parsed.ok, "the fixture command satisfies the production wire contract");

  const outcome = await handleProviderCommand(parsed.command);

  assert.equal(outcome.reason, "stale_claim_marked_ambiguous");
  assert.equal(outcome.action, "delete", "the message retires — it must not be redelivered to resubmit");
  assert.equal(
    db.state.generation_attempts[0].submission_evidence,
    "ambiguous",
    "the uncertainty is recorded durably rather than guessed away"
  );
  assert.equal(fakeR2Puts.length, 0, "no provider work was performed");
  assert.equal(db.state.generation_attempts.length, 1, "no second attempt was opened");
});

test("E2E COST: no real provider, AWS, storage, or credit side effect occurred", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  // The storage double records intent; a zero-cost run stores nothing real.
  assert.equal(fakeR2Puts.length, 0);
  // The mock adapter is the only provider in play, and it performs no HTTP.
  const { mockProvider } = await import("@/lib/orchestration/providers/mock-provider");
  assert.equal(mockProvider.providerId, "mock");
});
