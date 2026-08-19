"use client";

import { useEffect, useState } from "react";
import type { PrivacyAdminResult, PrivacyAdminView } from "@/lib/admin/privacy-admin-contract";

type PanelState =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable"; reasonCode: string }
  | { kind: "found"; view: PrivacyAdminView };

async function fetchPrivacyAdminView(): Promise<PanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/privacy", { cache: "no-store" });
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
  const result = body as PrivacyAdminResult;
  if (result.outcome === "SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: result.reasonCode };
  if (result.outcome === "FOUND") return { kind: "found", view: result.view };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-sm font-semibold text-neutral-200">{title}</h3>
      {children}
    </section>
  );
}

export default function PrivacyAdminPanel() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchPrivacyAdminView().then(setState);
  }, []);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Privacy &amp; Data Lifecycle</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Data classification/retention matrix, third-party processor/DPA inventory, and DSAR request status — read-only.
        Executing an export or deletion happens through the two-person Tier-0 flow, never from this view directly.
      </p>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "unavailable" && <p className="text-sm text-red-400">Unavailable ({state.reasonCode}).</p>}
      {state.kind === "found" && (
        <>
          <Section title={`Data classification (${state.view.dataClassification.length} tables)`}>
            <div className="flex flex-col gap-1">
              {state.view.dataClassification.map((entry) => (
                <div key={entry.table} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                  <span className="text-neutral-200">{entry.table}</span> — {entry.dataClass} · {entry.legalBasis} · owner:{" "}
                  {entry.owner} · retention: {entry.retentionPolicy} · deletion: {entry.deletionPolicy}
                </div>
              ))}
            </div>
          </Section>

          <Section title={`Third-party processors / DPA status (${state.view.processors.length})`}>
            <div className="flex flex-col gap-1">
              {state.view.processors.map((entry) => (
                <div key={entry.processorId} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                  <span className="text-neutral-200">{entry.name}</span> — {entry.purpose} · region: {entry.region} · DPA:{" "}
                  <span className={entry.dpaStatus === "SIGNED" ? "text-emerald-400" : "text-amber-500"}>{entry.dpaStatus}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title={`Deletion tombstones: ${state.view.tombstoneCount}`}>
            <p className="text-xs text-neutral-500">Accounts with a durable, permanent deletion record.</p>
          </Section>

          <Section title={`Recent privacy requests (${state.view.recentRequests.length})`}>
            {state.view.recentRequests.length === 0 ? (
              <p className="text-sm text-neutral-500">No requests yet.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {state.view.recentRequests.map((req) => (
                  <div key={req.id} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                    {req.requestType} · <span className="text-neutral-200">{req.status}</span> · requested {req.requestedAt}
                    {req.resolvedAt ? ` · resolved ${req.resolvedAt} by ${req.resolvedBy}` : ""}
                    {req.reasonCode ? ` · ${req.reasonCode}` : ""}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </section>
  );
}
