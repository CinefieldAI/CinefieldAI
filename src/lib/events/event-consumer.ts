import { validateDomainEvent } from "./schema-registry";
import type { DomainEventEnvelope } from "./domain-event";

/**
 * Cinefield event consumer FOUNDATION (Phase 6R.15).
 *
 * Deliberately contains no business behaviour. There are no notification
 * consumers, no analytics consumers, no side effects of any kind here —
 * inventing them before the events are even produced would bake in
 * assumptions about facts nothing emits yet. What this provides is the part
 * every future consumer must share and must not each reimplement:
 *
 *   1. parse + schema-validate before a handler ever sees the event
 *   2. the deduplication identity (eventId) under at-least-once delivery
 *   3. a safe routing decision for anything invalid
 *   4. trace propagation
 *
 * NO NETWORK. This module does not connect to Kafka. It is the pure decision
 * core a receive loop calls, mirroring how worker/provider-command-handler.ts
 * is separated from the SQS receive loop so it can be tested at zero cost.
 *
 * REJECT vs RETRY — THE DECISION THAT MATTERS
 * A schema violation is NOT retryable: redelivering a malformed event
 * produces the identical malformed event forever, so it must be routed away
 * (DLQ) instead of blocking the partition. Only an infrastructural failure
 * inside a handler is retryable. Getting this backwards is how one bad
 * message stalls a consumer group indefinitely.
 */

export type InboundDecision =
  | { decision: "handle"; event: DomainEventEnvelope; dedupeKey: string; traceId?: string }
  /** Permanently invalid. Route to a dead-letter destination; never redeliver. */
  | { decision: "reject"; reason: string; errors: string[] };

/**
 * Parses and validates one raw message value. Accepts the serialized string
 * a Kafka consumer actually receives.
 *
 * Every rejection reason is a short code and every error is a field
 * LOCATION, never a value, so a consumer can log its refusals in full
 * without leaking payload contents.
 */
export function inspectInboundEvent(raw: string): InboundDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { decision: "reject", reason: "malformed_json", errors: [] };
  }

  const validation = validateDomainEvent(parsed);
  if (!validation.ok) {
    return { decision: "reject", reason: validation.reason, errors: validation.errors };
  }

  const event = parsed as DomainEventEnvelope;
  return {
    decision: "handle",
    event,
    // THE deduplication identity. Stable across every publish retry by
    // construction (domain-event.ts generates it once and the outbox
    // preserves it), which is what makes at-least-once tolerable.
    dedupeKey: event.eventId,
    ...(event.traceId !== undefined ? { traceId: event.traceId } : {}),
  };
}

/**
 * A consumer's idempotency identity. Kept as an explicit function rather
 * than callers reading `.eventId` directly, so the day this needs to become
 * (eventId, consumerGroup) there is exactly one place to change.
 */
export function consumerDedupeKey(event: DomainEventEnvelope): string {
  return event.eventId;
}
