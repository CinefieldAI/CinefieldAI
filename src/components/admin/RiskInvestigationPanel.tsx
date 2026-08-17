"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  interpretRiskInvestigationResponse,
  networkErrorState,
  type RiskInvestigationPanelState,
} from "@/lib/admin/risk-investigation-client-state";
import type {
  MediaSafetySummaryView,
  RiskEvidenceView,
  RiskLookupIdentifierType,
} from "@/lib/admin/risk-investigation-contract";

/**
 * Phase 16-A Risk Investigation screen — client half.
 *
 * Answers exactly one operator question: "is there security/risk evidence
 * associated with this user, generation, or trace?" Manual entry, manual
 * submit — no auto-search, no polling, no action of any kind. This is
 * OBSERVATIONAL ONLY: no quarantine release, no suspension, no provider
 * disable, no kill switch — those belong to a later, separately reviewed
 * Phase 16 package, never to this read-only slice.
 *
 * No evidence found is shown distinctly from evidence being unavailable —
 * the panel never lets "we couldn't check" read as "this is safe."
 */

const IDENTIFIER_OPTIONS: { value: RiskLookupIdentifierType; label: string; placeholder: string }[] = [
  { value: "clerk_user_id", label: "Clerk user id", placeholder: "user_..." },
  { value: "generation_id", label: "Generation id", placeholder: "uuid" },
  { value: "trace_id", label: "Trace id", placeholder: "32 hex characters" },
];

async function fetchRiskInvestigation(
  identifierType: RiskLookupIdentifierType,
  identifierValue: string
): Promise<RiskInvestigationPanelState> {
  let response: Response;
  try {
    const params = new URLSearchParams({ identifierType, identifierValue });
    response = await fetch(`/api/admin/risk?${params.toString()}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  return interpretRiskInvestigationResponse(response.status, body);
}

function EventsList({ events }: { events: readonly RiskEvidenceView[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-neutral-500">No security_events rows for this identifier.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {events.map((event) => (
        <div key={event.eventId} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-neutral-200">{event.kind}</span>
            <span>
              severity: {event.severity} · risk: {event.riskScore ?? "—"} · action: {event.recommendedAction ?? "—"}
            </span>
          </div>
          <div>
            source: {event.source} · reason: {event.reasonCode}
          </div>
          <div>
            occurred {event.occurredAt}
            {event.actorClerkUserId ? (
              <>
                {" "}
                ·{" "}
                <Link
                  href={`/admin/users?clerkUserId=${encodeURIComponent(event.actorClerkUserId)}`}
                  className="text-neutral-300 underline hover:text-neutral-100"
                >
                  actor: {event.actorClerkUserId}
                </Link>
              </>
            ) : null}
            {event.resourceType === "generation" && event.resourceId ? (
              <>
                {" "}
                ·{" "}
                <Link
                  href={`/admin/generations?generationId=${encodeURIComponent(event.resourceId)}`}
                  className="text-neutral-300 underline hover:text-neutral-100"
                >
                  generation: {event.resourceId}
                </Link>
              </>
            ) : null}
            {event.traceId ? <> · trace: {event.traceId}</> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function MediaSafetyList({ items }: { items: readonly MediaSafetySummaryView[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-neutral-500">No media_assets safety rows for this identifier.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.mediaId} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-neutral-200">{item.mediaId}</span>
            <span>
              quarantine: {item.quarantineStatus} · moderation: {item.moderationStatus}
            </span>
          </div>
          <div>
            ingest: {item.ingestStatus} · engine: {item.moderationEngine ?? "—"} · moderated{" "}
            {item.moderatedAt ?? "—"}
          </div>
          <div>
            created {item.createdAt}
            {item.generationId ? (
              <>
                {" "}
                ·{" "}
                <Link
                  href={`/admin/generations?generationId=${encodeURIComponent(item.generationId)}`}
                  className="text-neutral-300 underline hover:text-neutral-100"
                >
                  generation: {item.generationId}
                </Link>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RiskInvestigationPanel() {
  const [identifierType, setIdentifierType] = useState<RiskLookupIdentifierType>("clerk_user_id");
  const [input, setInput] = useState("");
  const [state, setState] = useState<RiskInvestigationPanelState>({ kind: "idle" });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    setState({ kind: "loading" });
    void fetchRiskInvestigation(identifierType, value).then(setState);
  };

  const activeOption = IDENTIFIER_OPTIONS.find((o) => o.value === identifierType) ?? IDENTIFIER_OPTIONS[0];

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Risk Investigation</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Observational only — no evidence here can be acted on from this screen.
      </p>

      <form onSubmit={onSubmit} className="mb-6 flex gap-2">
        <select
          value={identifierType}
          onChange={(e) => setIdentifierType(e.target.value as RiskLookupIdentifierType)}
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
      {state.kind === "unavailable" && (
        <p className="text-sm text-red-400">Evidence unavailable ({state.reasonCode}) — this does not mean no risk.</p>
      )}
      {state.kind === "no_evidence" && (
        <p className="text-sm text-neutral-500">No risk evidence found — this does not mean the identifier is safe, only that none was recorded.</p>
      )}

      {state.kind === "partial" && (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-amber-400">Partial result ({state.result.reasonCode}) — one evidence source could not be read.</p>
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Security events ({state.result.events.length})</h3>
            <EventsList events={state.result.events} />
          </div>
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Media safety ({state.result.mediaSafety.length})</h3>
            <MediaSafetyList items={state.result.mediaSafety} />
          </div>
        </div>
      )}

      {state.kind === "found" && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Security events ({state.result.events.length})</h3>
            <EventsList events={state.result.events} />
          </div>
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Media safety ({state.result.mediaSafety.length})</h3>
            <MediaSafetyList items={state.result.mediaSafety} />
          </div>
        </div>
      )}
    </section>
  );
}
