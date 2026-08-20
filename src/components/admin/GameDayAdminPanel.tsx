"use client";

import { useEffect, useState } from "react";
import type { GameDayAdminResult, GameDayAdminView } from "@/lib/admin/game-day-admin-contract";

type PanelState =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable"; reasonCode: string }
  | { kind: "found"; view: GameDayAdminView };

async function fetchGameDayAdminView(): Promise<PanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/game-day", { cache: "no-store" });
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
  const result = body as GameDayAdminResult;
  if (result.outcome === "SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: result.reasonCode };
  if (result.outcome === "FOUND") return { kind: "found", view: result.view };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

const OUTCOME_COLOR: Record<string, string> = {
  PASS: "text-emerald-400",
  FAIL: "text-red-400",
  INCONCLUSIVE: "text-amber-500",
  NO_TARGET_CONFIGURED: "text-neutral-500",
};

export default function GameDayAdminPanel() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchGameDayAdminView().then(setState);
  }, []);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Chaos / Resilience Game Days</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Read-only. Every recorded drill and its server-measured recovery outcome — never a caller-supplied verdict. No
        production drill exists yet: AWS FIS wiring is code-complete and live-deferred, and no staging environment is
        configured in this repository today.
      </p>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "unavailable" && <p className="text-sm text-red-400">Unavailable ({state.reasonCode}).</p>}
      {state.kind === "found" && (
        <>
          <p className="mb-3 text-xs text-neutral-500">
            scenarios catalogued: <span className="text-neutral-300">{state.view.scenarioCount}</span> · RTO targets
            configured: <span className="text-neutral-300">{state.view.rtoTargetsConfigured}</span> · RPO targets
            configured: <span className="text-neutral-300">{state.view.rpoTargetsConfigured}</span>
          </p>
          {state.view.exercises.length === 0 && <p className="text-sm text-neutral-400">No exercises recorded yet.</p>}
          <div className="flex flex-col gap-1">
            {state.view.exercises.map((row) => (
              <div key={row.exerciseId} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                <span className="text-neutral-200">{row.scenarioId}</span> — {row.environment} · outcome:{" "}
                <span className={OUTCOME_COLOR[row.outcome] ?? "text-neutral-400"}>{row.outcome}</span> ({row.outcomeReasonCode})
                <br />
                recovery: {row.recoveryResult}
                {row.observedRecoveryMs !== null ? ` · ${row.observedRecoveryMs}ms` : ""}
                {row.targetRtoMs !== null ? ` (target ${row.targetRtoMs}ms)` : ""}
                {row.observedDataLossSeconds !== null ? ` · data loss ${row.observedDataLossSeconds}s` : ""}
                {row.targetRpoSeconds !== null ? ` (target ${row.targetRpoSeconds}s)` : ""}
                {row.failedGuardrails.length > 0 ? ` · failed guardrails: ${row.failedGuardrails.join(", ")}` : ""}
                {row.permanentActions.length > 0 ? ` · permanent actions: ${row.permanentActions.join(", ")}` : ""}
                {row.runbookUpdateRef ? ` · runbook: ${row.runbookUpdateRef}` : ""}
                {` · recorded ${row.recordedAt}`}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
