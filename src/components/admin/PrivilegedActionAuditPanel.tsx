"use client";

import { useEffect, useState } from "react";
import {
  interpretPrivilegedAuditResponse,
  networkErrorState,
  type PrivilegedAuditPanelState,
} from "@/lib/admin/privileged-audit-client-state";
import { PRIVILEGED_AUDIT_EVENTS } from "@/lib/admin/privileged-audit-contract";
import type { PrivilegedActionEvent } from "@/lib/admin/privileged-action-audit";

/**
 * Phase 16-E Privileged Action Audit screen — client half (Section 14).
 *
 * Bounded filters only: actor, action type, target id, event/outcome. No
 * free-text search. Read-only — no action can be taken from this screen,
 * matching every other Phase 16 investigation surface.
 */

interface Filters {
  actor: string;
  actionType: string;
  targetId: string;
  event: PrivilegedActionEvent | "all";
}

async function fetchAudit(filters: Filters): Promise<PrivilegedAuditPanelState> {
  const params = new URLSearchParams();
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.actionType) params.set("actionType", filters.actionType);
  if (filters.targetId) params.set("targetId", filters.targetId);
  if (filters.event !== "all") params.set("event", filters.event);

  let response: Response;
  try {
    response = await fetch(`/api/admin/privileged-audit?${params.toString()}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretPrivilegedAuditResponse(response.status, body);
}

export default function PrivilegedActionAuditPanel() {
  const [filters, setFilters] = useState<Filters>({ actor: "", actionType: "", targetId: "", event: "all" });
  const [state, setState] = useState<PrivilegedAuditPanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchAudit(filters).then(setState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.actor, filters.actionType, filters.targetId, filters.event]);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Privileged Action Audit</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Durable, append-only evidence for Tier-0 privileged admin actions — who requested or performed which action,
        against what target, when, and with what result. Read-only. Phase 16-E, `admin_privileged_action_events`.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          value={filters.actor}
          onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
          placeholder="actor clerk user id"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
        />
        <input
          value={filters.actionType}
          onChange={(e) => setFilters((f) => ({ ...f, actionType: e.target.value }))}
          placeholder="action type"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
        />
        <input
          value={filters.targetId}
          onChange={(e) => setFilters((f) => ({ ...f, targetId: e.target.value }))}
          placeholder="target id"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
        />
        <select
          value={filters.event}
          onChange={(e) => setFilters((f) => ({ ...f, event: e.target.value as Filters["event"] }))}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
        >
          <option value="all">all outcomes</option>
          {PRIVILEGED_AUDIT_EVENTS.map((event) => (
            <option key={event} value={event}>
              {event}
            </option>
          ))}
        </select>
      </div>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "unavailable" && (
        <p className="text-sm text-red-400">Evidence unavailable ({state.reasonCode}).</p>
      )}

      {state.kind === "found" && (
        <div className="flex flex-col gap-2">
          {state.result.rows.length === 0 ? (
            <p className="text-xs text-neutral-500">No rows for this filter.</p>
          ) : (
            state.result.rows.map((row) => (
              <div key={row.id} className="rounded border border-neutral-800 p-2 text-xs text-neutral-400">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-neutral-200">{row.event}</span>
                  <span>classification: {row.securityClassification}</span>
                </div>
                <div>
                  action: {row.actionType} · target: {row.targetType}
                  {row.targetId ? `:${row.targetId}` : ""}
                </div>
                <div>
                  actor: {row.actorClerkUserId}
                  {row.outcomeDetail ? <> · detail: {row.outcomeDetail}</> : null}
                  {row.reasonCode ? <> · reason: {row.reasonCode}</> : null}
                </div>
                <div>
                  request: {row.requestId} · occurred {row.occurredAt}
                  {row.correlationId ? <> · trace: {row.correlationId}</> : null}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
