/**
 * Phase 16-C admin Billing / Credits contract.
 *
 * ---------------------------------------------------------------------------
 * THE CANONICAL ECONOMIC TRUTH, READ VERBATIM — NEVER RE-DERIVED
 * ---------------------------------------------------------------------------
 * `credit_wallets`, `credit_ledger`, `credit_reservations` (Phase 10,
 * `supabase/migrations/20260811120000_credit_system.sql`) are the one
 * economic ledger truth in this repository. This surface is the FIRST
 * reader of any of them anywhere in the codebase — `src/lib/credits.ts`
 * (the only prior TypeScript module touching these tables) is write/
 * reserve-only and its own header states "NOT WIRED IN YET." This admin
 * service adds narrow, explicit-column SELECTs; it never calls
 * `reserve_credits`/`settle_reservation`/`refund_reservation`/
 * `grant_credits` — those are Phase 10's mutation surface, and Phase 16-C
 * is read-only by default, per its own binding scope.
 *
 * `credit_reconciliation` (same migration, lines ~961-985) is a VIEW, not a
 * table — it joins wallet/ledger/live-reservation sums and computes `ok`
 * (does the wallet balance actually equal the ledger sum, does `reserved`
 * actually equal the sum of held reservations). Reading it gives an
 * operator the single most direct "is this account's economic state
 * internally consistent" signal without this surface re-deriving that
 * check itself — the view's SQL is the one place that comparison is made.
 *
 * ---------------------------------------------------------------------------
 * PHASE 15-B ESTIMATE AND STRIPE ARE DELIBERATELY NOT SHOWN HERE
 * ---------------------------------------------------------------------------
 * Phase 15-B's `cost-contract.ts` is explicit: "THIS IS AN ESTIMATE. IT IS
 * NOT SPEND, AND IT IS NOT MONEY OWED," and a structural test there already
 * enforces that `credit_price_per_unit` (Phase 10) is never read by that
 * module — the separation runs both directions. Merging an estimate number
 * into this ledger-truth view, even side by side, risks exactly the
 * "one cost number" conflation the roadmap forbids; this slice keeps them
 * apart by simply not fetching the estimate here at all. Stripe has zero
 * integration in this repository (no `stripe` dependency, no webhook, no
 * customer/subscription table — confirmed by repository audit) — `
 * STRIPE_NOT_CONFIGURED` is a static fact, not a live check.
 */

export type BillingLookupIdentifierType = "clerk_user_id" | "generation_id";

export interface WalletView {
  readonly clerkUserId: string;
  readonly balance: number;
  readonly reserved: number;
  readonly lifetimeGranted: number;
  readonly lifetimeSpent: number;
  readonly updatedAt: string;
}

export interface ReconciliationView {
  readonly walletBalance: number;
  readonly walletReserved: number;
  readonly ledgerSum: number;
  readonly liveHolds: number;
  readonly ok: boolean;
}

export interface LedgerEntryView {
  readonly id: string;
  readonly entryType: string;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly reservationId: string | null;
  readonly generationId: string | null;
  readonly externalRef: string | null;
  readonly createdAt: string;
}

export interface ReservationView {
  readonly id: string;
  readonly generationId: string | null;
  readonly amount: number;
  readonly status: string;
  readonly expiresAt: string;
  readonly settledAt: string | null;
  readonly createdAt: string;
}

export type BillingAdminResult =
  | { readonly outcome: "INVALID_IDENTIFIER" }
  | { readonly outcome: "LEDGER_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "NO_ACCOUNT" }
  | {
      readonly outcome: "PARTIAL_DATA";
      readonly wallet: WalletView | null;
      readonly reconciliation: ReconciliationView | null;
      readonly ledgerEntries: readonly LedgerEntryView[];
      readonly reservations: readonly ReservationView[];
      readonly reasonCode: string;
    }
  | {
      readonly outcome: "FOUND";
      readonly wallet: WalletView | null;
      readonly reconciliation: ReconciliationView | null;
      readonly ledgerEntries: readonly LedgerEntryView[];
      readonly reservations: readonly ReservationView[];
    };

/** Constant, honest, never a live check — see this file's header. */
export const STRIPE_INTEGRATION_STATE = "STRIPE_NOT_CONFIGURED" as const;

/** `clerk_user_id` shape, mirroring `user-investigation-contract.ts`'s own pattern. */
export const BILLING_CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9_-]{1,60}$/;
/** UUID shape, mirroring `GENERATION_ID_PATTERN`. */
export const BILLING_GENERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function billingIdentifierPatternFor(type: BillingLookupIdentifierType): RegExp {
  return type === "clerk_user_id" ? BILLING_CLERK_USER_ID_PATTERN : BILLING_GENERATION_ID_PATTERN;
}
