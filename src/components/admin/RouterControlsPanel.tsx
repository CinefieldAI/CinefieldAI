"use client";

import { useState, type FormEvent } from "react";
import {
  interpretRouterActionResponse,
  interpretRouterListResponse,
  networkErrorState,
  type RouterActionPanelState,
  type RouterListPanelState,
} from "@/lib/admin/router-admin-client-state";
import type { RouteAdminView } from "@/lib/routing/admin-route-service";

/**
 * Phase 16-B Router Controls screen — client half.
 *
 * List routes (optionally scoped to one model id), then disable/re-enable
 * one route with a required reason and explicit confirmation. Uses
 * `setRouteEnabled` (Phase 7-B) — a Phase-16-admin who is not also a Phase
 * 7-B route admin sees a distinct "route authority denied" state, never
 * fabricated data.
 */

async function fetchRoutes(modelId: string): Promise<RouterListPanelState> {
  let response: Response;
  try {
    const params = modelId.trim() ? `?modelId=${encodeURIComponent(modelId.trim())}` : "";
    response = await fetch(`/api/admin/router${params}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretRouterListResponse(response.status, body);
}

async function postDisable(routeId: string, enabled: boolean, reason: string): Promise<RouterActionPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/router/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId, enabled, reason }),
      cache: "no-store",
    });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretRouterActionResponse(response.status, body);
}

function RouteRow({
  route,
  onRequestToggle,
}: {
  route: RouteAdminView;
  onRequestToggle: (route: RouteAdminView) => void;
}) {
  return (
    <div className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-neutral-200">
          {route.cinefieldModelId} v{route.modelVersion} → {route.providerId}
        </span>
        <span>{route.enabled ? "enabled" : "disabled"}</span>
      </div>
      <div>
        priority: {route.priority} · status: {route.status} · route id: {route.routeId}
      </div>
      <button
        type="button"
        onClick={() => onRequestToggle(route)}
        className="mt-1 rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-900"
      >
        {route.enabled ? "Disable…" : "Re-enable…"}
      </button>
    </div>
  );
}

export default function RouterControlsPanel() {
  const [modelId, setModelId] = useState("");
  const [list, setList] = useState<RouterListPanelState>({ kind: "idle" });
  const [target, setTarget] = useState<RouteAdminView | null>(null);
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<RouterActionPanelState>({ kind: "idle" });

  const onLoad = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setList({ kind: "loading" });
    void fetchRoutes(modelId).then(setList);
  };

  const onConfirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || !reason.trim()) return;
    setAction({ kind: "loading" });
    void postDisable(target.routeId, !target.enabled, reason.trim()).then((result) => {
      setAction(result);
      setTarget(null);
      // The list on screen may now be stale for this one route — reload
      // rather than leave a mismatched enabled/disabled label showing.
      if (result.kind === "applied") void fetchRoutes(modelId).then(setList);
    });
  };

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Router Controls</h2>
      <p className="mb-4 text-xs text-neutral-500">Which routes are active, and can an authorized operator disable one safely?</p>

      <form onSubmit={onLoad} className="mb-6 flex gap-2">
        <input
          type="text"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="Model id (optional filter)"
          className="w-72 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
        />
        <button
          type="submit"
          disabled={list.kind === "loading"}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          Load routes
        </button>
      </form>

      {list.kind === "idle" && <p className="text-sm text-neutral-500">Load routes to begin.</p>}
      {list.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {list.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {list.kind === "route_authority_denied" && (
        <p className="text-sm text-amber-400">This admin account is not on the separate route-authority allowlist.</p>
      )}
      {list.kind === "unavailable" && <p className="text-sm text-red-400">Routes unavailable ({list.reasonCode}).</p>}

      {list.kind === "found" && (
        <div className="mb-6 flex flex-col gap-2">
          {list.result.routes.length === 0 ? (
            <p className="text-sm text-neutral-500">No routes match.</p>
          ) : (
            list.result.routes.map((route) => (
              <RouteRow
                key={route.routeId}
                route={route}
                onRequestToggle={(r) => {
                  setTarget(r);
                  setReason("");
                  setAction({ kind: "idle" });
                }}
              />
            ))
          )}
        </div>
      )}

      {target && (
        <form onSubmit={onConfirm} className="mt-3 flex flex-col gap-2 rounded border border-amber-800 p-3">
          <p className="text-sm text-amber-300">
            Confirm {target.enabled ? "disabling" : "re-enabling"} route {target.routeId} ({target.cinefieldModelId} →{" "}
            {target.providerId}).
          </p>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={reason.trim().length === 0 || action.kind === "loading"}
              className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
            >
              Confirm {target.enabled ? "disable" : "re-enable"}
            </button>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {action.kind === "loading" && <p className="mt-3 text-sm text-neutral-400">Applying…</p>}
      {action.kind === "denied" && <p className="mt-3 text-sm text-red-400">Access denied.</p>}
      {action.kind === "route_authority_denied" && (
        <p className="mt-3 text-sm text-amber-400">This admin account is not on the route-authority allowlist.</p>
      )}
      {action.kind === "invalid_target" && <p className="mt-3 text-sm text-red-400">Invalid route id or missing reason.</p>}
      {action.kind === "route_not_found" && <p className="mt-3 text-sm text-amber-400">That route no longer exists.</p>}
      {action.kind === "unavailable" && <p className="mt-3 text-sm text-red-400">Action unavailable ({action.reasonCode}).</p>}
      {action.kind === "applied" && (
        <p className="mt-3 text-sm text-green-400">
          Route {action.result.routeId} is now {action.result.enabled ? "enabled" : "disabled"}.
        </p>
      )}
    </section>
  );
}
