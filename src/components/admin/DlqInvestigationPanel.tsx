"use client";

import { useState, type FormEvent } from "react";
import {
  interpretDlqInvestigationResponse,
  interpretDlqRedriveResponse,
  networkErrorState,
  type DlqInvestigationPanelState,
  type DlqRedrivePanelState,
} from "@/lib/admin/dlq-admin-client-state";

/**
 * Phase 16-B Failed Jobs / DLQ screen — client half.
 *
 * Two explicit steps, never collapsed into one click: (1) Investigate reads
 * whatever message is currently at the head of the provider DLQ and shows
 * its safety decision; (2) Redrive is only enabled after a fresh
 * investigation shows `SAFE_TO_REDRIVE`, requires a typed reason, and its
 * own server call recomputes the decision again before acting — so a stale
 * investigation result on screen can never itself authorize execution. No
 * optimistic success: the result section only ever shows what the server
 * just confirmed.
 */

async function fetchInvestigation(): Promise<DlqInvestigationPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/dlq", { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretDlqInvestigationResponse(response.status, body);
}

async function fetchRedrive(reason: string): Promise<DlqRedrivePanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/dlq/redrive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
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
  return interpretDlqRedriveResponse(response.status, body);
}

export default function DlqInvestigationPanel() {
  const [investigation, setInvestigation] = useState<DlqInvestigationPanelState>({ kind: "idle" });
  const [redrive, setRedrive] = useState<DlqRedrivePanelState>({ kind: "idle" });
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  const onInvestigate = () => {
    setInvestigation({ kind: "loading" });
    setRedrive({ kind: "idle" });
    setConfirming(false);
    void fetchInvestigation().then(setInvestigation);
  };

  const safeToRedrive = investigation.kind === "decided" && investigation.result.decision.state === "SAFE_TO_REDRIVE";

  const onConfirmRedrive = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim()) return;
    setRedrive({ kind: "loading" });
    void fetchRedrive(reason.trim()).then((result) => {
      setRedrive(result);
      setConfirming(false);
      // The message this decision described is no longer at the head of
      // the DLQ either way (redriven, or briefly claimed then released) —
      // the on-screen investigation result is now stale by construction,
      // so it is cleared rather than left looking current.
      setInvestigation({ kind: "idle" });
    });
  };

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Failed Jobs / DLQ</h2>
      <p className="mb-4 text-xs text-neutral-500">
        What is stuck, why, and is it safe to redrive? Provider DLQ only — one message at a time.
      </p>

      <div className="mb-6 flex items-center gap-2">
        <button
          type="button"
          onClick={onInvestigate}
          disabled={investigation.kind === "loading"}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          Investigate DLQ
        </button>
      </div>

      {investigation.kind === "idle" && <p className="text-sm text-neutral-500">Press Investigate to peek at the DLQ.</p>}
      {investigation.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {investigation.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {investigation.kind === "unavailable" && (
        <p className="text-sm text-red-400">DLQ evidence unavailable ({investigation.reasonCode}) — redrive is unavailable, not refused.</p>
      )}
      {investigation.kind === "no_message" && <p className="text-sm text-neutral-500">No message currently in the DLQ.</p>}

      {investigation.kind === "decided" && (
        <div className="mb-6 rounded border border-neutral-800 p-3 text-xs text-neutral-400">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-neutral-200">{investigation.result.decision.state}</span>
            <span>{investigation.result.decision.reasonCode}</span>
          </div>
          <div>
            generation: {investigation.result.decision.generationId ?? "—"} · attempt: {investigation.result.decision.attemptId ?? "—"}
          </div>
          <div>
            source: {investigation.result.decision.sourceQueue} · dlq: {investigation.result.decision.dlqName} · evaluated{" "}
            {investigation.result.decision.evaluatedAt}
          </div>
        </div>
      )}

      {safeToRedrive && !confirming && redrive.kind !== "loading" && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded border border-amber-700 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-950"
        >
          Redrive this message…
        </button>
      )}

      {confirming && (
        <form onSubmit={onConfirmRedrive} className="mt-3 flex flex-col gap-2 rounded border border-amber-800 p-3">
          <p className="text-sm text-amber-300">
            Confirm redrive of generation {investigation.kind === "decided" ? investigation.result.decision.generationId : "—"}. The
            safety decision will be re-checked on the server immediately before this runs.
          </p>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={reason.trim().length === 0 || redrive.kind === "loading"}
              className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
            >
              Confirm redrive
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {redrive.kind === "loading" && <p className="mt-3 text-sm text-neutral-400">Redriving…</p>}
      {redrive.kind === "denied" && <p className="mt-3 text-sm text-red-400">Access denied.</p>}
      {redrive.kind === "invalid_reason" && <p className="mt-3 text-sm text-red-400">A reason is required.</p>}
      {redrive.kind === "unavailable" && (
        <p className="mt-3 text-sm text-red-400">Redrive unavailable ({redrive.reasonCode}).</p>
      )}
      {redrive.kind === "no_message" && <p className="mt-3 text-sm text-neutral-500">No message was present when the server re-checked.</p>}
      {redrive.kind === "refused" && (
        <p className="mt-3 text-sm text-amber-400">
          Refused on re-check: {redrive.result.decision.state} ({redrive.result.decision.reasonCode}). Nothing was moved.
        </p>
      )}
      {redrive.kind === "redriven" && (
        <p className="mt-3 text-sm text-green-400">
          Redriven. message id: {redrive.result.messageId} · generation: {redrive.result.decision.generationId}
        </p>
      )}
    </section>
  );
}
