import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase, seedGeneration } from "./e2e-harness";
import {
  classifyCancellation,
  isLegalGenerationTransition,
  reflectAttemptOntoGeneration,
  GENERATION_STATES,
  ATTEMPT_STATES,
  TERMINAL_GENERATION_STATES,
  type ProviderCancelOutcome,
} from "@/lib/orchestration/cancellation";
import * as activities from "../../../worker/activities/generation-activities";
import type { GenerationAttempt } from "@/types/database";

/**
 * CANCEL SEMANTICS & STATE SEPARATION (Phase 6R-H).
 *
 * The property under test, in one sentence: a provider can never decide what
 * a Cinefield generation is.
 *
 * Everything else here follows from keeping four things apart — user cancel
 * intent, provider cancellability, Temporal's coordination decision, and the
 * two state machines (generations.status vs generation_attempts.status).
 */

const readSource = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

function attempt(overrides: Partial<GenerationAttempt> = {}): GenerationAttempt {
  return {
    id: randomUUID(),
    generation_id: randomUUID(),
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: null,
    status: "pending",
    submission_evidence: "none",
    submission_error_code: null,
    workflow_id: null,
    workflow_run_id: null,
    cost_amount: null,
    cost_currency: null,
    latency_ms: null,
    error_code: null,
    started_at: null,
    submitted_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as GenerationAttempt;
}

// ===========================================================================
// H1 / H12 — THE TWO STATE MACHINES ARE SEPARATE
// ===========================================================================

test("H1: the generation and attempt vocabularies are distinct, and match their DB constraints", () => {
  assert.deepEqual([...GENERATION_STATES], ["queued", "processing", "completed", "failed", "cancelled"]);
  assert.deepEqual(
    [...ATTEMPT_STATES],
    ["pending", "claimed", "submitting", "submitted", "processing", "succeeded", "failed", "cancelled"]
  );

  // The attempt machine is genuinely richer — that is the point of separating
  // them. States like claimed/submitting/succeeded describe a provider job
  // and have no business appearing on a user-facing generation.
  const generationOnly = new Set<string>(GENERATION_STATES);
  for (const attemptOnly of ["claimed", "submitting", "submitted", "succeeded"]) {
    assert.ok(!generationOnly.has(attemptOnly), `${attemptOnly} must not be a generation state`);
  }

  // And both mirror the real CHECK constraints rather than drifting from them.
  const remote = readSource("supabase/migrations/20260805132704_remote_schema.sql");
  for (const state of GENERATION_STATES) {
    assert.ok(remote.includes(`'${state}'::"text"`), `generations must permit ${state}`);
  }
  const attempts = readSource("supabase/migrations/20260810120000_generation_attempts.sql");
  for (const state of ATTEMPT_STATES) {
    assert.ok(attempts.includes(`'${state}'::"text"`), `generation_attempts must permit ${state}`);
  }
});

test("H12: the generation state machine refuses every backwards transition", () => {
  for (const from of GENERATION_STATES) {
    for (const to of GENERATION_STATES) {
      const legal = isLegalGenerationTransition(from, to);

      if (TERMINAL_GENERATION_STATES.has(from)) {
        assert.equal(legal, false, `${from} is terminal and must not move to ${to}`);
        continue;
      }
      if (to === "queued" || from === to) {
        assert.equal(legal, false, `${from} -> ${to} must be refused`);
        continue;
      }
      assert.equal(legal, true, `${from} -> ${to} should be permitted`);
    }
  }

  // The three the brief calls out by name.
  assert.equal(isLegalGenerationTransition("completed", "processing"), false);
  assert.equal(isLegalGenerationTransition("failed", "processing"), false);
  assert.equal(isLegalGenerationTransition("cancelled", "processing"), false);
});

test("H7/H12: a succeeded ATTEMPT does not by itself complete a generation", () => {
  // Without a cancel intent, a succeeded attempt reflects to completed...
  assert.deepEqual(
    reflectAttemptOntoGeneration({
      generationState: "processing",
      attemptState: "succeeded",
      userCancelRequested: false,
    }),
    { transitionTo: "completed", reason: "attempt_succeeded" }
  );

  // ...but the decision is Temporal's to apply, and a cancel intent outranks
  // it. This is the whole 6R-H invariant in one assertion.
  assert.deepEqual(
    reflectAttemptOntoGeneration({
      generationState: "processing",
      attemptState: "succeeded",
      userCancelRequested: true,
    }),
    { transitionTo: "cancelled", reason: "user_cancel_intent_outranks_late_completion" }
  );

  // And a generation that already resolved is never re-transitioned.
  for (const terminal of ["completed", "failed", "cancelled"] as const) {
    assert.deepEqual(
      reflectAttemptOntoGeneration({
        generationState: terminal,
        attemptState: "succeeded",
        userCancelRequested: false,
      }),
      { transitionTo: null, reason: "generation_already_terminal" }
    );
  }

  // A provider merely working is not a generation transition at all.
  for (const running of ["pending", "claimed", "submitting", "submitted", "processing"] as const) {
    assert.equal(
      reflectAttemptOntoGeneration({
        generationState: "processing",
        attemptState: running,
        userCancelRequested: false,
      }).transitionTo,
      null,
      `${running} must not move the generation`
    );
  }
});

test("E2/H: no production code lets a provider observation write generation.status directly", () => {
  // The inbound webhook boundary is the place this would happen if it were
  // going to. It may touch the ATTEMPT and signal Temporal, and nothing else.
  const bridge = readSource("src/lib/orchestration/webhook-temporal-bridge.ts");
  const code = bridge.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.ok(!/from\(["'`]generations["'`]\)/.test(code), "the bridge must not write the generations table");
  assert.ok(!/markCompleted|markFailed|markCancelled/.test(code), "the bridge must not transition a generation");
  assert.ok(/recordProviderObservation/.test(code), "it records an ATTEMPT observation");
  assert.ok(/signal/.test(code), "and hands the decision to Temporal");

  // The provider worker likewise records attempt evidence, never generation state.
  const handler = readSource("worker/provider-command-handler.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/markCompleted/.test(handler), "the worker must not finalize a generation");
});

// ===========================================================================
// H10 — SETTLEMENT CLASSIFICATION (evidence for Phase 10, not billing)
// ===========================================================================

test("H10: nothing ever sent classifies as a pre-submit cancel, with no reconciliation", () => {
  assert.deepEqual(classifyCancellation(null), {
    settlementClass: "pre_submit_cancel",
    attemptId: null,
    providerJobId: null,
    requiresReconciliation: false,
  });

  const pending = attempt({ status: "pending" });
  const result = classifyCancellation(pending);
  assert.equal(result.settlementClass, "pre_submit_cancel");
  assert.equal(result.requiresReconciliation, false);
});

test("H10: an in-flight submission with no evidence yet requires reconciliation", () => {
  // The dangerous window: a request may be at the provider right now.
  for (const status of ["claimed", "submitting"] as const) {
    const result = classifyCancellation(attempt({ status }));
    assert.equal(result.settlementClass, "unknown_reconcile", `${status} is not provably free`);
    assert.equal(result.requiresReconciliation, true);
  }
});

test("H10: ambiguous evidence outranks everything and always reconciles", () => {
  const result = classifyCancellation(
    attempt({ status: "failed", submission_evidence: "ambiguous" }),
    { outcome: "cancelled" } // even a confirmed provider cancel does not clear it
  );
  assert.equal(result.settlementClass, "unknown_reconcile");
  assert.equal(result.requiresReconciliation, true);
});

test("H10: a real job the provider confirmed stopped is classified separately from an assumed-free one", () => {
  const withJob = attempt({
    status: "processing",
    submission_evidence: "job",
    provider_job_id: "mock-job-1",
  });

  assert.equal(
    classifyCancellation(withJob, { outcome: "cancelled" }).settlementClass,
    "provider_confirmed_cancel"
  );

  // "confirmed stopped" is deliberately NOT "confirmed free" — the provider's
  // billing policy is not something Cinefield knows.
  const confirmed = classifyCancellation(withJob, { outcome: "cancelled" });
  assert.equal(confirmed.providerJobId, "mock-job-1", "the job id survives for Phase 10");
});

test("H10: unsupported, already-terminal, or never-asked cancels are assumed billable", () => {
  const withJob = attempt({
    status: "processing",
    submission_evidence: "job",
    provider_job_id: "mock-job-2",
  });

  const cases: (ProviderCancelOutcome | undefined)[] = [
    { outcome: "unsupported" },
    { outcome: "already_terminal" },
    undefined,
  ];
  for (const providerCancel of cases) {
    assert.equal(
      classifyCancellation(withJob, providerCancel).settlementClass,
      "provider_uncancellable_or_completed",
      `${providerCancel?.outcome ?? "not asked"} must be treated as possibly billable`
    );
  }

  // A cancel call that FAILED leaves the job's fate unknown — reconcile.
  const failed = classifyCancellation(withJob, { outcome: "failed", errorCode: "PROVIDER_TIMEOUT" });
  assert.equal(failed.settlementClass, "unknown_reconcile");
  assert.equal(failed.requiresReconciliation, true);
});

test("H10: the classifier mutates nothing and settles nothing", () => {
  const source = readSource("src/lib/orchestration/cancellation.ts");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [
    "reserve_credits",
    "settle_reservation",
    "refund_reservation",
    "getSupabaseAdminClient",
    ".update(",
    ".insert(",
    "fetch(",
  ]) {
    assert.ok(!code.includes(forbidden), `cancellation.ts must not reference ${forbidden}`);
  }
});

// ===========================================================================
// H3 / H4 / H9 — CANCEL PATH BEHAVIOUR AGAINST REAL CODE
// ===========================================================================

async function cancelScenario(options: {
  generationStatus?: string;
  attemptStatus?: string;
  evidence?: string;
  providerJobId?: string | null;
}) {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, {
    status: options.generationStatus ?? "processing",
    metadata: { mock_mode: "async-success" },
  });

  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: options.providerJobId ?? null,
    submission_evidence: options.evidence ?? "none",
    status: options.attemptStatus ?? "pending",
    updated_at: new Date().toISOString(),
    completed_at: null,
  });

  return { db, generationId, attemptId };
}

test("H3/A: cancelling before any submission cancels cleanly and emits ONE event", async () => {
  const { db, generationId, attemptId } = await cancelScenario({ attemptStatus: "pending" });

  const outcome = await activities.cancelGeneration({ generationId, attemptId });

  assert.equal(outcome.settled, true);
  assert.equal(db.state.generations[0].status, "cancelled");
  assert.equal(db.state.generation_attempts[0].status, "cancelled");
  assert.equal(db.outboxEvents.length, 1, "the transactional writer emitted exactly one event");
  assert.equal(db.outboxEvents[0].event_type, "generation.cancelled");
  assert.equal(db.outboxEvents[0].aggregate_id, generationId);
});

test("H3/B: a duplicate cancel is safe and does NOT emit a second event", async () => {
  const { db, generationId, attemptId } = await cancelScenario({ attemptStatus: "pending" });

  await activities.cancelGeneration({ generationId, attemptId });
  const second = await activities.cancelGeneration({ generationId, attemptId });

  assert.equal(second.settled, true, "a repeated cancel is not an error");
  assert.equal(db.state.generations[0].status, "cancelled");
  assert.equal(
    db.outboxEvents.length,
    1,
    "the refused transition emitted nothing — one cancellation, one event"
  );
});

test("H9/M: cancel DEFERS while a submission may be in flight, and destroys no evidence", async () => {
  for (const attemptStatus of ["claimed", "submitting"]) {
    const { db, generationId, attemptId } = await cancelScenario({ attemptStatus });

    const outcome = await activities.cancelGeneration({ generationId, attemptId });

    assert.equal(outcome.settled, false, `${attemptStatus} must defer`);
    assert.equal(db.state.generations[0].status, "processing", "nothing was written");
    assert.equal(db.state.generation_attempts[0].status, attemptStatus);
    assert.equal(db.outboxEvents.length, 0, "a deferred cancel announces nothing");
  }
});

test("H8/G: a cancel that arrives after completion loses, and the completion stands", async () => {
  const { db, generationId, attemptId } = await cancelScenario({
    generationStatus: "completed",
    attemptStatus: "succeeded",
    evidence: "job",
    providerJobId: "mock-job-done",
  });

  const outcome = await activities.cancelGeneration({ generationId, attemptId });

  assert.equal(outcome.settled, true, "the race is resolved, even though cancel lost");
  assert.equal(db.state.generations[0].status, "completed", "a finished generation is not un-finished");
  assert.equal(db.state.generation_attempts[0].status, "succeeded");
  assert.equal(db.outboxEvents.length, 0, "no cancellation event for a cancellation that did not happen");
});

test("H7/I: a provider completion arriving AFTER cancellation cannot revive the generation", async () => {
  const { db, generationId, clerkUserId } = await (async () => {
    const database = new FakeSupabaseClient();
    await installFakeSupabase(database);
    const seeded = seedGeneration(database, {
      status: "cancelled",
      metadata: {
        mock_mode: "async-success",
        orchestration: {
          stage: "cancelled",
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
    const meta = database.state.generations[0].metadata as {
      orchestration: { providerJob: { id: string } };
    };
    meta.orchestration.providerJob.id = `mock-${seeded.generationId}`;
    return { db: database, ...seeded };
  })();

  const { checkAsyncGeneration } = await import("@/lib/orchestration/orchestrator");
  const late = await checkAsyncGeneration({ generationId, clerkUserId, source: "webhook" });

  assert.equal(late.status, "failed", "a cancelled row reports terminal, never completed");
  assert.equal(db.state.generations[0].status, "cancelled");
  assert.equal(db.storageUploads.length, 0, "no output is finalized for a cancelled generation");
});

test("H11/J: a late verified webhook after cancellation cannot regress the attempt", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { status: "cancelled" });
  db.state.generation_attempts.push({
    id: randomUUID(),
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: "mock-job-late",
    submission_evidence: "job",
    status: "cancelled",
    updated_at: new Date().toISOString(),
  });

  const { markWebhookEventVerified } = await import("@/lib/orchestration/webhook-continuation");
  const { bridgeVerifiedWebhookToTemporal } = await import("@/lib/orchestration/webhook-temporal-bridge");

  let signals = 0;
  const event = markWebhookEventVerified({
    provider: "mock",
    providerJobId: "mock-job-late",
    reportedState: "completed",
    transport: "webhook",
  });
  const deps = {
    isAdminConfigured: () => true,
    getAdmin: () => db as never,
    signal: async () => {
      signals += 1;
      return { outcome: "signalled" as const };
    },
  };

  const first = await bridgeVerifiedWebhookToTemporal(event, deps);
  const duplicate = await bridgeVerifiedWebhookToTemporal(event, deps);

  assert.equal(first.outcome, "already_processed", "a cancelled attempt is not reopened");
  assert.equal(duplicate.outcome, "already_processed", "and the duplicate is equally inert");
  assert.equal(signals, 0, "a terminal attempt is never signalled");
  assert.equal(db.state.generation_attempts[0].status, "cancelled");
  assert.equal(db.state.generations[0].status, "cancelled");
});

// ===========================================================================
// H4 — TEMPORAL OWNS THE COORDINATION
// ===========================================================================

test("H4: only Temporal coordinates cancellation - no route, worker, or Trigger task does", () => {
  const workflow = readSource("worker/workflows/generation-workflow.ts");
  assert.ok(/cancelGenerationSignal/.test(workflow), "the workflow owns the cancel signal");
  assert.ok(/settleCancellation|waitForCancellationToSettle/.test(workflow), "and the settlement loop");

  // The command plane must not cancel a workflow.
  const worker = readSource("worker/provider-command-handler.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/markCancelled|cancelGeneration\b/.test(worker), "the SQS worker must not own cancellation");

  // No HTTP route finalizes a cancellation on its own.
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith("route.ts") ? [full] : [];
    });

  for (const route of walk(join(process.cwd(), "src/app/api"))) {
    const code = readFileSync(route, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/markCancelled\s*\(/.test(code),
      `${route} must not transition a generation to cancelled directly`
    );
  }
});

// ===========================================================================
// H5 — PROVIDER CANCEL IS HONEST ABOUT WHAT IT CAN DO
// ===========================================================================

test("H5/D-E-F: the three provider cancel behaviours are distinguishable", async () => {
  const { mockProvider } = await import("@/lib/orchestration/providers/mock-provider");
  const context = { generationId: randomUUID(), clerkUserId: "user_h5", projectId: randomUUID() };

  // D: supported and confirmed.
  await mockProvider.cancel!(
    { providerJobId: "job-1", provider: "mock", status: "processing", metadata: { mode: "async-success" } },
    context
  );

  // F: transient failure — the job's fate is unknown.
  await assert.rejects(
    mockProvider.cancel!(
      { providerJobId: "job-2", provider: "mock", status: "processing", metadata: { mode: "async-pending" } },
      context
    ),
    "a failing cancel must surface, not be swallowed as success"
  );

  // E: adapters that implement no cancel at all — the real state of the
  // world for Cinefield's actual providers, left deliberately untouched.
  const { falProvider } = await import("@/lib/orchestration/providers/fal-provider");
  assert.equal(
    typeof (falProvider as { cancel?: unknown }).cancel,
    "undefined",
    "no capability was invented for a provider that has none"
  );
  assert.equal(
    classifyCancellation(
      attempt({ status: "processing", submission_evidence: "job", provider_job_id: "job-3" }),
      { outcome: "unsupported" }
    ).settlementClass,
    "provider_uncancellable_or_completed"
  );
});

test("H5/H6: no cancel path can produce a second provider submission", () => {
  const workflow = readSource("worker/workflows/generation-workflow.ts");
  const activitiesSource = readSource("worker/activities/generation-activities.ts");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // cancelGeneration must not be able to reach the submit path.
  const cancelActivity = strip(activitiesSource).match(
    /export async function cancelGeneration[\s\S]*?\n}\n/
  );
  assert.ok(cancelActivity, "the cancel activity was located");
  assert.ok(!/submitAttempt|executeGeneration/.test(cancelActivity![0]), "cancel must never submit");

  // And the workflow's cancellation paths return, never loop back to submit.
  const stripped = strip(workflow);
  const afterSubmit = stripped.indexOf("submitGeneration({");
  const settleIndex = stripped.indexOf("async function settleCancellation");
  assert.ok(settleIndex >= 0 && afterSubmit >= 0);
  assert.ok(
    !/settleCancellation[\s\S]{0,400}submitGeneration/.test(stripped),
    "no cancellation path leads back into a submission"
  );
});
