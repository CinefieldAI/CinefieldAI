import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildDomainEvent, familyOf, MAX_EVENT_PAYLOAD_BYTES } from "./domain-event";
import { EVENT_TOPICS, topicForEventType } from "./event-topics";

/**
 * Zero-cost tests for the domain event envelope and topic contract
 * (Phase 6R.9). Pure string/object validation — no network, no database,
 * no Kafka, no AWS.
 */

// ---------------------------------------------------------------------------
// EVENT CONTRACT
// ---------------------------------------------------------------------------

test("valid event: eventId and occurredAt are server-generated", () => {
  const event = buildDomainEvent({
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: "3d9e7c2a-5b1f-4a8e-9c6d-2b3a4c5d6e7f",
    payload: { status: "completed" },
  });

  assert.equal(typeof event.eventId, "string");
  assert.ok(event.eventId.length > 0);
  assert.ok(!Number.isNaN(Date.parse(event.occurredAt)));
  assert.equal(event.eventType, "generation.completed");
  assert.equal(event.eventVersion, 1);
});

test("eventId remains stable when explicitly supplied - a publish retry preserves identity", () => {
  const fixedId = "8f2a4b1e-6c3d-4e7a-9b5f-1a2c3d4e5f6a";
  const first = buildDomainEvent({
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: "gen-1",
    payload: {},
    eventId: fixedId,
  });
  const retry = buildDomainEvent({
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: "gen-1",
    payload: {},
    eventId: fixedId,
  });
  assert.equal(first.eventId, retry.eventId);
  assert.equal(first.eventId, fixedId);
});

test("two events built without an explicit id get distinct ids", () => {
  const base = {
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: "gen-1",
    payload: {},
  };
  assert.notEqual(buildDomainEvent(base).eventId, buildDomainEvent(base).eventId);
});

test("invalid eventType rejected: malformed shape and unknown family", () => {
  const base = { eventVersion: 1, aggregateType: "generation", aggregateId: "gen-1", payload: {} };
  assert.throws(() => buildDomainEvent({ ...base, eventType: "nodot" }), /invalid eventType/);
  assert.throws(() => buildDomainEvent({ ...base, eventType: "Generation.Completed" }), /invalid eventType/);
  assert.throws(() => buildDomainEvent({ ...base, eventType: "" }), /invalid eventType/);
  // Well-formed but not a known family.
  assert.throws(() => buildDomainEvent({ ...base, eventType: "weather.changed" }), /unknown event family/);
});

test("eventVersion required as a positive integer", () => {
  const base = { eventType: "generation.completed", aggregateType: "generation", aggregateId: "gen-1", payload: {} };
  assert.throws(() => buildDomainEvent({ ...base, eventVersion: 0 }), /invalid eventVersion/);
  assert.throws(() => buildDomainEvent({ ...base, eventVersion: -1 }), /invalid eventVersion/);
  assert.throws(() => buildDomainEvent({ ...base, eventVersion: 1.5 }), /invalid eventVersion/);
});

test("invalid aggregate identity rejected", () => {
  const base = { eventType: "generation.completed", eventVersion: 1, payload: {} };
  assert.throws(
    () => buildDomainEvent({ ...base, aggregateType: "generation", aggregateId: "" }),
    /invalid aggregateId/
  );
  assert.throws(
    () => buildDomainEvent({ ...base, aggregateType: "", aggregateId: "gen-1" }),
    /invalid aggregateType/
  );
  assert.throws(
    () => buildDomainEvent({ ...base, aggregateType: "generation", aggregateId: "has space" }),
    /invalid aggregateId/
  );
});

test("unserializable payload rejected: functions, symbols, bigint", () => {
  const base = {
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: "gen-1",
  };
  assert.throws(
    () => buildDomainEvent({ ...base, payload: { fn: () => "nope" } as unknown as Record<string, unknown> }),
    /not JSON-serializable/
  );
  assert.throws(
    () => buildDomainEvent({ ...base, payload: { sym: Symbol("x") } as unknown as Record<string, unknown> }),
    /not JSON-serializable/
  );
  assert.throws(
    () => buildDomainEvent({ ...base, payload: { big: BigInt(1) } as unknown as Record<string, unknown> }),
    /not JSON-serializable/
  );
});

test("payload must be a plain object, not an array or null", () => {
  const base = {
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: "gen-1",
  };
  assert.throws(
    () => buildDomainEvent({ ...base, payload: [] as unknown as Record<string, unknown> }),
    /must be a plain object/
  );
  assert.throws(
    () => buildDomainEvent({ ...base, payload: null as unknown as Record<string, unknown> }),
    /must be a plain object/
  );
});

test("oversized payload rejected at the documented technical ceiling", () => {
  assert.throws(
    () =>
      buildDomainEvent({
        eventType: "generation.completed",
        eventVersion: 1,
        aggregateType: "generation",
        aggregateId: "gen-1",
        payload: { blob: "x".repeat(MAX_EVENT_PAYLOAD_BYTES + 100) },
      }),
    /payload too large/
  );
});

test("traceId is carried through when supplied, omitted when not", () => {
  const base = {
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: "gen-1",
    payload: {},
  };
  assert.equal(buildDomainEvent({ ...base, traceId: "trace-1" }).traceId, "trace-1");
  assert.equal(buildDomainEvent(base).traceId, undefined);
});

// ---------------------------------------------------------------------------
// TOPIC CONTRACT
// ---------------------------------------------------------------------------

test("generation events map to the generation topic", () => {
  assert.equal(topicForEventType("generation.created"), EVENT_TOPICS.generation);
  assert.equal(topicForEventType("generation.completed"), EVENT_TOPICS.generation);
  assert.equal(topicForEventType("generation.failed"), EVENT_TOPICS.generation);
});

test("credit, provider, and security events map to their own topics", () => {
  assert.equal(topicForEventType("credit.reserved"), EVENT_TOPICS.credit);
  assert.equal(topicForEventType("credit.settled"), EVENT_TOPICS.credit);
  assert.equal(topicForEventType("provider.submitted"), EVENT_TOPICS.provider);
  assert.equal(topicForEventType("security.warning"), EVENT_TOPICS.security);
});

test("all seven families have a distinct topic - no two families share one", () => {
  const topics = Object.values(EVENT_TOPICS);
  assert.equal(new Set(topics).size, topics.length);
});

test("unknown or malformed domain fails safely - null, never a fallback topic", () => {
  assert.equal(topicForEventType("weather.changed"), null);
  assert.equal(topicForEventType("nodot"), null);
  assert.equal(topicForEventType(""), null);
});

test("familyOf extracts the family or returns null for an unknown one", () => {
  assert.equal(familyOf("generation.completed"), "generation");
  assert.equal(familyOf("audit.recorded"), "audit");
  assert.equal(familyOf("weather.changed"), null);
});
