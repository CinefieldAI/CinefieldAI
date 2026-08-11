/**
 * Cinefield domain event envelope (Phase 6R.9).
 *
 * No network, no I/O — pure types + validation, safe to import from
 * producers, the outbox repository, and their tests alike.
 *
 * EXTENDS, NOT REPLACES, THE EXISTING CONTRACT
 * `src/lib/contracts/event-publisher.ts` (Phase 6R.2) already defined the
 * `EventFamily` union and a `DomainEvent` shape, and its own comment says
 * the outbox implementation arrives in Phase 6R.9. This module is that
 * implementation's envelope: it REUSES `EventFamily` from that contract
 * rather than declaring a competing copy, and adds the two fields a
 * durable outbox row genuinely needs and the in-memory contract lacked —
 * an explicit `eventVersion` and an `aggregateType`.
 *
 * WHAT MAY TRAVEL IN AN EVENT
 * Identifiers, enums, timestamps, numbers. Never a secret, an
 * authorization header, a signed URL, a temporary provider URL, a raw
 * provider payload, a prompt, or media. Events are retained, replayed and
 * read by many consumers — anything in one should be treated as
 * permanently disclosed internally. Enforced structurally below: the
 * payload must be plain JSON (no functions, classes, or binary) and is
 * size-bounded.
 *
 * SEMANTICS BOUNDARY (see also src/lib/bullmq/bullmq-config.ts's header)
 *   SQS         commands — "do this work", not yet done
 *   BullMQ      short retryable background work
 *   Kafka/MSK   FACTS THAT ALREADY HAPPENED — this module
 * An event is immutable history. It never instructs anyone to do anything;
 * zero or many consumers may react, and none of them can change the
 * outcome.
 */

import type { EventFamily } from "@/lib/contracts/event-publisher";

export type { EventFamily };

/** Technical ceiling for one event payload — keeps outbox rows and Kafka messages sane. Matches the DB CHECK in 20260812130000_outbox_events.sql. */
export const MAX_EVENT_PAYLOAD_BYTES = 65_536;

/** Bounded, safe-charset identifier — same discipline as every other Cinefield wire/keyspace contract. */
const AGGREGATE_ID_PATTERN = /^[A-Za-z0-9_:-]{1,200}$/;
/** e.g. "generation.completed" — family prefix, dotted, bounded. */
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

const KNOWN_FAMILIES: ReadonlySet<string> = new Set<EventFamily>([
  "generation",
  "provider",
  "asset",
  "billing",
  "credit",
  "security",
  "audit",
]);

export interface DomainEventEnvelope {
  /** Stable across every publish retry. THE consumer deduplication identity. */
  eventId: string;
  /** Dotted `<family>.<name>`, e.g. "generation.completed". */
  eventType: string;
  /** Explicit positive integer. Bumped when an event's payload shape changes incompatibly. */
  eventVersion: number;
  /** What kind of thing the aggregateId refers to, e.g. "generation". */
  aggregateType: string;
  /** Ordering/partition key — events for one aggregate stay in order. */
  aggregateId: string;
  /** When the fact became true, not when it was published. */
  occurredAt: string;
  /** Correlation id, matching the SQS command wire's existing `traceId` convention. */
  traceId?: string;
  payload: Record<string, unknown>;
}

export type BuildEventInput = {
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  traceId?: string;
  /** Supply ONLY to preserve identity across an application-level retry. Otherwise generated. */
  eventId?: string;
  /** Supply ONLY when the fact's real time differs from now. Otherwise generated. */
  occurredAt?: string;
};

/** The family segment of a dotted event type, or null when malformed/unknown. */
export function familyOf(eventType: string): EventFamily | null {
  const family = eventType.split(".")[0];
  return KNOWN_FAMILIES.has(family) ? (family as EventFamily) : null;
}

/**
 * Rejects anything that is not plain, serializable JSON — functions,
 * classes, Symbols, BigInt, Date objects, binary blobs. A payload that
 * cannot round-trip through JSON cannot be stored in an outbox row or sent
 * to Kafka, and silently coercing it would corrupt the event.
 */
function assertPlainJson(payload: Record<string, unknown>): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new Error("domain-event: payload is not JSON-serializable");
  }
  if (serialized === undefined) {
    throw new Error("domain-event: payload is not JSON-serializable");
  }
  // JSON.stringify silently DROPS functions/undefined/Symbols rather than
  // throwing, so a round-trip comparison is what actually catches them.
  const roundTripped = JSON.stringify(JSON.parse(serialized));
  if (roundTripped !== serialized) {
    throw new Error("domain-event: payload is not JSON-serializable");
  }
  for (const value of Object.values(payload)) {
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw new Error("domain-event: payload is not JSON-serializable");
    }
  }
  return serialized;
}

/**
 * Builds and fully validates a domain event envelope. Throws synchronously
 * for any contract violation — an invalid event is a caller bug, never a
 * runtime condition to be swallowed.
 *
 * `eventId` and `occurredAt` are server-generated unless explicitly
 * supplied; supplying `eventId` is how a retry preserves the SAME identity
 * so consumers still deduplicate correctly.
 */
export function buildDomainEvent(input: BuildEventInput): DomainEventEnvelope {
  if (!EVENT_TYPE_PATTERN.test(input.eventType)) {
    throw new Error("domain-event: invalid eventType");
  }
  if (familyOf(input.eventType) === null) {
    throw new Error("domain-event: unknown event family");
  }
  if (!Number.isInteger(input.eventVersion) || input.eventVersion < 1) {
    throw new Error("domain-event: invalid eventVersion");
  }
  if (!AGGREGATE_ID_PATTERN.test(input.aggregateType)) {
    throw new Error("domain-event: invalid aggregateType");
  }
  if (!AGGREGATE_ID_PATTERN.test(input.aggregateId)) {
    throw new Error("domain-event: invalid aggregateId");
  }
  if (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload)) {
    throw new Error("domain-event: payload must be a plain object");
  }

  const serialized = assertPlainJson(input.payload);
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVENT_PAYLOAD_BYTES) {
    throw new Error("domain-event: payload too large");
  }

  if (input.occurredAt !== undefined && Number.isNaN(Date.parse(input.occurredAt))) {
    throw new Error("domain-event: invalid occurredAt");
  }

  return {
    eventId: input.eventId ?? crypto.randomUUID(),
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
    payload: input.payload,
  };
}
