import "server-only";
import { publishDomainEvent, type KafkaProducerLike, type PublishOutcome } from "@/lib/kafka/kafka-producer";
import {
  claimPendingEvents,
  markFailed,
  markPublished,
  type ClaimOutcome,
  type ClaimedOutboxEvent,
  type ResolveOutcome,
} from "./outbox-repository";

/**
 * Cinefield outbox publisher (Phase 6R.9).
 *
 * Drains a bounded batch of committed outbox events to Kafka. Deliberately
 * NOT a daemon: no loop, no scheduler, no Trigger.dev binding, nothing that
 * starts on import or app boot. `drainOutboxOnce()` is a single pass a
 * future worker or ops job calls on whatever cadence that layer decides —
 * scheduling is not this module's concern.
 *
 * FAILURE IS SAFE BY CONSTRUCTION
 * If Kafka is unavailable or a send fails, the event is returned to
 * `pending` and retried on a later pass. It is never dropped, never marked
 * published, and the already-committed business state that produced it is
 * untouched. That asymmetry — durable fact first, best-effort delivery
 * second — is the whole reason the outbox exists.
 *
 * PER-EVENT RESOLUTION, NOT PER-BATCH
 * Each event is marked published or failed individually. A batch where the
 * third event fails still leaves the first two correctly published, rather
 * than replaying two already-delivered events on the next pass.
 */

export interface DrainResult {
  claimed: number;
  published: number;
  failed: number;
  /** True when Kafka was unconfigured/unreachable — claimed events were all returned to pending. */
  kafkaUnavailable: boolean;
}

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:outbox-publisher]", JSON.stringify(fields));
}

/**
 * The repository operations this publisher needs. Exists as an explicit
 * seam so zero-cost tests can inject an in-memory fake instead of a
 * Supabase connection — the same `testOverride` pattern every Redis store
 * in this project already uses, rather than module-level mocking.
 */
export interface OutboxPublisherRepository {
  claimPendingEvents(limit?: number, leaseSeconds?: number): Promise<ClaimOutcome>;
  markPublished(eventId: string, claimToken: string): Promise<ResolveOutcome>;
  markFailed(eventId: string, claimToken: string, errorCode?: string): Promise<ResolveOutcome>;
}

const defaultRepository: OutboxPublisherRepository = { claimPendingEvents, markPublished, markFailed };

/**
 * Claims up to `limit` pending events and attempts to publish each.
 *
 * `producer` is supplied by the caller (a worker connects one, tests inject
 * a fake, and `null` means Kafka is unavailable) — this module never
 * constructs or owns a Kafka connection itself, so its lifecycle stays
 * explicit and it can be fully tested with no Kafka present.
 */
export async function drainOutboxOnce(
  producer: KafkaProducerLike | null,
  limit = 100,
  testRepositoryOverride?: OutboxPublisherRepository
): Promise<DrainResult> {
  const repository = testRepositoryOverride ?? defaultRepository;
  const claim = await repository.claimPendingEvents(limit);
  if (claim.outcome !== "claimed") {
    return { claimed: 0, published: 0, failed: 0, kafkaUnavailable: false };
  }

  const events: ClaimedOutboxEvent[] = claim.events;
  let published = 0;
  let failed = 0;
  let kafkaUnavailable = false;

  for (const claimed of events) {
    const result: PublishOutcome = await publishDomainEvent(claimed.event, producer);

    if (result.outcome === "published") {
      // A failure to MARK published (not to publish) leaves the row
      // claimed; its lease expires and it is retried — delivering the
      // event twice, which at-least-once semantics already permit and
      // consumers already deduplicate via the stable eventId.
      await repository.markPublished(claimed.event.eventId, claimed.claimToken);
      published += 1;
      continue;
    }

    if (result.outcome === "unavailable") kafkaUnavailable = true;
    const errorCode = result.outcome === "failed" ? result.errorCode : "kafka_unavailable";
    await repository.markFailed(claimed.event.eventId, claimed.claimToken, errorCode);
    failed += 1;
  }

  log({ claimed: events.length, published, failed, kafkaUnavailable });
  return { claimed: events.length, published, failed, kafkaUnavailable };
}
