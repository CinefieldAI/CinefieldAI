"use client";

import { useEffect, useState } from "react";
import type { ModelQualityAdminResult, ModelQualityRouteView } from "@/lib/admin/model-quality-admin-contract";

type PanelState =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable"; reasonCode: string }
  | { kind: "found"; routes: readonly ModelQualityRouteView[] };

async function fetchModelQuality(): Promise<PanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/model-quality", { cache: "no-store" });
  } catch {
    return { kind: "unavailable", reasonCode: "network_error" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (response.status === 404 && typeof body === "object" && body !== null && (body as Record<string, unknown>).error === "not_found") {
    return { kind: "denied" };
  }
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };
  const result = body as ModelQualityAdminResult;
  if (result.outcome === "SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: result.reasonCode };
  if (result.outcome === "FOUND") return { kind: "found", routes: result.routes };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

function RouteRow({ route }: { route: ModelQualityRouteView }) {
  const run = route.latestRun;
  return (
    <div className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-neutral-200">
          {route.cinefieldModelId} v{route.modelVersion} → {route.providerId}/{route.providerModelId}
        </span>
        <span>{route.enabled ? "enabled" : "disabled"}</span>
      </div>
      {run ? (
        <div>
          quality: <span className="text-neutral-200">{run.meanQualityScore?.toFixed(2) ?? "—"}</span> · safety:{" "}
          <span className="text-neutral-200">{run.meanSafetyScore?.toFixed(2) ?? "—"}</span> · cases: {run.caseCount - run.failedCaseCount}/
          {run.caseCount} passed · evaluator: {run.evaluator} · measured {run.completedAt ?? "—"}
        </div>
      ) : (
        <div className="text-amber-500">no completed eval run yet</div>
      )}
    </div>
  );
}

export default function ModelQualityPanel() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchModelQuality().then(setState);
  }, []);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Model Quality</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Golden-dataset quality/cost/latency measurement per active route — the same evidence the router&rsquo;s own
        quality seam reads, and the same evidence the CI regression gate blocks a promotion on.
      </p>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "unavailable" && <p className="text-sm text-red-400">Unavailable ({state.reasonCode}).</p>}
      {state.kind === "found" && (
        <div className="flex flex-col gap-2">
          {state.routes.length === 0 ? (
            <p className="text-sm text-neutral-500">No routes configured.</p>
          ) : (
            state.routes.map((route) => <RouteRow key={route.routeId} route={route} />)
          )}
        </div>
      )}
    </section>
  );
}
