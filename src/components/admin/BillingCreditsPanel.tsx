"use client";

import { useState, type FormEvent } from "react";
import {
  interpretBillingResponse,
  networkErrorState,
  type BillingPanelState,
} from "@/lib/admin/billing-admin-client-state";
import { STRIPE_INTEGRATION_STATE } from "@/lib/admin/billing-admin-contract";
import type { LedgerEntryView, ReconciliationView, ReservationView, WalletView } from "@/lib/admin/billing-admin-contract";
import type { BillingLookupIdentifierType } from "@/lib/admin/billing-admin-contract";

/**
 * Phase 16-C Billing / Credits screen — client half.
 *
 * "What is the user's real credit/economic state?" Read-only. Reads
 * ECONOMIC_LEDGER_TRUTH (Phase 10) only — Phase 15-B's operational cost
 * ESTIMATE and Stripe's EXTERNAL billing truth are deliberately never
 * merged into this view (see `billing-admin-contract.ts`'s header); the
 * Stripe row below is a static fact, not a live probe.
 */

const IDENTIFIER_OPTIONS: { value: BillingLookupIdentifierType; label: string; placeholder: string }[] = [
  { value: "clerk_user_id", label: "Clerk user id", placeholder: "user_..." },
  { value: "generation_id", label: "Generation id", placeholder: "uuid" },
];

async function fetchBilling(identifierType: BillingLookupIdentifierType, identifierValue: string): Promise<BillingPanelState> {
  let response: Response;
  try {
    const params = new URLSearchParams({ identifierType, identifierValue });
    response = await fetch(`/api/admin/billing?${params.toString()}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretBillingResponse(response.status, body);
}

function WalletFields({ wallet, reconciliation }: { wallet: WalletView | null; reconciliation: ReconciliationView | null }) {
  return (
    <div className="rounded border border-neutral-800 p-3">
      <h3 className="mb-2 text-sm font-medium text-neutral-200">Wallet (Phase 10 economic ledger truth)</h3>
      {wallet ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-400">
          <dt>balance</dt>
          <dd>{wallet.balance}</dd>
          <dt>reserved</dt>
          <dd>{wallet.reserved}</dd>
          <dt>lifetime granted</dt>
          <dd>{wallet.lifetimeGranted}</dd>
          <dt>lifetime spent</dt>
          <dd>{wallet.lifetimeSpent}</dd>
          <dt>updated</dt>
          <dd>{wallet.updatedAt}</dd>
        </dl>
      ) : (
        <p className="text-xs text-neutral-500">No wallet row for this lookup.</p>
      )}
      {reconciliation && (
        <p className={`mt-2 text-xs ${reconciliation.ok ? "text-emerald-400" : "text-red-400"}`}>
          reconciliation: {reconciliation.ok ? "OK" : "MISMATCH"} (ledger sum {reconciliation.ledgerSum} · live holds{" "}
          {reconciliation.liveHolds})
        </p>
      )}
    </div>
  );
}

function LedgerList({ entries }: { entries: readonly LedgerEntryView[] }) {
  if (entries.length === 0) return <p className="text-xs text-neutral-500">No ledger entries.</p>;
  return (
    <div className="flex flex-col gap-2">
      {entries.map((e) => (
        <div key={e.id} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
          <div className="flex justify-between">
            <span className="text-neutral-200">{e.entryType}</span>
            <span>
              {e.amount > 0 ? "+" : ""}
              {e.amount} → {e.balanceAfter}
            </span>
          </div>
          <div>
            generation: {e.generationId ?? "—"} · reservation: {e.reservationId ?? "—"} · ref: {e.externalRef ?? "—"}
          </div>
          <div>{e.createdAt}</div>
        </div>
      ))}
    </div>
  );
}

function ReservationList({ reservations }: { reservations: readonly ReservationView[] }) {
  if (reservations.length === 0) return <p className="text-xs text-neutral-500">No reservations.</p>;
  return (
    <div className="flex flex-col gap-2">
      {reservations.map((r) => (
        <div key={r.id} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
          <div className="flex justify-between">
            <span className="text-neutral-200">{r.status}</span>
            <span>{r.amount}</span>
          </div>
          <div>generation: {r.generationId ?? "—"}</div>
          <div>
            created {r.createdAt} · expires {r.expiresAt} · settled {r.settledAt ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BillingCreditsPanel() {
  const [identifierType, setIdentifierType] = useState<BillingLookupIdentifierType>("clerk_user_id");
  const [input, setInput] = useState("");
  const [state, setState] = useState<BillingPanelState>({ kind: "idle" });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    setState({ kind: "loading" });
    void fetchBilling(identifierType, value).then(setState);
  };

  const activeOption = IDENTIFIER_OPTIONS.find((o) => o.value === identifierType) ?? IDENTIFIER_OPTIONS[0];

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Billing / Credits</h2>
      <p className="mb-1 text-xs text-neutral-500">
        Economic ledger truth (Phase 10) only — never merged with Phase 15-B cost estimates or external billing truth.
      </p>
      <p className="mb-4 text-xs text-neutral-600">Stripe: {STRIPE_INTEGRATION_STATE} (this repository has no Stripe integration)</p>

      <form onSubmit={onSubmit} className="mb-6 flex gap-2">
        <select
          value={identifierType}
          onChange={(e) => setIdentifierType(e.target.value as BillingLookupIdentifierType)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
        >
          {IDENTIFIER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={activeOption.placeholder}
          className="w-96 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
        />
        <button
          type="submit"
          disabled={state.kind === "loading" || input.trim().length === 0}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          Investigate
        </button>
      </form>

      {state.kind === "idle" && <p className="text-sm text-neutral-500">Enter an identifier to begin.</p>}
      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "invalid" && <p className="text-sm text-amber-400">That identifier is not a valid {activeOption.label.toLowerCase()}.</p>}
      {state.kind === "unavailable" && <p className="text-sm text-red-400">Ledger unavailable ({state.reasonCode}).</p>}
      {state.kind === "no_account" && <p className="text-sm text-neutral-500">No economic activity found for this identifier.</p>}

      {state.kind === "partial" && (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-amber-400">Partial result ({state.result.reasonCode}) — one or more reads failed.</p>
          <WalletFields wallet={state.result.wallet} reconciliation={state.result.reconciliation} />
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Ledger ({state.result.ledgerEntries.length})</h3>
            <LedgerList entries={state.result.ledgerEntries} />
          </div>
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Reservations ({state.result.reservations.length})</h3>
            <ReservationList reservations={state.result.reservations} />
          </div>
        </div>
      )}

      {state.kind === "found" && (
        <div className="flex flex-col gap-6">
          <WalletFields wallet={state.result.wallet} reconciliation={state.result.reconciliation} />
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Ledger ({state.result.ledgerEntries.length})</h3>
            <LedgerList entries={state.result.ledgerEntries} />
          </div>
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Reservations ({state.result.reservations.length})</h3>
            <ReservationList reservations={state.result.reservations} />
          </div>
        </div>
      )}
    </section>
  );
}
