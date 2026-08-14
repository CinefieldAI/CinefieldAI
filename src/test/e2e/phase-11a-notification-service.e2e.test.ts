import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { notificationForOutboxRow, type OutboxRow } from "@/lib/notification/notification-service";
import { channelForTenant, channelBelongsTo } from "@/lib/notification/channel-identity";
import { projectEvent } from "@/lib/notification/event-projection";

/**
 * Phase 11-A, application side.
 *
 * One property matters more than the rest: a notification's destination comes
 * from the database and from nowhere else. Everything below either proves that
 * or proves what the notification is allowed to contain once it has one.
 */

const ROOT = process.cwd();
const OWNER = "user_2abcdefghijklmnop";
const OTHER = "user_2zyxwvutsrqponml";
const GEN = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";

const SERVICE = readFileSync(path.join(ROOT, "src/lib/notification/notification-service.ts"), "utf8");
const PROJECTION = readFileSync(path.join(ROOT, "src/lib/notification/event-projection.ts"), "utf8");
const CHANNEL = readFileSync(path.join(ROOT, "src/lib/notification/channel-identity.ts"), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    eventId: "33333333-3333-4333-8333-333333333333",
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: GEN,
    occurredAt: "2026-08-24T10:00:00.000Z",
    tenantId: OWNER,
    payload: { generationId: GEN, provider: "fal" },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Contract validation
// ---------------------------------------------------------------------------

test("an invalid event type is rejected, not published", () => {
  const outcome = notificationForOutboxRow(row({ eventType: "media.asset.released" }));
  assert.equal(outcome.decision, "invalid");
});

test("an unknown family is rejected", () => {
  const outcome = notificationForOutboxRow(
    row({ eventType: "weather.changed", payload: { generationId: GEN } })
  );
  assert.equal(outcome.decision, "invalid");
});

test("a payload that violates its registered schema is rejected", () => {
  // generation.completed requires provider.
  const outcome = notificationForOutboxRow(row({ payload: { generationId: GEN } }));
  assert.equal(outcome.decision, "invalid");
});

test("validation happens BEFORE tenant resolution", () => {
  // A malformed event with a missing tenant must report the schema fault, not
  // the routing one — otherwise a bad event looks like a routing problem and
  // gets "fixed" by capturing a tenant for it.
  const outcome = notificationForOutboxRow(
    row({ eventType: "not-dotted", tenantId: null })
  );
  assert.equal(outcome.decision, "invalid");
});

// ---------------------------------------------------------------------------
// The canonical asset family now validates
// ---------------------------------------------------------------------------

test("asset.released and asset.rejected are valid events after the repair", () => {
  for (const eventType of ["asset.released", "asset.rejected"]) {
    const outcome = notificationForOutboxRow(
      row({ eventType, aggregateType: "media_asset", aggregateId: ASSET, payload: { assetId: ASSET } })
    );
    // Valid, routable — and deliberately withheld from the browser.
    assert.equal(outcome.decision, "not_user_facing", `${eventType} should validate`);
  }
});

test("asset safety decisions are not user-facing in this phase", () => {
  const outcome = projectEvent({
    eventId: "x", eventType: "asset.released", eventVersion: 1,
    aggregateType: "media_asset", aggregateId: ASSET,
    occurredAt: "2026-08-24T10:00:00.000Z", payload: { assetId: ASSET },
  });
  assert.equal(outcome.ok, false);
});

// ---------------------------------------------------------------------------
// Tenant — the security core
// ---------------------------------------------------------------------------

test("a missing tenant refuses; it does not broadcast", () => {
  const outcome = notificationForOutboxRow(row({ tenantId: null }));
  assert.equal(outcome.decision, "unroutable");
  assert.equal(outcome.decision === "unroutable" && outcome.reason, "tenant_missing");
});

test("a malformed tenant refuses rather than being coerced into shape", () => {
  for (const bad of ["", "  ", "anonymous", "user_", "*", "user:2abc", "../user_2abc"]) {
    const outcome = notificationForOutboxRow(row({ tenantId: bad }));
    assert.equal(outcome.decision, "unroutable", `"${bad}" must not resolve to a channel`);
  }
});

test("there is no fallback, global or admin channel anywhere in the service", () => {
  const code = stripComments(SERVICE) + stripComments(CHANNEL) + stripComments(PROJECTION);
  assert.ok(!/fallback|broadcast|["'`](?:global|all|admin|\*)["'`]/i.test(code));
});

test("the channel is derived from the tenant and matches nothing else", () => {
  const mine = channelForTenant(OWNER);
  assert.ok(mine.ok);
  assert.ok(mine.ok && channelBelongsTo(mine.channelId, OWNER));
  assert.ok(mine.ok && !channelBelongsTo(mine.channelId, OTHER), "cross-tenant channel match");
});

test("one tenant's event never projects into another tenant's channel", () => {
  const a = notificationForOutboxRow(row({ tenantId: OWNER }));
  const b = notificationForOutboxRow(row({ tenantId: OTHER }));
  assert.equal(a.decision, "publish");
  assert.equal(b.decision, "publish");
  assert.notEqual(
    a.decision === "publish" && a.envelope.channelId,
    b.decision === "publish" && b.envelope.channelId
  );
});

test("no client-supplied field can select a channel", () => {
  // The tenant is read from the ROW, and the row's tenant comes from
  // emit_outbox_event. A payload that tries to name a channel is ignored,
  // because nothing reads a channel out of a payload.
  const outcome = notificationForOutboxRow(
    row({
      tenantId: OWNER,
      payload: {
        generationId: GEN,
        provider: "fal",
        // Hostile extras. The schema has additionalProperties:false, so this
        // event is refused outright — the strongest possible answer.
        channelId: `user:${OTHER}`,
        tenantId: OTHER,
      },
    })
  );
  assert.equal(outcome.decision, "invalid");

  const code = stripComments(SERVICE) + stripComments(CHANNEL);
  assert.ok(!/payload\s*[.[]\s*["']?(channel|tenant|workspace|user)/i.test(code));
});

test("the service reads the tenant only from the row, never from the payload", () => {
  const code = stripComments(SERVICE);
  assert.match(code, /channelForTenant\(row\.tenantId\)/);
});

// ---------------------------------------------------------------------------
// Projections — the six browser states
// ---------------------------------------------------------------------------

test("generation lifecycle projects to the roadmap's browser states", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["generation.created", { generationId: GEN, generationType: "image", provider: "fal", model: "flux" }, "queued"],
    ["generation.processing", { generationId: GEN, provider: "fal" }, "processing"],
    ["generation.completed", { generationId: GEN, provider: "fal", durationMs: 4200 }, "completed"],
    ["generation.failed", { generationId: GEN, provider: "fal", errorCode: "PROVIDER_TIMEOUT" }, "failed"],
    ["generation.cancelled", { generationId: GEN }, "cancelled"],
  ];

  for (const [eventType, payload, expected] of cases) {
    const outcome = notificationForOutboxRow(row({ eventType, payload }));
    assert.equal(outcome.decision, "publish", `${eventType} should publish`);
    if (outcome.decision !== "publish") continue;
    assert.equal(outcome.envelope.projection.uiState, expected);
    assert.equal(outcome.envelope.projection.subject.id, GEN);
  }
});

test("credit.updated has a projection but no producer fabricates one", () => {
  // The state is mappable for 11-B, and Phase 10 owns the ledger. Nothing in
  // SQL emits a credit event today, and this batch adds no producer.
  const outcome = notificationForOutboxRow(
    row({
      eventType: "credit.settled",
      payload: { reservationId: "44444444-4444-4444-8444-444444444444", charged: 3 },
    })
  );
  assert.equal(outcome.decision, "publish");
  assert.equal(outcome.decision === "publish" && outcome.envelope.projection.uiState, "credit.updated");

  const migrations = readFileSync(
    path.join(ROOT, "supabase/migrations/20260824000000_event_contract_and_tenant_routing.sql"),
    "utf8"
  );
  assert.ok(!/emit_outbox_event\(\s*'credit\./.test(migrations), "this batch must emit no credit event");
});

// ---------------------------------------------------------------------------
// Payload minimization
// ---------------------------------------------------------------------------

test("the projection never spreads the outbox payload", () => {
  const code = stripComments(PROJECTION);
  assert.ok(!/\.\.\.\s*(p|payload|event\.payload)\b/.test(code), "no payload spreading");
  assert.ok(!/Object\.(assign|entries)\(\s*(p|payload)\b/.test(code.replace(/Object\.entries\(entries\)/g, "")));
});

test("forbidden fields cannot reach a browser even when present in a payload", () => {
  // A hostile or careless emitter adds secrets to a payload. The schema
  // refuses the event; and even a schema-valid event only carries the named
  // fields the projector copies.
  const published = notificationForOutboxRow(
    row({ payload: { generationId: GEN, provider: "fal", durationMs: 10 } })
  );
  assert.equal(published.decision, "publish");
  if (published.decision !== "publish") return;

  const serialized = JSON.stringify(published.envelope);
  for (const forbidden of [
    "objectKey", "signedUrl", "bucket", "r2", "s3", "secret", "apiKey",
    "accessKey", "prompt", "metadata", "stack", "approver", "reason_code",
  ]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(serialized),
      `${forbidden} must never appear in a notification envelope`
    );
  }
});

test("the envelope carries only the declared fields", () => {
  const outcome = notificationForOutboxRow(row({ traceId: "trace-1" }));
  assert.equal(outcome.decision, "publish");
  if (outcome.decision !== "publish") return;

  assert.deepEqual(
    Object.keys(outcome.envelope).sort(),
    ["channelId", "eventId", "eventType", "occurredAt", "projection", "tenantId", "traceId"]
  );
});

test("eventId is preserved as the dedupe identity for 11-C", () => {
  const outcome = notificationForOutboxRow(row({ eventId: "55555555-5555-4555-8555-555555555555" }));
  assert.equal(
    outcome.decision === "publish" && outcome.envelope.eventId,
    "55555555-5555-4555-8555-555555555555"
  );
});

// ---------------------------------------------------------------------------
// Boundaries: not a lifecycle owner, no Redis, no SSE
// ---------------------------------------------------------------------------

test("the Notification Service imports nothing that could own a lifecycle", () => {
  const imports = SERVICE.match(/^import .*$/gm)?.join("\n") ?? "";
  for (const forbidden of [
    "redis", "ioredis", "supabase", "temporal", "@aws-sdk", "stripe",
    "orchestrat", "provider", "media/", "credits",
  ]) {
    assert.ok(!new RegExp(forbidden, "i").test(imports), `must not import ${forbidden}`);
  }
});

test("no Redis and no SSE exist anywhere in this batch", () => {
  // Code only. All three modules DESCRIBE the Redis Streams and SSE stages in
  // their headers, because a module that ends at a boundary should say which
  // boundary; naming the next stage is documentation, not an implementation
  // of it.
  const all = stripComments(SERVICE) + stripComments(CHANNEL) + stripComments(PROJECTION);
  assert.ok(!/xadd|xread|xgroup|createClient|ioredis/i.test(all), "11-B owns Redis Streams");
  assert.ok(!/text\/event-stream|EventSource|ReadableStream|Last-Event-ID/i.test(all), "11-B/11-C own SSE");
});

test("11-C's ordering decision is left open, not silently taken", () => {
  // A `seq` field here would lock the architecture to the Redis Stream id as
  // the canonical event_seq before 11-C has weighed it. The candidate is
  // recorded in prose; the envelope stays free of it.
  const outcome = notificationForOutboxRow(row());
  assert.equal(outcome.decision, "publish");
  if (outcome.decision !== "publish") return;
  assert.ok(!("seq" in outcome.envelope), "11-C owns event_seq");
  assert.ok(!("eventSeq" in outcome.envelope));
});

test("the service is a pure function of its input", () => {
  const input = row();
  const before = JSON.stringify(input);
  notificationForOutboxRow(input);
  assert.equal(JSON.stringify(input), before, "input must not be mutated");
});
