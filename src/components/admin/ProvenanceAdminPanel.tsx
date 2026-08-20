"use client";

import { useEffect, useState } from "react";
import type { ProvenanceAdminResult, ProvenanceAdminView } from "@/lib/admin/provenance-admin-contract";

type PanelState =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable"; reasonCode: string }
  | { kind: "found"; view: ProvenanceAdminView };

async function fetchProvenanceAdminView(): Promise<PanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/provenance", { cache: "no-store" });
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
  const result = body as ProvenanceAdminResult;
  if (result.outcome === "SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: result.reasonCode };
  if (result.outcome === "FOUND") return { kind: "found", view: result.view };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

const STATE_COLOR: Record<string, string> = {
  NOT_MARKED: "text-neutral-500",
  EVIDENCE_RECORDED: "text-amber-500",
  SIGNED_DETACHED: "text-emerald-400",
  EMBEDDED_C2PA: "text-emerald-300",
};

export default function ProvenanceAdminPanel() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchProvenanceAdminView().then(setState);
  }, []);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Content Provenance &amp; AI Marking</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Read-only. Generated-media provenance (AI Act Article 50(2) machine-readable marking) — never a signature value,
        object key, or prompt. This is <span className="text-neutral-300">detached</span> evidence bound to Phase 9-B&rsquo;s
        content digest, not an embedded C2PA manifest: the embed step belongs after FFmpeg, which Phase 9-C has not built.
      </p>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "unavailable" && <p className="text-sm text-red-400">Unavailable ({state.reasonCode}).</p>}
      {state.kind === "found" && (
        <>
          <div className="mb-3 rounded border border-neutral-900 p-3 text-xs text-neutral-400">
            <div className="mb-1 text-neutral-300">Marking coverage</div>
            finalized assets: <span className="text-neutral-200">{state.view.coverage.totalFinalizedAssets}</span> · marked:{" "}
            <span className="text-neutral-200">{state.view.coverage.markedAssets}</span> · signed:{" "}
            <span className="text-neutral-200">{state.view.coverage.signedAssets}</span> · embedded C2PA:{" "}
            <span className="text-neutral-200">{state.view.coverage.embeddedC2paAssets}</span>
            <br />
            marked ratio:{" "}
            <span className="text-neutral-200">
              {state.view.coverage.markedRatio === null
                ? "n/a (no finalized assets)"
                : `${(state.view.coverage.markedRatio * 100).toFixed(2)}%`}
            </span>
            <br />
            signer configured: <span className="text-neutral-200">{state.view.signerConfigured ? "yes" : "no"}</span> ·
            embedding pipeline available:{" "}
            <span className="text-neutral-200">{state.view.embeddingPipelineAvailable ? "yes" : "no (Phase 9-C not built)"}</span>
          </div>

          {state.view.recent.length === 0 && <p className="text-sm text-neutral-400">No provenance evidence recorded yet.</p>}
          <div className="flex flex-col gap-1">
            {state.view.recent.map((row) => (
              <div key={row.mediaAssetId} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                <span className="text-neutral-200">{row.mediaAssetId}</span> — {row.verifiedMime} · {row.formatSupport} ·
                state: <span className={STATE_COLOR[row.markingState] ?? "text-neutral-400"}>{row.markingState}</span>
                <br />
                source type: {row.digitalSourceType} · signed: {row.signed ? "yes" : "no"}
                {row.signerKeyId ? ` (${row.signerKeyId})` : ""} · disclosure: {row.disclosureRequirement}
                {row.generationId ? ` · generation ${row.generationId}` : ""}
                {` · ${row.createdAt}`}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
