import "server-only";
import {
  notificationForOutboxRow,
  type NotificationEnvelope,
  type OutboxRow,
} from "@/lib/notification/notification-service";
import { getRealtimePublisher } from "./realtime-redis";
import {
  STREAM_MAXLEN_APPROX,
  retentionMinId,
  streamKeyFor,
} from "./stream-contract";

/**
 * The Notification -> Redis Streams adapter (Phase 11-B).
 *
 * THE ONLY PLACE IN THE REPOSITORY THAT MAY XADD.
 *
 * The roadmap's canonical realtime path is
 * `Outbox -> Notification Service -> Redis Streams -> SSE -> Browser`, and its
 * diagram correction is explicit that no Worker, Media or Provider draws an
 * arrow into the stream. That is enforced two ways: this is the only module
 * that imports a publisher, and a structural test scans the whole tree for
 * `xadd` outside it. A second publisher would mean a second place where the
 * tenant, the payload allowlist and the retention policy could each be wrong.
 *
 * IT DECIDES NOTHING. Validation, tenant resolution and projection all belong
 * to Phase 11-A's `notificationForOutboxRow`; this module calls it and either
 * publishes what it returns or does not. Re-deriving any of that here would
 * create a second answer to a question that already has one.
 *
 * PUBLICATION IS NOT DELIVERY. A successful XADD means the envelope is in a
 * stream a browser may read within the retention window. It does not mean
 * anyone read it, and this module never marks an outbox row published — the
 * outbox publisher owns that, and the row stays recoverable debt until it
 * does. Redis being unreachable is a delivery failure, never a generation
 * failure: nothing here touches generation state, credits, providers or
 * workflows, and it imports nothing that could.
 */

export type PublishOutcome =
  | { published: true; envelope: NotificationEnvelope; streamId: string }
  /** The event was handled and correctly not published. Not an error. */
  | { published: false; reason: "invalid" | "unroutable" | "not_user_facing"; detail?: string }
  /** Redis could not take it. The outbox row remains owed. */
  | { published: false; reason: "transport_unavailable" | "transport_failed"; detail?: string };

/**
 * Publishes one committed outbox row, if 11-A says it may be published.
 *
 * IDEMPOTENCY, HONESTLY DESCRIBED.
 *
 * Outbox delivery is at-least-once, so this can be called twice for one row.
 * `XADD` is not idempotent and cannot be made so — a stream id is assigned by
 * Redis on every append, so a retry produces a SECOND ENTRY. This module does
 * not pretend otherwise.
 *
 * What it guarantees instead is the property that actually matters
 * downstream: **the logical event identity is stable across retries**. Both
 * entries carry the same `eventId`, which is the outbox row's own id and the
 * dedupe identity the event contract already defines. A consumer that has
 * seen an `eventId` can discard the duplicate, and no second DOMAIN event is
 * ever created — only a second copy of the same one.
 *
 * Making the append itself exactly-once would need a per-channel dedupe set
 * and a Lua script to make the check-and-append atomic, and it would still be
 * only as good as that set's own retention. 11-C owns client-side dedupe and
 * the replay contract, and it is the right place to decide whether server-side
 * suppression is worth its cost. Stable identity now is the part 11-C cannot
 * add later; entry-level suppression it can.
 */
/**
 * The minimum a publisher must do. Structural rather than `Redis`, so a test
 * can supply one without a socket — the same dependency-injection shape
 * `drainOutboxOnce` uses for its Kafka producer.
 */
export interface RealtimeStreamPublisher {
  xadd(...args: (string | number)[]): Promise<string | null>;
  xtrim(...args: (string | number)[]): Promise<number>;
}

export async function publishNotification(
  row: OutboxRow,
  /** Defaults to the shared Redis A publisher. Injected only by tests. */
  publisherOverride?: RealtimeStreamPublisher | null
): Promise<PublishOutcome> {
  const outcome = notificationForOutboxRow(row);

  if (outcome.decision === "invalid") {
    return { published: false, reason: "invalid", detail: outcome.reason };
  }
  if (outcome.decision === "unroutable") {
    // A historical row with no captured tenant lands here. It is not
    // broadcast, not queued, and not retried into some other channel.
    return { published: false, reason: "unroutable", detail: outcome.reason };
  }
  if (outcome.decision === "not_user_facing") {
    return { published: false, reason: "not_user_facing", detail: outcome.eventType };
  }

  const publisher =
    publisherOverride !== undefined
      ? publisherOverride
      : (getRealtimePublisher() as RealtimeStreamPublisher | null);
  if (!publisher) {
    return { published: false, reason: "transport_unavailable" };
  }

  const envelope = outcome.envelope;
  const key = streamKeyFor(envelope.channelId);

  try {
    // ONE FIELD. The entry carries the serialized envelope and nothing beside
    // it — no outbox payload, no aggregate row, no provider detail. Whatever
    // 11-A refused to project cannot appear here, because this module never
    // sees it.
    const streamId = await publisher.xadd(
      key,
      "MAXLEN",
      "~",
      STREAM_MAXLEN_APPROX,
      "*",
      "envelope",
      JSON.stringify(envelope)
    );

    if (!streamId) {
      return { published: false, reason: "transport_failed", detail: "no_stream_id" };
    }

    // The exact half of the retention policy. MAXLEN ~ is approximate by
    // design; MINID is what actually enforces fifteen minutes, and it is
    // cheap enough to run on every publish rather than behind a scheduler
    // nobody would remember to enable.
    //
    // A trim failure is not a publish failure: the entry is already durable
    // and the next publish will trim again.
    try {
      await publisher.xtrim(key, "MINID", retentionMinId(Date.now()));
    } catch {
      /* bounded by MAXLEN in the meantime */
    }

    return { published: true, envelope, streamId };
  } catch (error) {
    // Reason class only. Never the key, never the URL, never the payload.
    return {
      published: false,
      reason: "transport_failed",
      detail: error instanceof Error ? error.name : "unknown",
    };
  }
}
