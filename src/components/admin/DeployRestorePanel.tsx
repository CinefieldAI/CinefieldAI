"use client";

import { useEffect, useState } from "react";
import {
  interpretDeployRestoreResponse,
  networkErrorState,
  type DeployRestorePanelState,
} from "@/lib/admin/deploy-restore-admin-client-state";

/**
 * Phase 16-D Deploy/Restore Health screen — client half.
 *
 * Three cards: rollback signal (real, Phase 14-D), restore verification
 * (real, Phase 15-C, but this repository proves only a local pg_dump/
 * pg_restore round trip — never live Supabase PITR), and recovery RTO/RPO
 * (both target registries are empty — no business-approved commitment
 * exists). Deploy eligibility is reported unavailable rather than guessed —
 * see the panel text for why. No deploy, rollback, or restore EXECUTION is
 * reachable from this screen.
 */

async function fetchDeployRestore(): Promise<DeployRestorePanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/deploy-restore", { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretDeployRestoreResponse(response.status, body);
}

export default function DeployRestorePanel() {
  const [state, setState] = useState<DeployRestorePanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchDeployRestore().then(setState);
  }, []);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Deploy / Restore Health</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Read-only evidence only. No deploy, rollback, or restore execution is reachable from this screen.
      </p>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "unavailable" && (
        <p className="text-sm text-red-400">Evidence unavailable ({state.reasonCode}).</p>
      )}

      {state.kind === "found" && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-neutral-800 p-3 text-xs text-neutral-400">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Deploy eligibility</h3>
            <p className="text-amber-400">
              DEPLOY_EVIDENCE_UNAVAILABLE ({state.result.deployEligibility.reasonCode}) — no live GitHub Actions/CI,
              Vercel, or artifact-provenance integration is wired into this repository, so no honest eligibility
              verdict can be computed. This is reported rather than fabricated.
            </p>
          </div>

          <div className="rounded border border-neutral-800 p-3 text-xs text-neutral-400">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Rollback signal (Phase 14-D, real)</h3>
            <div>decision: {state.result.rollback.decision}</div>
            <div>reasons: {state.result.rollback.reasons.join(", ") || "—"}</div>
            <div>target deployment: {state.result.rollback.targetDeploymentId ?? "none known (no deployment-identity tracking exists)"}</div>
            <div>current readiness: {state.result.rollback.currentReadiness}</div>
            <div>open critical alerts: {state.result.rollback.openCriticalAlertTypes.join(", ") || "none"}</div>
          </div>

          <div className="rounded border border-neutral-800 p-3 text-xs text-neutral-400">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Restore verification (Phase 15-C, real)</h3>
            <div>status: {state.result.restore.status}</div>
            <div>reason: {state.result.restore.reasonCode ?? "—"}</div>
            <div>
              metrics:{" "}
              {Object.entries(state.result.restore.metrics)
                .map(([k, v]) => `${k}=${v}`)
                .join(" · ") || "—"}
            </div>
            <p className="mt-1 text-neutral-500">
              Proves at most a local pg_dump/pg_restore round trip against an isolated database — never live Supabase
              PITR, which remains DEFERRED_EXTERNAL.
            </p>
          </div>

          <div className="rounded border border-neutral-800 p-3 text-xs text-neutral-400">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Recovery / RTO-RPO (Phase 15-D)</h3>
            <p className="text-amber-400">RTO_RPO_NOT_CONFIGURED</p>
            <div>RTO targets configured: {state.result.recovery.rtoTargetsConfigured}</div>
            <div>RPO targets configured: {state.result.recovery.rpoTargetsConfigured}</div>
            <p className="mt-1 text-neutral-500">
              No target configured is not the same as a target being met. No business-approved recovery-time or
              data-loss commitment exists in this repository yet.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
