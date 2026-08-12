import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { compileSchema, validateAgainstSchema, type JsonSchema } from "./json-schema";
import { EVENT_SCHEMAS, versionsOf } from "./event-schemas";
import { classifyCompatibility, resolveSchema, validateDomainEvent } from "./schema-registry";
import { inspectInboundEvent, consumerDedupeKey } from "./event-consumer";
import { buildDomainEvent } from "./domain-event";
import {
  describeGlueRegistry,
  plannedGlueSchemas,
  syncSchemasToGlue,
  INTENDED_GLUE_COMPATIBILITY,
  INTENDED_GLUE_DATA_FORMAT,
} from "./glue-schema-registry";
import {
  describeSchemaRegistryConfig,
  getSchemaRegistryConfig,
  isSchemaRegistryConfigured,
  isSchemaRegistryEnabled,
} from "./schema-registry-config";

/**
 * Event contract governance tests (Phase 6R.15).
 *
 * Zero AWS. Nothing here connects to Glue, MSK, or any network.
 */

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    ...buildDomainEvent({
      eventType: "generation.completed",
      eventVersion: 1,
      aggregateType: "generation",
      aggregateId: randomUUID(),
      payload: { generationId: randomUUID(), provider: "mock", attemptNo: 1 },
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The subset validator's own contract
// ---------------------------------------------------------------------------

test("an unsupported keyword is REJECTED at compile time, never silently ignored", () => {
  // The whole point: a schema author must never believe a constraint is
  // enforced when the validator does not implement it.
  assert.throws(
    () => compileSchema({ type: "array", items: { type: "string" }, minItems: 1 } as unknown as JsonSchema),
    /unsupported keyword "minItems"/
  );
  assert.throws(
    () => compileSchema({ oneOf: [{ type: "string" }] } as unknown as JsonSchema),
    /unsupported keyword "oneOf"/
  );
});

test("an object schema must close itself - additionalProperties: false is mandatory", () => {
  assert.throws(
    () => compileSchema({ type: "object", properties: { a: { type: "string" } } }),
    /additionalProperties/
  );
});

test("a schema requiring a property it never declares is rejected", () => {
  assert.throws(
    () => compileSchema({ type: "object", additionalProperties: false, required: ["ghost"], properties: {} }),
    /requires "ghost" but never declares it/
  );
});

test("validation errors carry field locations, never values", () => {
  const errors = validateAgainstSchema(
    { secret: "hunter2" },
    { type: "object", additionalProperties: false, properties: {} }
  );
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("/secret"), "the location is reported");
  assert.ok(!errors[0].includes("hunter2"), "the VALUE is never echoed into an error string");
});

// ---------------------------------------------------------------------------
// 15.9 CONTRACT TESTS
// ---------------------------------------------------------------------------

test("known event at a known version is accepted", () => {
  const result = validateDomainEvent(validEvent());
  assert.deepEqual(result, { ok: true, schemaName: "cinefield.generation.completed" });
});

test("unknown VERSION of a known event is rejected, and says so specifically", () => {
  const result = validateDomainEvent(validEvent({ eventVersion: 99 }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "unknown_event_version");

  const resolution = resolveSchema("generation.completed", 99);
  assert.equal(resolution.ok, false);
  assert.deepEqual(resolution.ok === false && resolution.knownVersions, [1], "the known versions are reported");
});

test("unknown EVENT TYPE is rejected as a different problem than an unknown version", () => {
  const result = validateDomainEvent(validEvent({ eventType: "generation.teleported" }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "unknown_event_type");
});

test("a malformed envelope is rejected before any schema is resolved", () => {
  for (const broken of [
    validEvent({ eventId: "not-a-uuid" }),
    validEvent({ occurredAt: "yesterday" }),
    validEvent({ eventVersion: 0 }),
    validEvent({ aggregateId: "" }),
    { eventType: "generation.completed" },
  ]) {
    const result = validateDomainEvent(broken);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(Object.keys(broken))}`);
    assert.equal(result.ok === false && result.reason, "malformed_envelope");
  }
});

test("a payload incompatible with its schema is rejected", () => {
  // Wrong type.
  const wrongType = validateDomainEvent(
    validEvent({ payload: { generationId: randomUUID(), provider: "mock", attemptNo: "one" } })
  );
  assert.equal(wrongType.ok === false && wrongType.reason, "payload_schema_violation");

  // Missing a required field.
  const missing = validateDomainEvent(validEvent({ payload: { generationId: randomUUID() } }));
  assert.equal(missing.ok === false && missing.reason, "payload_schema_violation");

  // An UNDECLARED field — this is the one that keeps secrets off the bus.
  const extra = validateDomainEvent(
    validEvent({
      payload: { generationId: randomUUID(), provider: "mock", attemptNo: 1, authorization: "Bearer x" },
    })
  );
  assert.equal(extra.ok === false && extra.reason, "payload_schema_violation");
  assert.ok(
    (extra.ok === false ? extra.errors : []).some((e) => e.includes("authorization")),
    "the undeclared field is named"
  );
  assert.ok(
    !(extra.ok === false ? extra.errors : []).some((e) => e.includes("Bearer")),
    "but its value never is"
  );
});

test("a valid ADDITIVE optional field is accepted without a version bump", () => {
  // durationMs is optional on generation.completed: present or absent, both valid.
  const withOptional = validateDomainEvent(
    validEvent({ payload: { generationId: randomUUID(), provider: "mock", attemptNo: 1, durationMs: 1200 } })
  );
  assert.equal(withOptional.ok, true);
});

test("eventId and traceId survive the consumer boundary intact", () => {
  const event = buildDomainEvent({
    eventType: "provider.submitted",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: randomUUID(),
    traceId: "trace-abc",
    payload: {
      generationId: randomUUID(),
      attemptId: randomUUID(),
      provider: "mock",
      providerJobId: "mock-job-1",
      submissionEvidence: "job",
    },
  });

  const decision = inspectInboundEvent(JSON.stringify(event));
  assert.equal(decision.decision, "handle");
  if (decision.decision !== "handle") return;
  assert.equal(decision.dedupeKey, event.eventId, "eventId IS the deduplication identity");
  assert.equal(consumerDedupeKey(decision.event), event.eventId);
  assert.equal(decision.traceId, "trace-abc", "the correlation id is propagated");
});

test("a consumer REJECTS an invalid event rather than retrying it forever", () => {
  for (const raw of [
    "{not json",
    JSON.stringify(validEvent({ eventType: "generation.teleported" })),
    JSON.stringify(validEvent({ payload: { generationId: "nope" } })),
  ]) {
    const decision = inspectInboundEvent(raw);
    assert.equal(decision.decision, "reject", "invalid input is routed away, never redelivered");
  }
});

test("no registered schema permits a secret-shaped field", () => {
  const FORBIDDEN = /(secret|token|password|apikey|api_key|authorization|signedurl|signed_url|credential|prompt)/i;
  for (const entry of EVENT_SCHEMAS.values()) {
    for (const field of Object.keys(entry.payload.properties ?? {})) {
      assert.ok(
        !FORBIDDEN.test(field),
        `${entry.schemaName} declares "${field}" — events are retained and widely read`
      );
    }
    assert.equal(
      entry.payload.additionalProperties,
      false,
      `${entry.schemaName} must be closed so an undeclared field cannot ride along`
    );
  }
});

// ---------------------------------------------------------------------------
// 15.3 VERSIONING POLICY
// ---------------------------------------------------------------------------

const BASE: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string" },
    state: { type: "string", enum: ["a", "b"] },
    count: { type: "integer", minimum: 0 },
  },
};

test("compatibility policy: adding an OPTIONAL property needs no version bump", () => {
  const next: JsonSchema = {
    ...BASE,
    properties: { ...BASE.properties, note: { type: "string" } },
  };
  assert.deepEqual(classifyCompatibility(BASE, next), { compatible: true });
});

test("compatibility policy: widening an enum and relaxing a bound need no version bump", () => {
  const next: JsonSchema = {
    ...BASE,
    properties: {
      ...BASE.properties,
      state: { type: "string", enum: ["a", "b", "c"] },
      count: { type: "integer", minimum: -1 },
    },
  };
  assert.deepEqual(classifyCompatibility(BASE, next), { compatible: true });
});

test("compatibility policy: every breaking change is flagged as requiring a version bump", () => {
  const cases: [string, JsonSchema][] = [
    [
      "new required property",
      { ...BASE, required: ["id", "owner"], properties: { ...BASE.properties, owner: { type: "string" } } },
    ],
    ["removed property", { ...BASE, properties: { id: { type: "string" }, state: BASE.properties!.state } }],
    [
      "type changed",
      { ...BASE, properties: { ...BASE.properties, count: { type: "string" } } },
    ],
    [
      "enum narrowed",
      { ...BASE, properties: { ...BASE.properties, state: { type: "string", enum: ["a"] } } },
    ],
    [
      "bound tightened",
      { ...BASE, properties: { ...BASE.properties, count: { type: "integer", minimum: 5 } } },
    ],
    [
      "optional became required",
      { ...BASE, required: ["id", "state"] },
    ],
  ];

  for (const [label, next] of cases) {
    const verdict = classifyCompatibility(BASE, next);
    assert.equal(verdict.compatible, false, `${label} must be classified as breaking`);
  }
});

test("no event type registers two versions without an explicit, deliberate entry", () => {
  // Today every event is at v1. This asserts the registry stays internally
  // consistent as versions are added: versions must be dense from 1.
  for (const eventType of new Set([...EVENT_SCHEMAS.values()].map((s) => s.eventType))) {
    const versions = versionsOf(eventType);
    assert.deepEqual(
      versions,
      versions.map((_, i) => i + 1),
      `${eventType} versions must be dense from 1, got ${versions.join(",")}`
    );
  }
});

// ---------------------------------------------------------------------------
// 15.4 PRODUCER CONTRACT
// ---------------------------------------------------------------------------

test("the producer validates BEFORE sending - an unregistered event never reaches a topic", async () => {
  const { publishDomainEvent } = await import("@/lib/kafka/kafka-producer");

  const sent: unknown[] = [];
  const producer = {
    async send(record: unknown) {
      sent.push(record);
    },
    async disconnect() {},
  };

  const unregistered = buildDomainEvent({
    eventType: "audit.recorded",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: randomUUID(),
    payload: { anything: true },
  });

  const result = await publishDomainEvent(unregistered, producer);
  assert.deepEqual(result, { outcome: "failed", errorCode: "unknown_event_type" });
  assert.equal(sent.length, 0, "nothing was sent");
});

test("the producer refuses a schema-violating payload even when Kafka is healthy", async () => {
  const { publishDomainEvent } = await import("@/lib/kafka/kafka-producer");
  const sent: unknown[] = [];
  const producer = { async send(r: unknown) { sent.push(r); }, async disconnect() {} };

  const bad = buildDomainEvent({
    eventType: "generation.failed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: randomUUID(),
    // errorCode is required and must match the normalized code pattern.
    payload: { generationId: randomUUID(), provider: "mock", errorCode: "it broke" },
  });

  const result = await publishDomainEvent(bad, producer);
  assert.deepEqual(result, { outcome: "failed", errorCode: "payload_schema_violation" });
  assert.equal(sent.length, 0);
});

test("a fully valid event still publishes, carrying its eventId as the message key", async () => {
  const { publishDomainEvent } = await import("@/lib/kafka/kafka-producer");
  const sent: { topic: string; messages: { key: string; value: string }[] }[] = [];
  const producer = {
    async send(r: { topic: string; messages: { key: string; value: string }[] }) {
      sent.push(r);
    },
    async disconnect() {},
  };

  const event = validEvent();
  const result = await publishDomainEvent(event as never, producer);

  assert.equal(result.outcome, "published");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].topic, "generation.events");
  assert.equal(sent[0].messages[0].key, event.eventId, "the dedup identity is the partition key");
});

test("an invalid event is reported as invalid even when no producer exists", async () => {
  const { publishDomainEvent } = await import("@/lib/kafka/kafka-producer");
  const bad = buildDomainEvent({
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: randomUUID(),
    payload: {},
  });
  // Never "unavailable": a caller bug must not hide behind an infra outage.
  const result = await publishDomainEvent(bad, null);
  assert.deepEqual(result, { outcome: "failed", errorCode: "payload_schema_violation" });
});

// ---------------------------------------------------------------------------
// 15.6 / 15.10 GLUE CONFIG AND LIVE STATUS
// ---------------------------------------------------------------------------

test("Glue is disabled by default and no AWS call is even attempted", async () => {
  delete process.env.EVENT_SCHEMA_REGISTRY_ENABLED;
  delete process.env.GLUE_REGISTRY_NAME;

  assert.equal(isSchemaRegistryEnabled(), false);
  assert.equal(getSchemaRegistryConfig(), null);
  assert.deepEqual(describeGlueRegistry(), { status: "disabled" });
  assert.deepEqual(await syncSchemasToGlue(), { status: "disabled" });
});

test("enabled but unconfigured reports unconfigured, not ready and not a crash", async () => {
  process.env.EVENT_SCHEMA_REGISTRY_ENABLED = "true";
  delete process.env.GLUE_REGISTRY_NAME;
  try {
    assert.equal(isSchemaRegistryConfigured(), false);
    assert.deepEqual(describeGlueRegistry(), { status: "unconfigured" });
    assert.deepEqual(await syncSchemasToGlue(), { status: "unconfigured" });
  } finally {
    delete process.env.EVENT_SCHEMA_REGISTRY_ENABLED;
  }
});

test("configured but with no SDK installed reports unavailable - never a fake success", async () => {
  process.env.EVENT_SCHEMA_REGISTRY_ENABLED = "true";
  process.env.AWS_REGION = "eu-central-1";
  process.env.GLUE_REGISTRY_NAME = "cinefield-events";
  try {
    assert.deepEqual(describeGlueRegistry(), {
      status: "ready",
      registryName: "cinefield-events",
      region: "eu-central-1",
    });
    const synced = await syncSchemasToGlue();
    assert.equal(synced.status, "unavailable", "no schema was registered with AWS");
  } finally {
    delete process.env.EVENT_SCHEMA_REGISTRY_ENABLED;
    delete process.env.GLUE_REGISTRY_NAME;
  }
});

test("the config surface never exposes a credential-shaped field", () => {
  const described = describeSchemaRegistryConfig();
  assert.deepEqual(Object.keys(described).sort(), ["configured", "enabled", "region"]);
  // Assert against what the module actually READS, not against prose: the
  // header deliberately names ACCESS_KEY to explain why no such field exists,
  // and a naive substring scan would flag its own documentation.
  const source = require("node:fs").readFileSync(
    require("node:path").join(process.cwd(), "src/lib/events/schema-registry-config.ts"),
    "utf8"
  );
  const envReads = [...source.matchAll(/(?:read\(|process\.env(?:\.|\[["']))\s*["']?([A-Z_][A-Z0-9_]*)/g)].map(
    (m: RegExpMatchArray) => m[1]
  );
  assert.deepEqual(
    [...new Set(envReads)].sort(),
    ["AWS_REGION", "EVENT_SCHEMA_REGISTRY_ENABLED", "GLUE_REGISTRY_NAME"],
    "the config surface reads exactly three non-secret settings and nothing else"
  );
});

test("the planned Glue entries mirror the local registry exactly, in JSON with BACKWARD compatibility", () => {
  const planned = plannedGlueSchemas();
  assert.equal(planned.length, EVENT_SCHEMAS.size, "one Glue entry per locally registered schema");
  for (const entry of planned) {
    assert.equal(entry.dataFormat, INTENDED_GLUE_DATA_FORMAT);
    assert.equal(entry.compatibility, INTENDED_GLUE_COMPATIBILITY);
    assert.ok(entry.schemaName.startsWith("cinefield."));
  }
});
