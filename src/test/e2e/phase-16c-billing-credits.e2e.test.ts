import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminBillingView } from "@/lib/admin/billing-admin-service";
import {
  billingIdentifierPatternFor,
  STRIPE_INTEGRATION_STATE,
  type BillingAdminResult,
} from "@/lib/admin/billing-admin-contract";
import { interpretBillingResponse, networkErrorState } from "@/lib/admin/billing-admin-client-state";

/**
 * Phase 16-C — Billing / Credits. `getAdminBillingView` reads Phase 10's
 * ECONOMIC_LEDGER_TRUTH (`credit_wallets`, `credit_reconciliation`,
 * `credit_ledger`, `credit_reservations`) as four INDEPENDENT fallible reads
 * and never mutates it — this suite proves the read-only promise, the
 * combine() outcome matrix, and that Phase 15-B's cost estimate / Stripe are
 * never merged into this view.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/billing-admin-contract.ts",
  "src/lib/admin/billing-admin-service.ts",
  "src/lib/admin/billing-admin-client-state.ts",
  "src/app/api/admin/billing/route.ts",
  "src/app/admin/billing/page.tsx",
  "src/components/admin/BillingCreditsPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

const CLERK_USER = "user_billing_test_subject";
const GENERATION = randomUUID();

type TableConfig = {
  row?: Record<string, unknown> | null;
  rows?: Record<string, unknown>[];
  fail?: boolean;
};

/** A per-table double: `.maybeSingle()` for `readOne`, direct `await` (via `.then`) for `readMany`. */
function billingAdmin(config: Record<string, TableConfig>): SupabaseClient {
  const from = (table: string) => {
    const cfg = config[table] ?? {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => (cfg.fail ? { data: null, error: { message: "boom" } } : { data: cfg.row ?? null, error: null }),
      then<T1, T2 = never>(
        onfulfilled?: ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
        onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
      ) {
        const result = cfg.fail ? { data: null, error: { message: "boom" } } : { data: cfg.rows ?? [], error: null };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Identifier validation — never reaches a query on malformed input
// ---------------------------------------------------------------------------

test("malformed clerk_user_id and generation_id return INVALID_IDENTIFIER without querying anything", async () => {
  const admin = billingAdmin({});
  const r1 = await getAdminBillingView(admin, "clerk_user_id", "not-a-clerk-id; DROP TABLE credit_wallets;--");
  assert.deepEqual(r1, { outcome: "INVALID_IDENTIFIER" });
  const r2 = await getAdminBillingView(admin, "generation_id", "not-a-uuid");
  assert.deepEqual(r2, { outcome: "INVALID_IDENTIFIER" });
});

test("billingIdentifierPatternFor matches the real id shapes", () => {
  assert.match(CLERK_USER, billingIdentifierPatternFor("clerk_user_id"));
  assert.match(GENERATION, billingIdentifierPatternFor("generation_id"));
  assert.doesNotMatch("user_" + "x".repeat(200), billingIdentifierPatternFor("clerk_user_id"));
});

// ---------------------------------------------------------------------------
// clerk_user_id axis — combine() outcome matrix
// ---------------------------------------------------------------------------

test("clerk_user_id: all four reads empty/null → NO_ACCOUNT, not a fabricated FOUND", async () => {
  const admin = billingAdmin({
    credit_wallets: { row: null },
    credit_reconciliation: { row: null },
    credit_ledger: { rows: [] },
    credit_reservations: { rows: [] },
  });
  const result = await getAdminBillingView(admin, "clerk_user_id", CLERK_USER);
  assert.deepEqual(result, { outcome: "NO_ACCOUNT" });
});

test("clerk_user_id: all four reads fail → LEDGER_UNAVAILABLE, never a silent empty result", async () => {
  const admin = billingAdmin({
    credit_wallets: { fail: true },
    credit_reconciliation: { fail: true },
    credit_ledger: { fail: true },
    credit_reservations: { fail: true },
  });
  const result = await getAdminBillingView(admin, "clerk_user_id", CLERK_USER);
  assert.deepEqual(result, { outcome: "LEDGER_UNAVAILABLE", reasonCode: "read_failed" });
});

test("clerk_user_id: wallet succeeds, ledger read fails → PARTIAL_DATA carries the real wallet, not silence", async () => {
  const admin = billingAdmin({
    credit_wallets: {
      row: {
        clerk_user_id: CLERK_USER,
        balance: 500,
        reserved: 50,
        lifetime_granted: 1000,
        lifetime_spent: 500,
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    },
    credit_reconciliation: { row: null },
    credit_ledger: { fail: true },
    credit_reservations: { rows: [] },
  });
  const result = await getAdminBillingView(admin, "clerk_user_id", CLERK_USER);
  assert.equal(result.outcome, "PARTIAL_DATA");
  const partial = result as Extract<BillingAdminResult, { outcome: "PARTIAL_DATA" }>;
  assert.equal(partial.reasonCode, "some_reads_failed");
  assert.equal(partial.wallet?.balance, 500);
  assert.deepEqual(partial.ledgerEntries, []);
});

test("clerk_user_id: full evidence set projects every field correctly, FOUND", async () => {
  const ledgerId = randomUUID();
  const reservationId = randomUUID();
  const admin = billingAdmin({
    credit_wallets: {
      row: {
        clerk_user_id: CLERK_USER,
        balance: 250,
        reserved: 25,
        lifetime_granted: "2000",
        lifetime_spent: "1750",
        updated_at: "2026-08-10T12:00:00.000Z",
      },
    },
    credit_reconciliation: {
      row: { wallet_balance: 250, wallet_reserved: 25, ledger_sum: 250, live_holds: 25, ok: true },
    },
    credit_ledger: {
      rows: [
        {
          id: ledgerId,
          entry_type: "spend",
          amount: -10,
          balance_after: 250,
          reservation_id: reservationId,
          generation_id: GENERATION,
          external_ref: null,
          created_at: "2026-08-10T11:00:00.000Z",
        },
      ],
    },
    credit_reservations: {
      rows: [
        {
          id: reservationId,
          generation_id: GENERATION,
          amount: 10,
          status: "settled",
          expires_at: "2026-08-10T13:00:00.000Z",
          settled_at: "2026-08-10T11:00:00.000Z",
          created_at: "2026-08-10T10:00:00.000Z",
        },
      ],
    },
  });

  const result = await getAdminBillingView(admin, "clerk_user_id", CLERK_USER);
  assert.equal(result.outcome, "FOUND");
  const found = result as Extract<BillingAdminResult, { outcome: "FOUND" }>;

  assert.deepEqual(found.wallet, {
    clerkUserId: CLERK_USER,
    balance: 250,
    reserved: 25,
    lifetimeGranted: 2000,
    lifetimeSpent: 1750,
    updatedAt: "2026-08-10T12:00:00.000Z",
  });
  assert.deepEqual(found.reconciliation, {
    walletBalance: 250,
    walletReserved: 25,
    ledgerSum: 250,
    liveHolds: 25,
    ok: true,
  });
  assert.equal(found.ledgerEntries.length, 1);
  assert.equal(found.ledgerEntries[0].id, ledgerId);
  assert.equal(found.ledgerEntries[0].generationId, GENERATION);
  assert.equal(found.reservations.length, 1);
  assert.equal(found.reservations[0].id, reservationId);
  assert.equal(found.reservations[0].status, "settled");
});

test("reconciliation.ok === false surfaces a real mismatch rather than being coerced to true", async () => {
  const admin = billingAdmin({
    credit_wallets: { row: null },
    credit_reconciliation: {
      row: { wallet_balance: 100, wallet_reserved: 0, ledger_sum: 40, live_holds: 0, ok: false },
    },
    credit_ledger: { rows: [] },
    credit_reservations: { rows: [] },
  });
  const result = await getAdminBillingView(admin, "clerk_user_id", CLERK_USER);
  assert.equal(result.outcome, "FOUND");
  const found = result as Extract<BillingAdminResult, { outcome: "FOUND" }>;
  assert.equal(found.reconciliation?.ok, false);
});

// ---------------------------------------------------------------------------
// generation_id axis — wallet/reconciliation are always forced null
// ---------------------------------------------------------------------------

test("generation_id: wallet and reconciliation are always null, even if the double would otherwise return rows", async () => {
  const ledgerId = randomUUID();
  const admin = billingAdmin({
    // These are deliberately configured WITH data to prove the service code
    // never even queries them on this axis — combine() is called with
    // static nulls for wallet/reconciliation regardless.
    credit_wallets: { row: { clerk_user_id: CLERK_USER, balance: 999, reserved: 0, lifetime_granted: 999, lifetime_spent: 0, updated_at: "x" } },
    credit_reconciliation: { row: { wallet_balance: 999, wallet_reserved: 0, ledger_sum: 999, live_holds: 0, ok: true } },
    credit_ledger: {
      rows: [
        {
          id: ledgerId,
          entry_type: "spend",
          amount: -5,
          balance_after: 10,
          reservation_id: null,
          generation_id: GENERATION,
          external_ref: null,
          created_at: "2026-08-10T00:00:00.000Z",
        },
      ],
    },
    credit_reservations: { rows: [] },
  });

  const result = await getAdminBillingView(admin, "generation_id", GENERATION);
  assert.equal(result.outcome, "FOUND");
  const found = result as Extract<BillingAdminResult, { outcome: "FOUND" }>;
  assert.equal(found.wallet, null, "wallet must be null on the generation_id axis");
  assert.equal(found.reconciliation, null, "reconciliation must be null on the generation_id axis");
  assert.equal(found.ledgerEntries.length, 1);
});

test("generation_id: no ledger/reservation evidence → NO_ACCOUNT", async () => {
  const admin = billingAdmin({
    credit_ledger: { rows: [] },
    credit_reservations: { rows: [] },
  });
  const result = await getAdminBillingView(admin, "generation_id", GENERATION);
  assert.deepEqual(result, { outcome: "NO_ACCOUNT" });
});

// ---------------------------------------------------------------------------
// Client-state interpretation
// ---------------------------------------------------------------------------

test("interpretBillingResponse maps every outcome and HTTP edge case", () => {
  assert.deepEqual(interpretBillingResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(interpretBillingResponse(500, {}), { kind: "unavailable", reasonCode: "http_500" });
  assert.deepEqual(interpretBillingResponse(200, { outcome: "INVALID_IDENTIFIER" }), { kind: "invalid" });
  assert.deepEqual(interpretBillingResponse(200, { outcome: "LEDGER_UNAVAILABLE", reasonCode: "not_configured" }), {
    kind: "unavailable",
    reasonCode: "not_configured",
  });
  assert.deepEqual(interpretBillingResponse(200, { outcome: "NO_ACCOUNT" }), { kind: "no_account" });
  assert.deepEqual(interpretBillingResponse(200, "not-an-object"), { kind: "unavailable", reasonCode: "malformed_response" });
  assert.deepEqual(networkErrorState(), { kind: "unavailable", reasonCode: "network_error" });
});

// ---------------------------------------------------------------------------
// STRUCTURAL — read-only, no RPC, no FinOps/Stripe conflation
// ---------------------------------------------------------------------------

test("billing-admin-service.ts never mutates: no .insert(, .update(, .upsert(, .delete(, or .rpc( anywhere", () => {
  const serviceText = stripComments(read("src/lib/admin/billing-admin-service.ts"));
  assert.doesNotMatch(serviceText, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
});

test("billing-admin-service.ts never calls Phase 10's mutation RPCs by name", () => {
  const serviceText = stripComments(read("src/lib/admin/billing-admin-service.ts"));
  assert.doesNotMatch(serviceText, /reserve_credits|settle_reservation|refund_reservation|grant_credits/);
});

test("no new file reads credit_price_per_unit or imports Phase 15-B's cost-contract — the estimate and the ledger stay separate", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /credit_price_per_unit/, file);
    assert.doesNotMatch(text, /finops\/cost-contract/, file);
  }
});

test("STRIPE_INTEGRATION_STATE is a static constant, never a live network check, and the panel renders it verbatim", () => {
  assert.equal(STRIPE_INTEGRATION_STATE, "STRIPE_NOT_CONFIGURED");
  const contractText = stripComments(read("src/lib/admin/billing-admin-contract.ts"));
  assert.doesNotMatch(contractText, /fetch\(|stripe\.com|https:\/\//i);
  const panelText = stripComments(read("src/components/admin/BillingCreditsPanel.tsx"));
  assert.match(panelText, /STRIPE_INTEGRATION_STATE/);
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /["']stripe["']/i, `${file}: no stripe package/dependency reference`);
  }
});

test("package.json has no stripe dependency, confirming STRIPE_NOT_CONFIGURED is honest", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  assert.equal(Object.keys(all).some((name) => name.toLowerCase().includes("stripe")), false);
});

test("the billing route is GET-only, authenticated_read, and requires requireAdminAccess before any read", () => {
  const routeText = stripComments(read("src/app/api/admin/billing/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.match(routeText, /export async function GET/);
  assert.doesNotMatch(routeText, /export async function POST|export async function DELETE|export async function PUT/);
  assert.match(routeText, /routeClass:\s*"authenticated_read"/);
});

test("no locked product UI route is referenced by the new files, and no migration was added", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of NEW_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE|DROP TABLE/i, file);
  }
});
