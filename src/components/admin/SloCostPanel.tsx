"use client";

import { useEffect, useState } from "react";
import {
  interpretSloCostResponse,
  networkErrorState,
  type SloCostPanelState,
} from "@/lib/admin/slo-cost-admin-client-state";

/**
 * Phase 16-D SLO/Cost Guard screen — client half.
 *
 * SLO snapshots are Phase 15-A's own `evaluateSlo()` output, fed real data.
 * Cost Guard is Phase 15-B's own production entry point, called verbatim.
 * Read-only — no budget can be edited and no routing control is reachable
 * from this screen.
 */

const STATE_COLOR: Record<string, string> = {
  HEALTHY: "text-emerald-400",
  AT_RISK: "text-amber-400",
  BREACHED: "text-red-400",
  INSUFFICIENT_DATA: "text-neutral-500",
  UNAVAILABLE: "text-red-400",
};

async function fetchSloCost(): Promise<SloCostPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/slo-cost", { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretSloCostResponse(response.status, body);
}

export default function SloCostPanel() {
  const [state, setState] = useState<SloCostPanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchSloCost().then(setState);
  }, []);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">SLO / Cost Guard</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Read-only. SLO evaluation reuses Phase 15-A&apos;s arithmetic; Cost Guard calls Phase 15-B&apos;s own production
        entry point.
      </p>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "unavailable" && (
        <p className="text-sm text-red-400">Evidence unavailable ({state.reasonCode}).</p>
      )}

      {state.kind === "found" && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">SLO snapshots (1h window)</h3>
            <div className="flex flex-col gap-2">
              {state.result.slo.map((snapshot) => (
                <div
                  key={`${snapshot.sliId}-${snapshot.window}`}
                  className="rounded border border-neutral-900 p-2 text-xs text-neutral-400"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-neutral-200">{snapshot.sliId}</span>
                    <span className={STATE_COLOR[snapshot.state] ?? "text-neutral-400"}>{snapshot.state}</span>
                  </div>
                  <div>
                    reason: {snapshot.reasonCode} · samples: {snapshot.sampleCount} · ratio:{" "}
                    {snapshot.observedRatio !== null ? snapshot.observedRatio.toFixed(4) : "—"} · value:{" "}
                    {snapshot.observedValue ?? "—"} · target: {snapshot.target ?? "—"}
                  </div>
                  <div>
                    budget remaining: {snapshot.budgetRemaining !== null ? snapshot.budgetRemaining.toFixed(3) : "—"} ·
                    burn: {snapshot.burnRateBucket ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Cost Guard (24h lookback, estimate-based)</h3>
            <div className="text-xs text-neutral-400">
              <div>status: {state.result.costGuard.status}</div>
              <div>reason: {state.result.costGuard.reasonCode ?? "—"}</div>
              <div>
                metrics:{" "}
                {Object.entries(state.result.costGuard.metrics)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" · ") || "—"}
              </div>
              <div>
                started {state.result.costGuard.startedAt} · completed {state.result.costGuard.completedAt}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
