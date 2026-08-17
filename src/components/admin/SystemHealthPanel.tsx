"use client";

import { useCallback, useEffect, useState } from "react";
import {
  interpretHealthResponse,
  networkErrorState,
  type HealthPanelState,
} from "@/lib/admin/admin-health-client-state";

/**
 * Phase 16 System Health screen — client half (Phase 16/1).
 *
 * ---------------------------------------------------------------------------
 * MANUAL REFRESH ONLY
 * ---------------------------------------------------------------------------
 * No polling, no WebSocket, no SSE, no interval timer. An operator loads the
 * page, sees the answer as of that moment, and presses "Refresh" to ask
 * again. A background poll loop is exactly the "operational scheduler" this
 * batch is explicitly not building.
 *
 * ---------------------------------------------------------------------------
 * FAILURE NEVER RENDERS AS SUCCESS
 * ---------------------------------------------------------------------------
 * A fetch failure (network error, non-200, malformed body) renders as its
 * own distinct "Unavailable" state — it never silently falls back to a blank
 * or a green summary. A 404 from the API (session lost mid-visit) renders as
 * "Access denied", not as an empty health report.
 */

type PanelState = HealthPanelState;

async function fetchHealth(): Promise<PanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/health", { cache: "no-store" });
  } catch {
    return networkErrorState();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  return interpretHealthResponse(response.status, body);
}

const STATUS_LABEL: Record<string, string> = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  UNREADY: "Unready",
  UNKNOWN: "Unknown",
};

const STATUS_COLOR: Record<string, string> = {
  HEALTHY: "text-emerald-400",
  DEGRADED: "text-amber-400",
  UNREADY: "text-red-400",
  UNKNOWN: "text-neutral-400",
};

export default function SystemHealthPanel() {
  // Starts "loading" already, so the mount effect below only needs to kick
  // off the fetch — it never calls setState synchronously from inside the
  // effect body itself (React's react-hooks/set-state-in-effect rule flags
  // that pattern; setState here only ever runs inside the resolved fetch
  // promise's .then callback).
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  const load = useCallback(() => {
    void fetchHealth().then(setState);
  }, []);

  /** Manual refresh: explicitly resets to "loading" before re-fetching. */
  const refresh = useCallback(() => {
    setState({ kind: "loading" });
    load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-100">System Health</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={state.kind === "loading"}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          {state.kind === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}

      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}

      {state.kind === "unavailable" && (
        <p className="text-sm text-red-400">Health data unavailable ({state.reasonCode}).</p>
      )}

      {state.kind === "loaded" && (
        <div>
          <p className="mb-4 text-sm text-neutral-400">
            Overall:{" "}
            <span className={STATUS_COLOR[state.projection.overallStatus] ?? "text-neutral-400"}>
              {STATUS_LABEL[state.projection.overallStatus] ?? state.projection.overallStatus}
            </span>{" "}
            · checked {new Date(state.projection.checkedAt).toLocaleTimeString()}
          </p>

          <div className="flex flex-col gap-4">
            {state.projection.runtimes.map((runtime) => (
              <div key={runtime.runtime} className="rounded border border-neutral-800 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-200">{runtime.runtime}</span>
                  <span className={`text-sm ${STATUS_COLOR[runtime.status] ?? "text-neutral-400"}`}>
                    {STATUS_LABEL[runtime.status] ?? runtime.status}
                  </span>
                </div>
                <ul className="flex flex-col gap-1">
                  {runtime.dependencies.map((dep) => (
                    <li key={dep.dependency} className="flex items-center justify-between text-xs">
                      <span className="text-neutral-400">
                        {dep.dependency} <span className="text-neutral-600">({dep.criticality})</span>
                      </span>
                      <span className={STATUS_COLOR[dep.status] ?? "text-neutral-400"}>
                        {STATUS_LABEL[dep.status] ?? dep.status}
                        {dep.reasonCode ? ` — ${dep.reasonCode}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
