"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  interpretSecurityCenterResponse,
  networkErrorState,
  type SecurityCenterPanelState,
} from "@/lib/admin/security-center-client-state";
import { SECURITY_SEVERITY_FILTERS } from "@/lib/admin/security-center-contract";
import type { SecuritySeverity } from "@/lib/security/security-event-contract";

/**
 * Phase 16-D Security Center screen — client half.
 *
 * "What is happening right now, system-wide?" — a live feed of the most
 * recent `security_events` rows (Phase 12-C), optionally filtered by
 * severity, plus whichever of them the alert router (Phase 13-D) currently
 * considers OPEN. Read-only, exactly like Risk Investigation — no
 * suspension, no block, no kill switch from this screen.
 */

async function fetchSecurityCenter(severity: SecuritySeverity | "all"): Promise<SecurityCenterPanelState> {
  let response: Response;
  try {
    const params = severity === "all" ? "" : `?severity=${severity}`;
    response = await fetch(`/api/admin/security-center${params}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretSecurityCenterResponse(response.status, body);
}

export default function SecurityCenterPanel() {
  const [severity, setSeverity] = useState<SecuritySeverity | "all">("all");
  const [state, setState] = useState<SecurityCenterPanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchSecurityCenter(severity).then(setState);
  }, [severity]);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Security Center</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Most recent security evidence, system-wide. Read-only — reuses Phase 12-C `security_events` and Phase 13-D&apos;s
        live alert state.
      </p>

      <div className="mb-4 flex gap-2">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as SecuritySeverity | "all")}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
        >
          <option value="all">all severities</option>
          {SECURITY_SEVERITY_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s}
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
        <div className="flex flex-col gap-6">
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">
              Open security alerts (this process, ephemeral) — {state.result.openSecurityAlerts.length}
            </h3>
            {state.result.openSecurityAlerts.length === 0 ? (
              <p className="text-xs text-neutral-500">None currently tracked in this process&apos;s memory.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {state.result.openSecurityAlerts.map((alert) => (
                  <div key={alert.dedupeKey} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                    {alert.type} · severity {alert.severity} · resource {alert.resource} · occurrences{" "}
                    {alert.occurrenceCount} · last seen {alert.lastSeen}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">
              security_events ({state.result.events.length})
            </h3>
            {state.result.events.length === 0 ? (
              <p className="text-xs text-neutral-500">No rows for this filter.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {state.result.events.map((event) => (
                  <div key={event.eventId} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-neutral-200">{event.kind}</span>
                      <span>
                        severity: {event.severity} · risk: {event.riskScore ?? "—"} · action:{" "}
                        {event.recommendedAction ?? "—"}
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
                            href={`/admin/temporal?generationId=${encodeURIComponent(event.resourceId)}`}
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
            )}
          </div>
        </div>
      )}
    </section>
  );
}
