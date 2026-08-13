import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  refusalFor,
  retireStaleGeneration,
  STALE_RETIREMENT_REASON,
  type RetirementCandidate,
} from "@/lib/orchestration/stale-generation-retirement";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Administrative retirement must be unable to destroy evidence.
 *
 * The gate is the whole safety story here, so most of these are about what it
 * REFUSES. A cleanup that quietly terminalises a row with a live provider job
 * would hide a bill nobody can reconcile.
 */

const ROOT = process.cwd();

function candidate(overrides: Partial<RetirementCandidate> = {}): RetirementCandidate {
  return {
    generationId: "11111111-1111-4111-8111-111111111111",
    status: "queued",
    hasAttempt: false,
    hasProviderJob: false,
    hasOutput: false,
    hasTemporalWorkflow: false,
    ...overrides,
  };
}

function fakeAdmin(rpc: (name: string, args: Record<string, unknown>) => unknown): SupabaseClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => ({ data: rpc(name, args), error: null }),
  } as unknown as SupabaseClient;
}

test("a clean stale row is retired through the canonical transaction", async () => {
  let calledWith: Record<string, unknown> | undefined;
  const admin = fakeAdmin((name, args) => {
    assert.equal(name, "cancel_generation_tx", "must use the existing primitive");
    calledWith = args;
    return { applied: true, status: "cancelled", event_id: "e" };
  });

  const outcome = await retireStaleGeneration(admin, candidate());

  assert.equal(outcome.retired, true);
  assert.equal(calledWith?.p_reason, STALE_RETIREMENT_REASON);
});

test("the reason code satisfies the SQL validator", () => {
  assert.match(STALE_RETIREMENT_REASON, /^[a-z][a-z0-9_]{1,64}$/);
});

test("a row with a provider job is REFUSED — an external bill may be pending", async () => {
  let rpcCalls = 0;
  const admin = fakeAdmin(() => {
    rpcCalls += 1;
    return { applied: true };
  });

  const outcome = await retireStaleGeneration(admin, candidate({ hasProviderJob: true }));

  assert.equal(outcome.retired, false);
  assert.equal(outcome.refusal, "has_provider_job");
  assert.equal(rpcCalls, 0, "the row must not even be touched");
});

test("a row with an attempt is REFUSED — it reached the provider boundary", () => {
  assert.equal(refusalFor(candidate({ hasAttempt: true })), "has_attempt");
});

test("a row with output is REFUSED — bytes would be orphaned", () => {
  assert.equal(refusalFor(candidate({ hasOutput: true })), "has_output");
});

test("a row with a Temporal workflow is REFUSED — something is running", () => {
  assert.equal(refusalFor(candidate({ hasTemporalWorkflow: true })), "has_temporal_workflow");
});

test("an already-terminal row is refused before the gate even matters", () => {
  for (const status of ["completed", "failed", "cancelled"]) {
    assert.equal(refusalFor(candidate({ status })), "not_stale");
  }
});

test("the gate fails closed when several hazards are present", () => {
  // Order matters less than the fact that SOMETHING refuses.
  assert.ok(
    refusalFor(candidate({ hasAttempt: true, hasProviderJob: true, hasOutput: true })) !== null
  );
});

test("replay is not a second transition", async () => {
  // cancel_generation_tx only moves queued/processing, so the second run
  // reports the existing terminal state and emits no event.
  const admin = fakeAdmin(() => ({ applied: false, status: "cancelled", event_id: null }));
  const outcome = await retireStaleGeneration(admin, candidate());

  assert.equal(outcome.retired, false);
  assert.equal(outcome.alreadyTerminal, "cancelled");
  assert.ok(!outcome.refusal, "a replay is not a refusal");
});

test("retirement cannot start a workflow, submit, settle, or delete", () => {
  const source = readFileSync(
    path.join(ROOT, "src/lib/orchestration/stale-generation-retirement.ts"),
    "utf8"
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.ok(!/startGenerationWorkflow|workflow\.start/.test(code), "no workflow start");
  assert.ok(!/\.submit\(/.test(code), "no provider submission");
  assert.ok(!/settle|reserve|credit/i.test(code), "no financial authority");
  assert.ok(!/\.delete\(/.test(code), "never deletes a generation");
  assert.ok(!/from\(["']generation_attempts["']\)/.test(code), "creates no attempt");
  assert.ok(!/workflow_start_outbox/.test(code), "recreates no start intent");
});

test("the only status it can write is one the schema already allows", () => {
  const schema = readFileSync(
    path.join(ROOT, "supabase/migrations/20260805132704_remote_schema.sql"),
    "utf8"
  );
  const check = schema.match(/generations_status_check[^)]*\)/)?.[0] ?? "";

  assert.ok(/'cancelled'/.test(check), "cancelled is an existing terminal state");
  assert.ok(!/'expired'/.test(check), "no expired state exists — none was invented");

  const source = readFileSync(
    path.join(ROOT, "src/lib/orchestration/stale-generation-retirement.ts"),
    "utf8"
  );
  assert.ok(!/["']expired["']/.test(source));
});

test("the cancel reason is persisted rather than validated and dropped", () => {
  // It was accepted and discarded from 20260813 until this migration, which
  // made every cancellation indistinguishable from every other.
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260819000000_persist_cancel_reason.sql"),
    "utf8"
  );

  assert.ok(/'cancelReason', p_reason/.test(migration), "the reason reaches the row");
  assert.ok(
    /jsonb_strip_nulls\(jsonb_build_object\(\s*'stage'/.test(migration),
    "a NULL reason is stripped, so reasonless cancels are unchanged"
  );
  assert.ok(
    /p_reason !~ '\^\[a-z\]\[a-z0-9_\]\{1,64\}\$'/.test(migration),
    "the strict validator is what makes persisting it safe"
  );
});
