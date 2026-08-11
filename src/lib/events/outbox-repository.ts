import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import type { DomainEventEnvelope } from "./domain-event";

/**
 * Cinefield outbox repository (Phase 6R.9).
 *
 * Server-only. Every function goes through the service-role Supabase
 * client and the SECURITY DEFINER functions in
 * `supabase/migrations/20260812130000_outbox_events.sql` — `outbox_events`
 * has RLS enabled with no `authenticated` policy, so the browser cannot
 * read or write it, and every function's EXECUTE is revoked from the
 * browser roles. A trusted domain event can only ever originate
 * server-side.
 *
 * ===========================================================================
 * WHAT IS AND IS NOT TRANSACTIONAL — READ BEFORE RELYING ON THIS
 * ===========================================================================
 * `enqueueEventStandalone()` below inserts an outbox row in its OWN
 * transaction. That is NOT the transactional-outbox guarantee: it is
 * useful only when there is no accompanying business mutation (or for
 * tests).
 *
 * The real guarantee comes from calling the SQL function
 * `emit_outbox_event()` from INSIDE another PL/pgSQL function that is
 * performing the business mutation, so both share that function's single
 * implicit transaction. No TypeScript sequence of two Supabase calls can
 * reproduce it — PostgREST cannot span a transaction across two HTTP
 * requests. See the migration's own header for the full explanation.
 *
 * AT-LEAST-ONCE
 * A publisher can succeed at Kafka and crash before marking the row
 * published; the row is then retried and the event delivered twice.
 * `eventId` is stable across every retry so consumers can deduplicate.
 * Nothing here provides exactly-once processing or exactly-once effects.
 */

export interface ClaimedOutboxEvent {
  event: DomainEventEnvelope;
  publishAttempts: number;
  /** Proves ownership of this row's claim. Required to resolve it. Never logged. */
  claimToken: string;
}

export type EnqueueOutcome = { outcome: "enqueued"; eventId: string } | { outcome: "failed"; errorCode: string };
export type ClaimOutcome = { outcome: "claimed"; events: ClaimedOutboxEvent[] } | { outcome: "failed"; errorCode: string };
export type ResolveOutcome = { outcome: "resolved" } | { outcome: "not_owner" } | { outcome: "failed"; errorCode: string };

function log(fields: Record<string, unknown>): void {
  // Never includes claimToken, payload contents, or a raw error message.
  console.info("[cinefield:outbox]", JSON.stringify(fields));
}

/**
 * Inserts an outbox row on its own — NOT transactionally joined to any
 * business mutation (see this module's header). Use only when there is no
 * accompanying state change to be atomic with.
 */
export async function enqueueEventStandalone(event: DomainEventEnvelope): Promise<EnqueueOutcome> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("emit_outbox_event", {
    p_event_type: event.eventType,
    p_event_version: event.eventVersion,
    p_aggregate_type: event.aggregateType,
    p_aggregate_id: event.aggregateId,
    p_payload: event.payload,
    p_trace_id: event.traceId ?? null,
    p_event_id: event.eventId,
    p_occurred_at: event.occurredAt,
  });

  if (error) {
    log({ eventType: event.eventType, op: "enqueue", result: "failed" });
    return { outcome: "failed", errorCode: "enqueue_failed" };
  }
  return { outcome: "enqueued", eventId: String(data) };
}

/**
 * Atomically claims a batch of pending events. Two concurrent publishers
 * can never receive the same row — the SQL function uses
 * `FOR UPDATE SKIP LOCKED` inside its own transaction. Rows whose claim
 * lease has expired (a crashed publisher) are reclaimable, so nothing is
 * stranded.
 */
export async function claimPendingEvents(limit = 100, leaseSeconds = 300): Promise<ClaimOutcome> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_outbox_events", {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    log({ op: "claim", result: "failed" });
    return { outcome: "failed", errorCode: "claim_failed" };
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const events: ClaimedOutboxEvent[] = rows.map((row) => ({
    event: {
      eventId: String(row.event_id),
      eventType: String(row.event_type),
      eventVersion: Number(row.event_version),
      aggregateType: String(row.aggregate_type),
      aggregateId: String(row.aggregate_id),
      occurredAt: String(row.occurred_at),
      ...(row.trace_id ? { traceId: String(row.trace_id) } : {}),
      payload: (row.payload ?? {}) as Record<string, unknown>,
    },
    publishAttempts: Number(row.publish_attempts),
    claimToken: String(row.claim_token),
  }));

  return { outcome: "claimed", events };
}

/** Marks an event published. Claim-token-verified: a stale publisher cannot resolve a row another now owns. */
export async function markPublished(eventId: string, claimToken: string): Promise<ResolveOutcome> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("mark_outbox_event_published", {
    p_event_id: eventId,
    p_claim_token: claimToken,
  });

  if (error) {
    log({ eventId, op: "mark_published", result: "failed" });
    return { outcome: "failed", errorCode: "mark_published_failed" };
  }
  return data === true ? { outcome: "resolved" } : { outcome: "not_owner" };
}

/**
 * Returns an event to `pending` after a failed publish. The event is NEVER
 * dropped and never marked published — Kafka being unavailable must leave
 * the durable event intact for retry, which is the entire reason the
 * outbox exists.
 */
export async function markFailed(eventId: string, claimToken: string, errorCode?: string): Promise<ResolveOutcome> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("mark_outbox_event_failed", {
    p_event_id: eventId,
    p_claim_token: claimToken,
    p_error_code: errorCode ?? null,
  });

  if (error) {
    log({ eventId, op: "mark_failed", result: "failed" });
    return { outcome: "failed", errorCode: "mark_failed_failed" };
  }
  return data === true ? { outcome: "resolved" } : { outcome: "not_owner" };
}
