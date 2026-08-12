import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase, seedGeneration } from "./e2e-harness";
import {
  canonicalJson,
  canonicalRequestHash,
  deriveIdempotencyIdentity,
  bindsSameOperation,
} from "@/lib/redis/idempotency-identity";
import * as activities from "../../../worker/activities/generation-activities";

/**
 * DATA & EVENT FOUNDATION (Phase 6R-E).
 *
 * The transactional guarantee itself is NOT tested here, and cannot be: a
 * TypeScript double has no transactions. It is proven against real
 * PostgreSQL in supabase/tests/test_transactional_outbox.sql, run by
 * supabase/tests/run_pg_tests.sh in a throwaway container. Proofs A–I there
 * cover commit-together, rollback-together, refused-transition-emits-nothing,
 * durability without Kafka, event identity, and two-session claim
 * concurrency.
 *
 * What this suite covers is everything around that: correlation, the Redis A
 * boundary, idempotency identity composition, and the fact that the
 * application actually calls the transactional function instead of doing two
 * writes and calling it atomic.
 */

/** Normalizes CRLF so source-shape assertions are line-ending agnostic. */
const readSource = (relative: string) =>
  readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");

// ===========================================================================
// E1 — CORRELATION: generation -> attempt -> outbox is followable
// ===========================================================================

test("E1: one generation id links the generation, its attempts, and its events", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { metadata: { mock_mode: "async-success" } });

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

  await activities.cancelGeneration({ generationId, attemptId });

  // The chain, followed end to end by the one canonical identifier.
  assert.equal(db.state.generations[0].id, generationId);
  assert.equal(db.state.generation_attempts[0].generation_id, generationId);
  assert.equal(db.outboxEvents[0].aggregate_id, generationId, "the event points back at the generation");
  assert.equal(
    (db.outboxEvents[0].payload as { generationId: string }).generationId,
    generationId,
    "and carries it in the payload for consumers that never see the aggregate column"
  );
});

test("E1: trace_id is a TRANSPORT correlation id and is honestly scoped", () => {
  // It exists on the command wire and on the outbox row...
  assert.ok(readSource("src/lib/contracts/command-wire.ts").includes("traceId"));
  assert.ok(readSource("supabase/migrations/20260812130000_outbox_events.sql").includes('"trace_id"'));
  assert.ok(
    readSource("supabase/migrations/20260813000000_cancellation_outbox.sql").includes("p_trace_id"),
    "and the transactional writer threads it through"
  );

  // ...and NOT on the durable business rows. Stated rather than implied, so
  // nobody assumes a join that does not exist: the canonical correlation
  // across generations/attempts is generation_id.
  const remote = readSource("supabase/migrations/20260805132704_remote_schema.sql");
  const attempts = readSource("supabase/migrations/20260810120000_generation_attempts.sql");
  assert.ok(!/"trace_id"/.test(attempts), "generation_attempts has no trace_id column today");
  assert.ok(
    !/generations[\s\S]{0,2000}"trace_id"/.test(remote),
    "generations has no trace_id column today"
  );

  // Exactly one correlation vocabulary is used — no competing second id.
  for (const file of [
    "src/lib/contracts/command-wire.ts",
    "src/lib/events/domain-event.ts",
    "src/lib/events/outbox-repository.ts",
  ]) {
    assert.ok(
      !/correlationId|correlation_id/.test(readSource(file)),
      `${file} must not introduce a second correlation identifier`
    );
  }
});

// ===========================================================================
// E3 / E4 — THE APPLICATION ACTUALLY USES THE TRANSACTIONAL WRITER
// ===========================================================================

test("E4: markCancelled goes through the SQL function, not two PostgREST writes", () => {
  const source = readSource("src/lib/orchestration/status-manager.ts");
  const fn = source.match(/export async function markCancelled[\s\S]*?\n}\n/)![0];

  assert.ok(fn.includes('admin.rpc("cancel_generation_tx"'), "it calls the transactional function");
  assert.ok(
    !/\.from\(["'`]generations["'`]\)/.test(fn),
    "and does NOT perform its own PostgREST update — that would be a second transaction"
  );
  assert.ok(
    !/emit_outbox_event/.test(fn),
    "the event insert must not be a separate client call either"
  );
});

test("E3: the SQL function performs the update and the event in ONE body", () => {
  const migration = readSource("supabase/migrations/20260813000000_cancellation_outbox.sql");
  const fn = migration.match(
    /CREATE OR REPLACE FUNCTION "public"\."cancel_generation_tx"[\s\S]*?\n\$\$;/
  )![0];

  assert.ok(/UPDATE generations/.test(fn), "the business mutation is inside the function");
  assert.ok(/emit_outbox_event\(/.test(fn), "so is the event");
  assert.ok(/IF NOT FOUND THEN/.test(fn), "and a refused transition returns before emitting");

  // The refusal branch must come BEFORE the emit, or a lost race would still
  // announce a cancellation.
  assert.ok(
    fn.indexOf("IF NOT FOUND THEN") < fn.indexOf("emit_outbox_event("),
    "the guard must precede the event"
  );

  assert.ok(/SECURITY DEFINER/.test(fn) && /SET "search_path" TO 'public'/.test(fn),
    "security-definer functions must pin search_path");
});

test("E4: no code that MUTATES business state also emits its event as a separate request", () => {
  // The failure mode this forbids: .update() followed by .rpc("emit_outbox_event"),
  // which is two transactions wearing one name.
  //
  // outbox-repository.ts is deliberately exempt and is checked separately
  // below: it is the generic emit helper, it performs no business mutation of
  // its own, and its 6R.9 header already states that calling it standalone is
  // "only an insert". The rule that matters is that a mutation path must not
  // use it — which is what this walks for.
  const EXEMPT = ["outbox-repository.ts"];

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
    });

  for (const file of [...walk(join(process.cwd(), "src/lib")), ...walk(join(process.cwd(), "worker"))]) {
    if (EXEMPT.some((name) => file.endsWith(name))) continue;
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/rpc\(\s*["'`]emit_outbox_event["'`]/.test(code),
      `${file} calls emit_outbox_event as a standalone RPC alongside its own writes — that is not transactional`
    );
  }

  // And the exemption is honest: the helper says so itself, so nobody reads
  // it as a transactional API.
  const repository = readSource("src/lib/events/outbox-repository.ts");
  assert.ok(
    !/\.update\(|\.insert\(/.test(repository.replace(/\/\*[\s\S]*?\*\//g, "")),
    "the generic emit helper must not perform business mutations of its own"
  );
});

test("E4: the event the writer emits matches a REGISTERED schema", async () => {
  const { validateDomainEvent } = await import("@/lib/events/schema-registry");
  const { buildDomainEvent } = await import("@/lib/events/domain-event");

  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db);
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

  await activities.cancelGeneration({ generationId, attemptId });
  const row = db.outboxEvents[0];

  // Reconstruct the envelope a publisher would build from this row and run it
  // through the real Phase 6R.15 gate.
  const validation = validateDomainEvent(
    buildDomainEvent({
      eventId: row.event_id as string,
      eventType: row.event_type as string,
      eventVersion: row.event_version as number,
      aggregateType: row.aggregate_type as string,
      aggregateId: row.aggregate_id as string,
      payload: row.payload as Record<string, unknown>,
    })
  );

  assert.deepEqual(validation, { ok: true, schemaName: "cinefield.generation.cancelled" });
});

test("E5: an application retry keeps ONE event identity", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db);

  const { markCancelled } = await import("@/lib/orchestration/status-manager");
  const eventId = randomUUID();

  const applied = await markCancelled(db as never, generationId, null, { eventId });
  assert.equal(applied, true);
  assert.equal(db.outboxEvents[0].event_id, eventId, "the supplied identity is preserved, not replaced");

  // The retry loses the compare-and-set, so it emits nothing at all — which
  // is the strongest possible form of "no duplicate event".
  const retry = await markCancelled(db as never, generationId, null, { eventId });
  assert.equal(retry, false);
  assert.equal(db.outboxEvents.length, 1);
});

// ===========================================================================
// E6 — KAFKA IS NOT REQUIRED FOR DURABILITY
// ===========================================================================

test("E6: the event survives with Kafka disabled, unconfigured, and absent", async () => {
  const saved = { enabled: process.env.KAFKA_ENABLED, brokers: process.env.KAFKA_BROKERS };
  try {
    delete process.env.KAFKA_ENABLED;
    delete process.env.KAFKA_BROKERS;

    const { getKafkaConfig, describeKafkaConfig } = await import("@/lib/kafka/kafka-config");
    assert.equal(getKafkaConfig(), null, "Kafka is not configured in this repository");
    assert.deepEqual(describeKafkaConfig(), { configured: false, brokerCount: 0 });

    const db = new FakeSupabaseClient();
    await installFakeSupabase(db);
    const { generationId } = seedGeneration(db);
    const { markCancelled } = await import("@/lib/orchestration/status-manager");

    assert.equal(await markCancelled(db as never, generationId, null), true);
    assert.equal(db.state.generations[0].status, "cancelled", "the business transaction succeeded");
    assert.equal(db.outboxEvents.length, 1, "and the event is durable");
    assert.equal(db.outboxEvents[0].status, "pending", "waiting for a publisher that does not exist yet");
    assert.equal(db.outboxEvents[0].published_at, null);
  } finally {
    if (saved.enabled === undefined) delete process.env.KAFKA_ENABLED;
    else process.env.KAFKA_ENABLED = saved.enabled;
    if (saved.brokers === undefined) delete process.env.KAFKA_BROKERS;
    else process.env.KAFKA_BROKERS = saved.brokers;
  }
});

test("E6: nothing in the durability path imports a Kafka client", () => {
  for (const file of [
    "src/lib/orchestration/status-manager.ts",
    "src/lib/events/outbox-repository.ts",
    "worker/activities/generation-activities.ts",
  ]) {
    const code = readSource(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/kafka/i.test(code), `${file} must not depend on Kafka to make a fact durable`);
  }
});

// ===========================================================================
// E8 — REDIS A BOUNDARY
// ===========================================================================

test("E8: Redis A stays application state and never becomes a source of truth", async () => {
  const { REDIS_KEY_TTL_SECONDS } = await import("@/lib/redis/redis-keys");

  // Every namespace is TTL-bounded. A durable source of truth would not be.
  for (const [namespace, ttl] of Object.entries(REDIS_KEY_TTL_SECONDS)) {
    assert.ok(
      typeof ttl === "number" && ttl > 0 && Number.isFinite(ttl),
      `${namespace} must be TTL-bounded — Redis A holds no permanent truth`
    );
  }

  const walk = (dir: string): string[] =>
    readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(dir, f));

  for (const file of walk(join(process.cwd(), "src/lib/redis"))) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Not a queue, not a workflow store, not an event log.
    assert.ok(!/bullmq|BullMQ/.test(code), `${file}: Redis A is not BullMQ's queue storage`);
    assert.ok(!/outbox|domain-event/i.test(code), `${file}: Redis A is not the event log`);
    assert.ok(!/workflowId|GenerationWorkflow/.test(code), `${file}: Redis A is not workflow state`);
    // Forbidden Redis commands that would turn a bounded cache into a
    // scan-able store. Matched against a redis-client call specifically —
    // Object.keys() on a parsed hash is ordinary and must not trip this.
    assert.ok(
      !/\b(?:client|redis)\s*\.\s*(?:keys|scan|flushdb|flushall)\s*\(/i.test(code),
      `${file}: Redis A must never be enumerated or flushed`
    );
  }
});

// ===========================================================================
// E9 — IDEMPOTENCY IDENTITY (6R.24)
// ===========================================================================

test("E9: the same key, actor and request produce the same identity", () => {
  const input = {
    clientKey: "client-key-1",
    actorId: "user_alice",
    canonicalRequest: { model: "mock-image", prompt: "a cat", count: 1 },
  };
  const a = deriveIdempotencyIdentity(input);
  const b = deriveIdempotencyIdentity({
    ...input,
    // Same request, different key ORDER — must be the same operation.
    canonicalRequest: { count: 1, prompt: "a cat", model: "mock-image" },
  });

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.ok && b.ok && a.identity, b.ok ? b.identity : "", "key order is not part of the request");
  assert.ok(a.ok && /^[0-9a-f]{64}$/.test(a.identity), "the identity is identifier-safe");
});

test("E9: the SAME key from a DIFFERENT actor cannot reach the first actor's claim", () => {
  const request = { model: "mock-image", prompt: "a cat" };
  const alice = deriveIdempotencyIdentity({
    clientKey: "shared-key",
    actorId: "user_alice",
    canonicalRequest: request,
  });
  const mallory = deriveIdempotencyIdentity({
    clientKey: "shared-key",
    actorId: "user_mallory",
    canonicalRequest: request,
  });

  assert.ok(alice.ok && mallory.ok);
  assert.notEqual(
    alice.ok && alice.identity,
    mallory.ok && mallory.identity,
    "a guessed or copied key must not cross a tenant boundary"
  );
});

test("E9: the SAME key with a DIFFERENT request is a different operation, and is detectable", () => {
  const base = { clientKey: "k", actorId: "user_alice" };
  const first = deriveIdempotencyIdentity({ ...base, canonicalRequest: { prompt: "a cat" } });
  const edited = deriveIdempotencyIdentity({ ...base, canonicalRequest: { prompt: "a dog" } });

  assert.ok(first.ok && edited.ok);
  assert.notEqual(first.ok && first.identity, edited.ok && edited.identity);

  // And a caller holding the earlier record can refuse explicitly rather than
  // silently answering the wrong question.
  assert.equal(
    bindsSameOperation(first.ok ? first.requestHash : "", edited.ok ? edited.requestHash : ""),
    false,
    "key reuse with a changed payload must be detectable, not silently served"
  );
  assert.equal(
    bindsSameOperation(first.ok ? first.requestHash : "", first.ok ? first.requestHash : ""),
    true
  );
});

test("E9: a missing or oversized key/actor is rejected before anything is claimed", () => {
  const request = { prompt: "x" };
  assert.deepEqual(
    deriveIdempotencyIdentity({ clientKey: "", actorId: "user_a", canonicalRequest: request }),
    { ok: false, reason: "invalid_client_key" }
  );
  assert.deepEqual(
    deriveIdempotencyIdentity({ clientKey: "k", actorId: "  ", canonicalRequest: request }),
    { ok: false, reason: "invalid_actor" }
  );
  assert.deepEqual(
    deriveIdempotencyIdentity({ clientKey: "x".repeat(201), actorId: "a", canonicalRequest: request }),
    { ok: false, reason: "invalid_client_key" }
  );
});

test("E9: field boundaries cannot be shifted to impersonate another identity", () => {
  // Without length prefixes, ("ab","c") and ("a","bc") would hash the same.
  const a = deriveIdempotencyIdentity({ clientKey: "ab", actorId: "c", canonicalRequest: 1 });
  const b = deriveIdempotencyIdentity({ clientKey: "a", actorId: "bc", canonicalRequest: 1 });
  assert.ok(a.ok && b.ok);
  assert.notEqual(a.ok && a.identity, b.ok && b.identity);
});

test("E9: canonical hashing preserves array order and ignores undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  // Array order is meaningful — input files are not a set.
  assert.notEqual(canonicalRequestHash({ inputs: ["a", "b"] }), canonicalRequestHash({ inputs: ["b", "a"] }));
  assert.equal(canonicalRequestHash({ x: { y: 1 } }), canonicalRequestHash({ x: { y: 1 } }));
});

test("E9: the identity contains no readable actor id", () => {
  const derived = deriveIdempotencyIdentity({
    clientKey: "k",
    actorId: "user_very_identifiable",
    canonicalRequest: {},
  });
  assert.ok(derived.ok);
  assert.ok(
    derived.ok && !derived.identity.includes("user_very_identifiable"),
    "an actor id must not travel into a key that ends up in logs and metrics"
  );
});

// ===========================================================================
// E10 — TENANT BINDING, REPORTED HONESTLY
// ===========================================================================

test("E10: there is no workspace column yet, and nothing pretends otherwise", () => {
  const migrations = readdirSync(join(process.cwd(), "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readSource(join("supabase/migrations", f)))
    .join("\n");

  assert.ok(
    !/"workspace_id"|workspace_id\s+"?uuid/.test(migrations),
    "no workspace_id exists — 6R.21 is a real, open schema dependency"
  );

  // What DOES bind a generation to a tenant today is clerk_user_id, and it is
  // read from the row, never from an inbound message or request body.
  const handler = readSource("worker/provider-command-handler.ts");
  assert.ok(
    /clerkUserId: generation\.clerk_user_id/.test(handler),
    "the worker derives the owner from the durable row"
  );
  const wire = readSource("src/lib/contracts/command-wire.ts");
  assert.ok(!/clerkUserId|workspaceId|userId/.test(wire), "and no owner travels on the wire at all");
});

test("E10: the service-role client is documented as bypassing RLS, not as authorization", () => {
  const admin = readSource("src/lib/supabase/supabaseAdmin.ts");
  assert.ok(/bypasses RLS/i.test(admin), "the RLS bypass is stated explicitly");
  // Every server path that uses it re-checks ownership itself.
  for (const file of [
    "src/lib/orchestration/orchestrator.ts",
    "worker/activities/generation-activities.ts",
  ]) {
    assert.ok(
      /clerk_user_id !== /.test(readSource(file)),
      `${file} must verify ownership rather than rely on the admin client`
    );
  }
});

// ===========================================================================
// X1 — THE GLOBAL INVARIANT
// ===========================================================================

test("X1: nothing in the 6R lifecycle can mint a second generation id", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
    });

  const LIFECYCLE = [
    ...walk(join(process.cwd(), "worker")),
    join(process.cwd(), "src/lib/orchestration/attempt-submission-service.ts"),
    join(process.cwd(), "src/lib/orchestration/webhook-temporal-bridge.ts"),
    join(process.cwd(), "src/lib/orchestration/generation-execution-service.ts"),
  ];

  for (const file of LIFECYCLE) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/from\(["'`]generations["'`]\)[\s\S]{0,80}\.insert\(/.test(code),
      `${file} must never INSERT a generation — retries multiply attempts, not generations`
    );
  }

  // Attempts, by contrast, are explicitly allowed to multiply — and the DB
  // enforces that only one may be active at a time (proven on real Postgres,
  // supabase/tests/test_transactional_outbox.sql PROOF F).
  const attempts = readSource("supabase/migrations/20260810120000_generation_attempts.sql");
  assert.ok(/generation_attempts_one_active_uniq/.test(attempts));
  assert.ok(/attempt_no/.test(attempts));
});
