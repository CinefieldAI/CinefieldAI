import { familyOf, type EventFamily } from "./domain-event";

/**
 * Cinefield Kafka topic contract (Phase 6R.9).
 *
 * The single place every Kafka topic name is defined — the same "one
 * reviewable contract" discipline `src/lib/aws/sqs-topology.ts` applies to
 * SQS queue names, `src/lib/redis/redis-keys.ts` to Redis keys, and
 * `src/lib/bullmq/queue-names.ts` to BullMQ queues. No publisher may write
 * a topic string literal.
 *
 * ONE BROAD TOPIC PER DOMAIN FAMILY, NOT PER EVENT TYPE
 * `generation.created`, `generation.completed`, and `generation.failed` all
 * go to `generation.events`. Fine-grained per-event-type topics would mean
 * dozens of topics, each needing its own partitioning, retention, ACLs and
 * consumer wiring, for no benefit a consumer-side `eventType` filter does
 * not already provide. Families come from the existing `EventFamily` union
 * in src/lib/contracts/event-publisher.ts — this file adds no new domain.
 *
 * UNKNOWN DOMAIN FAILS SAFELY
 * `topicForEventType()` returns null rather than inventing a topic or
 * falling back to a catch-all. A producer that cannot resolve a topic must
 * refuse to publish, never guess where a fact belongs.
 */

export const EVENT_TOPICS: Readonly<Record<EventFamily, string>> = {
  generation: "generation.events",
  provider: "provider.events",
  asset: "asset.events",
  billing: "billing.events",
  credit: "credit.events",
  security: "security.events",
  audit: "audit.events",
} as const;

export type EventTopic = (typeof EVENT_TOPICS)[EventFamily];

/**
 * Deterministic `eventType -> topic` mapping. Returns null for a malformed
 * or unknown-family event type — the caller must treat that as a refusal.
 */
export function topicForEventType(eventType: string): string | null {
  const family = familyOf(eventType);
  if (family === null) return null;
  return EVENT_TOPICS[family];
}
