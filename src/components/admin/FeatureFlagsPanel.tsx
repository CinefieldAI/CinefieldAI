"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  interpretFeatureFlagActionResponse,
  interpretFeatureFlagListResponse,
  networkErrorState,
  type FeatureFlagActionPanelState,
  type FeatureFlagListPanelState,
} from "@/lib/admin/feature-flag-admin-client-state";
import type { FeatureFlagAdminView } from "@/lib/admin/feature-flag-admin-contract";

/**
 * Phase 21-B Feature Flags screen — client half. Mirrors
 * `RouterControlsPanel.tsx`'s structure and interaction pattern exactly.
 *
 * A HIGH_RISK_TIER0 flag (`maintenance_mode`, `release_stage`) that comes
 * back `TIER0_AUTHORIZATION_REQUIRED` shows the pending request id so an
 * operator can hand it to a second admin for
 * `POST /api/admin/privileged-actions/decide`, then retry with the same id.
 */

async function fetchFlags(): Promise<FeatureFlagListPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/feature-flags", { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretFeatureFlagListResponse(response.status, body);
}

async function postSet(
  key: string,
  value: boolean | string,
  reason: string,
  ticketRef: string,
  requestId?: string
): Promise<FeatureFlagActionPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/feature-flags/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, reason, ticketRef: ticketRef || undefined, requestId }),
      cache: "no-store",
    });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretFeatureFlagActionResponse(response.status, body);
}

function FlagRow({ flag, onRequestChange }: { flag: FeatureFlagAdminView; onRequestChange: (flag: FeatureFlagAdminView) => void }) {
  const currentValue = flag.record?.value ?? "(default)";
  return (
    <div className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-neutral-200">{flag.key}</span>
        <span className={flag.riskTier === "HIGH_RISK_TIER0" ? "text-amber-400" : "text-neutral-400"}>{flag.riskTier}</span>
      </div>
      <div className="mb-1">{flag.description}</div>
      <div>
        current: <span className="text-neutral-200">{String(currentValue)}</span>
        {flag.record?.expiresAt && <span> · expires {flag.record.expiresAt}</span>}
      </div>
      <button
        type="button"
        onClick={() => onRequestChange(flag)}
        className="mt-1 rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-900"
      >
        Change…
      </button>
    </div>
  );
}

export default function FeatureFlagsPanel() {
  const [list, setList] = useState<FeatureFlagListPanelState>({ kind: "loading" });
  const [target, setTarget] = useState<FeatureFlagAdminView | null>(null);
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const [ticketRef, setTicketRef] = useState("");
  const [pendingRequestId, setPendingRequestId] = useState<string | undefined>(undefined);
  const [action, setAction] = useState<FeatureFlagActionPanelState>({ kind: "idle" });

  useEffect(() => {
    void fetchFlags().then(setList);
  }, []);

  const onConfirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || !reason.trim() || newValue.trim() === "") return;
    const value: boolean | string = target.valueType === "boolean" ? newValue === "true" : newValue.trim();
    setAction({ kind: "loading" });
    void postSet(target.key, value, reason.trim(), ticketRef, pendingRequestId).then((result) => {
      setAction(result);
      if (result.kind === "tier0_authorization_required") {
        setPendingRequestId(result.requestId);
        return;
      }
      setTarget(null);
      setPendingRequestId(undefined);
      if (result.kind === "applied") void fetchFlags().then(setList);
    });
  };

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Feature Flags</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Runtime kill switches and the release-stage value — changed without a deploy, every change audited and reversible.
      </p>

      {list.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {list.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {list.kind === "unavailable" && <p className="text-sm text-red-400">Flags unavailable ({list.reasonCode}).</p>}

      {list.kind === "found" && (
        <div className="mb-6 flex flex-col gap-2">
          {list.result.flags.map((flag) => (
            <FlagRow
              key={flag.key}
              flag={flag}
              onRequestChange={(f) => {
                setTarget(f);
                setNewValue("");
                setReason("");
                setTicketRef("");
                setPendingRequestId(undefined);
                setAction({ kind: "idle" });
              }}
            />
          ))}
        </div>
      )}

      {target && (
        <form onSubmit={onConfirm} className="mt-3 flex flex-col gap-2 rounded border border-amber-800 p-3">
          <p className="text-sm text-amber-300">
            Changing {target.key} ({target.riskTier}).
          </p>

          {target.valueType === "boolean" ? (
            <select
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
            >
              <option value="">Select…</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : target.valueType === "enum" ? (
            <select
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
            >
              <option value="">Select…</option>
              {(target.allowedValues ?? []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="New value"
              className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
            />
          )}

          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
          />
          <input
            type="text"
            value={ticketRef}
            onChange={(e) => setTicketRef(e.target.value)}
            placeholder="Ticket ref (optional)"
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
          />

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={reason.trim().length === 0 || newValue.trim() === "" || action.kind === "loading"}
              className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
            >
              {pendingRequestId ? "Retry (after second approval)" : "Confirm change"}
            </button>
            <button
              type="button"
              onClick={() => {
                setTarget(null);
                setPendingRequestId(undefined);
              }}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {action.kind === "loading" && <p className="mt-3 text-sm text-neutral-400">Applying…</p>}
      {action.kind === "denied" && <p className="mt-3 text-sm text-red-400">Access denied.</p>}
      {action.kind === "invalid_target" && <p className="mt-3 text-sm text-red-400">Invalid flag key or value, or missing reason.</p>}
      {action.kind === "policy_denied" && <p className="mt-3 text-sm text-red-400">Policy denied ({action.reasonCode}).</p>}
      {action.kind === "write_failed" && <p className="mt-3 text-sm text-red-400">Write failed ({action.reasonCode}).</p>}
      {action.kind === "unavailable" && <p className="mt-3 text-sm text-red-400">Action unavailable ({action.reasonCode}).</p>}
      {action.kind === "tier0_authorization_required" && (
        <p className="mt-3 text-sm text-amber-400">
          Authorization pending ({action.reasonCode}). Request id: {action.requestId}. This flag requires a second admin&rsquo;s
          approval via Privileged Action Audit before retrying.
        </p>
      )}
      {action.kind === "applied" && (
        <p className="mt-3 text-sm text-green-400">
          {action.result.key} is now {String(action.result.value)}.
        </p>
      )}
    </section>
  );
}
