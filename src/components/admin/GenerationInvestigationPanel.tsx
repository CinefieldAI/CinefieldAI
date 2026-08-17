"use client";

import { useState, type FormEvent } from "react";
import {
  interpretInvestigationResponse,
  networkErrorState,
  type InvestigationPanelState,
} from "@/lib/admin/generation-investigation-client-state";
import type { TraceChainLinkStatus } from "@/lib/admin/generation-investigation-contract";

/**
 * Phase 16-A/2 Generation Investigation screen — client half.
 *
 * Answers exactly one operator question: "what happened to this
 * generation?" Manual entry, manual submit — no auto-search, no polling, no
 * action of any kind. Missing evidence renders as its own honest state; it
 * is never collapsed into a green "complete" summary.
 */

async function fetchInvestigation(generationId: string): Promise<InvestigationPanelState> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/generations/${encodeURIComponent(generationId)}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  return interpretInvestigationResponse(response.status, body);
}

const CHAIN_LABEL: Record<TraceChainLinkStatus, string> = {
  AVAILABLE: "Available",
  OPTIONAL: "Optional",
  NOT_PERSISTED: "Not persisted",
  EXTERNAL: "External",
  NOT_APPLICABLE: "Not applicable",
};

const CHAIN_COLOR: Record<TraceChainLinkStatus, string> = {
  AVAILABLE: "text-emerald-400",
  OPTIONAL: "text-neutral-400",
  NOT_PERSISTED: "text-amber-400",
  EXTERNAL: "text-neutral-400",
  NOT_APPLICABLE: "text-neutral-600",
};

export default function GenerationInvestigationPanel() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<InvestigationPanelState>({ kind: "idle" });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = input.trim();
    if (!id) return;
    setState({ kind: "loading" });
    void fetchInvestigation(id).then(setState);
  };

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-neutral-100">Generation Investigation</h2>

      <form onSubmit={onSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Generation id (UUID)"
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

      {state.kind === "idle" && <p className="text-sm text-neutral-500">Enter a generation id to begin.</p>}
      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "not_found" && <p className="text-sm text-amber-400">No generation found for that id.</p>}
      {state.kind === "unavailable" && (
        <p className="text-sm text-red-400">Evidence unavailable ({state.reasonCode}).</p>
      )}

      {state.kind === "found" && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Generation</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-400">
              <dt>id</dt>
              <dd>{state.result.generation.generationId}</dd>
              <dt>status</dt>
              <dd>{state.result.generation.status}</dd>
              <dt>type</dt>
              <dd>{state.result.generation.generationType}</dd>
              <dt>provider / model</dt>
              <dd>
                {state.result.generation.provider} / {state.result.generation.model}
              </dd>
              <dt>created</dt>
              <dd>{state.result.generation.createdAt}</dd>
              <dt>updated</dt>
              <dd>{state.result.generation.updatedAt}</dd>
              <dt>completed</dt>
              <dd>{state.result.generation.completedAt ?? "—"}</dd>
              <dt>temporal workflow id</dt>
              <dd>{state.result.generation.temporalWorkflowId ?? "—"}</dd>
              <dt>project (ref)</dt>
              <dd>{state.result.generation.projectId}</dd>
              <dt>user (ref)</dt>
              <dd>{state.result.generation.clerkUserId}</dd>
            </dl>
          </div>

          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">
              Attempts {state.result.attempts.length === 0 ? "(none recorded)" : `(${state.result.attempts.length})`}
            </h3>
            {state.result.attempts.length === 0 ? (
              <p className="text-xs text-neutral-500">No attempts recorded for this generation.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {state.result.attempts.map((attempt) => (
                  <div key={attempt.attemptId} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-neutral-200">
                        #{attempt.attemptNo} · {attempt.attemptId}
                      </span>
                      <span>{attempt.status}</span>
                    </div>
                    <div>
                      {attempt.provider} / {attempt.providerModel} · evidence: {attempt.submissionEvidence}
                    </div>
                    {attempt.providerJobId && <div>provider job id: {attempt.providerJobId}</div>}
                    {(attempt.errorCode || attempt.submissionErrorCode) && (
                      <div className="text-amber-400">
                        error: {attempt.errorCode ?? attempt.submissionErrorCode}
                      </div>
                    )}
                    <div>
                      started {attempt.startedAt ?? "—"} · submitted {attempt.submittedAt ?? "—"} · completed{" "}
                      {attempt.completedAt ?? "—"}
                      {attempt.latencyMs !== null ? ` · ${attempt.latencyMs}ms` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Trace / Correlation</h3>
            <ul className="mb-3 flex flex-col gap-1">
              {state.result.chain.map((link) => (
                <li key={link.name} className="flex items-center justify-between text-xs">
                  <span className="text-neutral-400">{link.name}</span>
                  <span className={CHAIN_COLOR[link.status]}>
                    {link.value ?? CHAIN_LABEL[link.status]}
                  </span>
                </li>
              ))}
            </ul>
            {state.result.traceEvents.length === 0 ? (
              <p className="text-xs text-neutral-500">No correlated events recorded.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {state.result.traceEvents.map((event, i) => (
                  <li key={`${event.eventType}-${i}`} className="text-xs text-neutral-400">
                    {event.occurredAt} · {event.eventType} · trace: {event.traceId ?? "not persisted"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
