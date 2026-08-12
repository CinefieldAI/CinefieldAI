import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FakeSupabaseClient } from "./fake-supabase";
import { FakeSqsTransport, installFakeSupabase, seedGeneration } from "./e2e-harness";
import {
  commandIdFor,
  parseCommand,
  serializeCommand,
  COMMAND_WIRE_VERSION,
  type CommandWireV1,
} from "@/lib/contracts/command-wire";
import { SQS_QUEUES, ATTEMPT_STALE_AFTER_MS } from "@/lib/aws/sqs-topology";
import { handleProviderCommand } from "../../../worker/provider-command-handler";

/**
 * DURABLE GENERATION COMMAND PLANE (Phase 6R-C).
 *
 * The one invariant every test here serves, 6R.22:
 *
 *   AN SQS MESSAGE IS NOT AUTHORIZATION EVIDENCE.
 *
 * AWS delivering a message says nothing about whether the work it names is
 * legal. Every field is re-derived from, or checked against, durable server
 * state before anything can reach a provider. The message chooses nothing —
 * not the owner, not the provider, not whether a submission may happen.
 *
 * REAL: the wire contract (serialize/parse), the provider worker handler, the
 * attempt state machine, the submission claim, the mock ProviderAdapter.
 * FAKE: the AWS network and the Supabase network, nothing else.
 *
 * HONEST LIMIT, stated up front: the database is an in-memory double, so the
 * concurrency test below exercises the application's compare-and-set logic
 * under interleaved awaits, NOT PostgreSQL's row locking. Real database
 * concurrency is 6R-G's gate and is not claimed here.
 */

/** Builds a wire command the way the producer does, then parses it the way the worker does. */
function wireCommand(overrides: Partial<CommandWireV1> & { attemptId: string; generationId: string }) {
  const type = overrides.type ?? "provider.submit";
  const body = serializeCommand({
    commandId: overrides.commandId ?? commandIdFor(type, overrides.attemptId),
    type,
    generationId: overrides.generationId,
    attemptId: overrides.attemptId,
    issuedAt: overrides.issuedAt ?? new Date().toISOString(),
    ...(overrides.traceId ? { traceId: overrides.traceId } : {}),
  });
  const parsed = parseCommand(body);
  if (!parsed.ok) throw new Error(`fixture rejected by the production parser: ${parsed.reason}`);
  return { command: parsed.command, body };
}

interface AttemptSeed {
  status?: string;
  provider?: string;
  providerModel?: string;
  providerJobId?: string | null;
  evidence?: string;
  updatedAt?: string;
  generationId?: string;
}

async function commandScenario(
  options: { mockMode?: string; generationStatus?: string; attempt?: AttemptSeed } = {}
) {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  const { generationId, clerkUserId } = seedGeneration(db, {
    metadata: { mock_mode: options.mockMode ?? "async-success" },
    ...(options.generationStatus ? { status: options.generationStatus } : {}),
  });

  const attemptId = randomUUID();
  const a = options.attempt ?? {};
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: a.generationId ?? generationId,
    attempt_no: 1,
    provider: a.provider ?? "mock",
    provider_model: a.providerModel ?? "mock-image-v1",
    provider_job_id: a.providerJobId ?? null,
    submission_evidence: a.evidence ?? "none",
    status: a.status ?? "pending",
    updated_at: a.updatedAt ?? new Date().toISOString(),
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    submitted_at: null,
    completed_at: null,
    error_code: null,
    submission_error_code: null,
    cost_amount: null,
    cost_currency: null,
    latency_ms: null,
    workflow_id: "wf-6rc",
    workflow_run_id: "run-6rc",
  });

  return { db, generationId, clerkUserId, attemptId };
}

/** Uploads are the observable proof a provider actually produced work. */
const providerDidWork = (db: FakeSupabaseClient) =>
  db.storageUploads.length > 0 ||
  db.state.generation_attempts.some((a) => a.provider_job_id !== null);

// ===========================================================================
// A. VALID COMMAND
// ===========================================================================

test("A: a valid provider command submits exactly once, through the real chain", async () => {
  const { db, generationId, attemptId } = await commandScenario();
  const { command } = wireCommand({ generationId, attemptId });

  const outcome = await handleProviderCommand(command);

  assert.equal(outcome.action, "delete");
  assert.equal(outcome.classification, "safe");
  assert.equal(outcome.reason, "submitted:processing");
  assert.equal(db.state.generation_attempts[0].status, "processing");
  assert.equal(db.state.generation_attempts[0].submission_evidence, "job");
  assert.equal(db.state.generation_attempts.length, 1, "no attempt was invented");
});

// ===========================================================================
// B + C. DUPLICATE DELIVERY — TRANSPORT DEDUP IS NOT THE BOUNDARY
// ===========================================================================

test("B: the identical message delivered twice submits at most once", async () => {
  const { db, generationId, attemptId } = await commandScenario();
  const { command } = wireCommand({ generationId, attemptId });

  const first = await handleProviderCommand(command);
  const jobAfterFirst = db.state.generation_attempts[0].provider_job_id;
  const second = await handleProviderCommand(command);

  assert.equal(first.reason, "submitted:processing");
  assert.equal(second.reason, "evidence_already_recorded", "the durable guard caught the duplicate");
  assert.equal(second.classification, "safe");
  assert.equal(
    db.state.generation_attempts[0].provider_job_id,
    jobAfterFirst,
    "the provider job id was not replaced by a second submission"
  );
  assert.equal(db.state.generation_attempts.length, 1);
});

test("C: a DIFFERENT message representing the same logical attempt still submits at most once", async () => {
  const { db, generationId, attemptId } = await commandScenario();

  // Same attempt, different issuedAt and traceId — i.e. a genuinely different
  // SQS message that FIFO deduplication would NOT collapse, because dedup
  // keys on the deterministic commandId only within its window. The business
  // boundary has to hold on its own.
  const a = wireCommand({ generationId, attemptId, issuedAt: new Date(1).toISOString(), traceId: "t1" });
  const b = wireCommand({ generationId, attemptId, issuedAt: new Date(2).toISOString(), traceId: "t2" });
  assert.notEqual(a.body, b.body, "these are genuinely different messages");
  assert.equal(a.command.commandId, b.command.commandId, "but one logical command");

  await handleProviderCommand(a.command);
  const second = await handleProviderCommand(b.command);

  assert.equal(second.reason, "evidence_already_recorded");
  assert.equal(db.state.generation_attempts.length, 1);
  assert.equal(db.storageUploads.length, 0, "async submission uploads nothing yet, and never twice");
});

test("C2: FIFO deduplication is defense in depth, NOT the idempotency boundary", async () => {
  // Documents the layering explicitly: the transport collapses a same-window
  // duplicate, and the durable claim independently refuses one that escapes.
  const sqs = new FakeSqsTransport();
  const envelope = {
    queue: "provider" as const,
    command: {
      type: "provider.submit" as const,
      generationId: randomUUID(),
      attemptId: randomUUID(),
    },
    idempotencyKey: "provider.submit:dedup-probe",
  };
  await sqs.enqueue(envelope);
  await sqs.enqueue(envelope);
  assert.equal(sqs.messages.length, 1, "transport collapsed the in-window duplicate");
  assert.equal(sqs.dedupDroppedCount, 1);
  // The durable half is proven by B and C above, which bypass the transport
  // entirely and still submit only once.
});

// ===========================================================================
// D. UNKNOWN GENERATION
// ===========================================================================

test("D: a command naming an unknown generation calls no provider", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  const { command } = wireCommand({ generationId: randomUUID(), attemptId: randomUUID() });
  const outcome = await handleProviderCommand(command);

  assert.equal(outcome.reason, "attempt_not_found");
  assert.equal(outcome.action, "retain", "preserved for the DLQ rather than silently dropped");
  assert.equal(providerDidWork(db), false);
  assert.equal(db.state.generation_attempts.length, 0, "no attempt was created from the message");
});

test("D2: an attempt whose generation row is absent is poison, not a retry loop", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  // generation_attempts.generation_id has a FK ON DELETE CASCADE, so this is
  // impossible under the real schema — which is exactly why it must not be
  // retried into the same contradiction.
  const attemptId = randomUUID();
  const generationId = randomUUID();
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

  const { command } = wireCommand({ generationId, attemptId });
  const outcome = await handleProviderCommand(command);

  assert.equal(outcome.reason, "generation_not_found");
  assert.equal(outcome.classification, "non_retryable");
  assert.equal(providerDidWork(db), false);
});

// ===========================================================================
// E. STALE COMMAND vs TERMINAL GENERATION
// ===========================================================================

for (const terminal of ["completed", "failed", "cancelled"]) {
  test(`E: a stale command for an already-${terminal} generation calls no provider`, async () => {
    const { db, generationId, attemptId } = await commandScenario({
      generationStatus: terminal,
      // The attempt is still pending — the race this guards is precisely a
      // command that outlived its generation's resolution elsewhere.
      attempt: { status: "pending" },
    });

    const { command } = wireCommand({ generationId, attemptId });
    const outcome = await handleProviderCommand(command);

    assert.equal(outcome.reason, `generation_not_submittable:${terminal}`);
    assert.equal(outcome.classification, "non_retryable");
    assert.equal(outcome.action, "delete", "a benign race does not belong in the DLQ");
    assert.equal(providerDidWork(db), false);
    assert.equal(
      db.state.generations[0].status,
      terminal,
      "the terminal generation state was not disturbed"
    );
    assert.equal(
      db.state.generation_attempts[0].status,
      "pending",
      "the attempt is left for reconciliation, not force-failed by the command plane"
    );
  });
}

test("E2: a terminal ATTEMPT is also refused, independently of the generation", async () => {
  const { db, generationId, attemptId } = await commandScenario({
    attempt: { status: "succeeded" },
  });
  const { command } = wireCommand({ generationId, attemptId });

  const outcome = await handleProviderCommand(command);
  assert.equal(outcome.reason, "already_terminal:succeeded");
  assert.equal(outcome.classification, "safe");
  assert.equal(providerDidWork(db), false);
});

// ===========================================================================
// F. ATTEMPT / GENERATION MISMATCH
// ===========================================================================

test("F: an attempt belonging to another generation is refused, with no provider call", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  const victim = seedGeneration(db, { metadata: { mock_mode: "async-success" } });
  const other = seedGeneration(db, { metadata: { mock_mode: "async-success" } });

  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: other.generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: null,
    submission_evidence: "none",
    status: "pending",
    updated_at: new Date().toISOString(),
  });

  // A message that pairs the victim's generation with the other's attempt.
  const { command } = wireCommand({ generationId: victim.generationId, attemptId });
  const outcome = await handleProviderCommand(command);

  assert.equal(outcome.reason, "generation_mismatch");
  assert.equal(outcome.classification, "non_retryable");
  assert.equal(outcome.action, "retain", "genuine poison is preserved for investigation");
  assert.equal(providerDidWork(db), false);
  assert.equal(db.state.generation_attempts[0].status, "pending", "nothing was mutated");
});

// ===========================================================================
// G. PROVIDER MISMATCH — THE MESSAGE CANNOT ROUTE
// ===========================================================================

test("G: an attempt whose provider disagrees with the registry is refused", async () => {
  const { db, generationId, attemptId } = await commandScenario({
    // The generation's model resolves to "mock" in the registry; the attempt
    // claims a different provider. Submitting could bill the wrong one.
    attempt: { provider: "fal" },
  });

  const { command } = wireCommand({ generationId, attemptId });
  const outcome = await handleProviderCommand(command);

  assert.equal(outcome.reason, "provider_mismatch");
  assert.equal(outcome.classification, "non_retryable");
  assert.equal(providerDidWork(db), false);
});

test("G2: the wire format has no provider field at all - routing is not negotiable", () => {
  const { command } = wireCommand({ generationId: randomUUID(), attemptId: randomUUID() });
  assert.deepEqual(
    Object.keys(command).sort(),
    ["attemptId", "commandId", "generationId", "issuedAt", "type", "v"],
    "no provider, no model, no owner, no tenant — nothing routable travels on the wire"
  );

  // And an added one is rejected outright rather than ignored.
  const smuggled = JSON.stringify({ ...command, provider: "expensive-provider" });
  const parsed = parseCommand(smuggled);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.ok === false && parsed.reason, "unknown_field:provider");
});

// ===========================================================================
// H + I. SCHEMA AND VERSION
// ===========================================================================

test("H: malformed messages are rejected by the production parser, never guessed at", () => {
  const valid = wireCommand({ generationId: randomUUID(), attemptId: randomUUID() });
  const cases: [string, string][] = [
    ["not json at all", "not_json"],
    [JSON.stringify([1, 2]), "not_object"],
    [JSON.stringify({ ...valid.command, generationId: "gen-1" }), "invalid_generation_id"],
    [JSON.stringify({ ...valid.command, attemptId: "attempt-1" }), "invalid_attempt_id"],
    [JSON.stringify({ ...valid.command, type: "provider.detonate" }), "unknown_type"],
    [JSON.stringify({ ...valid.command, issuedAt: "sometime" }), "invalid_issued_at"],
    [JSON.stringify({ ...valid.command, commandId: "provider.submit:someone-else" }), "command_id_mismatch"],
    [JSON.stringify({ ...valid.command, apiKey: "leak" }), "unknown_field:apiKey"],
  ];

  for (const [body, expected] of cases) {
    const parsed = parseCommand(body);
    assert.equal(parsed.ok, false, `expected rejection for ${expected}`);
    assert.equal(parsed.ok === false && parsed.reason, expected);
  }
});

test("I: an unknown wire version is rejected rather than reinterpreted", () => {
  const valid = wireCommand({ generationId: randomUUID(), attemptId: randomUUID() });
  for (const v of [COMMAND_WIRE_VERSION + 1, 0, "1", null]) {
    const parsed = parseCommand(JSON.stringify({ ...valid.command, v }));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.reason, "unsupported_version");
  }
});

test("I2: the handler re-validates the contract itself, not just its caller's word", async () => {
  const { db, generationId, attemptId } = await commandScenario();

  // A command object that never went through parseCommand — what a second,
  // future caller of the handler could hand it.
  const forged = {
    v: COMMAND_WIRE_VERSION,
    commandId: "provider.submit:somebody-else",
    type: "provider.submit",
    generationId,
    attemptId,
    issuedAt: new Date().toISOString(),
  } as CommandWireV1;

  const outcome = await handleProviderCommand(forged);
  assert.equal(outcome.classification, "non_retryable");
  assert.ok(
    outcome.reason.startsWith("schema_invalid:"),
    `expected a schema refusal, got ${outcome.reason}`
  );
  assert.equal(providerDidWork(db), false);
});

// ===========================================================================
// J. AMBIGUOUS SUBMISSION
// ===========================================================================

test("J: a stale claim with no evidence is recorded ambiguous and never blindly resubmitted", async () => {
  const { db, generationId, attemptId } = await commandScenario({
    attempt: {
      status: "submitting",
      updatedAt: new Date(Date.now() - ATTEMPT_STALE_AFTER_MS - 60_000).toISOString(),
    },
  });

  const { command } = wireCommand({ generationId, attemptId });
  const outcome = await handleProviderCommand(command);

  assert.equal(outcome.reason, "stale_claim_marked_ambiguous");
  assert.equal(outcome.classification, "ambiguous", "classified as ambiguous, never as safe");
  assert.equal(outcome.action, "delete", "retired so redelivery cannot become a blind resubmit");
  assert.equal(db.state.generation_attempts[0].submission_evidence, "ambiguous");
  assert.equal(providerDidWork(db), false);

  // And a redelivery afterwards still refuses. It lands on the TERMINAL
  // guard rather than the evidence guard, because recording ambiguity also
  // closes the attempt — a stricter refusal reached one check earlier.
  const again = await handleProviderCommand(command);
  assert.equal(again.reason, "already_terminal:failed");
  assert.equal(providerDidWork(db), false);
  assert.equal(
    db.state.generation_attempts[0].submission_evidence,
    "ambiguous",
    "the ambiguity survives for reconciliation — it is not overwritten by the refusal"
  );
});

test("J2: a LIVE claim is waited on, not preempted - evidence about to be written is not discarded", async () => {
  const { db, generationId, attemptId } = await commandScenario({
    attempt: { status: "submitting", updatedAt: new Date().toISOString() },
  });

  const { command } = wireCommand({ generationId, attemptId });
  const outcome = await handleProviderCommand(command);

  assert.equal(outcome.reason, "possibly_in_flight");
  assert.equal(outcome.classification, "retryable");
  assert.equal(outcome.action, "retain");
  assert.equal(db.state.generation_attempts[0].status, "submitting", "the live handler was left alone");
});

// ===========================================================================
// K + L. RETRYABLE vs NON-RETRYABLE
// ===========================================================================

test("K: a transient infrastructure failure is retryable and asserts nothing about the provider", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db);
  const attemptId = randomUUID();

  // The read itself fails, as a database blip looks from here.
  const original = db.from.bind(db);
  db.from = ((table: string) => {
    if (table === "generation_attempts") throw new Error("ECONNRESET");
    return original(table);
  }) as typeof db.from;

  const { command } = wireCommand({ generationId, attemptId });
  await assert.rejects(
    handleProviderCommand(command),
    "a handler that cannot decide must throw, so the worker retains the message"
  );

  // The worker's own catch is what turns this into a retain — asserted here
  // against the real source rather than a re-implementation.
  const workerSource = readFileSync(join(process.cwd(), "worker/provider-worker.ts"), "utf8");
  assert.ok(/handler_failed/.test(workerSource));
  assert.ok(
    /classification: "retryable"/.test(workerSource),
    "a thrown handler is classified retryable, never acknowledged"
  );
});

test("L: every non-retryable outcome is deterministic and never reaches a provider", async () => {
  // One table, so a new refusal path cannot be added without deciding its
  // classification and its DLQ behaviour.
  const NON_RETRYABLE_REASONS = [
    "generation_mismatch",
    "generation_not_found",
    "unknown_model",
    "provider_mismatch",
    "generation_not_submittable:completed",
    "generation_not_submittable:failed",
    "generation_not_submittable:cancelled",
  ];

  const handlerSource = readFileSync(
    join(process.cwd(), "worker/provider-command-handler.ts"),
    "utf8"
  );
  for (const reason of NON_RETRYABLE_REASONS) {
    const base = reason.split(":")[0];
    assert.ok(handlerSource.includes(base), `${base} must still exist as a refusal path`);
  }

  // Nothing may be classified "safe" while also retaining: a retained message
  // is by definition unresolved.
  const outcomes = [
    ...handlerSource.matchAll(/action:\s*"(delete|retain)",\s*\n?\s*classification:\s*"(\w+)"/g),
  ];
  assert.ok(outcomes.length >= 8, "the classification table was parsed");
  for (const [, action, classification] of outcomes) {
    assert.ok(
      !(action === "retain" && classification === "safe"),
      "a retained message cannot be classified safe — it has not been resolved"
    );
  }
});

// ===========================================================================
// M. CONCURRENT SAME-ATTEMPT HANDLING
// ===========================================================================

test("M: two concurrent deliveries of one attempt yield exactly one submission right", async () => {
  const { db, generationId, attemptId } = await commandScenario();
  const { command } = wireCommand({ generationId, attemptId });

  const [x, y] = await Promise.all([
    handleProviderCommand(command),
    handleProviderCommand(command),
  ]);

  const reasons = [x.reason, y.reason].sort();
  assert.deepEqual(
    reasons,
    ["submitted:processing", "submitted:skipped"],
    "one delivery won the claim; the other was refused by it"
  );
  assert.equal(db.state.generation_attempts.length, 1);
  assert.equal(
    db.state.generation_attempts[0].submission_evidence,
    "job",
    "exactly one provider job was recorded"
  );
  // NOTE: interleaved awaits over an in-memory double, not PostgreSQL row
  // locking. See the file header — real DB concurrency is 6R-G's gate.
});

// ===========================================================================
// N + O. OWNERSHIP BOUNDARIES PRESERVED
// ===========================================================================

test("N: the callback path still ends in a Temporal signal, not in a queue command", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { status: "processing" });
  db.state.generation_attempts.push({
    id: randomUUID(),
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: "mock-job-callback",
    submission_evidence: "job",
    status: "submitted",
    updated_at: new Date().toISOString(),
  });

  const { markWebhookEventVerified } = await import("@/lib/orchestration/webhook-continuation");
  const { bridgeVerifiedWebhookToTemporal } = await import("@/lib/orchestration/webhook-temporal-bridge");

  const signalled: string[] = [];
  const result = await bridgeVerifiedWebhookToTemporal(
    markWebhookEventVerified({
      provider: "mock",
      providerJobId: "mock-job-callback",
      reportedState: "completed",
      transport: "webhook",
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

  assert.equal(result.outcome, "accepted");
  assert.deepEqual(signalled, [generationId], "the callback signals Temporal directly");
  assert.equal(
    db.state.generation_attempts[0].status,
    "processing",
    "durable observation first, signal second — unchanged by 6R-C"
  );

  // The bridge must not have grown a queue dependency.
  const bridgeSource = readFileSync(
    join(process.cwd(), "src/lib/orchestration/webhook-temporal-bridge.ts"),
    "utf8"
  );
  for (const forbidden of ["command-bus", "sqs", "bullmq", "getCommandBus"]) {
    assert.ok(
      !bridgeSource.toLowerCase().includes(forbidden),
      `the callback path must not route through ${forbidden}`
    );
  }
});

test("O: the command plane cannot own a workflow or a lifecycle", () => {
  const handlerSource = readFileSync(
    join(process.cwd(), "worker/provider-command-handler.ts"),
    "utf8"
  );
  const workerSource = readFileSync(join(process.cwd(), "worker/provider-worker.ts"), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const [name, source] of [
    ["provider-command-handler.ts", strip(handlerSource)],
    ["provider-worker.ts", strip(workerSource)],
  ] as const) {
    // No workflow ownership.
    assert.ok(!/startGenerationWorkflow/.test(source), `${name} must not start a workflow`);
    assert.ok(!/signalWithStart|getTemporalClient/.test(source), `${name} must not drive Temporal`);
    // No independent finalization: markCompleted belongs to the shared tail
    // that Temporal's poll reaches, not to the command plane.
    assert.ok(!/markCompleted/.test(source), `${name} must not finalize a generation`);
    // No Trigger.dev resurrection.
    assert.ok(!/generationTask|asyncContinuationTask|@trigger\.dev/.test(source),
      `${name} must not reach Trigger.dev`);
  }
});

// ===========================================================================
// TRANSPORT CONTRACT — the timing relationships the safety argument rests on
// ===========================================================================

test("the provider queue's timing contract holds together", () => {
  const provider = SQS_QUEUES.provider;

  assert.equal(provider.fifo, true, "per-generation ordering and dedup are FIFO properties");
  assert.ok(provider.dlqName.endsWith(".fifo"), "a FIFO queue requires a FIFO DLQ");
  assert.ok(provider.visibilityTimeoutSeconds > 0);
  assert.ok(provider.maxReceiveCount >= 1 && provider.maxReceiveCount <= 1000);
  assert.equal(provider.receiveWaitTimeSeconds, 20, "long polling at the SQS maximum");

  // THE relationship the crash-window recovery depends on: a redelivery
  // caused by visibility expiry must NOT be able to treat a live handler as
  // dead. Staleness is measured in ATTEMPT_STALE_AFTER_MS and refreshed by
  // the handler's heartbeat, so it must be comfortably larger than one
  // visibility window.
  const visibilityMs = provider.visibilityTimeoutSeconds * 1000;
  assert.ok(
    ATTEMPT_STALE_AFTER_MS > visibilityMs * 2,
    `staleness (${ATTEMPT_STALE_AFTER_MS}ms) must exceed a visibility window ` +
      `(${visibilityMs}ms) with margin, or a redelivery could preempt a live handler`
  );

  // The heartbeat is what keeps that true for a submission that legitimately
  // runs longer than the staleness window.
  const handlerSource = readFileSync(
    join(process.cwd(), "worker/provider-command-handler.ts"),
    "utf8"
  );
  const heartbeat = Number(handlerSource.match(/HEARTBEAT_INTERVAL_MS = ([\d_]+)/)![1].replace(/_/g, ""));
  assert.ok(
    heartbeat * 5 < ATTEMPT_STALE_AFTER_MS,
    "the heartbeat must tick several times inside the staleness window, so one missed tick is survivable"
  );
});

test("every queue in the topology has a same-type DLQ and a bounded redelivery budget", () => {
  for (const [key, spec] of Object.entries(SQS_QUEUES)) {
    assert.ok(spec.dlqName.length > 0, `${key} has no DLQ`);
    assert.equal(
      spec.dlqName.endsWith(".fifo"),
      spec.fifo,
      `${key}: SQS requires the DLQ to match the queue's type`
    );
    assert.ok(spec.maxReceiveCount >= 1, `${key}: a message must be able to reach the DLQ`);
    assert.ok(
      spec.maxReceiveCount <= 10,
      `${key}: an unbounded-looking budget delays poison detection`
    );
  }
});

// ===========================================================================
// IAM QUEUE BOUNDARY
// ===========================================================================

test("SQS IAM stays separated by worker boundary, with no wildcard", () => {
  const iam = readFileSync(join(process.cwd(), "infra/modules/iam/main.tf"), "utf8");
  const code = iam.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(#|\/\/).*$/gm, "");

  assert.ok(!/actions\s*=\s*\[[^\]]*"sqs:\*"/.test(code), "no sqs:* grant");
  assert.ok(!/resources\s*=\s*\["\*"\]/.test(code), "no wildcard resource");

  // Consuming and producing are granted separately, and the provider worker
  // is given no SendMessage on the generation command plane by default.
  const production = readFileSync(
    join(process.cwd(), "infra/environments/production/main.tf"),
    "utf8"
  );
  assert.ok(
    /provider_worker_produce_queue_arns\s*=\s*\[\]/.test(production),
    "the provider worker must not be able to enqueue generation commands"
  );
});
