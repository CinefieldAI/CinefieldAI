import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase, seedGeneration } from "./e2e-harness";
import { recordCancelIntent, readCancelIntent } from "@/lib/orchestration/cancel-intent";
import { classifyCancellation, type ProviderCancelOutcome } from "@/lib/orchestration/cancellation";
import * as activities from "../../../worker/activities/generation-activities";

/**
 * PRODUCTION CONVERGENCE (Phase 5) + 6R-B / 6R-H CLOSURE.
 *
 * The three things this phase had to make true, and the tests that hold them:
 *
 *   one canonical generation endpoint, with every other route delegating to
 *   the same server behaviour rather than reimplementing it;
 *
 *   exactly one production lifecycle owner, which meant the legacy Gemini
 *   route had to stop executing — and that in turn meant migrating Gemini
 *   into the orchestration core so the route had something to delegate TO;
 *
 *   a real cancel path: durable intent first, Temporal coordinating, and
 *   ProviderAdapter.cancel invoked from an activity with provider details
 *   read from the durable attempt.
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
// A2 / A3 — THE CANONICAL ENDPOINT
// ===========================================================================

test("A2: POST /api/generate exists and delegates rather than deciding", () => {
  const route = readSource("src/app/api/generate/route.ts");
  const code = strip(route);

  assert.ok(/export async function POST/.test(code), "the canonical endpoint exists");
  assert.ok(/respondToGenerationRequest/.test(code), "it delegates to the shared behaviour");
  assert.ok(/auth\(\)/.test(code), "it authenticates server-side");

  // It must own nothing.
  for (const forbidden of [
    "executeGeneration",
    "startGenerationWorkflow",
    "getCommandBus",
    "generationTask",
    "ProviderAdapter",
    "getGeminiClient",
    "reserveCredits",
  ]) {
    assert.ok(!code.includes(forbidden), `the route must not reference ${forbidden}`);
  }
});

test("A3: every generation route returns the SAME contract, via one function", () => {
  const ROUTES = [
    "src/app/api/generate/route.ts",
    "src/app/api/orchestration/execute/route.ts",
    "src/app/api/generations/[generationId]/execute/route.ts",
  ];

  for (const route of ROUTES) {
    const code = strip(readSource(route));
    assert.ok(
      /respondToGenerationRequest/.test(code),
      `${route} must produce the canonical response through the shared function`
    );
    // No route may build its own success payload.
    assert.ok(
      !/status:\s*"completed"/.test(code),
      `${route} must not construct a terminal response of its own`
    );
  }

  // And the transport no longer leaks into the contract.
  const contract = readSource("src/lib/orchestration/generation-api-contract.ts");
  assert.ok(!/mode:\s*"trigger"/.test(contract), "the retired mode field is gone");
  assert.ok(/owner: "temporal"/.test(contract), "the owner is stated explicitly");
});

test("A3: the response carries no transport detail or credential", () => {
  const contract = strip(readSource("src/lib/orchestration/generation-api-contract.ts"));
  for (const leak of ["queueUrl", "TEMPORAL_ADDRESS", "apiKey", "REDIS_URL", "namespace"]) {
    assert.ok(!contract.includes(leak), `the response contract must not expose ${leak}`);
  }
});

// ===========================================================================
// A4 — THE CLIENT UNDERSTANDS THE TEMPORAL CONTRACT
// ===========================================================================

test("A4: useGeneration branches on status, not on the retired trigger mode", () => {
  const hook = readSource("src/hooks/useGeneration.ts");

  assert.ok(
    !/execJson\.mode === "trigger"/.test(hook),
    "the transport-coupled branch is gone — it was why a Temporal-owned generation " +
      "would have surfaced as a failure"
  );
  assert.ok(
    /execJson\.status === "queued" \|\| execJson\.status === "processing"/.test(hook),
    "queued and processing are both accepted, whoever is carrying the work"
  );
  assert.ok(/fetch\("\/api\/generate"/.test(hook), "it calls the canonical endpoint");

  // Cancelled is a legitimate outcome, and the poller must recognise it as
  // terminal or a cancelled generation polls until it times out.
  assert.ok(/status === "cancelled"/.test(hook), "cancellation is handled, not treated as failure");
  const poller = hook.match(/async function pollGenerationUntilTerminal[\s\S]*?\n}/)![0];
  assert.ok(
    /"cancelled"/.test(poller),
    "the poller must treat cancelled as terminal"
  );
});

// ===========================================================================
// A5 / PART B — ONE PRODUCTION LIFECYCLE OWNER
// ===========================================================================

test("A5: the legacy Gemini route no longer owns a lifecycle", () => {
  const code = strip(readSource("src/app/api/generations/[generationId]/execute/route.ts"));

  // It used to do all of this. None of it may remain.
  for (const owned of [
    "getGeminiClient",
    "interactions.create",
    "generation-outputs",
    "storage",
    'status: "completed"',
    'eq("status", "queued")',
    "buildOutputStoragePath",
  ]) {
    assert.ok(!code.includes(owned), `the wrapper must not ${owned}`);
  }

  assert.ok(/respondToGenerationRequest/.test(code), "it delegates to the canonical behaviour");
  assert.ok(/auth\(\)/.test(code), "and still authenticates");
});

test("B: exactly one production writer of generations.status remains", () => {
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

  // Only the sanctioned state machine. The legacy route is gone from this
  // list — that is the 6R-B closure, expressed as a fact about the code.
  assert.deepEqual(
    writers.sort(),
    ["src/lib/orchestration/status-manager.ts"],
    "Temporal must be the sole lifecycle owner; a new writer here is a regression"
  );
});

test("B: no production route can reach a provider directly", () => {
  for (const route of walk(join(root, "src/app/api"))) {
    // The standalone video job API is a separate subsystem that never touches
    // the generations table; it is out of the generation lifecycle entirely.
    if (route.includes("generate-video")) continue;
    const code = strip(readFileSync(route, "utf8"));
    for (const forbidden of ["getGeminiClient", "getProviderAdapter", "adapter.submit"]) {
      assert.ok(!code.includes(forbidden), `${route} must not reach a provider`);
    }
  }
});

test("B: Gemini is now a registered provider, so the wrapper has something to delegate to", async () => {
  const { findModel } = await import("@/lib/orchestration/model-registry");
  const { isProviderRegistered } = await import("@/lib/orchestration/provider-registry");

  assert.ok(isProviderRegistered("gemini"), "the adapter is registered");

  for (const id of ["nano-banana-pro", "nano-banana-2", "nano-banana-2-lite"]) {
    const model = findModel(id);
    assert.ok(model, `${id} must resolve in the registry, or the wrapper 404s on UNKNOWN_MODEL`);
    assert.equal(model!.providerId, "gemini");
    assert.equal(model!.isMock, false, "a real provider must never be marked mock");
    assert.equal(model!.executionMode, "sync");
  }

  // Capabilities are derived from the existing mapping tables, not restated,
  // so the registry and the adapter cannot drift.
  const registry = readSource("src/lib/orchestration/model-registry.ts");
  assert.ok(/IMAGE_SIZE_SUPPORT\[id\]/.test(registry), "resolutions come from the mapping table");
  assert.ok(/SUPPORTS_THINKING_LEVEL\[id\]/.test(registry), "so does thinking support");
});

test("B: the Gemini adapter performs no lifecycle work of its own", () => {
  const code = strip(readSource("src/lib/orchestration/providers/gemini-provider.ts"));
  for (const forbidden of [
    "markCompleted",
    "markFailed",
    'from("generations")\n    .update',
    "claimGeneration",
    "generation_attempts",
  ]) {
    assert.ok(!code.includes(forbidden), `the adapter must not ${forbidden}`);
  }
  // It may only read an input attachment; the OUTPUT upload belongs to the
  // shared finalization tail.
  assert.ok(
    !/from\("generation-outputs"\)/.test(code),
    "the adapter must not upload — that is the shared finalization tail's job"
  );
});

// ===========================================================================
// PART C — CANCELLATION
// ===========================================================================

test("C1: the cancel endpoint exists, records intent BEFORE signalling, and owns nothing", () => {
  const path = "src/app/api/generations/[generationId]/cancel/route.ts";
  assert.ok(existsSync(join(root, path)), "the cancel endpoint exists");
  const code = strip(readSource(path));

  assert.ok(/auth\(\)/.test(code), "it authenticates");
  assert.ok(/recordCancelIntent/.test(code), "it records durable intent");
  assert.ok(/requestGenerationCancellation/.test(code), "and signals Temporal");
  assert.ok(
    code.indexOf("recordCancelIntent") < code.indexOf("requestGenerationCancellation"),
    "durable first, transport second — a failed signal must not lose the intent"
  );

  // The route owns nothing.
  for (const forbidden of ["markCancelled", "adapter.cancel", "getProviderAdapter", "refund"]) {
    assert.ok(!code.includes(forbidden), `the cancel route must not ${forbidden}`);
  }
});

test("C1: cancel intent is durable, idempotent, and keeps the FIRST request time", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId, clerkUserId } = seedGeneration(db, { status: "processing" });

  const first = await recordCancelIntent(db as never, generationId, clerkUserId);
  assert.deepEqual(first, { outcome: "cancelled", generationId, alreadyRequested: false });

  const stored = readCancelIntent(db.state.generations[0].metadata as Record<string, unknown>);
  assert.ok(stored, "the intent is on the row");
  const firstRequestedAt = stored!.requestedAt;

  const second = await recordCancelIntent(db as never, generationId, clerkUserId);
  assert.equal(second.outcome, "cancelled");
  assert.equal(
    (second as { alreadyRequested?: boolean }).alreadyRequested,
    true,
    "a duplicate cancel is recognised, not re-recorded"
  );
  assert.equal(
    readCancelIntent(db.state.generations[0].metadata as Record<string, unknown>)!.requestedAt,
    firstRequestedAt,
    "the audit trail keeps the first moment the user asked"
  );

  // The intent alone must NOT transition the generation — Temporal decides
  // when that is safe.
  assert.equal(db.state.generations[0].status, "processing");
});

test("C1: cancelling a terminal generation is a no-op that reports the winner", async () => {
  for (const terminal of ["completed", "failed", "cancelled"]) {
    const db = new FakeSupabaseClient();
    await installFakeSupabase(db);
    const { generationId, clerkUserId } = seedGeneration(db, { status: terminal });

    const outcome = await recordCancelIntent(db as never, generationId, clerkUserId);
    assert.deepEqual(outcome, { outcome: "already_terminal", generationId, status: terminal });
    assert.equal(
      readCancelIntent(db.state.generations[0].metadata as Record<string, unknown>),
      null,
      "no intent is recorded on a generation that already finished"
    );
  }
});

test("C1: another user cannot cancel a generation, and gets no existence signal", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { clerk_user_id: "user_owner", status: "processing" });

  await assert.rejects(
    recordCancelIntent(db as never, generationId, "user_attacker"),
    /GENERATION_NOT_FOUND/,
    "a foreign generation reports not-found, never forbidden"
  );
  assert.equal(
    readCancelIntent(db.state.generations[0].metadata as Record<string, unknown>),
    null,
    "and nothing was written"
  );
});

// ===========================================================================
// C3 / C4 / C5 — THE PROVIDER CANCEL ACTIVITY
// ===========================================================================

async function attemptScenario(overrides: Record<string, unknown>) {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, {
    status: "processing",
    metadata: {
      mock_mode: "async-success",
      orchestration: {
        providerJob: {
          id: "mock-cancel-job",
          provider: "mock",
          state: "processing",
          checkCount: 0,
          lastCheckedAt: new Date().toISOString(),
          resume: { mock: true, mode: "async-success" },
        },
      },
    },
  });

  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: "mock-cancel-job",
    submission_evidence: "job",
    status: "processing",
    updated_at: new Date().toISOString(),
    ...overrides,
  });

  return { db, generationId, attemptId };
}

test("C3: the activity reads provider and job id from the DURABLE attempt", () => {
  const code = strip(readSource("worker/activities/generation-activities.ts"));
  const fn = code.match(/export async function cancelProviderJob[\s\S]*?\n}\n/)![0];

  assert.ok(/readAttempt\(admin, params\.attemptId\)/.test(fn), "it loads the attempt");
  assert.ok(/attempt\.provider_job_id/.test(fn), "and uses the job id the attempt owns");
  assert.ok(/getProviderAdapter\(attempt\.provider\)/.test(fn), "and the attempt's provider");

  // Nothing about the provider may come from a caller.
  assert.ok(!/params\.provider/.test(fn), "the caller cannot name a provider");
  assert.ok(!/findModel/.test(fn), "and it does not re-derive one — that would be routing");
  // It cannot submit.
  assert.ok(!/submitAttempt|executeGeneration/.test(fn), "cancel must never reach a submission");
});

test("C4/D: a provider that confirms the stop is classified as confirmed", async () => {
  const { attemptId } = await attemptScenario({});
  const outcome = await activities.cancelProviderJob({ attemptId });
  assert.deepEqual(outcome, { outcome: "cancelled" });
});

test("C4/F: a failing provider cancel means UNKNOWN, and routes to reconciliation", async () => {
  // async-pending drives the mock's cancel to throw.
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, {
    status: "processing",
    metadata: {
      orchestration: {
        providerJob: {
          id: "mock-cancel-fail",
          provider: "mock",
          state: "processing",
          checkCount: 0,
          lastCheckedAt: new Date().toISOString(),
          resume: { mock: true, mode: "async-pending" },
        },
      },
    },
  });
  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: "mock-cancel-fail",
    submission_evidence: "job",
    status: "processing",
    updated_at: new Date().toISOString(),
  });

  const outcome = await activities.cancelProviderJob({ attemptId });
  assert.equal(outcome.outcome, "failed", "a failed cancel is reported as failed, never as cancelled");

  const evidence = classifyCancellation(
    db.state.generation_attempts[0] as never,
    outcome as ProviderCancelOutcome
  );
  assert.equal(evidence.settlementClass, "unknown_reconcile");
  assert.equal(evidence.requiresReconciliation, true, "guessing here could refund a billed job");
});

test("C5: an adapter with no cancel is reported unsupported, and assumed billable", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { status: "processing" });
  const attemptId = randomUUID();
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: generationId,
    attempt_no: 1,
    // fal implements no cancel() — the real state of the world.
    provider: "fal",
    provider_model: "fal-flux-schnell",
    provider_job_id: "fal-job-1",
    submission_evidence: "job",
    status: "processing",
    updated_at: new Date().toISOString(),
  });

  const outcome = await activities.cancelProviderJob({ attemptId });
  assert.deepEqual(outcome, { outcome: "unsupported" });
  assert.equal(
    classifyCancellation(db.state.generation_attempts[0] as never, outcome).settlementClass,
    "provider_uncancellable_or_completed",
    "unsupported never means free"
  );
  assert.equal(db.state.generations[0].status, "processing", "and nothing was transitioned");
});

test("C4: nothing to cancel and already-terminal are distinguished from a real stop", async () => {
  // Never submitted.
  const noJob = await attemptScenario({ provider_job_id: null, submission_evidence: "none" });
  assert.deepEqual(await activities.cancelProviderJob({ attemptId: noJob.attemptId }), {
    outcome: "no_job",
  });

  // Already finished at the provider.
  const done = await attemptScenario({ status: "succeeded" });
  assert.deepEqual(await activities.cancelProviderJob({ attemptId: done.attemptId }), {
    outcome: "already_terminal",
  });

  // A missing attempt is not an error either.
  assert.deepEqual(await activities.cancelProviderJob({ attemptId: randomUUID() }), {
    outcome: "no_job",
  });
});

test("C2: the workflow asks the provider only AFTER Cinefield's state is settled", () => {
  const workflow = strip(readSource("worker/workflows/generation-workflow.ts"));
  const settle = workflow.match(/async function settleCancellation[\s\S]*?\n}\n/)![0];

  const settledCheck = settle.indexOf("if (!outcome.settled) return null;");
  const providerCancel = settle.indexOf("cancelProviderJob(");
  assert.ok(settledCheck >= 0 && providerCancel >= 0, "both steps are present");
  assert.ok(
    settledCheck < providerCancel,
    "asking a provider to cancel a submission still in flight races the evidence write"
  );

  // The workflow must not branch on the provider's answer — it is evidence,
  // not a decision.
  assert.ok(
    !/cancelProviderJob\([\s\S]{0,120}?\)\s*;[\s\S]{0,80}?if\s*\(\s*\w+\.outcome/.test(settle),
    "the provider's answer must not steer the Cinefield transition"
  );
});

test("C6: cancel while claimed or submitting still defers, and destroys no evidence", async () => {
  for (const status of ["claimed", "submitting"]) {
    const { db, generationId, attemptId } = await attemptScenario({
      status,
      provider_job_id: null,
      submission_evidence: "none",
    });

    const outcome = await activities.cancelGeneration({ generationId, attemptId });
    assert.equal(outcome.settled, false, `${status} must defer`);
    assert.equal(db.state.generations[0].status, "processing", "nothing was written");
    assert.equal(db.state.generation_attempts[0].status, status, "the attempt is untouched");
    assert.equal(db.outboxEvents.length, 0, "and a deferred cancel announces nothing");
  }
});

// ===========================================================================
// PHASE 5 FINAL — SERVER-SIDE GENERATION CREATION
// ===========================================================================

test("A2-final: /api/generate accepts a FULL request and creates the row server-side", () => {
  const route = strip(readSource("src/app/api/generate/route.ts"));

  assert.ok(/createGeneration\(/.test(route), "the canonical shape creates the generation");
  assert.ok(/isExecuteOnlyBody/.test(route), "the { generationId } shape stays supported for wrappers");

  // Creation commits BEFORE Temporal starts, so a Temporal failure leaves a
  // durable generation instead of losing the request.
  assert.ok(
    route.indexOf("createGeneration(") < route.indexOf("respondToGenerationRequest(generationId"),
    "the row must be durable before the workflow is started"
  );

  // The route still owns nothing.
  for (const forbidden of ["getGeminiClient", "getProviderAdapter", "startGenerationWorkflow"]) {
    assert.ok(!route.includes(forbidden), `the route must not reference ${forbidden}`);
  }
});

test("A5-final: the canonical request type has no field for an internal identity", () => {
  const service = readSource("src/lib/orchestration/generation-create-service.ts");
  const requestType = service.match(/export interface GenerationCreateRequest \{[\s\S]*?\n\}/)![0];

  // The strongest form of "a client cannot choose these": there is nowhere
  // to put them.
  for (const forbidden of [
    "provider",
    "providerJobId",
    "attemptId",
    "workflowId",
    "generationType",
    "workspaceId",
    "credits",
    "queue",
  ]) {
    assert.ok(
      !new RegExp(`^\s*${forbidden}[?:]`, "m").test(requestType),
      `GenerationCreateRequest must not accept ${forbidden}`
    );
  }

  // And the fields that ARE derived are taken from the registry.
  assert.ok(/p_generation_type: model\.generationType/.test(service));
  assert.ok(/p_provider: model\.providerId/.test(service));
});

test("A7-final: the server derives routing and refuses an unknown model", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const projectId = randomUUID();
  db.state.projects = [{ id: projectId, clerk_user_id: "user_create", title: "p" }];

  const { createGeneration } = await import("@/lib/orchestration/generation-create-service");

  const created = await createGeneration(db as never, "user_create", {
    model: "mock-image",
    prompt: "a cat",
    projectId,
  });
  assert.equal(created.outcome, "created");

  const row = db.state.generations[0];
  assert.equal(row.provider, "mock", "provider comes from the registry, not the client");
  assert.equal(row.generation_type, "image", "so does the generation type");
  assert.equal(row.clerk_user_id, "user_create", "and the owner from the session");
  assert.equal(row.status, "queued");

  await assert.rejects(
    createGeneration(db as never, "user_create", {
      model: "not-a-real-model",
      prompt: "x",
      projectId,
    }),
    /UNKNOWN_MODEL|not available/i,
    "the registry is authoritative for what may be generated"
  );
});

test("A8-final: a replayed request returns the SAME generation, a changed payload is refused", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const projectId = randomUUID();
  db.state.projects = [{ id: projectId, clerk_user_id: "user_create", title: "p" }];

  const { createGeneration } = await import("@/lib/orchestration/generation-create-service");
  const base = { model: "mock-image", prompt: "a cat", projectId, idempotencyKey: "client-key-123" };

  const first = await createGeneration(db as never, "user_create", base);
  assert.equal(first.outcome, "created");

  // Same key, same payload — even with the object keys written in a
  // different order, which must not change the canonical hash.
  const replay = await createGeneration(db as never, "user_create", {
    idempotencyKey: "client-key-123",
    projectId,
    prompt: "a cat",
    model: "mock-image",
  });
  assert.equal(replay.outcome, "replayed");
  assert.equal(
    replay.outcome === "replayed" && replay.generationId,
    first.outcome === "created" ? first.generationId : "",
    "one logical request, one generation id"
  );
  assert.equal(db.state.generations.length, 1, "and no second row");

  // Same key, DIFFERENT payload — refused rather than silently served.
  const conflict = await createGeneration(db as never, "user_create", {
    ...base,
    prompt: "a dog",
  });
  assert.deepEqual(conflict, { outcome: "idempotency_conflict" });
  assert.equal(db.state.generations.length, 1);
});

test("A6-final: a project belonging to someone else is not usable, and reports not-found", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const victimProject = randomUUID();
  db.state.projects = [{ id: victimProject, clerk_user_id: "user_victim", title: "victim" }];

  const { createGeneration } = await import("@/lib/orchestration/generation-create-service");

  await assert.rejects(
    createGeneration(db as never, "user_attacker", {
      model: "mock-image",
      prompt: "x",
      projectId: victimProject,
    }),
    /GENERATION_NOT_FOUND|Project not found/i,
    "ownership is re-checked server-side; the error does not confirm the project exists"
  );
  assert.equal(db.state.generations.length, 0, "and nothing was created");
});

test("A12-final: the browser no longer inserts a canonical generation row", () => {
  const hook = readSource("src/hooks/useGeneration.ts");

  // The canonical path posts the full request.
  assert.ok(/fetch\("\/api\/generate"/.test(hook), "it calls the canonical endpoint");
  assert.ok(/idempotencyKey/.test(hook), "with a per-submission idempotency key");
  assert.ok(
    /model: effectiveModel,[\s\S]{0,200}?projectId: activeProject\.id/.test(hook),
    "sending the request, not a pre-made row id"
  );

  // The remaining insert is reachable ONLY for non-orchestration placeholder
  // models, which have no provider and never reach the server generation
  // boundary. Asserted structurally so it cannot quietly grow back onto the
  // canonical path.
  const inserts = [...hook.matchAll(/\.from\("generations"\)\s*\n\s*\.insert\(/g)];
  assert.equal(inserts.length, 1, "exactly one insert remains");
  const guard = hook.slice(0, inserts[0].index!);
  assert.ok(
    /if \(!isOrchestrationModel\(effectiveModel\)\) \{[\s\S]*$/.test(guard),
    "and it sits inside the non-orchestration placeholder branch"
  );
});
