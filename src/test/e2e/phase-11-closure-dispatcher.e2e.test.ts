import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { dispatchRealtimeOnce, readRealtimeDebt } from "@/lib/realtime/outbox-dispatcher";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 11 closure — the dispatcher that connects the outbox to realtime.
 *
 * The defect this batch closes (D-11-1): every link of the chain was built and
 * proven, and NOTHING joined the first two. Ninety-two events sat pending for
 * a day with `ever_published = 0`. These tests assert both that the arrow now
 * exists and that it cannot quietly disappear again.
 */

const ROOT = process.cwd();
const GEN = "11111111-1111-4111-8111-111111111111";
const OWNER = "user_2abcdefghijklmnop";

const DISPATCHER = readFileSync(path.join(ROOT, "src/lib/realtime/outbox-dispatcher.ts"), "utf8");
const WORKER = readFileSync(path.join(ROOT, "worker/realtime-dispatcher-worker.ts"), "utf8");
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase/migrations/20260825000000_outbox_realtime_delivery_lane.sql"),
  "utf8"
);
const RETIREMENT = readFileSync(
  path.join(ROOT, "supabase/migrations/20260825000100_retire_pre_realtime_outbox_debt.sql"),
  "utf8"
);

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(full)) out.push(full);
  }
  return out;
}

const SOURCE_FILES = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "worker"))];

interface FakeRow {
  event_id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  tenant_id: string | null;
  trace_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  realtime_attempts: number;
  realtime_claim_token: string;
}

function claimed(over: Partial<FakeRow> = {}): FakeRow {
  return {
    event_id: "33333333-3333-4333-8333-333333333333",
    event_type: "generation.completed",
    event_version: 1,
    aggregate_type: "generation",
    aggregate_id: GEN,
    tenant_id: OWNER,
    trace_id: null,
    payload: { generationId: GEN, provider: "fal", durationMs: 12 },
    occurred_at: "2026-08-25T10:00:00.000Z",
    realtime_attempts: 1,
    realtime_claim_token: "44444444-4444-4444-8444-444444444444",
    ...over,
  };
}

/** Records RPCs without a database. */
function fakeAdmin(rows: FakeRow[], opts: { claimFails?: boolean; loseLease?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const admin = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === "claim_realtime_outbox_events") {
        return opts.claimFails ? { data: null, error: { message: "boom" } } : { data: rows, error: null };
      }
      if (fn === "resolve_realtime_outbox_event" || fn === "release_realtime_outbox_event") {
        return { data: !opts.loseLease, error: null };
      }
      if (fn === "realtime_outbox_debt") {
        return { data: [{ pending: 3, dispatching: 1, oldest_pending_seconds: 42, max_attempts: 2,
          published: 10, not_user_facing: 2, unroutable: 1, invalid: 0, retired: 92,
          with_transport_error: 1 }], error: null };
      }
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

function fakeRedis(behaviour: { fail?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    publisher: {
      async xadd(...args: (string | number)[]) {
        calls.push(String(args[0]));
        if (behaviour.fail) throw new Error("ECONNREFUSED");
        return "1786720175057-0";
      },
      async xtrim() { return 0; },
    },
  };
}

// ---------------------------------------------------------------------------
// D-11-1: the arrow exists, and a guard keeps it existing
// ---------------------------------------------------------------------------

test("D-11-1: the Notification Service and the stream adapter have production callers", () => {
  const production = SOURCE_FILES.filter(
    (f) => !f.includes(`${path.sep}test${path.sep}`) && !/\.test\.tsx?$/.test(f)
  );

  const callers = (needle: string, ownFile: string) =>
    production.filter(
      (f) => !f.endsWith(ownFile) && new RegExp(`\\b${needle}\\s*\\(`).test(stripComments(readFileSync(f, "utf8")))
    );

  // This is the regression guard. Before this batch BOTH were zero, and every
  // component test still passed — because no test asked whether anything
  // actually called them.
  const adapterCallers = callers("publishNotification", "notification-stream-adapter.ts");
  assert.ok(adapterCallers.length >= 1, "the stream adapter must have a production caller");

  const dispatchCallers = callers("dispatchRealtimeOnce", "outbox-dispatcher.ts");
  assert.ok(dispatchCallers.length >= 1, "the dispatcher must have a production entry point");

  // And the entry point must be a long-running worker, not a route or a task.
  assert.ok(
    dispatchCallers.some((f) => f.includes(`${path.sep}worker${path.sep}`)),
    `the dispatcher owner must live in worker/, found: ${dispatchCallers.map((f) => path.relative(ROOT, f))}`
  );
});

test("the worker is a real long-running loop with graceful shutdown", () => {
  const code = stripComments(WORKER);
  assert.match(code, /while \(!controller\.signal\.aborted\)/, "a loop, not a single pass");
  assert.match(code, /process\.on\("SIGTERM", stop\)/);
  assert.match(code, /process\.on\("SIGINT", stop\)/);
  assert.match(code, /dispatchRealtimeOnce\(/);
  // Bounded, jittered error backoff — never a busy spin.
  assert.match(code, /Math\.min\(ERROR_MAX_MS/);
  assert.match(code, /Math\.random\(\)/);
  assert.ok(!/setInterval|while \(true\)/.test(code), "no unbounded timer or busy loop");
  // Realtime cadence, not a cron.
  assert.match(code, /const IDLE_MS = 750/);
});

// ---------------------------------------------------------------------------
// Publication order — the correctness argument
// ---------------------------------------------------------------------------

test("a row is resolved published ONLY after Redis accepted it", async () => {
  const { admin, calls } = fakeAdmin([claimed()]);
  const redis = fakeRedis();

  const result = await dispatchRealtimeOnce({ admin, publisher: redis.publisher });
  assert.equal(result.published, 1);

  const order = calls.map((c) => c.fn);
  const claimAt = order.indexOf("claim_realtime_outbox_events");
  const resolveAt = order.indexOf("resolve_realtime_outbox_event");
  assert.ok(claimAt >= 0 && resolveAt > claimAt, "claim precedes resolve");
  assert.equal(redis.calls.length, 1, "exactly one XADD");

  // The order that matters: XADD happened, THEN resolve. A resolve with no
  // preceding publish would mean the row was marked delivered on hope.
  assert.equal(calls[resolveAt].args.p_disposition, "published");
});

test("a transport failure releases the row and never marks it delivered", async () => {
  const { admin, calls } = fakeAdmin([claimed()]);
  const result = await dispatchRealtimeOnce({ admin, publisher: fakeRedis({ fail: true }).publisher });

  assert.equal(result.transportFailed, 1);
  assert.equal(result.published, 0);
  assert.ok(!calls.some((c) => c.fn === "resolve_realtime_outbox_event"),
    "a failed transport must never resolve the row");
  const release = calls.find((c) => c.fn === "release_realtime_outbox_event");
  assert.ok(release, "the row must be returned for a later pass");
  assert.equal(release.args.p_error_code, "realtime_transport");
});

test("no Redis client at all is also a transport failure, not a delivery", async () => {
  const { admin, calls } = fakeAdmin([claimed()]);
  const result = await dispatchRealtimeOnce({ admin, publisher: null });
  assert.equal(result.transportFailed, 1);
  assert.ok(!calls.some((c) => c.fn === "resolve_realtime_outbox_event"));
});

// ---------------------------------------------------------------------------
// The four dispositions stay distinct
// ---------------------------------------------------------------------------

test("not_user_facing is terminal — a correct decision is not retried forever", async () => {
  const ASSET = "22222222-2222-4222-8222-222222222222";
  const redis = fakeRedis();
  const { admin, calls } = fakeAdmin([
    claimed({
      event_type: "asset.released",
      aggregate_type: "media_asset",
      aggregate_id: ASSET,
      payload: { assetId: ASSET },
    }),
  ]);

  const result = await dispatchRealtimeOnce({ admin, publisher: redis.publisher });
  assert.equal(result.notUserFacing, 1);
  assert.equal(redis.calls.length, 0, "a withheld event must never reach a stream");
  assert.equal(
    calls.find((c) => c.fn === "resolve_realtime_outbox_event")?.args.p_disposition,
    "not_user_facing"
  );
});

test("unroutable is terminal and visible, and nothing is broadcast", async () => {
  const redis = fakeRedis();
  const { admin, calls } = fakeAdmin([claimed({ tenant_id: null })]);

  const result = await dispatchRealtimeOnce({ admin, publisher: redis.publisher });
  assert.equal(result.unroutable, 1);
  assert.equal(redis.calls.length, 0, "an unroutable event must never reach a stream");

  const resolve = calls.find((c) => c.fn === "resolve_realtime_outbox_event");
  assert.equal(resolve?.args.p_disposition, "unroutable");
  assert.equal(resolve?.args.p_error_code, "tenant_unprovable");
});

test("invalid is terminal — redelivering a malformed event reproduces it forever", async () => {
  const redis = fakeRedis();
  const { admin, calls } = fakeAdmin([claimed({ event_type: "media.asset.released" })]);

  const result = await dispatchRealtimeOnce({ admin, publisher: redis.publisher });
  assert.equal(result.invalid, 1);
  assert.equal(redis.calls.length, 0, "an invalid event must never reach a stream");
  assert.equal(
    calls.find((c) => c.fn === "resolve_realtime_outbox_event")?.args.p_disposition,
    "invalid"
  );
});

test("the four dispositions are never collapsed into success/failure", async () => {
  const rows = [
    claimed({ event_id: "aaaaaaaa-1111-4111-8111-111111111111" }),
    claimed({ event_id: "bbbbbbbb-2222-4222-8222-222222222222", tenant_id: null }),
    claimed({ event_id: "cccccccc-3333-4333-8333-333333333333", event_type: "media.asset.released" }),
    claimed({ event_id: "dddddddd-4444-4444-8444-444444444444", event_type: "asset.rejected",
      aggregate_type: "media_asset", payload: { assetId: "22222222-2222-4222-8222-222222222222" } }),
  ];
  const { admin } = fakeAdmin(rows);
  const result = await dispatchRealtimeOnce({ admin, publisher: fakeRedis().publisher });

  assert.equal(result.claimed, 4);
  assert.equal(result.published, 1);
  assert.equal(result.unroutable, 1);
  assert.equal(result.invalid, 1);
  assert.equal(result.notUserFacing, 1);
  assert.equal(result.transportFailed, 0);
});

// ---------------------------------------------------------------------------
// Lease loss and claim failure
// ---------------------------------------------------------------------------

test("a lost lease is counted, not overwritten", async () => {
  const { admin } = fakeAdmin([claimed()], { loseLease: true });
  const result = await dispatchRealtimeOnce({ admin, publisher: fakeRedis().publisher });
  assert.equal(result.lostLease, 1);
  assert.equal(result.published, 0, "a dispatcher that lost its lease must not claim the delivery");
});

test("a claim failure resolves nothing and leaves the debt untouched", async () => {
  const { admin, calls } = fakeAdmin([claimed()], { claimFails: true });
  const result = await dispatchRealtimeOnce({ admin, publisher: fakeRedis().publisher });
  assert.equal(result.claimed, 0);
  assert.equal(calls.length, 1, "only the failed claim was attempted");
});

// ---------------------------------------------------------------------------
// Ownership boundaries
// ---------------------------------------------------------------------------

test("the dispatcher cannot own a lifecycle — it imports nothing that could", () => {
  const imports = (DISPATCHER + WORKER).match(/^import .*$/gm)?.join("\n") ?? "";
  for (const forbidden of [
    "orchestrat", "temporal", "provider", "credits", "stripe", "kafka",
    "quarantine", "asset-service", "r2-client", "generation-starter",
  ]) {
    assert.ok(!new RegExp(forbidden, "i").test(imports), `must not import ${forbidden}`);
  }
  const code = stripComments(DISPATCHER + WORKER);
  assert.ok(!/createGeneration|startWorkflow|submitToProvider|reserveCredits|settleCredits|approveMediaRelease|createSignedUrl/i.test(code));
});

test("projection and tenant logic are not duplicated in the dispatcher", () => {
  const code = stripComments(DISPATCHER);
  assert.match(code, /publishNotification\(/, "it must go through the canonical adapter");
  assert.ok(!/channelForTenant|projectEvent|uiState|streamKeyFor/.test(code),
    "a second answer to a question 11-A already answers");
});

test("still the only XADD path, and Kafka is not required", () => {
  const code = stripComments(DISPATCHER + WORKER);
  assert.ok(!/\.xadd\(/.test(code), "the dispatcher publishes through the adapter, never directly");
  assert.ok(!/kafka|KAFKA_ENABLED|publishDomainEvent/i.test(code), "realtime must not need Kafka");
  assert.ok(!/\.publish\(|\.subscribe\(/.test(code), "Pub/Sub stays forbidden");
  assert.ok(!/BULLMQ_REDIS_URL|bullmq/i.test(code), "Redis B stays out of scope");
});

// ---------------------------------------------------------------------------
// Multi-sink independence, at the contract level
// ---------------------------------------------------------------------------

test("the realtime lane is separate from the Kafka lane, additively", () => {
  for (const column of [
    "realtime_status", "realtime_claim_token", "realtime_claimed_at",
    "realtime_attempts", "realtime_completed_at", "realtime_disposition",
  ]) {
    assert.ok(MIGRATION.includes(column), `${column} must exist`);
  }
  // The Kafka columns are untouched: no DROP, no rewrite of its functions.
  assert.ok(!/\bDROP\s+COLUMN\b|\bDROP\s+TABLE\b|\bTRUNCATE\b/i.test(MIGRATION));
  assert.ok(!/CREATE OR REPLACE FUNCTION "public"\."claim_outbox_events"/.test(MIGRATION),
    "the Kafka claim must not be rewritten");
  assert.ok(!/CREATE OR REPLACE FUNCTION "public"\."mark_outbox_event_/.test(MIGRATION));

  // And the dispatcher only ever touches the realtime functions.
  const code = stripComments(DISPATCHER);
  assert.match(code, /claim_realtime_outbox_events/);
  assert.ok(!/\bclaim_outbox_events\b|mark_outbox_event_published/.test(code),
    "the dispatcher must not drive the Kafka lane");
});

test("historical debt was retired auditably, never deleted", () => {
  assert.ok(!/\bDELETE\s+FROM\b|\bTRUNCATE\b/i.test(RETIREMENT), "evidence must not be destroyed");
  assert.match(RETIREMENT, /realtime_disposition = 'retired'/);
  assert.match(RETIREMENT, /realtime_last_error_code = 'pre_realtime_untenanted'/);
  // Narrow: only untenanted rows that predate the migration.
  assert.match(RETIREMENT, /tenant_id IS NULL/);
  assert.match(RETIREMENT, /created_at < now\(\)/);
  // And it refuses to have touched the other sink.
  assert.match(RETIREMENT, /must not have altered the kafka lane/);
});

// ---------------------------------------------------------------------------
// Observable debt
// ---------------------------------------------------------------------------

test("debt is counts and ages only — no payload, no tenant, no id", async () => {
  const { admin } = fakeAdmin([]);
  const debt = await readRealtimeDebt(admin);
  assert.ok(debt);
  assert.deepEqual(
    Object.keys(debt!).sort(),
    ["dispatching", "invalid", "maxAttempts", "notUserFacing", "oldestPendingSeconds",
     "pending", "published", "retired", "unroutable", "withTransportError"]
  );
  for (const value of Object.values(debt!)) assert.equal(typeof value, "number");
});

test("logs carry counts, never event content", () => {
  const code = stripComments(WORKER);
  const logs = code.match(/console\.(log|error)\([\s\S]{0,400}?\);/g) ?? [];
  assert.ok(logs.length > 0);
  for (const line of logs) {
    assert.ok(!/payload|tenant|eventId|event_id|aggregate|prompt|url/i.test(line),
      `a log line may leak content: ${line.slice(0, 80)}`);
  }
});
