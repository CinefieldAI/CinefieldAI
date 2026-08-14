import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publishNotification, type RealtimeStreamPublisher } from "./notification-stream-adapter";
import type { OutboxRow } from "@/lib/notification/notification-service";
import { reportRealtimeEventUnroutable } from "@/lib/security/security-signals";

/**
 * The realtime outbox dispatcher (Phase 11 closure).
 *
 * ---------------------------------------------------------------------------
 * THE ARROW THAT WAS MISSING
 * ---------------------------------------------------------------------------
 * The roadmap's canonical chain is
 * `Outbox -> Notification Service -> Redis Streams -> SSE -> Browser`, and
 * every link was built and proven except the first arrow. Nothing called
 * `drainOutboxOnce`, and `drainOutboxOnce` targets Kafka anyway, so no code
 * path existed from a committed fact to a browser. Ninety-two events sat
 * pending for a day with `ever_published = 0`. Phase 11 was component-complete
 * and end-to-end dead.
 *
 * This module is that arrow, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * A DELIVERY TRANSPORT, NOT A LIFECYCLE OWNER
 * ---------------------------------------------------------------------------
 * It claims outbox debt, hands each row to the EXISTING Notification Service
 * through the EXISTING stream adapter, and records what happened. It does not
 * create generations, start workflows, submit or retry providers, move
 * credits, release quarantine or mint URLs — and it cannot, because it imports
 * nothing that could. Projection and tenant resolution are not re-derived
 * here: duplicating them would create a second answer to a question 11-A
 * already answers.
 *
 * ---------------------------------------------------------------------------
 * ONE PASS, NO LOOP
 * ---------------------------------------------------------------------------
 * `dispatchRealtimeOnce` performs exactly one claim-and-resolve pass and
 * returns. Cadence belongs to the runtime that hosts it — the same separation
 * `drainOutboxOnce`, `provider-command-handler` and `event-consumer` already
 * use, and the reason every rule below is testable without a socket or a
 * timer.
 */

/** Exactly what the SQL claim returns. */
interface ClaimedRow {
  event_id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  tenant_id: string | null;
  trace_id: string | null;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  realtime_attempts: number;
  realtime_claim_token: string;
}

/**
 * Terminal dispositions, kept distinct because they demand different
 * operational responses. Collapsing them into success/failure would hide the
 * only one that means somebody has to do something.
 */
export type Disposition =
  | "published"
  /** Valid, routable, deliberately not shown. TERMINAL — see below. */
  | "not_user_facing"
  /** No provable tenant. TERMINAL and visible. */
  | "unroutable"
  /** Fails the event contract. TERMINAL. */
  | "invalid";

export interface DispatchResult {
  claimed: number;
  published: number;
  notUserFacing: number;
  unroutable: number;
  invalid: number;
  /** Returned to pending for a later pass. NOT a disposition — still owed. */
  transportFailed: number;
  /** Claim tokens that lost their lease to another dispatcher mid-pass. */
  lostLease: number;
}

export interface DispatchDeps {
  admin: SupabaseClient;
  /** Injected only by tests; production uses the shared Redis A publisher. */
  publisher?: RealtimeStreamPublisher | null;
  limit?: number;
  leaseSeconds?: number;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_LEASE_SECONDS = 60;

/**
 * One claim-and-resolve pass.
 *
 * ORDER IS THE WHOLE CORRECTNESS ARGUMENT:
 *
 *     claim -> validate/project -> XADD -> resolve('published')
 *
 * and never claim -> resolve -> publish. A row is marked delivered only after
 * Redis has accepted it. A crash between the XADD and the resolve therefore
 * leaves the row owed, and the next pass republishes it — producing a second
 * transport entry carrying the SAME `eventId`, which 11-C's client dedupe
 * absorbs. That is at-least-once, chosen deliberately: exactly-once transport
 * would need a distributed transaction across PostgreSQL and Redis, and the
 * stable identity 11-A/11-B preserve makes the duplicate harmless.
 *
 * The alternative failure — mark first, publish second — loses the event
 * silently and forever, with the database confidently reporting success.
 */
export async function dispatchRealtimeOnce(deps: DispatchDeps): Promise<DispatchResult> {
  const { admin, limit = DEFAULT_LIMIT, leaseSeconds = DEFAULT_LEASE_SECONDS } = deps;

  const result: DispatchResult = {
    claimed: 0,
    published: 0,
    notUserFacing: 0,
    unroutable: 0,
    invalid: 0,
    transportFailed: 0,
    lostLease: 0,
  };

  const { data, error } = await admin.rpc("claim_realtime_outbox_events", {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });

  // A claim failure is a database problem, not an event problem. Nothing is
  // resolved, the debt is untouched, and the caller backs off.
  if (error || !Array.isArray(data)) return result;

  const rows = data as ClaimedRow[];
  result.claimed = rows.length;

  for (const row of rows) {
    const outcome = await publishNotification(toOutboxRow(row), deps.publisher);

    if (outcome.published) {
      if (await resolve(admin, row, "published")) result.published += 1;
      else result.lostLease += 1;
      continue;
    }

    switch (outcome.reason) {
      // TERMINAL. A valid event with no browser projection — asset safety,
      // provider internals. Retrying a correct decision forever is a busy
      // loop wearing the costume of reliability.
      case "not_user_facing":
        if (await resolve(admin, row, "not_user_facing")) result.notUserFacing += 1;
        else result.lostLease += 1;
        break;

      // TERMINAL AND VISIBLE. No provable tenant. It is never broadcast, never
      // sent to a fallback channel, and never guessed at. It is terminal
      // because the condition is structural: a row's tenant is captured at
      // emit time or not at all, so a later pass would reach the identical
      // conclusion. The debt view counts these so an emitter that forgot to
      // capture a tenant is visible rather than retried into silence.
      case "unroutable":
        // Phase 12-C. The debt view already counts these; this makes each one
        // an individually inspectable row, because "twelve events went
        // nowhere" and "twelve events belonging to this event type went
        // nowhere over three hours" are different facts and only the second
        // finds the emitter that forgot to capture a tenant.
        //
        // No tenant exists by definition, so no user is told and none could
        // be — the row is operator evidence and nothing else.
        reportRealtimeEventUnroutable({ eventType: row.event_type, eventId: row.event_id });
        if (await resolve(admin, row, "unroutable", "tenant_unprovable")) result.unroutable += 1;
        else result.lostLease += 1;
        break;

      // TERMINAL. Redelivering a malformed event reproduces it identically
      // forever. The evidence is preserved: the row stays, with its reason.
      case "invalid":
        if (await resolve(admin, row, "invalid", "event_contract_violation")) result.invalid += 1;
        else result.lostLease += 1;
        break;

      // NOT terminal, and NOT marked delivered. The row returns to pending
      // with its attempt count already incremented, so a permanently failing
      // transport shows as a rising number rather than as silence.
      case "transport_unavailable":
      case "transport_failed":
        if (await release(admin, row, "realtime_transport")) result.transportFailed += 1;
        else result.lostLease += 1;
        break;
    }
  }

  return result;
}

/** Rebuilt from named columns, so a new column cannot ride along downstream. */
function toOutboxRow(row: ClaimedRow): OutboxRow {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    occurredAt: row.occurred_at,
    tenantId: row.tenant_id,
    traceId: row.trace_id,
    payload: row.payload ?? {},
  };
}

/**
 * Both completions are claim-token verified in SQL, and both return false
 * when the token no longer matches — a dispatcher whose lease expired and was
 * reclaimed cannot overwrite the new owner's work. Losing a lease is a normal
 * recovery outcome, counted rather than raised.
 */
async function resolve(
  admin: SupabaseClient,
  row: ClaimedRow,
  disposition: Disposition,
  errorCode?: string
): Promise<boolean> {
  const { data, error } = await admin.rpc("resolve_realtime_outbox_event", {
    p_event_id: row.event_id,
    p_claim_token: row.realtime_claim_token,
    p_disposition: disposition,
    p_error_code: errorCode ?? null,
  });
  return !error && data === true;
}

async function release(admin: SupabaseClient, row: ClaimedRow, errorCode: string): Promise<boolean> {
  const { data, error } = await admin.rpc("release_realtime_outbox_event", {
    p_event_id: row.event_id,
    p_claim_token: row.realtime_claim_token,
    p_error_code: errorCode,
  });
  return !error && data === true;
}

/**
 * The debt view, for operations.
 *
 * Counts and ages only — no payload, no tenant, no event id. An operational
 * metric that carries a user's content is a data leak with a dashboard in
 * front of it. Phase 13 owns observability; this is the shape it can read
 * without the dispatcher having to grow one.
 */
export interface RealtimeDebt {
  pending: number;
  dispatching: number;
  oldestPendingSeconds: number;
  maxAttempts: number;
  published: number;
  notUserFacing: number;
  unroutable: number;
  invalid: number;
  retired: number;
  withTransportError: number;
}

export async function readRealtimeDebt(admin: SupabaseClient): Promise<RealtimeDebt | null> {
  const { data, error } = await admin.rpc("realtime_outbox_debt");
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const row = data[0] as Record<string, number>;
  return {
    pending: Number(row.pending ?? 0),
    dispatching: Number(row.dispatching ?? 0),
    oldestPendingSeconds: Number(row.oldest_pending_seconds ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    published: Number(row.published ?? 0),
    notUserFacing: Number(row.not_user_facing ?? 0),
    unroutable: Number(row.unroutable ?? 0),
    invalid: Number(row.invalid ?? 0),
    retired: Number(row.retired ?? 0),
    withTransportError: Number(row.with_transport_error ?? 0),
  };
}
