import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  runCreditAudit,
  runEstimatedSpendGuard,
  runGenerationReconcile,
  runProviderCostReconcile,
  runProviderHealthAudit,
  runRestoreVerification,
  runSecurityAnalyze,
  runStorageCleanupPlan,
  type OperationalDeps,
} from "./operational-services";
import { resolveLimit, resolveMode } from "./operational-task-contract";

/**
 * Zero-cost tests for the Trigger.dev operational services (Phase 6R.11).
 *
 * No provider, no paid generation, no credits spent, no storage object
 * deleted, no restore, no Trigger.dev SDK, no Supabase or Redis
 * connection. Every collaborator arrives through the injected
 * `OperationalDeps` seam.
 */

// ---------------------------------------------------------------------------
// In-memory Supabase stand-in
// ---------------------------------------------------------------------------

interface TableData {
  generations?: Record<string, unknown>[];
  generation_attempts?: Record<string, unknown>[];
  credit_reconciliation?: Record<string, unknown>[];
  /** Phase 15-B/3: the canonical routed-identity join. */
  provider_models?: Record<string, unknown>[];
}

class FakeDb {
  data: TableData;
  rpcCalls: { fn: string; args: unknown }[] = [];
  failTable: string | null = null;
  deletes = 0;
  rpcResult: unknown = 0;

  constructor(data: TableData = {}) {
    this.data = data;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  async rpc(fn: string, args: unknown) {
    this.rpcCalls.push({ fn, args });
    return { data: this.rpcResult, error: null };
  }
}

class FakeQuery {
  private db: FakeDb;
  private table: string;
  private rows: Record<string, unknown>[];

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
    this.rows = [...((db.data as Record<string, Record<string, unknown>[]>)[table] ?? [])];
  }

  select() {
    return this;
  }

  eq(col: string, value: unknown) {
    this.rows = this.rows.filter((r) => r[col] === value);
    return this;
  }

  in(col: string, values: unknown[]) {
    this.rows = this.rows.filter((r) => values.includes(r[col]));
    return this;
  }

  /** Phase 15-B/3: the spend window is a half-open [start, end) range. */
  gte(col: string, value: unknown) {
    this.rows = this.rows.filter((r) => String(r[col] ?? "") >= String(value));
    return this;
  }

  lt(col: string, value: unknown) {
    this.rows = this.rows.filter((r) => String(r[col] ?? "") < String(value));
    return this;
  }

  not(col: string, _op: string, _value: unknown) {
    // Only used as .not("output_url", "is", null) — keep rows that have one.
    this.rows = this.rows.filter((r) => r[col] !== null && r[col] !== undefined);
    return this;
  }

  limit(_n: number) {
    return this.resolve();
  }

  private resolve() {
    if (this.db.failTable === this.table) {
      return Promise.resolve({ data: null, error: { message: "boom" } as { message: string } | null });
    }
    return Promise.resolve({ data: this.rows, error: null as { message: string } | null });
  }

  /**
   * The real Supabase builder is thenable, so a query without a terminal
   * `.limit()` still resolves when awaited — reconcile's inner attempt
   * lookup relies on exactly that.
   */
  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected);
  }
}

const noTelemetry = {
  getProviderHealth: async () => null,
  getProviderLatency: async () => ({ outcome: "no_data" as const }),
  getProviderErrorRate: async () => ({ outcome: "no_data" as const }),
};

function depsFor(db: FakeDb, overrides: Partial<OperationalDeps> = {}): OperationalDeps {
  return {
    isAdminConfigured: () => true,
    getAdmin: () => db as never,
    listModels: () =>
      [
        { id: "mock-image", providerId: "mock", isMock: true },
        { id: "fal-flux-schnell", providerId: "fal", isMock: false },
      ] as never,
    getActivePricing: async () => null,
    ...noTelemetry,
    ...overrides,
  } as OperationalDeps;
}

// ---------------------------------------------------------------------------
// CONTRACT
// ---------------------------------------------------------------------------

test("contract: detect is the default mode - repair must be explicitly requested", () => {
  assert.equal(resolveMode(), "detect");
  assert.equal(resolveMode({}), "detect");
  assert.equal(resolveMode({ mode: "detect" }), "detect");
  assert.equal(resolveMode({ mode: "repair" }), "repair");
});

test("contract: limit is bounded - an unbounded sweep is impossible", () => {
  assert.equal(resolveLimit(), 100);
  assert.equal(resolveLimit({ limit: 50 }), 50);
  assert.throws(() => resolveLimit({ limit: 0 }));
  assert.throws(() => resolveLimit({ limit: -1 }));
  assert.throws(() => resolveLimit({ limit: 5000 }));
  assert.throws(() => resolveLimit({ limit: 1.5 }));
});

// ---------------------------------------------------------------------------
// PROVIDER HEALTH
// ---------------------------------------------------------------------------

test("provider health: reports recorded telemetry, never probes a provider", async () => {
  const db = new FakeDb();
  const result = await runProviderHealthAudit(
    {},
    depsFor(db, {
      getProviderHealth: async () => ({
        status: "healthy",
        consecutiveFailures: 0,
        lastCheckedAt: new Date().toISOString(),
      }),
      getProviderLatency: async () => ({
        outcome: "available",
        sampleCount: 3,
        totalLatencyMs: 600,
        averageLatencyMs: 200,
      }),
      getProviderErrorRate: async () => ({
        outcome: "available",
        totalCount: 4,
        successCount: 4,
        failureCount: 0,
        errorRate: 0,
      }),
    })
  );

  assert.equal(result.status, "success");
  assert.equal(result.metrics.providers, 2);
  assert.equal(result.metrics.withHealth, 2);
});

test("provider health: no recorded telemetry reports no_work, never a synthesized 'healthy'", async () => {
  const result = await runProviderHealthAudit({}, depsFor(new FakeDb()));
  assert.equal(result.status, "no_work");
  assert.equal(result.metrics.withoutTelemetry, 2);
});

test("provider health: telemetry store unavailable is reported as unavailable, not as a finding", async () => {
  const result = await runProviderHealthAudit(
    {},
    depsFor(new FakeDb(), {
      getProviderLatency: async () => ({ outcome: "unavailable" }),
      getProviderErrorRate: async () => ({ outcome: "unavailable" }),
    })
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.reasonCode, "telemetry_store_unavailable");
});

// ---------------------------------------------------------------------------
// GENERATION RECONCILE
// ---------------------------------------------------------------------------

test("reconcile: terminal generations are ignored entirely", async () => {
  const db = new FakeDb({
    generations: [
      { id: "gen-done", status: "completed" },
      { id: "gen-failed", status: "failed" },
      { id: "gen-cancelled", status: "cancelled" },
    ],
    generation_attempts: [],
  });

  const result = await runGenerationReconcile({}, depsFor(db));
  assert.equal(result.status, "no_work");
  assert.equal(result.metrics.scanned, 0, "terminal generations must not even be scanned");
});

test("reconcile: a consistent in-flight generation is no_work", async () => {
  const db = new FakeDb({
    generations: [{ id: "gen-1", status: "processing" }],
    generation_attempts: [
      { id: "a-1", generation_id: "gen-1", status: "processing", submission_evidence: "job" },
    ],
  });

  const result = await runGenerationReconcile({}, depsFor(db));
  assert.equal(result.status, "no_work");
  assert.equal(result.metrics.flagged, 0);
});

test("reconcile: a non-terminal generation with no active attempt is flagged", async () => {
  const db = new FakeDb({
    generations: [{ id: "gen-stuck", status: "processing" }],
    generation_attempts: [
      { id: "a-1", generation_id: "gen-stuck", status: "failed", submission_evidence: "none" },
    ],
  });

  const result = await runGenerationReconcile({}, depsFor(db));
  assert.equal(result.status, "success");
  assert.deepEqual(result.flagged, ["gen-stuck"]);
});

test("reconcile: an AMBIGUOUS submission is counted but never flagged for retry", async () => {
  const db = new FakeDb({
    generations: [{ id: "gen-amb", status: "processing" }],
    generation_attempts: [
      { id: "a-1", generation_id: "gen-amb", status: "failed", submission_evidence: "ambiguous" },
    ],
  });

  const result = await runGenerationReconcile({}, depsFor(db));
  assert.equal(result.metrics.ambiguous, 1);
  assert.ok(
    !(result.flagged ?? []).includes("gen-amb"),
    "an attempt that may already have a billed provider job must never be queued for retry"
  );
});

test("reconcile: makes no RPC and no provider call - detect only, no resubmission", async () => {
  const db = new FakeDb({
    generations: [{ id: "gen-stuck", status: "processing" }],
    generation_attempts: [],
  });

  await runGenerationReconcile({}, depsFor(db));
  assert.equal(db.rpcCalls.length, 0, "reconciliation must never invoke a repair/submission RPC");
});

// ---------------------------------------------------------------------------
// CREDIT AUDIT
// ---------------------------------------------------------------------------

test("credit audit: a clean ledger reports no_work", async () => {
  const db = new FakeDb({ credit_reconciliation: [] });
  const result = await runCreditAudit({}, depsFor(db));
  assert.equal(result.status, "no_work");
  assert.equal(result.metrics.mismatched, 0);
});

test("credit audit: a synthetic mismatch is detected and counted, users are not listed", async () => {
  const db = new FakeDb({
    credit_reconciliation: [
      { clerk_user_id: "user_a", ok: false },
      { clerk_user_id: "user_b", ok: false },
    ],
  });

  const result = await runCreditAudit({}, depsFor(db));
  assert.equal(result.status, "success");
  assert.equal(result.metrics.mismatched, 2);
  assert.equal(result.flagged, undefined, "wallet owners must not be enumerated in an ops result");
});

test("credit audit: detect mode performs NO credit mutation whatsoever", async () => {
  const db = new FakeDb({ credit_reconciliation: [{ clerk_user_id: "user_a", ok: false }] });
  await runCreditAudit({ mode: "detect" }, depsFor(db));
  assert.equal(db.rpcCalls.length, 0, "detect mode must never call a credit function");
});

test("credit audit: repair mode calls ONLY the existing idempotent expire function", async () => {
  const db = new FakeDb({ credit_reconciliation: [] });
  db.rpcResult = 3;

  const result = await runCreditAudit({ mode: "repair" }, depsFor(db));

  assert.equal(db.rpcCalls.length, 1);
  assert.equal(db.rpcCalls[0].fn, "expire_stale_reservations", "no other credit RPC may be called");
  assert.equal(result.metrics.expiredReservations, 3);
});

// ---------------------------------------------------------------------------
// PROVIDER COST RECONCILE
// ---------------------------------------------------------------------------

test("cost reconcile: unpriced models are flagged, no price is ever invented", async () => {
  const db = new FakeDb();
  const result = await runProviderCostReconcile({}, depsFor(db, { getActivePricing: async () => null }));

  assert.equal(result.status, "success");
  assert.equal(result.metrics.unpriced, 2);
  assert.equal(result.reasonCode, "models_without_active_pricing");
  // Nothing in the result carries a numeric price.
  assert.equal(result.metrics.pricedRealModels, 0);
});

test("cost reconcile: a mock model's verified $0 is counted separately from real pricing", async () => {
  const db = new FakeDb();
  const result = await runProviderCostReconcile(
    {},
    depsFor(db, {
      getActivePricing: async (modelId: string) =>
        modelId === "mock-image"
          ? ({
              platformModelId: "mock-image",
              provider: "mock",
              providerModelId: "mock-image-v1",
              pricingVersion: 1,
              providerBillingUnit: "per_output",
              providerUnitCost: 0,
              providerCurrency: "USD",
              creditPricePerUnit: 0,
              sourceType: "manual_verification",
              sourceReference: "mock",
              verifiedAt: "2026-01-01T00:00:00.000Z",
              effectiveFrom: "2026-01-01T00:00:00.000Z",
            } as never)
          : null,
    })
  );

  assert.equal(result.metrics.pricedMockModels, 1);
  assert.equal(result.metrics.pricedRealModels, 0, "a $0 mock row must never count as production pricing");
  assert.deepEqual(result.flagged, ["fal-flux-schnell"]);
});

// ---------------------------------------------------------------------------
// STORAGE CLEANUP
// ---------------------------------------------------------------------------

test("storage cleanup: candidates are detected but ZERO objects are deleted", async () => {
  const db = new FakeDb({
    generations: [
      { id: "gen-1", status: "failed", output_url: "path/a.png" },
      { id: "gen-2", status: "cancelled", output_url: "path/b.png" },
      { id: "gen-3", status: "failed", output_url: null },
    ],
  });

  const result = await runStorageCleanupPlan({}, depsFor(db));

  assert.equal(result.status, "success");
  assert.equal(result.metrics.candidates, 2);
  assert.equal(result.metrics.deleted, 0);
  assert.equal(db.deletes, 0, "a cleanup PLAN must never delete");
  assert.equal(result.reasonCode, "cleanup_candidates_detected_dry_run_only");
});

test("storage cleanup: repair mode still deletes nothing - there is no delete path at all", async () => {
  const db = new FakeDb({
    generations: [{ id: "gen-1", status: "failed", output_url: "path/a.png" }],
  });

  const result = await runStorageCleanupPlan({ mode: "repair" }, depsFor(db));

  assert.equal(result.metrics.deleted, 0);
  assert.equal(db.deletes, 0, "even repair mode must not delete: no retention policy exists yet");
});

test("storage cleanup: nothing to clean reports no_work", async () => {
  const result = await runStorageCleanupPlan({}, depsFor(new FakeDb({ generations: [] })));
  assert.equal(result.status, "no_work");
});

// ---------------------------------------------------------------------------
// RESTORE VERIFICATION
// ---------------------------------------------------------------------------

test("restore verification: honestly reports unavailable rather than faking a green check", async () => {
  const result = await runRestoreVerification();
  assert.equal(result.status, "unavailable");
  assert.equal(result.reasonCode, "restore_contract_not_implemented");
  assert.notEqual(result.status, "success", "never report success for a check that did not happen");
});

// ---------------------------------------------------------------------------
// SECURITY ANALYSIS
// ---------------------------------------------------------------------------

test("security analyze: a synthetic ambiguous attempt is detected and reported", async () => {
  const db = new FakeDb({
    generation_attempts: [
      { id: "a-1", submission_evidence: "ambiguous" },
      { id: "a-2", submission_evidence: "job" },
    ],
  });

  const result = await runSecurityAnalyze({}, depsFor(db));

  assert.equal(result.status, "success");
  assert.equal(result.metrics.ambiguousAttempts, 1);
  assert.deepEqual(result.flagged, ["a-1"]);
});

test("security analyze: takes NO action - no block, no suspension, no RPC", async () => {
  const db = new FakeDb({ generation_attempts: [{ id: "a-1", submission_evidence: "ambiguous" }] });
  const result = await runSecurityAnalyze({}, depsFor(db));

  assert.equal(result.metrics.actionsTaken, 0);
  assert.equal(db.rpcCalls.length, 0, "security analysis must never invoke an enforcement action");
});

test("security analyze: clean data reports no_work", async () => {
  const db = new FakeDb({ generation_attempts: [{ id: "a-1", submission_evidence: "job" }] });
  const result = await runSecurityAnalyze({}, depsFor(db));
  assert.equal(result.status, "no_work");
});

// ---------------------------------------------------------------------------
// GENERAL SAFETY
// ---------------------------------------------------------------------------

test("every service reports unavailable (never failed/success) when the admin client is unconfigured", async () => {
  const db = new FakeDb();
  const deps = depsFor(db, { isAdminConfigured: () => false });

  for (const run of [
    runGenerationReconcile,
    runCreditAudit,
    runProviderCostReconcile,
    runStorageCleanupPlan,
    runSecurityAnalyze,
  ]) {
    const result = await run({}, deps);
    assert.equal(result.status, "unavailable", `${run.name} must report unavailable`);
    assert.equal(result.reasonCode, "supabase_admin_not_configured");
  }
  assert.equal(db.rpcCalls.length, 0);
});

test("a query failure yields a sanitized reasonCode - never a driver message or stack trace", async () => {
  const db = new FakeDb({ generations: [] });
  db.failTable = "generations";

  const result = await runGenerationReconcile({}, depsFor(db));

  assert.equal(result.status, "unavailable");
  assert.equal(result.reasonCode, "generation_query_failed");
  assert.ok(!JSON.stringify(result).includes("boom"), "the raw driver message must not leak");
});

test("results carry timestamps and counts only - no user content", async () => {
  const db = new FakeDb({ credit_reconciliation: [] });
  const result = await runCreditAudit({}, depsFor(db));

  assert.ok(!Number.isNaN(Date.parse(result.startedAt)));
  assert.ok(!Number.isNaN(Date.parse(result.completedAt)));
  for (const value of Object.values(result.metrics)) {
    assert.equal(typeof value, "number", "metrics must be counts, never content");
  }
});

// ---------------------------------------------------------------------------
// ESTIMATED SPEND GUARD (Phase 15-B/2, behaviourally proven in 15-B/3)
// ---------------------------------------------------------------------------

/**
 * These exercise the REAL operational entry point end to end.
 *
 * 15-B/2 shipped with only a source-regex assertion that
 * `runEstimatedSpendGuard` existed, which proves the function is declared and
 * nothing about whether it works. The registry join, the pricing pre-fetch,
 * the window resolution and the status mapping were all unexecuted. These
 * tests run the function, through the same injected `OperationalDeps` seam the
 * other seven services use.
 *
 * Still zero-cost: no Supabase, no Redis, no provider, no credits, no routing
 * write, no Trigger SDK.
 */

const SPEND_WINDOW = { windowStart: "2026-08-15T00:00:00.000Z", windowEnd: "2026-08-16T00:00:00.000Z" };

/** One attempt row inside the window, with explicit evidence. */
function attemptRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "fal",
    provider_model: "fal-ai/flux-schnell",
    status: "succeeded",
    submission_evidence: "job",
    created_at: "2026-08-15T12:00:00.000Z",
    ...over,
  };
}

/** A priced model, matching the catalogue entry `depsFor` already declares. */
const FLUX_PRICING = {
  platformModelId: "fal-flux-schnell",
  provider: "fal",
  providerModelId: "fal-ai/flux-schnell",
  pricingVersion: 1,
  providerBillingUnit: "per_request" as const,
  providerUnitCost: 0.01,
  providerCurrency: "USD",
  creditPricePerUnit: 100,
  sourceType: "official_docs" as const,
  sourceReference: "https://example.test/pricing",
  verifiedAt: "2026-08-01T00:00:00.000Z",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
};

function spendDeps(db: FakeDb, overrides: Partial<OperationalDeps> = {}): OperationalDeps {
  return depsFor(db, {
    listModels: () =>
      [
        { id: "fal-flux-schnell", providerId: "fal", providerModelId: "fal-ai/flux-schnell", isMock: false },
      ] as never,
    getActivePricing: async (id: string) => (id === "fal-flux-schnell" ? (FLUX_PRICING as never) : null),
    ...overrides,
  });
}

test("spend guard: an unconfigured admin reports unavailable, never a zero-spend success", async () => {
  const result = await runEstimatedSpendGuard(SPEND_WINDOW, spendDeps(new FakeDb(), { isAdminConfigured: () => false }));
  assert.equal(result.status, "unavailable");
  assert.equal(result.reasonCode, "supabase_admin_not_configured");
});

test("spend guard: an invalid window is refused rather than silently widened", async () => {
  const db = new FakeDb({ generation_attempts: [attemptRow()] });
  for (const bad of [
    { windowStart: "2026-08-16T00:00:00.000Z", windowEnd: "2026-08-15T00:00:00.000Z" },
    { windowStart: "not-a-date", windowEnd: "2026-08-16T00:00:00.000Z" },
    { lookbackHours: 0 },
    { lookbackHours: 24 * 400 },
  ]) {
    const result = await runEstimatedSpendGuard(bad as never, spendDeps(db));
    assert.equal(result.status, "unavailable", JSON.stringify(bad));
    assert.equal(result.reasonCode, "invalid_spend_window");
  }
});

test("spend guard: a readable window with no attempts is no_work, not a breach", async () => {
  const result = await runEstimatedSpendGuard(SPEND_WINDOW, spendDeps(new FakeDb({ generation_attempts: [] })));
  assert.equal(result.status, "no_work");
  assert.equal(result.reasonCode, "empty_window");
  assert.equal(result.metrics.attempts, 0);
  assert.equal(result.metrics.estimatedSpendMicros, 0);
});

test("spend guard: a failed attempt query is unavailable, never zero spend", async () => {
  const db = new FakeDb({ generation_attempts: [attemptRow()] });
  db.failTable = "generation_attempts";
  const result = await runEstimatedSpendGuard(SPEND_WINDOW, spendDeps(db));
  assert.equal(result.status, "unavailable");
  assert.equal(result.reasonCode, "attempt_query_failed");
  // No spend figure is reported at all — absence, not zero.
  assert.equal(result.metrics.estimatedSpendMicros, undefined);
});

test("spend guard: a priced window succeeds and reports real estimated spend", async () => {
  const db = new FakeDb({ generation_attempts: [attemptRow(), attemptRow(), attemptRow()] });
  const result = await runEstimatedSpendGuard(SPEND_WINDOW, spendDeps(db));

  // Three attempts x USD 0.01 per request = 0.03, in micro-units.
  assert.equal(result.status, "success");
  assert.equal(result.metrics.attempts, 3);
  assert.equal(result.metrics.lines, 1);
  assert.equal(result.metrics.unpriceableLines, 0);
  assert.equal(result.metrics.estimatedSpendMicros, 30_000);
  // No budget is configured, so nothing is breached and nothing is alerted.
  assert.equal(result.metrics.alertsRaised, 0);
});

test("spend guard: cancelled attempts are counted by evidence, through the real path", async () => {
  const db = new FakeDb({
    generation_attempts: [
      attemptRow({ status: "cancelled", submission_evidence: "none" }),
      attemptRow({ status: "cancelled", submission_evidence: "ambiguous" }),
      attemptRow({ status: "cancelled", submission_evidence: "job" }),
      attemptRow({ status: "pending", submission_evidence: "none" }),
    ],
  });
  const result = await runEstimatedSpendGuard(SPEND_WINDOW, spendDeps(db));

  // Two cancelled attempts crossed the boundary. The locally-cancelled one and
  // the pending one did not.
  assert.equal(result.metrics.attempts, 2);
  assert.equal(result.metrics.estimatedSpendMicros, 20_000);
});

test("spend guard: attempts outside the window are excluded", async () => {
  const db = new FakeDb({
    generation_attempts: [
      attemptRow({ created_at: "2026-08-14T23:59:59.000Z" }),
      attemptRow({ created_at: "2026-08-15T12:00:00.000Z" }),
      attemptRow({ created_at: "2026-08-16T00:00:00.000Z" }),
    ],
  });
  const result = await runEstimatedSpendGuard(SPEND_WINDOW, spendDeps(db));
  // Half-open [start, end): only the middle row is inside.
  assert.equal(result.metrics.attempts, 1);
});

test("spend guard: an unpriced model reports partial, never success", async () => {
  const db = new FakeDb({ generation_attempts: [attemptRow()] });
  const result = await runEstimatedSpendGuard(SPEND_WINDOW, spendDeps(db, { getActivePricing: async () => null }));

  // A window that could not be fully priced must not read as "within budget".
  assert.equal(result.status, "partial");
  assert.equal(result.metrics.unpriceableLines, 1);
  assert.equal(result.metrics.estimatedSpendMicros, undefined);
});

test("spend guard: a pricing read failure is unavailable, distinct from unpriced", async () => {
  const db = new FakeDb({ generation_attempts: [attemptRow()] });
  const result = await runEstimatedSpendGuard(
    SPEND_WINDOW,
    spendDeps(db, {
      getActivePricing: async () => {
        throw new Error("pricing store down");
      },
    })
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.reasonCode, "pricing_source_unavailable");
});

test("spend guard: routed traffic resolves through the canonical join", async () => {
  // The attempt carries a provider model the static catalogue has never heard
  // of, because a Phase 7 route override chose it.
  const db = new FakeDb({
    generation_attempts: [attemptRow({ provider_model: "fal-ai/routed-variant" })],
    provider_models: [
      {
        provider_id: "fal",
        provider_model_id: "fal-ai/routed-variant",
        model_routes: [{ model_id: "fal-flux-schnell" }],
      },
    ],
  });
  const result = await runEstimatedSpendGuard(SPEND_WINDOW, spendDeps(db));

  assert.equal(result.status, "success", "routed traffic must be priceable");
  assert.equal(result.metrics.unpriceableLines, 0);
  assert.equal(result.metrics.estimatedSpendMicros, 10_000);
});

test("spend guard: routed traffic with no canonical route stays unpriceable", async () => {
  const db = new FakeDb({
    generation_attempts: [attemptRow({ provider_model: "fal-ai/orphan" })],
    provider_models: [],
  });
  const result = await runEstimatedSpendGuard(SPEND_WINDOW, spendDeps(db));

  assert.equal(result.status, "partial");
  assert.equal(result.metrics.unpriceableLines, 1);
  assert.equal(result.metrics.estimatedSpendMicros, undefined, "unresolved identity is not free");
});

test("spend guard: the operational path performs no write of any kind", async () => {
  const db = new FakeDb({ generation_attempts: [attemptRow(), attemptRow()] });
  await runEstimatedSpendGuard(SPEND_WINDOW, spendDeps(db));

  // No RPC, no delete. Cost observation reads; it never changes the numbers
  // it is meant to be reporting, and never touches Phase 10 or Phase 7 state.
  assert.deepEqual(db.rpcCalls, []);
  assert.equal(db.deletes, 0);
});
