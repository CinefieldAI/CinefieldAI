import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  billingIdentifierPatternFor,
  type BillingAdminResult,
  type BillingLookupIdentifierType,
  type LedgerEntryView,
  type ReconciliationView,
  type ReservationView,
  type WalletView,
} from "./billing-admin-contract";

/**
 * The Phase 16-C admin Billing / Credits read service.
 *
 * ---------------------------------------------------------------------------
 * READ-ONLY. NO RPC IS EVER CALLED HERE.
 * ---------------------------------------------------------------------------
 * `reserve_credits`/`settle_reservation`/`refund_reservation`/
 * `grant_credits` (Phase 10) are Phase 10's own mutation surface — this
 * file only ever `.select()`s `credit_wallets`, `credit_ledger`,
 * `credit_reservations`, and the `credit_reconciliation` view. No
 * `.insert(`, `.update(`, `.upsert(`, `.delete(`, or `.rpc(` exists
 * anywhere in this file.
 *
 * Each identifier axis runs its reads as INDEPENDENT fallible reads, the
 * same defensive discipline every other 16-A/16-B admin service uses: a
 * `credit_ledger` read failure with a real wallet row still present
 * degrades to `PARTIAL_DATA` rather than discarding real evidence.
 */

const MAX_LEDGER_ENTRIES = 20;
const MAX_RESERVATIONS = 20;

interface RawReadResult<T> {
  readonly ok: boolean;
  readonly data: T | null;
}

async function readOne(admin: SupabaseClient, table: string, columns: string, column: string, value: string) {
  try {
    const { data, error } = await admin.from(table).select(columns).eq(column, value).maybeSingle();
    if (error) return { ok: false, data: null } as RawReadResult<Record<string, unknown>>;
    return { ok: true, data: (data as unknown as Record<string, unknown> | null) ?? null } as RawReadResult<Record<string, unknown>>;
  } catch {
    return { ok: false, data: null } as RawReadResult<Record<string, unknown>>;
  }
}

async function readMany(
  admin: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  value: string,
  limit: number
) {
  try {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .eq(column, value)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, data: null } as RawReadResult<Record<string, unknown>[]>;
    return { ok: true, data: (data as unknown as Record<string, unknown>[] | null) ?? [] } as RawReadResult<Record<string, unknown>[]>;
  } catch {
    return { ok: false, data: null } as RawReadResult<Record<string, unknown>[]>;
  }
}

function projectWallet(row: Record<string, unknown>): WalletView {
  return {
    clerkUserId: row.clerk_user_id as string,
    balance: row.balance as number,
    reserved: row.reserved as number,
    lifetimeGranted: Number(row.lifetime_granted),
    lifetimeSpent: Number(row.lifetime_spent),
    updatedAt: row.updated_at as string,
  };
}

function projectReconciliation(row: Record<string, unknown>): ReconciliationView {
  return {
    walletBalance: row.wallet_balance as number,
    walletReserved: row.wallet_reserved as number,
    ledgerSum: row.ledger_sum as number,
    liveHolds: row.live_holds as number,
    ok: row.ok as boolean,
  };
}

function projectLedgerEntries(rows: readonly Record<string, unknown>[]): LedgerEntryView[] {
  return rows.map((row) => ({
    id: row.id as string,
    entryType: row.entry_type as string,
    amount: row.amount as number,
    balanceAfter: row.balance_after as number,
    reservationId: (row.reservation_id as string | null) ?? null,
    generationId: (row.generation_id as string | null) ?? null,
    externalRef: (row.external_ref as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

function projectReservations(rows: readonly Record<string, unknown>[]): ReservationView[] {
  return rows.map((row) => ({
    id: row.id as string,
    generationId: (row.generation_id as string | null) ?? null,
    amount: row.amount as number,
    status: row.status as string,
    expiresAt: row.expires_at as string,
    settledAt: (row.settled_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export async function getAdminBillingView(
  admin: SupabaseClient,
  identifierType: BillingLookupIdentifierType,
  identifierValue: string
): Promise<BillingAdminResult> {
  if (!billingIdentifierPatternFor(identifierType).test(identifierValue)) {
    return { outcome: "INVALID_IDENTIFIER" };
  }

  if (identifierType === "clerk_user_id") {
    const [walletR, reconR, ledgerR, resR] = await Promise.all([
      readOne(admin, "credit_wallets", "clerk_user_id, balance, reserved, lifetime_granted, lifetime_spent, updated_at", "clerk_user_id", identifierValue),
      readOne(admin, "credit_reconciliation", "wallet_balance, wallet_reserved, ledger_sum, live_holds, ok", "clerk_user_id", identifierValue),
      readMany(admin, "credit_ledger", "id, entry_type, amount, balance_after, reservation_id, generation_id, external_ref, created_at", "clerk_user_id", identifierValue, MAX_LEDGER_ENTRIES),
      readMany(admin, "credit_reservations", "id, generation_id, amount, status, expires_at, settled_at, created_at", "clerk_user_id", identifierValue, MAX_RESERVATIONS),
    ]);
    return combine(walletR, reconR, ledgerR, resR);
  }

  const [ledgerR, resR] = await Promise.all([
    readMany(admin, "credit_ledger", "id, entry_type, amount, balance_after, reservation_id, generation_id, external_ref, created_at", "generation_id", identifierValue, MAX_LEDGER_ENTRIES),
    readMany(admin, "credit_reservations", "id, generation_id, amount, status, expires_at, settled_at, created_at", "generation_id", identifierValue, MAX_RESERVATIONS),
  ]);
  return combine({ ok: true, data: null }, { ok: true, data: null }, ledgerR, resR);
}

function combine(
  walletR: RawReadResult<Record<string, unknown>>,
  reconR: RawReadResult<Record<string, unknown>>,
  ledgerR: RawReadResult<Record<string, unknown>[]>,
  resR: RawReadResult<Record<string, unknown>[]>
): BillingAdminResult {
  const anyOk = walletR.ok || reconR.ok || ledgerR.ok || resR.ok;
  if (!anyOk) return { outcome: "LEDGER_UNAVAILABLE", reasonCode: "read_failed" };

  const wallet = walletR.ok && walletR.data ? projectWallet(walletR.data) : null;
  const reconciliation = reconR.ok && reconR.data ? projectReconciliation(reconR.data) : null;
  const ledgerEntries = ledgerR.ok ? projectLedgerEntries(ledgerR.data ?? []) : [];
  const reservations = resR.ok ? projectReservations(resR.data ?? []) : [];

  const allOk = walletR.ok && reconR.ok && ledgerR.ok && resR.ok;
  const hasEvidence = wallet !== null || reconciliation !== null || ledgerEntries.length > 0 || reservations.length > 0;

  if (allOk && !hasEvidence) return { outcome: "NO_ACCOUNT" };
  if (!allOk) return { outcome: "PARTIAL_DATA", wallet, reconciliation, ledgerEntries, reservations, reasonCode: "some_reads_failed" };
  return { outcome: "FOUND", wallet, reconciliation, ledgerEntries, reservations };
}
