"use client";

import { useEffect, useState } from "react";
import type { SecretsAdminResult, SecretsAdminView } from "@/lib/admin/secrets-admin-contract";

type PanelState =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable"; reasonCode: string }
  | { kind: "found"; view: SecretsAdminView };

async function fetchSecretsAdminView(): Promise<PanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/secrets", { cache: "no-store" });
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
  const result = body as SecretsAdminResult;
  if (result.outcome === "SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: result.reasonCode };
  if (result.outcome === "FOUND") return { kind: "found", view: result.view };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

const STATE_COLOR: Record<string, string> = {
  NOT_CONFIGURED: "text-neutral-500",
  ROTATION_REQUIRED: "text-amber-500",
  ROTATING: "text-amber-500",
  VERIFYING: "text-amber-500",
  ACTIVE: "text-emerald-400",
  ROLLBACK_AVAILABLE: "text-amber-500",
  FAILED: "text-red-400",
  EXPIRED: "text-red-400",
};

export default function SecretsAdminPanel() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  useEffect(() => {
    void fetchSecretsAdminView().then(setState);
  }, []);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Secrets &amp; Rotation Lifecycle</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Read-only. Every credential this system depends on, its rotation class, and its current lifecycle state — never
        a value. Rotation executes only through the two-person Tier-0 flow (secret.rotate), never from this view
        directly, and no automatic/scheduled rotation runs anywhere in this codebase today.
      </p>

      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "unavailable" && <p className="text-sm text-red-400">Unavailable ({state.reasonCode}).</p>}
      {state.kind === "found" && (
        <>
          <p className="mb-3 text-xs text-neutral-500">
            environment: <span className="text-neutral-300">{state.view.environment}</span> · secret backend:{" "}
            <span className="text-neutral-300">{state.view.secretManagerBackend}</span>
          </p>
          <div className="flex flex-col gap-1">
            {state.view.secrets.map((row) => (
              <div key={row.name} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                <span className="text-neutral-200">{row.name}</span> — {row.class} · {row.group} · rotation:{" "}
                {row.rotationClass} · state: <span className={STATE_COLOR[row.state] ?? "text-neutral-400"}>{row.state}</span>
                {row.lastRotatedAt ? ` · last rotated ${row.lastRotatedAt}` : ""}
                {row.verifiedAt ? ` · verified ${row.verifiedAt}` : ""}
                {row.expiresAt ? ` · expires ${row.expiresAt}` : ""}
                {row.reasonCode ? ` · ${row.reasonCode}` : ""}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
