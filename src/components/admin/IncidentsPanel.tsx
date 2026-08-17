"use client";

import { useEffect, useState } from "react";
import {
  interpretIncidentsResponse,
  networkErrorState,
  type IncidentsPanelState,
} from "@/lib/admin/incidents-admin-client-state";

/**
 * Phase 16-D Incidents/Audit screen — client half.
 *
 * Three panels: currently-open alerts (Phase 13-D, honestly ephemeral —
 * this process's memory only, not a durable incident timeline), the
 * policy-decision audit trail (Phase 12-E), and the media-safety audit
 * trail (Phase 9-E). Read-only.
 */

async function fetchIncidents(): Promise<IncidentsPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/incidents", { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretIncidentsResponse(response.status, body);
}

export default function IncidentsPanel() {
  const [state, setState] = useState<IncidentsPanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchIncidents().then(setState);
  }, []);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Incidents / Audit</h2>
      <p className="mb-4 text-xs text-neutral-500">Read-only. No resolve/acknowledge action exists on this screen.</p>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "unavailable" && (
        <p className="text-sm text-red-400">Evidence unavailable ({state.reasonCode}).</p>
      )}

      {state.kind === "found" && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-amber-900/60 bg-amber-950/20 p-3">
            <h3 className="mb-1 text-sm font-medium text-amber-300">
              Open alerts — {state.result.alerts.length} (this process only)
            </h3>
            <p className="mb-2 text-xs text-amber-400/80">
              ALERT_HISTORY_EPHEMERAL: this is one process&apos;s in-memory dedupe state, not a durable incident
              timeline. It is cleared on every restart or redeploy and is never shared across instances.
            </p>
            {state.result.alerts.length === 0 ? (
              <p className="text-xs text-neutral-500">None currently tracked.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {state.result.alerts.map((alert) => (
                  <div key={alert.dedupeKey} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                    {alert.type} · {alert.source} · severity {alert.severity} · resource {alert.resource} ·
                    occurrences {alert.occurrenceCount} · first {alert.firstSeen} · last {alert.lastSeen}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">
              Policy decision audit ({state.result.policyDecisions.length})
            </h3>
            {state.result.policyDecisions.length === 0 ? (
              <p className="text-xs text-neutral-500">No policy_decision_* rows.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {state.result.policyDecisions.map((item) => (
                  <div key={item.eventId} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                    {item.kind} · reason {item.reasonCode} · policy {item.policyVersion ?? "—"} · actor{" "}
                    {item.actorClerkUserId ?? "—"} · {item.occurredAt}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">
              Media safety audit ({state.result.mediaSafetyActions.length})
            </h3>
            {state.result.mediaSafetyActions.length === 0 ? (
              <p className="text-xs text-neutral-500">No media_safety_audit rows.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {state.result.mediaSafetyActions.map((item, index) => (
                  <div
                    key={`${item.assetId}-${index}`}
                    className="rounded border border-neutral-900 p-2 text-xs text-neutral-400"
                  >
                    {item.action} · asset {item.assetId} · actor {item.actorClerkUserId} · reason{" "}
                    {item.reasonCode ?? "—"} · {item.createdAt}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
