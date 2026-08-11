import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";

/**
 * Cinefield credit system client (Phase 10 — infrastructure only).
 *
 * Thin, typed wrappers around the SECURITY DEFINER SQL functions in
 * `supabase/migrations/20260811120000_credit_system.sql`
 * (reserve_credits / settle_reservation / refund_reservation). These
 * functions are the ONLY place a credit balance may change — EXECUTE on all
 * three is revoked from `anon`/`authenticated` in that migration, so
 * `service_role` (this admin client) is the only caller that can ever reach
 * them. Nothing in this file duplicates their logic; it only calls them.
 *
 * NOT WIRED IN YET
 * No route, activity, or workflow calls these functions today. Adding that
 * wiring requires a real per-model credit price (see pricing.ts's absence
 * from this repo — the pricing catalog handed off alongside this migration
 * referenced model ids that do not exist in this codebase's actual
 * model-registry.ts, so it was deliberately not added). This module exists
 * so that integration, when it happens, calls one reviewed place rather than
 * each caller inventing its own `db.rpc(...)` shape.
 *
 * Postgres remains the source of truth for every balance; nothing here
 * caches or duplicates that state.
 */

export interface ReserveCreditsResult {
  reservationId: string;
  generationId: string | null;
  amount: number;
  /** Present only on a fresh (non-replayed) reservation. */
  balance?: number;
  status: "held" | "settled" | "refunded" | "expired";
  /** True when an existing reservation (same idempotency key) was returned instead of a new one. */
  replayed: boolean;
}

export interface SettleReservationResult {
  reservationId: string;
  status: string;
  /** Absent when this call observed an already-terminal reservation (replayed). */
  charged?: number;
  returned?: number;
  balance?: number;
  replayed?: boolean;
}

export interface RefundReservationResult {
  reservationId: string;
  status: string;
  returned?: number;
  balance?: number;
  replayed?: boolean;
}

/**
 * Reserves credits for one generation attempt. `idempotencyKey` is the
 * caller-supplied identifier for one user intent — the same key replayed
 * (double-click, client retry) returns the original reservation instead of
 * creating a second charge; see the migration's own idempotency review notes
 * for the exact guarantee and its limits.
 */
export async function reserveCredits(params: {
  clerkUserId: string;
  amount: number;
  idempotencyKey: string;
  generationId?: string;
  quote?: Record<string, unknown>;
}): Promise<ReserveCreditsResult> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("reserve_credits", {
    p_user_id: params.clerkUserId,
    p_amount: params.amount,
    p_idempotency_key: params.idempotencyKey,
    p_generation_id: params.generationId ?? null,
    p_quote: params.quote ?? {},
  });

  if (error) throw new Error(`reserve_credits_failed: ${error.message}`);

  return {
    reservationId: data.reservation_id,
    generationId: data.generation_id ?? null,
    amount: data.amount,
    balance: data.balance,
    status: data.status,
    replayed: Boolean(data.replayed),
  };
}

/**
 * Called when the provider reports success. `actualCredits` lets an
 * over-quote be returned automatically; omitting it charges the full quote.
 *
 * Safe to call twice: `settle_reservation` treats a non-'held' reservation
 * as a no-op, which is what makes this callable from a Temporal activity
 * that may be retried after a crash.
 */
export async function settleGeneration(
  reservationId: string,
  actualCredits?: number
): Promise<SettleReservationResult> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("settle_reservation", {
    p_reservation_id: reservationId,
    p_actual_amount: actualCredits ?? null,
  });

  if (error) throw new Error(`settle_reservation_failed: ${error.message}`);

  return {
    reservationId: data.reservation_id,
    status: data.status,
    charged: data.charged,
    returned: data.returned,
    balance: data.balance,
    replayed: data.replayed,
  };
}

/**
 * Called on any terminal failure or cancellation — this is the function that
 * makes "credits vanished and nothing was produced" impossible. Same
 * call-twice safety as settleGeneration.
 */
export async function refundGeneration(
  reservationId: string,
  reason = "generation_failed"
): Promise<RefundReservationResult> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("refund_reservation", {
    p_reservation_id: reservationId,
    p_reason: reason,
  });

  if (error) throw new Error(`refund_reservation_failed: ${error.message}`);

  return {
    reservationId: data.reservation_id,
    status: data.status,
    returned: data.returned,
    balance: data.balance,
    replayed: data.replayed,
  };
}
