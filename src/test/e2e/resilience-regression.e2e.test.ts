import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, before, after } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { WorkflowIdConflictPolicy } from "@temporalio/client";
import { FakeSupabaseClient } from "./fake-supabase";
import { FakeSqsTransport, installFakeSupabase, uninstallFakeSupabase, seedGeneration } from "./e2e-harness";
import { setCommandBus } from "@/lib/contracts/command-bus";
import type { CommandBus, CommandEnvelope } from "@/lib/contracts/command-bus";
import { generationWorkflowId } from "@/lib/temporal/workflow-ids";
import { TASK_QUEUES } from "@/lib/temporal/task-queues";
import { handleProviderCommand } from "../../../worker/provider-command-handler";
import * as activities from "../../../worker/activities/generation-activities";
import { setC2paSignerMode } from "@/lib/provenance/c2pa-embedder";

// ---------------------------------------------------------------------------
// PHASE 27 / 9-C: this suite drives the REAL finalization tail, which now
// embeds C2PA provenance into every canonical output. Production FAILS CLOSED
// with no signer configured, so these tests install the DEVELOPMENT signer to
// reach completion. c2pa-node's test certificate is never production trust
// and is never the default (C2paSignerMode defaults to "none").
// ---------------------------------------------------------------------------
setC2paSignerMode("test");


/**
 * SECURITY / IDEMPOTENCY RESILIENCE REGRESSION (Phase 6R.13).
 *
 * SCOPE IS DELIBERATELY NARROW. Large parts of the 6R.13 brief are already
 * covered densely and correctly elsewhere, and duplicating them would create
 * a second, divergent notion of the same guard:
 *
 *   webhook replay / out-of-order / provider mismatch / payload secrecy /
 *   provider-identity-is-not-ownership
 *                     → src/lib/orchestration/webhook-temporal-bridge.test.ts
 *   outbox event identity across retries, publish-unavailable
 *                     → src/lib/events/outbox-publisher.test.ts
 *   Redis idempotency lifecycle, owner tokens, stale owners
 *                     → src/lib/redis/idempotency-store.test.ts
 *
 * What follows targets the gaps those suites leave: concurrent submission
 * races, duplicate Temporal signals against a REAL running workflow,
 * cancellation races, transport loss, and the durable state machine's
 * no-regression property.
 *
 * CREDIT / DOUBLE-BILLING NOTE
 * The credit guards are PL/pgSQL (reserve_credits, settle_reservation,
 * refund_reservation). src/lib/credits.ts is a thin RPC delegation with no
 * local arithmetic, so there is nothing at the TypeScript layer whose
 * correctness a test here could establish — proving those guards requires a
 * real Postgres, which this zero-cost run does not have. That is reported as
 * blocked rather than papered over. What IS provable here, and is proven
 * below, is the structural fact that no credit mutation is even reachable
 * from the target generation path today.
 */

let env: TestWorkflowEnvironment;

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, { timeout: 240_000 });

after(async () => {
  await env?.teardown();
  await uninstallFakeSupabase();
});

async function withWorker<T>(fn: () => Promise<T>): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUES.generation,
    workflowsPath: require.resolve("../../../worker/workflows/generation-workflow"),
    activities,
  });
  return worker.runUntil(fn());
}

async function scenario(
  mode: string,
  onSubmitted?: (ctx: { generationId: string }) => Promise<void>
) {
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
    if (onSubmitted) await onSubmitted({ generationId });
  };

  return { db, sqs, generationId, clerkUserId };
}

function runWorkflow(generationId: string, clerkUserId: string) {
  return withWorker(async () =>
    env.client.workflow.execute("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    })
  );
}

const REPO_ROOT = process.cwd();
const readSource = (relative: string) => readFileSync(join(REPO_ROOT, relative), "utf8");

// ===========================================================================
// 13.2 DOUBLE SUBMISSION
// ===========================================================================

test("13.2 two concurrent submissions of one attempt produce exactly one provider job", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId, clerkUserId } = seedGeneration(db, {
    metadata: { mock_mode: "async-success" },
  });

  const { createAttempt } = await import("@/lib/orchestration/attempt-repository");
  const { submitAttempt } = await import("@/lib/orchestration/attempt-submission-service");
  const attempt = await createAttempt(db as never, {
    generationId,
    provider: "mock",
    providerModel: "mock-image-v1",
    workflowId: "wf-race",
    workflowRunId: "run-race",
  });

  const params = { generationId, clerkUserId, attemptId: attempt.id };
  const [a, b] = await Promise.all([submitAttempt(params), submitAttempt(params)]);

  const results = [a.result, b.result].sort();
  assert.deepEqual(results, ["processing", "skipped"], "the atomic claim admitted exactly one submitter");
  assert.equal(db.state.generation_attempts.length, 1, "no second attempt was created");
  assert.equal(
    db.state.generation_attempts[0].submission_evidence,
    "job",
    "one — and only one — provider job was recorded"
  );
});

test("13.2 an attempt already carrying ambiguous evidence is never resubmitted", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { status: "processing" });

  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: null,
    // A prior handler could not prove whether a request reached the provider.
    submission_evidence: "ambiguous",
    status: "pending",
    updated_at: new Date().toISOString(),
  });

  const outcome = await handleProviderCommand({
    commandId: `provider.submit:${attemptId}`,
    type: "provider.submit",
    generationId,
    attemptId,
    issuedAt: new Date().toISOString(),
  } as never);

  assert.equal(outcome.reason, "evidence_already_recorded");
  assert.equal(outcome.action, "delete", "the message retires rather than being retried into a submit");
  assert.equal(db.storageUploads.length, 0, "no provider work happened");
  assert.equal(
    db.state.generation_attempts[0].submission_evidence,
    "ambiguous",
    "the ambiguity is preserved for reconciliation, not resolved by guessing"
  );
});

test("13.2 two concurrent deliveries of the same command submit only once", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { metadata: { mock_mode: "async-success" } });

  const { createAttempt } = await import("@/lib/orchestration/attempt-repository");
  const attempt = await createAttempt(db as never, {
    generationId,
    provider: "mock",
    providerModel: "mock-image-v1",
    workflowId: "wf-dup",
    workflowRunId: "run-dup",
  });

  const command = {
    commandId: `provider.submit:${attempt.id}`,
    type: "provider.submit",
    generationId,
    attemptId: attempt.id,
    issuedAt: new Date().toISOString(),
  } as never;

  const [x, y] = await Promise.all([
    handleProviderCommand(command),
    handleProviderCommand(command),
  ]);

  const reasons = [x.reason, y.reason].sort();
  assert.deepEqual(
    reasons,
    ["submitted:processing", "submitted:skipped"],
    "one delivery submitted; the other died on the claim"
  );
  assert.equal(db.state.generation_attempts.length, 1);
});

// ===========================================================================
// 13.3 DOUBLE BILLING (structural — the SQL guards need a real Postgres)
// ===========================================================================

test("13.3 no credit mutation is reachable from the target generation path", () => {
  const GENERATION_PATH = [
    "worker/workflows/generation-workflow.ts",
    "worker/activities/generation-activities.ts",
    "worker/provider-command-handler.ts",
    "src/lib/orchestration/attempt-submission-service.ts",
    "src/lib/orchestration/webhook-temporal-bridge.ts",
  ];
  const CREDIT_MUTATIONS = [
    "reserveCredits",
    "settleGeneration",
    "refundGeneration",
    "reserve_credits",
    "settle_reservation",
    "refund_reservation",
    "grant_credits",
  ];

  for (const file of GENERATION_PATH) {
    const source = readSource(file);
    for (const mutation of CREDIT_MUTATIONS) {
      assert.ok(
        !source.includes(mutation),
        `${file} must not call ${mutation} — credits are not wired into this path yet, ` +
          `and wiring them silently would create an unreviewed billing surface`
      );
    }
  }
});

test("13.3 the credit client performs no local balance arithmetic - every guard stays in SQL", () => {
  const source = readSource("src/lib/credits.ts");
  // One notion of a balance. A second, TypeScript-side computation is exactly
  // how a settle and a refund end up disagreeing.
  assert.ok(!/balance\s*[-+]/.test(source), "no local balance arithmetic");
  assert.ok(!/\bUPDATE\b|\.from\(["'`]credit/.test(source), "no direct writes to credit tables");
  for (const fn of ["reserve_credits", "settle_reservation", "refund_reservation"]) {
    assert.ok(source.includes(`admin.rpc("${fn}"`), `${fn} is delegated to the database function`);
  }
});

// ===========================================================================
// 13.5 DUPLICATE TEMPORAL SIGNAL
// ===========================================================================

test("13.5 the same provider event signalled repeatedly still finalizes exactly once", { timeout: 180_000 }, async () => {
  const s = await scenario("async-success", async ({ generationId }) => {
    const handle = env.client.workflow.getHandle(generationWorkflowId(generationId));
    const payload = {
      attemptId: s.db.state.generation_attempts[0].id as string,
      providerJobId: `mock-${generationId}`,
      status: "completed" as const,
    };
    // Five identical deliveries — the case at-least-once signalling permits.
    for (let i = 0; i < 5; i += 1) {
      await handle.signal("providerEvent", payload);
    }
  });

  const result = await runWorkflow(s.generationId, s.clerkUserId);

  assert.equal(result.outcome, "completed");
  assert.equal(s.db.storageUploads.length, 1, "five signals produced one finalization");
  assert.equal(s.db.state.generation_attempts.length, 1, "no signal created an attempt");
  assert.equal(s.sqs.enqueueCount, 1, "no signal caused a resubmission");
});

// ===========================================================================
// 13.6 CANCELLATION RACES
//
// Documenting the ACTUAL semantics rather than an aspirational one: Cinefield
// makes no claim that a provider job is cancelled at the provider. Cancelling
// stops Cinefield from waiting and marks Cinefield's own rows; a job that is
// already running may still complete and may still be billed, which is
// exactly why the code refuses to overwrite evidence on the way out.
// ===========================================================================

test("13.6 cancel DEFERS while a handler may be mid-call, and writes nothing", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { status: "processing" });

  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: null,
    submission_evidence: "none",
    // The dangerous window: a provider call may be in flight right now.
    status: "submitting",
    updated_at: new Date().toISOString(),
  });

  const outcome = await activities.cancelGeneration({ generationId, attemptId });

  assert.equal(outcome.settled, false, "cancellation waits rather than racing a live submission");
  assert.equal(db.state.generation_attempts[0].status, "submitting", "the attempt was not touched");
  assert.equal(db.state.generations[0].status, "processing", "the generation was not touched");
});

test("13.6 cancel LOSES to a generation that already completed", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, {
    status: "completed",
    output_url: "user_e2e/p/g/out.png",
    completed_at: new Date().toISOString(),
  });
  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: `mock-${generationId}`,
    submission_evidence: "job",
    status: "succeeded",
    updated_at: new Date().toISOString(),
  });

  const outcome = await activities.cancelGeneration({ generationId, attemptId });

  assert.equal(outcome.settled, true, "there is nothing left in flight, so the race is resolved");
  assert.equal(db.state.generations[0].status, "completed", "a finished generation is never un-finished");
  assert.equal(db.state.generation_attempts[0].status, "succeeded", "a succeeded attempt is never rewritten");
});

test("13.6 duplicate cancellation is idempotent", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { status: "processing" });
  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: null,
    submission_evidence: "none",
    status: "pending",
    updated_at: new Date().toISOString(),
  });

  const first = await activities.cancelGeneration({ generationId, attemptId });
  const statusAfterFirst = db.state.generations[0].status;
  const second = await activities.cancelGeneration({ generationId, attemptId });

  assert.equal(first.settled, true);
  assert.equal(second.settled, true);
  assert.equal(statusAfterFirst, "cancelled");
  assert.equal(db.state.generations[0].status, "cancelled", "the second cancel changed nothing");
  assert.equal(db.state.generation_attempts[0].status, "cancelled");
  assert.equal(db.state.generation_attempts.length, 1);
});

test("13.6 a provider completion arriving AFTER cancellation does not resurrect the generation", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId, clerkUserId } = seedGeneration(db, {
    status: "cancelled",
    metadata: {
      mock_mode: "async-success",
      orchestration: {
        stage: "waiting-provider",
        workflow: "text-to-image",
        providerJob: {
          id: "placeholder",
          provider: "mock",
          state: "processing",
          lastCheckedAt: new Date().toISOString(),
          checkCount: 5,
        },
      },
    },
  });
  const meta = db.state.generations[0].metadata as {
    orchestration: { providerJob: { id: string } };
  };
  meta.orchestration.providerJob.id = `mock-${generationId}`;

  const { checkAsyncGeneration } = await import("@/lib/orchestration/orchestrator");
  const late = await checkAsyncGeneration({ generationId, clerkUserId, source: "webhook" });

  assert.equal(late.status, "failed", "a cancelled row is reported as terminal, not completed");
  assert.equal(db.state.generations[0].status, "cancelled", "the terminal state is unchanged");
  assert.equal(db.storageUploads.length, 0, "a cancelled generation never finalizes an output");
});

test("13.6 a cancel signal before submission ends the real workflow as cancelled, with nothing sent", { timeout: 180_000 }, async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const sqs = new FakeSqsTransport();
  setCommandBus(sqs);
  process.env.SQS_COMMAND_BUS_ENABLED = "true";
  const { generationId, clerkUserId } = seedGeneration(db, {
    metadata: { mock_mode: "async-success" },
  });

  const result = await withWorker(async () => {
    const handle = await env.client.workflow.start("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    });
    // Two cancel signals: the handler must be idempotent.
    await handle.signal("cancelGeneration");
    await handle.signal("cancelGeneration");
    return handle.result();
  });

  assert.ok(
    ["cancelled", "abandoned"].includes(result.outcome),
    `a cancelled generation must never report success, got: ${result.outcome}`
  );
  assert.notEqual(db.state.generations[0].status, "completed");
  assert.equal(db.storageUploads.length, 0, "nothing was finalized");
});

// ===========================================================================
// 13.7 LOST MESSAGE / RETRY
// ===========================================================================

test("13.7 a transient dispatch failure is retried and still yields exactly one provider job", { timeout: 180_000 }, async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId, clerkUserId } = seedGeneration(db, {
    metadata: { mock_mode: "async-success" },
  });

  const real = new FakeSqsTransport();
  real.consumer = async (raw) => {
    real.messages.push(raw);
    const next = real.receive();
    if (!next) return;
    const outcome = await handleProviderCommand(next.command);
    real.consumedReasons.push(outcome.reason);
  };

  // Fails the first SendMessage, exactly as a throttled or briefly
  // unreachable SQS would. The activity's retry policy must absorb it.
  let attemptsSeen = 0;
  const flaky: CommandBus = {
    async enqueue(envelope: CommandEnvelope) {
      attemptsSeen += 1;
      if (attemptsSeen === 1) throw new Error("SQS_UNAVAILABLE");
      await real.enqueue(envelope);
    },
  };
  setCommandBus(flaky);
  process.env.SQS_COMMAND_BUS_ENABLED = "true";

  const result = await withWorker(async () =>
    env.client.workflow.execute("generationWorkflow", {
      taskQueue: TASK_QUEUES.generation,
      workflowId: generationWorkflowId(generationId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ generationId, clerkUserId }],
    })
  );

  assert.ok(attemptsSeen >= 2, "the dispatch was genuinely retried");
  assert.equal(result.outcome, "completed", "a transient transport failure did not strand the generation");
  assert.equal(db.state.generation_attempts.length, 1, "the retry reused the existing attempt");
  assert.equal(real.enqueueCount, 1, "only the successful dispatch reached the queue");
  assert.equal(db.storageUploads.length, 1, "exactly one finalization");
});

test("13.7 a dispatch failure leaves no phantom evidence behind", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId, clerkUserId } = seedGeneration(db);

  const { createAttempt } = await import("@/lib/orchestration/attempt-repository");
  const attempt = await createAttempt(db as never, {
    generationId,
    provider: "mock",
    providerModel: "mock-image-v1",
    workflowId: "wf-lost",
    workflowRunId: "run-lost",
  });

  setCommandBus({
    async enqueue() {
      throw new Error("SQS_UNAVAILABLE");
    },
  });
  process.env.SQS_COMMAND_BUS_ENABLED = "true";

  await assert.rejects(
    activities.submitGeneration({ generationId, clerkUserId, attemptId: attempt.id }),
    "a failed dispatch must surface, never be swallowed as success"
  );

  const row = db.state.generation_attempts[0];
  assert.equal(row.status, "pending", "the attempt stays claimable — the retry is safe");
  assert.equal(row.submission_evidence, "none", "no evidence was invented for a request never sent");
  assert.equal(row.provider_job_id, null);
});

// ===========================================================================
// 13.8 STATE RACES — TERMINAL STATES CANNOT REGRESS
// ===========================================================================

test("13.8 the durable state machine refuses every terminal regression", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { status: "processing" });

  const repo = await import("@/lib/orchestration/attempt-repository");
  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: `mock-${generationId}`,
    submission_evidence: "job",
    status: "processing",
    updated_at: new Date().toISOString(),
  });

  // processing -> succeeded is legal, exactly once.
  assert.equal(await repo.markAttemptTerminal(db as never, attemptId, { status: "succeeded" }), true);
  assert.equal(
    await repo.markAttemptTerminal(db as never, attemptId, { status: "failed" }),
    false,
    "a terminal attempt cannot be re-closed with a different outcome"
  );
  assert.equal(db.state.generation_attempts[0].status, "succeeded");

  // A late webhook cannot drag a finished attempt back to processing.
  assert.equal(
    await repo.recordProviderObservation(db as never, attemptId, "processing"),
    false,
    "succeeded -> processing is refused"
  );
  assert.equal(db.state.generation_attempts[0].status, "succeeded");

  // Nor can a late claim, heartbeat, or cancel touch it.
  // Returns the claimed row, or null when the claim is refused.
  assert.equal(await repo.claimAttemptForSubmission(db as never, attemptId), null);
  assert.equal(await repo.touchAttemptHeartbeat(db as never, attemptId), false);
  assert.equal(await repo.cancelPendingAttempt(db as never, attemptId), false);
  assert.equal(db.state.generation_attempts[0].status, "succeeded");
});

test("13.8 a completion cannot be written onto a cancelled generation", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { status: "cancelled" });

  const { markCompleted } = await import("@/lib/orchestration/status-manager");
  await assert.rejects(
    markCompleted(db as never, generationId, {}, {
      outputUrl: "u/p/g/out.png",
      provider: "mock",
      workflow: "text-to-image",
      isMock: true,
    }),
    /DUPLICATE_EXECUTION|Duplicate/i,
    "markCompleted's compare-and-set must lose against a terminal row"
  );
  assert.equal(db.state.generations[0].status, "cancelled");
  assert.equal(db.state.generations[0].output_url, null, "no output url was attached");
});

// ===========================================================================
// 13.9 SECURITY BOUNDARY
// ===========================================================================

test("13.9 the verified-webhook brand is module-private - no caller can mint trust", () => {
  const source = readSource("src/lib/orchestration/webhook-continuation.ts");
  // The brand symbol must be declared but never exported: exporting it would
  // let any module fabricate a VerifiedWebhookEvent that type-checks.
  assert.ok(/const VERIFIED\b/.test(source), "the brand symbol exists");
  assert.ok(
    !/export\s+(const|type|interface)?\s*VERIFIED\b/.test(source),
    "the brand symbol must never be exported"
  );
  assert.ok(
    source.includes("export function markWebhookEventVerified"),
    "the single, auditable entry point for granting trust"
  );
});

test("13.9 nothing the browser can import can publish an event or reach the trusted path", () => {
  const SERVER_ONLY = [
    "src/lib/orchestration/webhook-continuation.ts",
    "src/lib/orchestration/webhook-temporal-bridge.ts",
    "src/lib/orchestration/attempt-submission-service.ts",
    "src/lib/orchestration/orchestrator.ts",
    "src/lib/supabase/supabaseAdmin.ts",
    "src/lib/credits.ts",
  ];
  for (const file of SERVER_ONLY) {
    assert.ok(
      readSource(file).startsWith('import "server-only"'),
      `${file} must be server-only — a client bundle importing it is a build error, not a runtime hope`
    );
  }
});

test("13.9 a provider callback cannot reach another user's generation", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  const victim = seedGeneration(db, { clerk_user_id: "user_victim", status: "processing" });
  const attacker = seedGeneration(db, { clerk_user_id: "user_attacker", status: "processing" });

  db.state.generation_attempts.push({
    id: randomUUID(),
    generation_id: attacker.generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: "job-attacker",
    submission_evidence: "job",
    status: "submitted",
    updated_at: new Date().toISOString(),
  });

  const { markWebhookEventVerified } = await import("@/lib/orchestration/webhook-continuation");
  const { bridgeVerifiedWebhookToTemporal } = await import("@/lib/orchestration/webhook-temporal-bridge");

  // A perfectly VALID callback for the attacker's own job, but naming the
  // victim's generation as its correlation hint.
  const signalled: string[] = [];
  const result = await bridgeVerifiedWebhookToTemporal(
    markWebhookEventVerified({
      provider: "mock",
      providerJobId: "job-attacker",
      reportedState: "completed",
      transport: "webhook",
      correlationGenerationId: victim.generationId,
    }),
    {
      isAdminConfigured: () => true,
      getAdmin: () => db as never,
      signal: async (gid) => {
        signalled.push(gid);
        return { outcome: "signalled" };
      },
    }
  );

  assert.deepEqual(result, { outcome: "rejected", reason: "correlation_mismatch" });
  assert.deepEqual(signalled, [], "no workflow was signalled");
  assert.equal(db.state.generations[0].status, "processing", "the victim's row is untouched");
});

// ===========================================================================
// 13.10 OUTBOX IDENTITY (application-contract level only)
// ===========================================================================

test("13.10 the SQL claim contract prevents overlapping claims - unproven against a live Postgres", async () => {
  const migration = readSource("supabase/migrations/20260812130000_outbox_events.sql");
  // The concurrency guarantee is a Postgres one; assert the contract that
  // provides it actually exists rather than claiming it was exercised.
  assert.ok(
    /FOR\s+UPDATE\s+SKIP\s+LOCKED/i.test(migration),
    "claim_outbox_events must use FOR UPDATE SKIP LOCKED for non-overlapping claims"
  );
  assert.ok(/SECURITY\s+DEFINER/i.test(migration), "the outbox functions are security-definer");
  assert.ok(/search_path/i.test(migration), "search_path is pinned on the security-definer functions");
});
