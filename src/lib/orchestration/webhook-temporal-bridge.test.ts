import { strict as assert } from "node:assert";
import { test } from "node:test";
import { markWebhookEventVerified, type NormalizedWebhookEvent } from "./webhook-continuation";
import type { ProviderEventSignalOutcome } from "@/lib/temporal/provider-event-signal";
import { bridgeVerifiedWebhookToTemporal, type WebhookBridgeDeps } from "./webhook-temporal-bridge";

/**
 * Zero-cost tests for the verified-webhook → Temporal bridge (Phase 6R.10).
 *
 * No provider, no paid generation, no credits, no Temporal connection, no
 * Supabase connection. Both collaborators are supplied through the
 * bridge's own `deps` seam: an in-memory attempt store standing in for
 * Supabase, and an injected signal function standing in for Temporal.
 */

// ---------------------------------------------------------------------------
// In-memory attempt store standing in for Supabase.
// ---------------------------------------------------------------------------

interface FakeAttempt {
  id: string;
  generation_id: string;
  provider: string;
  provider_job_id: string | null;
  status: string;
}

class FakeDb {
  attempts: FakeAttempt[] = [];
  updates: { attemptId: string; status: string }[] = [];
  failCorrelation = false;
  failUpdate = false;

  from(_table: string) {
    return new FakeQuery(this);
  }
}

/**
 * Minimal chainable stand-in for the subset of the Supabase query builder
 * that attempt-repository.ts uses on these two code paths.
 */
class FakeQuery {
  private db: FakeDb;
  private mode: "select" | "update" = "select";
  private filters: { col: string; value: unknown }[] = [];
  private inFilter: { col: string; values: string[] } | null = null;
  private updatePayload: Record<string, unknown> = {};

  constructor(db: FakeDb) {
    this.db = db;
  }

  select() {
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.mode = "update";
    this.updatePayload = payload;
    return this;
  }

  eq(col: string, value: unknown) {
    this.filters.push({ col, value });
    return this;
  }

  in(col: string, values: string[]) {
    this.inFilter = { col, values };
    return this;
  }

  private matches(): FakeAttempt[] {
    return this.db.attempts.filter((a) => {
      for (const f of this.filters) {
        if ((a as unknown as Record<string, unknown>)[f.col] !== f.value) return false;
      }
      if (this.inFilter) {
        const current = (a as unknown as Record<string, unknown>)[this.inFilter.col];
        if (!this.inFilter.values.includes(String(current))) return false;
      }
      return true;
    });
  }

  async maybeSingle() {
    if (this.mode === "select") {
      if (this.db.failCorrelation) return { data: null, error: { message: "boom" } };
      return { data: this.matches()[0] ?? null, error: null };
    }

    if (this.db.failUpdate) return { data: null, error: { message: "boom" } };
    const found = this.matches()[0] ?? null;
    if (!found) return { data: null, error: null };

    Object.assign(found, this.updatePayload);
    this.db.updates.push({ attemptId: found.id, status: String(this.updatePayload.status) });
    return { data: { id: found.id }, error: null };
  }
}

const signalOk = async (): Promise<ProviderEventSignalOutcome> => ({ outcome: "signalled" });

/**
 * Builds the injectable dependency set. ESM live bindings are read-only, so
 * the bridge exposes an explicit `deps` seam rather than being module-patched.
 */
function depsFor(db: FakeDb, signal: WebhookBridgeDeps["signal"] = signalOk): WebhookBridgeDeps {
  return { isAdminConfigured: () => true, getAdmin: () => db as never, signal };
}

function verifiedEvent(overrides: Partial<NormalizedWebhookEvent> = {}) {
  const base: NormalizedWebhookEvent = {
    provider: "fal",
    providerJobId: "job-123",
    reportedState: "completed",
    transport: "webhook",
    ...overrides,
  };
  return markWebhookEventVerified(base);
}

function attempt(overrides: Partial<FakeAttempt> = {}): FakeAttempt {
  return {
    id: "attempt-1",
    generation_id: "gen-1",
    provider: "fal",
    provider_job_id: "job-123",
    status: "submitted",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CORRELATION
// ---------------------------------------------------------------------------

test("known providerJobId resolves the correct attempt and signals its workflow", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt());
  const signalled: { generationId: string; payload: unknown }[] = [];

  const deps = depsFor(db, async (generationId, payload) => {
    signalled.push({ generationId, payload });
    return { outcome: "signalled" };
  });
  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent(), deps);

  assert.equal(result.outcome, "accepted");
  if (result.outcome === "accepted") {
    assert.equal(result.generationId, "gen-1");
    assert.equal(result.attemptId, "attempt-1");
  }
  assert.equal(signalled.length, 1);
  assert.equal(signalled[0].generationId, "gen-1", "workflow must come from the DB row, not the event");
});

test("unknown providerJobId mutates nothing and returns unknown_job", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ provider_job_id: "some-other-job" }));
  let signalCalls = 0;

  const deps = depsFor(db, async () => {
    signalCalls += 1;
    return { outcome: "signalled" };
  });
  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent(), deps);

  assert.deepEqual(result, { outcome: "unknown_job" });
  assert.equal(db.updates.length, 0, "no attempt may be mutated for an unknown job");
  assert.equal(signalCalls, 0, "no workflow may be signalled for an unknown job");
});

test("provider mismatch is not correlated - a fal job id cannot match a cloudflare attempt", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ provider: "cloudflare-workers-ai" }));

  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent({ provider: "fal" }), depsFor(db));

  assert.deepEqual(result, { outcome: "unknown_job" });
  assert.equal(db.updates.length, 0);
});

test("a correlation hint contradicting durable state is rejected, never resolved in the event's favour", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ generation_id: "gen-real" }));

  const result = await bridgeVerifiedWebhookToTemporal(
    verifiedEvent({ correlationGenerationId: "gen-attacker-supplied" }),
    depsFor(db)
  );

  assert.equal(result.outcome, "rejected");
  if (result.outcome === "rejected") assert.equal(result.reason, "correlation_mismatch");
  assert.equal(db.updates.length, 0, "a mismatched hint must mutate nothing");
});

test("missing job identity is rejected before any DB access", async () => {
  const db = new FakeDb();

  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent({ providerJobId: "" }), depsFor(db));

  assert.equal(result.outcome, "rejected");
  assert.equal(db.updates.length, 0);
});

// ---------------------------------------------------------------------------
// ATTEMPT STATE
// ---------------------------------------------------------------------------

test("submitted -> processing observation is recorded durably, and before the signal", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ status: "submitted" }));
  let dbStatusAtSignalTime: string | null = null;

  const deps = depsFor(db, async () => {
    dbStatusAtSignalTime = db.attempts[0].status;
    return { outcome: "signalled" };
  });
  await bridgeVerifiedWebhookToTemporal(verifiedEvent({ reportedState: "processing" }), deps);

  assert.equal(db.updates.length, 1);
  assert.equal(db.updates[0].status, "processing");
  assert.equal(db.attempts[0].status, "processing", "durable state must reflect the observation");
  assert.equal(dbStatusAtSignalTime, "processing", "the write must land BEFORE the signal is sent");
});

test("a completed attempt is NOT regressed - reports already_processed", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ status: "succeeded" }));
  let signalCalls = 0;

  const deps = depsFor(db, async () => {
    signalCalls += 1;
    return { outcome: "signalled" };
  });
  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent({ reportedState: "processing" }), deps);

  assert.equal(result.outcome, "already_processed");
  assert.equal(db.updates.length, 0, "a terminal attempt must never be written back to processing");
  assert.equal(db.attempts[0].status, "succeeded");
  assert.equal(signalCalls, 0);
});

test("a failed attempt is not reopened by a late processing webhook", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ status: "failed" }));

  const result = await bridgeVerifiedWebhookToTemporal(
    verifiedEvent({ reportedState: "processing" }),
    depsFor(db)
  );

  assert.equal(result.outcome, "already_processed");
  assert.equal(db.attempts[0].status, "failed");
  assert.equal(db.updates.length, 0);
});

test("a cancelled attempt is not revived", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ status: "cancelled" }));

  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent(), depsFor(db));

  assert.equal(result.outcome, "already_processed");
  assert.equal(db.attempts[0].status, "cancelled");
});

test("duplicate webhook does not create a second attempt", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt());

  await bridgeVerifiedWebhookToTemporal(verifiedEvent(), depsFor(db));
  await bridgeVerifiedWebhookToTemporal(verifiedEvent(), depsFor(db));
  await bridgeVerifiedWebhookToTemporal(verifiedEvent(), depsFor(db));

  assert.equal(db.attempts.length, 1, "the attempt count must never grow from webhooks");
});

test("unknown provider state fails safely - rejected, nothing mutated, nothing signalled", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt());
  let signalCalls = 0;

  const deps = depsFor(db, async () => {
    signalCalls += 1;
    return { outcome: "signalled" };
  });
  const result = await bridgeVerifiedWebhookToTemporal(
    verifiedEvent({ reportedState: "bizarre-provider-state" as never }),
    deps
  );

  assert.equal(result.outcome, "rejected");
  if (result.outcome === "rejected") assert.equal(result.reason, "unknown_provider_state");
  assert.equal(db.updates.length, 0);
  assert.equal(signalCalls, 0);
});

// ---------------------------------------------------------------------------
// REPLAY / OUT-OF-ORDER
// ---------------------------------------------------------------------------

test("same event twice is safe - state never regresses and no attempt is created", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ status: "submitted" }));

  const first = await bridgeVerifiedWebhookToTemporal(
    verifiedEvent({ reportedState: "processing" }),
    depsFor(db)
  );
  const second = await bridgeVerifiedWebhookToTemporal(
    verifiedEvent({ reportedState: "processing" }),
    depsFor(db)
  );

  assert.equal(first.outcome, "accepted");
  // Still inside the observable window (processing → processing), so it is
  // accepted again and re-signals. Safe: the signal only wakes the poll
  // loop, and the workflow re-reads authoritative state either way.
  assert.equal(second.outcome, "accepted");
  assert.equal(db.attempts[0].status, "processing", "state never regressed");
  assert.equal(db.attempts.length, 1);
});

test("out-of-order: completed then a late processing event preserves the terminal state", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ status: "submitted" }));

  // The completion signal reaches the workflow, which (in production)
  // finalizes and drives the attempt terminal. Simulate that outcome.
  await bridgeVerifiedWebhookToTemporal(verifiedEvent({ reportedState: "completed" }), depsFor(db));
  db.attempts[0].status = "succeeded";

  // A stale 'processing' event now arrives out of order.
  const late = await bridgeVerifiedWebhookToTemporal(
    verifiedEvent({ reportedState: "processing" }),
    depsFor(db)
  );

  assert.equal(late.outcome, "already_processed");
  assert.equal(db.attempts[0].status, "succeeded", "terminal state must be preserved");
});

// ---------------------------------------------------------------------------
// TEMPORAL FAILURE SAFETY
// ---------------------------------------------------------------------------

test("Temporal unavailable: the observation stays durable and the result is explicitly retryable", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ status: "submitted" }));

  const deps = depsFor(db, async () => ({ outcome: "unavailable", errorCode: "ServiceUnavailable" }));
  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent(), deps);

  assert.equal(result.outcome, "signal_unavailable");
  if (result.outcome === "signal_unavailable") {
    assert.equal(result.errorCode, "ServiceUnavailable");
    assert.equal(result.generationId, "gen-1");
  }
  // THE critical invariant: the observed provider state is NOT rolled back
  // or falsified just because Temporal could not be reached.
  assert.equal(db.attempts[0].status, "processing", "durable observation must survive a signal failure");
  assert.equal(db.updates.length, 1);
});

test("signal failure is never reported as success", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ status: "submitted" }));

  const deps = depsFor(db, async () => ({ outcome: "unavailable", errorCode: "DeadlineExceeded" }));
  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent(), deps);

  assert.notEqual(result.outcome, "accepted");
});

test("missing workflow is a safe terminal outcome, never a second workflow", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ status: "submitted" }));

  const deps = depsFor(db, async () => ({ outcome: "workflow_not_found" }));
  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent(), deps);

  assert.equal(result.outcome, "already_processed", "no live workflow == nothing further to do");
});

test("attempt update failure does not signal Temporal", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt({ status: "submitted" }));
  db.failUpdate = true;
  let signalCalls = 0;

  const deps = depsFor(db, async () => {
    signalCalls += 1;
    return { outcome: "signalled" };
  });
  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent(), deps);

  assert.equal(result.outcome, "unavailable");
  assert.equal(signalCalls, 0, "the workflow must not be told about state that was never persisted");
});

test("correlation failure is reported as unavailable, nothing signalled", async () => {
  const db = new FakeDb();
  db.failCorrelation = true;
  let signalCalls = 0;

  const deps = depsFor(db, async () => {
    signalCalls += 1;
    return { outcome: "signalled" };
  });
  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent(), deps);

  assert.equal(result.outcome, "unavailable");
  assert.equal(signalCalls, 0);
});

test("admin client unconfigured: nothing is correlated, mutated, or signalled", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt());
  let signalCalls = 0;

  const result = await bridgeVerifiedWebhookToTemporal(verifiedEvent(), {
    isAdminConfigured: () => false,
    getAdmin: () => db as never,
    signal: async () => {
      signalCalls += 1;
      return { outcome: "signalled" };
    },
  });

  assert.equal(result.outcome, "unavailable");
  assert.equal(db.updates.length, 0);
  assert.equal(signalCalls, 0);
});

// ---------------------------------------------------------------------------
// SECURITY
// ---------------------------------------------------------------------------

test("the signal payload carries only normalized ids and status - no headers, secrets, or raw body", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt());
  let captured: Record<string, unknown> | null = null;

  const deps = depsFor(db, async (_generationId, payload) => {
    captured = payload as unknown as Record<string, unknown>;
    return { outcome: "signalled" };
  });
  await bridgeVerifiedWebhookToTemporal(verifiedEvent({ reportedState: "completed" }), deps);

  assert.notEqual(captured, null);
  assert.deepEqual(
    Object.keys(captured!).sort(),
    ["attemptId", "providerJobId", "status"],
    "no additional field may be smuggled into the signal"
  );
  assert.equal(captured!.status, "completed");
});

test("the event cannot nominate a user identity - none is read from it or forwarded", async () => {
  const db = new FakeDb();
  db.attempts.push(attempt());
  let captured: Record<string, unknown> | null = null;

  const deps = depsFor(db, async (_generationId, payload) => {
    captured = payload as unknown as Record<string, unknown>;
    return { outcome: "signalled" };
  });
  // A hostile callback attaching a user id must have no effect: the field
  // is not part of NormalizedWebhookEvent and is never read.
  const hostile = { ...verifiedEvent(), clerkUserId: "user_attacker" } as never;
  await bridgeVerifiedWebhookToTemporal(hostile, deps);

  assert.ok(!("clerkUserId" in captured!), "no user identity may reach the signal");
  assert.ok(!("userId" in captured!));
});
