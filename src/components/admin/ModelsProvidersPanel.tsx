"use client";

import { useEffect, useState } from "react";
import {
  interpretModelProviderResponse,
  networkErrorState,
  type ModelProviderPanelState,
} from "@/lib/admin/model-provider-admin-client-state";

/**
 * Phase 16-B Models / Providers screen — client half.
 *
 * Which models/providers are active and healthy (configured/enabled)?
 * Read-only, no action of any kind — see `model-provider-admin-contract.ts`
 * for why route-level detail is deliberately absent from this page.
 */

async function fetchCatalogue(): Promise<ModelProviderPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/models-providers", { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretModelProviderResponse(response.status, body);
}

export default function ModelsProvidersPanel() {
  // Starts "loading" already, so the mount effect never calls setState
  // synchronously from inside the effect body itself (matches
  // SystemHealthPanel.tsx's own fix for the same
  // react-hooks/set-state-in-effect concern) — setState here only ever
  // runs inside the resolved fetch promise's .then callback.
  const [state, setState] = useState<ModelProviderPanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchCatalogue().then(setState);
  }, []);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Models / Providers</h2>
      <p className="mb-4 text-xs text-neutral-500">Which models and providers are configured and enabled?</p>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "unavailable" && <p className="text-sm text-red-400">Catalogue unavailable ({state.reasonCode}).</p>}

      {state.kind === "found" && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Providers ({state.result.providers.length})</h3>
            <div className="flex flex-col gap-1">
              {state.result.providers.map((p) => (
                <div key={p.providerId} className="flex justify-between text-xs text-neutral-400">
                  <span>
                    {p.label} ({p.providerId})
                  </span>
                  <span>{p.enabled ? "enabled" : "disabled"}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Models ({state.result.models.length})</h3>
            <div className="flex flex-col gap-1">
              {state.result.models.map((m) => (
                <div key={m.modelId} className="flex justify-between text-xs text-neutral-400">
                  <span>
                    {m.label} ({m.modelId}) · {m.generationType}
                  </span>
                  <span>{m.lifecycle}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Provider models ({state.result.providerModels.length})</h3>
            <div className="flex flex-col gap-1">
              {state.result.providerModels.map((pm) => (
                <div key={`${pm.providerId}:${pm.providerModelId}`} className="flex justify-between text-xs text-neutral-400">
                  <span>
                    {pm.providerId} → {pm.providerModelId}
                  </span>
                  <span>{pm.enabled ? "enabled" : "disabled"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
