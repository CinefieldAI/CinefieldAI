import "server-only";
import { validateDomainEvent } from "@/lib/events/schema-registry";
import type { DomainEventEnvelope } from "@/lib/events/domain-event";
import { channelForTenant, type ChannelId } from "./channel-identity";
import { projectEvent, type NotificationProjection } from "./event-projection";

/**
 * The Notification Service (Phase 11-A).
 *
 * Postgres Outbox -> [ THIS ] -> Redis Streams -> SSE Gateway -> Browser
 *                       ^
 *                       this batch ends here
 *
 * NO NETWORK, ON PURPOSE. There is no Redis import in this file and no SSE
 * anywhere in this batch. This is the pure decision core a future stream
 * adapter will call — the same separation `event-consumer.ts` has from a Kafka
 * receive loop, and `provider-command-handler.ts` has from the SQS loop. It
 * means every rule below is testable at zero cost and cannot be quietly
 * bypassed by a transport that decides to "handle it itself".
 *
 * NOT A LIFECYCLE OWNER. It reads committed facts and returns an envelope. It
 * cannot mutate generation state, settle or release credits, call a provider,
 * start a Temporal workflow, write a provider attempt, release a quarantine,
 * or mint a signed URL — not by policy but by construction: it takes a row and
 * returns a value, and imports nothing that could do any of those things.
 *
 * THREE REFUSALS, AND THEY ARE NOT THE SAME
 *   invalid          the event does not satisfy its registered schema. A
 *                    permanent fault: redelivering produces the identical bad
 *                    event forever, so it must be routed away, never retried.
 *   unroutable       the event is valid but its tenant was never captured, or
 *                    was captured malformed. It is NOT broadcast anywhere.
 *   not_user_facing  valid, routable, and deliberately not shown — asset
 *                    safety decisions and provider internals.
 *
 * Collapsing these into one "skip" would hide an operational problem inside a
 * normal outcome. `unroutable` in particular is a signal that an emitter
 * forgot to capture a tenant, and it must be visible as itself.
 *
 * WHY THERE IS NO FALLBACK CHANNEL
 * The obvious convenience — route unknown-tenant events to an admin or global
 * channel so nothing is "lost" — is precisely a cross-tenant leak with a
 * friendly name. An event whose owner cannot be proven has exactly one correct
 * destination: nowhere.
 */

export interface OutboxRow {
  eventId: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  /** Captured by `emit_outbox_event` inside the emitting transaction. */
  tenantId: string | null;
  traceId?: string | null;
  payload: Record<string, unknown>;
}

/**
 * What a stream adapter will publish. Carries the identity 11-C needs for
 * dedupe and correlation, and nothing a browser should not see.
 *
 * DELIBERATELY NO `seq` FIELD. 11-C owns ordering — monotonic per-channel
 * `event_seq`, `Last-Event-ID` resume, the replay window. A Redis Stream entry
 * id is monotonic per stream and channel maps to stream, so it is a strong
 * CANDIDATE for that cursor, but recording a candidate is not the same as
 * deciding, and putting a `seq` here now would lock the architecture to it
 * before 11-C has weighed replay-window trimming against it. `eventId` is
 * carried instead: it is already the at-least-once dedupe identity, and 11-C
 * can add its cursor alongside without renegotiating this envelope.
 */
export interface NotificationEnvelope {
  /** Stable across retries. THE dedupe identity, per the event contract. */
  eventId: string;
  channelId: ChannelId;
  /** Server-derived; present so a stream adapter can re-check before publishing. */
  tenantId: string;
  eventType: string;
  occurredAt: string;
  /** Correlation only. Absent when the producer had none. */
  traceId?: string;
  projection: NotificationProjection;
}

export type NotificationOutcome =
  | { decision: "publish"; envelope: NotificationEnvelope }
  | { decision: "invalid"; reason: string; errors: string[] }
  | { decision: "unroutable"; reason: "tenant_missing" | "tenant_malformed"; eventId: string }
  | { decision: "not_user_facing"; eventType: string; eventId: string };

/**
 * The whole service. One committed outbox row in, one decision out.
 *
 * Order matters and is not arbitrary: validate BEFORE resolving a tenant, so a
 * malformed event can never reach channel logic; resolve the tenant BEFORE
 * projecting, so an unroutable event is never even shaped for delivery.
 */
export function notificationForOutboxRow(row: OutboxRow): NotificationOutcome {
  // 1. Schema first. The envelope is rebuilt from named fields rather than
  //    passed through, so a column added to outbox_events later cannot ride
  //    along into validation or out to a consumer.
  const candidate = {
    eventId: row.eventId,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    occurredAt: row.occurredAt,
    ...(row.traceId ? { traceId: row.traceId } : {}),
    payload: row.payload ?? {},
  };

  const validation = validateDomainEvent(candidate);
  if (!validation.ok) {
    return { decision: "invalid", reason: validation.reason, errors: validation.errors };
  }

  const event = candidate as DomainEventEnvelope;

  // 2. Tenant. Refuses; never falls back.
  const channel = channelForTenant(row.tenantId);
  if (!channel.ok) {
    return { decision: "unroutable", reason: channel.reason, eventId: row.eventId };
  }

  // 3. Projection. Allowlisted fields only.
  const projected = projectEvent(event);
  if (!projected.ok) {
    return { decision: "not_user_facing", eventType: row.eventType, eventId: row.eventId };
  }

  return {
    decision: "publish",
    envelope: {
      eventId: row.eventId,
      channelId: channel.channelId,
      tenantId: channel.tenantId,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      ...(row.traceId ? { traceId: row.traceId } : {}),
      projection: projected.projection,
    },
  };
}
