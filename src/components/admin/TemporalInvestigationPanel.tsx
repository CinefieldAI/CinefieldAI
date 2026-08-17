"use client";

import { useState, type FormEvent } from "react";
import {
  interpretCancelResponse,
  interpretInspectionResponse,
  networkErrorState,
  type TemporalCancelPanelState,
  type TemporalInspectionPanelState,
} from "@/lib/admin/temporal-admin-client-state";
import { ADMIN_CANCEL_REASON_PATTERN } from "@/lib/admin/temporal-admin-contract";

/**
 * Phase 16-D Temporal/Workflows screen — client half.
 *
 * Answers "what is this generation's workflow doing right now, and can it
 * be cancelled?" Inspection is read-only and reuses the durable
 * `generations` row plus a live Temporal `describe()`. Cancel is the one
 * guarded mutation this 16-D package allows — it always re-reads current
 * state on the server before acting, so a stale panel cannot cancel
 * something that already finished.
 */

async function fetchInspection(generationId: string): Promise<TemporalInspectionPanelState> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/temporal/${encodeURIComponent(generationId)}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretInspectionResponse(response.status, body);
}

async function postCancel(generationId: string, reasonCode: string): Promise<TemporalCancelPanelState> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/temporal/${encodeURIComponent(generationId)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reasonCode }),
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
  return interpretCancelResponse(response.status, body);
}

export default function TemporalInvestigationPanel() {
  const [generationId, setGenerationId] = useState("");
  const [state, setState] = useState<TemporalInspectionPanelState>({ kind: "idle" });
  const [reasonCode, setReasonCode] = useState("");
  const [cancelState, setCancelState] = useState<TemporalCancelPanelState>({ kind: "idle" });

  const onInspect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = generationId.trim();
    if (!value) return;
    setCancelState({ kind: "idle" });
    setState({ kind: "loading" });
    void fetchInspection(value).then(setState);
  };

  const onCancel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = generationId.trim();
    if (!value || !ADMIN_CANCEL_REASON_PATTERN.test(reasonCode)) return;
    setCancelState({ kind: "submitting" });
    void postCancel(value, reasonCode).then((result) => {
      setCancelState(result);
      if (result.kind === "requested") void fetchInspection(value).then(setState);
    });
  };

  const canOfferCancel =
    state.kind === "found" &&
    state.result.outcome === "FOUND" &&
    ["queued", "processing"].includes(state.result.generation.status);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Temporal / Workflows</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Read-only inspection of one generation&apos;s workflow, plus the one canonical, guarded cancel action.
      </p>

      <form onSubmit={onInspect} className="mb-6 flex gap-2">
        <input
          type="text"
          value={generationId}
          onChange={(e) => setGenerationId(e.target.value)}
          placeholder="Generation id (uuid)"
          className="w-96 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
        />
        <button
          type="submit"
          disabled={state.kind === "loading" || generationId.trim().length === 0}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          Inspect
        </button>
      </form>

      {state.kind === "idle" && <p className="text-sm text-neutral-500">Enter a generation id to begin.</p>}
      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "invalid" && <p className="text-sm text-amber-400">That is not a valid generation id.</p>}
      {state.kind === "not_found" && <p className="text-sm text-neutral-500">No generation found for that id.</p>}
      {state.kind === "unavailable" && (
        <p className="text-sm text-red-400">Evidence unavailable ({state.reasonCode}).</p>
      )}

      {state.kind === "found" && state.result.outcome === "FOUND" && (
        <div className="flex flex-col gap-4">
          <div className="rounded border border-neutral-800 p-3 text-xs text-neutral-400">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Generation</h3>
            <div>status: {state.result.generation.status}</div>
            <div>
              cancel intent:{" "}
              {state.result.generation.cancelIntent
                ? `requested ${state.result.generation.cancelIntent.requestedAt} (${state.result.generation.cancelIntent.reason})${
                    state.result.generation.cancelIntent.recordedByAdmin
                      ? ` — recorded by admin ${state.result.generation.cancelIntent.recordedByAdmin}`
                      : ""
                  }`
                : "none recorded"}
            </div>
          </div>

          <div className="rounded border border-neutral-800 p-3 text-xs text-neutral-400">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Temporal workflow</h3>
            {state.result.workflow.state === "TEMPORAL_NOT_CONFIGURED" && (
              <p className="text-amber-400">TEMPORAL_NOT_CONFIGURED — this deployment has no Temporal owner wired up.</p>
            )}
            {state.result.workflow.state === "WORKFLOW_NOT_FOUND" && (
              <p>WORKFLOW_NOT_FOUND — no live Temporal execution exists for this generation (may predate Temporal, or the run has aged out of retention).</p>
            )}
            {state.result.workflow.state === "UNAVAILABLE" && (
              <p className="text-red-400">UNAVAILABLE ({state.result.workflow.reasonCode})</p>
            )}
            {state.result.workflow.state === "FOUND" && (
              <>
                <div>workflow id: {state.result.workflow.view.workflowId}</div>
                <div>run id: {state.result.workflow.view.runId}</div>
                <div>task queue: {state.result.workflow.view.taskQueue}</div>
                <div>status: {state.result.workflow.view.status}</div>
                <div>started: {state.result.workflow.view.startedAt}</div>
                <div>closed: {state.result.workflow.view.closedAt ?? "—"}</div>
                <div>history length: {state.result.workflow.view.historyLength}</div>
              </>
            )}
          </div>

          {canOfferCancel && (
            <form onSubmit={onCancel} className="rounded border border-neutral-800 p-3">
              <h3 className="mb-2 text-sm font-medium text-neutral-200">Cancel this generation</h3>
              <p className="mb-2 text-xs text-neutral-500">
                Requires a reason code. Re-checks current state on the server before acting — cannot cancel a
                generation that has already finished.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  placeholder="reason_code (e.g. operator_investigation)"
                  className="w-80 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                />
                <button
                  type="submit"
                  disabled={cancelState.kind === "submitting" || !ADMIN_CANCEL_REASON_PATTERN.test(reasonCode)}
                  className="rounded border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950 disabled:opacity-50"
                >
                  Cancel workflow
                </button>
              </div>
              {cancelState.kind === "denied" && <p className="mt-2 text-sm text-red-400">Access denied.</p>}
              {cancelState.kind === "invalid" && <p className="mt-2 text-sm text-amber-400">Invalid input.</p>}
              {cancelState.kind === "not_found" && <p className="mt-2 text-sm text-neutral-500">Generation not found.</p>}
              {cancelState.kind === "unavailable" && (
                <p className="mt-2 text-sm text-red-400">Unavailable ({cancelState.reasonCode}).</p>
              )}
              {cancelState.kind === "not_allowed" && (
                <p className="mt-2 text-sm text-amber-400">
                  CANCEL_NOT_ALLOWED — generation is already {cancelState.status}.
                </p>
              )}
              {cancelState.kind === "requested" && (
                <p className="mt-2 text-sm text-emerald-400">
                  Cancel intent recorded{cancelState.alreadyRequested ? " (already requested previously)" : ""}. Temporal
                  signalled: {cancelState.workflowSignalled ? "yes" : "no"}.
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
