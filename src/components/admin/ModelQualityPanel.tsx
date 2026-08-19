"use client";

import { useEffect, useState } from "react";
import type { EvidenceScale, ModelQualityAdminResult, ModelQualityRouteView } from "@/lib/admin/model-quality-admin-contract";

type PanelState =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable"; reasonCode: string }
  | { kind: "found"; routes: readonly ModelQualityRouteView[]; evidenceScale: EvidenceScale };

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
  if (result.outcome === "FOUND") return { kind: "found", routes: result.routes, evidenceScale: result.evidenceScale };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

function formatScore(metric: { state: string; value?: number }): string {
  return metric.state === "AVAILABLE" && typeof metric.value === "number" ? metric.value.toFixed(2) : "no evidence";
}

function formatLatency(metric: { state: string; valueMs?: number }): string {
  return metric.state === "AVAILABLE" && typeof metric.valueMs === "number" ? `${Math.round(metric.valueMs)}ms` : "no evidence";
}

function formatCost(metric: { state: string; value?: number; currency?: string }): string {
  if (metric.state === "AVAILABLE" && typeof metric.value === "number") return `${metric.value.toFixed(4)} ${metric.currency}`;
  if (metric.state === "MIXED_CURRENCY") return "mixed currency";
  return "no evidence";
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
        <div className="flex flex-col gap-0.5">
          <div>
            quality: <span className="text-neutral-200">{formatScore(run.quality)}</span> · latency:{" "}
            <span className="text-neutral-200">{formatLatency(run.latency)}</span> · cost:{" "}
            <span className="text-neutral-200">{formatCost(run.cost)}</span> · safety:{" "}
            <span className="text-neutral-200">{formatScore(run.safety)}</span>
          </div>
          <div>
            cases: {run.caseCount - run.failedCaseCount}/{run.caseCount} passed · evaluator: {run.evaluator} · measured{" "}
            {run.completedAt ?? "—"}
          </div>
          <div>
            manifest: <span className="text-neutral-200">{run.manifestVersion ?? "unknown (no manifest lineage)"}</span> · compiler:{" "}
            <span className="text-neutral-200">{run.compilerVersion ?? "unknown (no manifest lineage)"}</span>
          </div>
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
      <p className="mb-1 text-xs text-neutral-500">
        Golden-dataset quality/latency/cost measurement per active route — the same evidence the router&rsquo;s own
        quality seam reads, and the same evidence the CI regression gate blocks a promotion on.
      </p>

      {state.kind === "found" && (
        <p className="mb-4 text-xs text-neutral-600">
          {state.evidenceScale.label === "CI_EVAL_EVIDENCE" ? (
            <>
              CI_EVAL_EVIDENCE — the golden dataset has {state.evidenceScale.datasetCaseCount} case(s), below the{" "}
              {state.evidenceScale.minSamplesForRoutingConfidence} the router&rsquo;s own quality policy requires
              before treating a score as confident. What is shown below is real, but it is smoke-test-scale
              evidence, not evidence sized for production routing decisions.
            </>
          ) : (
            <>
              PRODUCTION_ROUTING_CONFIDENT — the golden dataset has {state.evidenceScale.datasetCaseCount} case(s),
              meeting the router&rsquo;s own {state.evidenceScale.minSamplesForRoutingConfidence}-sample confidence
              bar.
            </>
          )}
        </p>
      )}

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
