import "server-only";
import { getKafkaConfig } from "./kafka-config";
import { topicForEventType } from "@/lib/events/event-topics";
import { validateDomainEvent } from "@/lib/events/schema-registry";
import type { DomainEventEnvelope } from "@/lib/events/domain-event";

/**
 * Cinefield Kafka producer foundation (Phase 6R.9).
 *
 * Lazy and server-only: importing this module opens no connection and
 * constructs no client. The Kafka client is `require`d only inside
 * `connectProducer()`, so a build, a test run, or any import that never
 * publishes performs zero network activity — the same discipline Redis A's
 * `redis-client.ts` and Redis B's `bullmq-connection.ts` follow.
 *
 * NOT AUTO-STARTED. Nothing here runs on app startup or import; a producer
 * exists only once a caller explicitly connects one, and that caller owns
 * disconnecting it.
 *
 * SANITIZED FAILURES
 * A raw Kafka error can carry broker addresses and connection details.
 * Callers never receive one — every failure is reduced to
 * `{ outcome: "failed", errorCode }` carrying only the error's class name,
 * and logs record the same sanitized classification, never the message.
 */

/** The narrow surface this module needs — lets tests inject a fake with no Kafka client at all. */
export interface KafkaProducerLike {
  send(record: {
    topic: string;
    messages: { key: string; value: string; headers?: Record<string, string> }[];
  }): Promise<unknown>;
  disconnect(): Promise<void>;
}

export type PublishOutcome =
  | { outcome: "published"; topic: string; eventId: string }
  | { outcome: "unavailable" }
  | { outcome: "failed"; errorCode: string };

function log(fields: Record<string, unknown>): void {
  // Never includes broker addresses, credentials, or a raw error message.
  console.info("[cinefield:kafka-producer]", JSON.stringify(fields));
}

/**
 * Connects a producer, or returns null when Kafka is not
 * enabled/configured. The dynamic require is deliberate: it keeps the
 * native Kafka binding out of every import path that never publishes.
 */
export async function connectProducer(): Promise<KafkaProducerLike | null> {
  const config = getKafkaConfig();
  if (!config) return null;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KafkaJS } = require("@confluentinc/kafka-javascript");
  const kafka = new KafkaJS.Kafka({
    kafkaJS: { brokers: config.brokers, clientId: config.clientId },
  });
  const producer = kafka.producer();
  await producer.connect();
  return producer as KafkaProducerLike;
}

/**
 * Publishes one validated domain event.
 *
 * The message KEY is the stable `eventId` — it is what lets a consumer
 * deduplicate under this system's at-least-once semantics, and it keeps a
 * retried publish of the same event addressable as the same message.
 * The VALUE is the exact validated envelope, serialized — nothing is added,
 * nothing is stripped.
 *
 * Returns `unavailable` when no producer was supplied (Kafka
 * unconfigured), and `failed` with a sanitized code on any send error —
 * never throws a raw Kafka error at the caller.
 */
export async function publishDomainEvent(
  event: DomainEventEnvelope,
  producer: KafkaProducerLike | null
): Promise<PublishOutcome> {
  const topic = topicForEventType(event.eventType);
  if (topic === null) {
    // An unresolvable topic is a contract violation, not a transient
    // condition — refuse rather than guess where the fact belongs.
    return { outcome: "failed", errorCode: "unknown_event_topic" };
  }

  // Phase 6R.15: the schema gate. Nothing reaches a topic without matching a
  // registered contract, checked BEFORE the send rather than discovered by a
  // consumer later — an unschema'd fact on the bus is permanent, because
  // consumers replay history. Ordered before the producer check on purpose:
  // an invalid event is invalid whether or not Kafka happens to be up, and
  // reporting it as merely "unavailable" would hide a caller bug behind an
  // infrastructural one.
  const validation = validateDomainEvent(event);
  if (!validation.ok) {
    log({
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      topic,
      result: "rejected",
      reason: validation.reason,
    });
    return { outcome: "failed", errorCode: validation.reason };
  }

  if (!producer) return { outcome: "unavailable" };

  try {
    await producer.send({
      topic,
      messages: [
        {
          key: event.eventId,
          value: JSON.stringify(event),
          headers: {
            "event-type": event.eventType,
            "event-version": String(event.eventVersion),
            ...(event.traceId ? { "trace-id": event.traceId } : {}),
          },
        },
      ],
    });
    return { outcome: "published", topic, eventId: event.eventId };
  } catch (caught) {
    const errorCode = caught instanceof Error ? caught.name : "UnknownError";
    log({ eventType: event.eventType, topic, result: "failed", error: errorCode });
    return { outcome: "failed", errorCode };
  }
}
