"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  interpretModerationActionResponse,
  interpretModerationQueueResponse,
  interpretModerationViewResponse,
  networkErrorState,
  type ModerationActionPanelState,
  type ModerationQueuePanelState,
  type ModerationViewPanelState,
} from "@/lib/admin/moderation-admin-client-state";
import type { ModerationActionKind } from "@/lib/admin/moderation-admin-contract";

/**
 * Phase 16-C Moderation screen — client half.
 *
 * "Is this media quarantined/released, and why?" Observational plus one
 * real, already-canonical action lane (request/approve/reject — Phase
 * 9-E, two-person approval enforced server-side). No client-only mutation:
 * every action call is re-validated, re-authorized, and re-policy-gated on
 * the server before anything changes.
 *
 * PHASE 28-D adds the REVIEW QUEUE above the investigation form. Until now
 * every action needed an asset id the operator already had, so there was no
 * way to discover WHICH assets were waiting — and an appeal, however
 * correctly recorded, reached nobody. The queue is a READ: selecting an item
 * fills the asset-id field, and the release path below is unchanged.
 */

async function fetchModerationView(assetId: string): Promise<ModerationViewPanelState> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/moderation?assetId=${encodeURIComponent(assetId)}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretModerationViewResponse(response.status, body);
}

async function postModerationAction(
  action: ModerationActionKind,
  assetId: string,
  reasonCode: string
): Promise<ModerationActionPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/moderation/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, assetId, reasonCode }),
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
  return interpretModerationActionResponse(response.status, body);
}

/** The Phase 28-D queue: no assetId means "what is waiting for a human?". */
async function fetchModerationQueue(): Promise<ModerationQueuePanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/moderation", { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretModerationQueueResponse(response.status, body);
}

const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;

export default function ModerationPanel() {
  const [assetId, setAssetId] = useState("");
  const [view, setView] = useState<ModerationViewPanelState>({ kind: "idle" });
  const [pendingAction, setPendingAction] = useState<ModerationActionKind | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [action, setAction] = useState<ModerationActionPanelState>({ kind: "idle" });
  // Starts in `loading` rather than being set to it inside the effect: the
  // queue fetch begins on mount, so "loading" is the true initial state and
  // setting it from the effect would be a redundant synchronous re-render.
  const [queue, setQueue] = useState<ModerationQueuePanelState>({ kind: "loading" });

  // Loaded once on mount. Not polled: a review queue that refreshes under a
  // reviewer's cursor is a queue that loses their place mid-decision.
  useEffect(() => {
    void fetchModerationQueue().then(setQueue);
  }, []);

  const queueItems = queue.kind === "loaded" && queue.queue.outcome === "FOUND" ? queue.queue.items : [];

  const onLoad = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = assetId.trim();
    if (!value) return;
    setView({ kind: "loading" });
    setAction({ kind: "idle" });
    void fetchModerationView(value).then(setView);
  };

  const onConfirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingAction || !REASON_CODE_PATTERN.test(reasonCode)) return;
    setAction({ kind: "loading" });
    void postModerationAction(pendingAction, assetId.trim(), reasonCode).then((result) => {
      setAction(result);
      setPendingAction(null);
      // The asset's quarantine/moderation state may have just changed —
      // reload rather than leave a stale view on screen.
      void fetchModerationView(assetId.trim()).then(setView);
    });
  };

  const foundAsset = view.kind === "loaded" && view.body.asset.outcome === "FOUND" ? view.body.asset.assets[0] : null;

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Moderation</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Is this media quarantined/released, and why? Release requires two DIFFERENT admins&apos; approval, enforced
        server-side — this screen can never complete a release alone.
      </p>

      {/* PHASE 28-D — the review queue. A READ: picking an item fills the
          asset-id field below, and the release path is unchanged. Nothing
          here can release anything; a queue that could would be a second
          authority alongside Phase 9-E's two-person lane. */}
      <div className="mb-6 rounded border border-neutral-800 p-3">
        <h3 className="mb-2 text-sm font-medium text-neutral-200">Awaiting human review</h3>
        {queue.kind === "loading" && <p className="text-xs text-neutral-400">Loading queue…</p>}
        {queue.kind === "denied" && <p className="text-xs text-red-400">Access denied.</p>}
        {queue.kind === "unavailable" && (
          <p className="text-xs text-red-400">Queue unavailable ({queue.reasonCode}).</p>
        )}
        {queue.kind === "loaded" && queue.queue.outcome === "QUEUE_UNAVAILABLE" && (
          <p className="text-xs text-red-400">Queue unavailable ({queue.queue.reasonCode}).</p>
        )}
        {queue.kind === "loaded" && queue.queue.outcome === "FOUND" && queueItems.length === 0 && (
          <p className="text-xs text-neutral-500">Nothing is waiting on a human.</p>
        )}
        {queueItems.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-neutral-400">
            {queueItems.map((item) => (
              <li key={item.decisionId} className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!item.mediaAssetId) return;
                    setAssetId(item.mediaAssetId);
                    setView({ kind: "loading" });
                    setAction({ kind: "idle" });
                    void fetchModerationView(item.mediaAssetId).then(setView);
                  }}
                  disabled={!item.mediaAssetId}
                  className="rounded border border-neutral-700 px-2 py-0.5 font-mono text-[11px] text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
                >
                  {item.mediaAssetId ?? "prompt-stage"}
                </button>
                <span>
                  output {item.outputIndex ?? "—"} · {item.reasonCode}
                </span>
                {item.riskCategories.length > 0 && (
                  <span className="text-neutral-500">[{item.riskCategories.join(", ")}]</span>
                )}
                {/* The vendor's opinion, shown as distinct from Cinefield's
                    verdict — a reviewer needs to know which of the two
                    raised the item. */}
                {item.providerSignalFlagged === true && (
                  <span className="text-amber-400">provider flagged ({item.providerSignalSource})</span>
                )}
                {item.appealOpen && <span className="text-sky-400">appeal open</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={onLoad} className="mb-6 flex gap-2">
        <input
          type="text"
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
          placeholder="Asset id (uuid)"
          className="w-96 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
        />
        <button
          type="submit"
          disabled={view.kind === "loading" || assetId.trim().length === 0}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          Investigate
        </button>
      </form>

      {view.kind === "idle" && <p className="text-sm text-neutral-500">Enter an asset id to begin.</p>}
      {view.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {view.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {view.kind === "unavailable" && <p className="text-sm text-red-400">Evidence unavailable ({view.reasonCode}).</p>}

      {view.kind === "loaded" && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-neutral-800 p-3 text-xs text-neutral-400">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Quarantine / moderation state</h3>
            {foundAsset ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt>quarantine status</dt>
                <dd>{foundAsset.quarantineStatus}</dd>
                <dt>moderation status</dt>
                <dd>{foundAsset.moderationStatus}</dd>
                <dt>moderation engine</dt>
                <dd>{foundAsset.moderationEngine ?? "not_evaluated (no engine configured)"}</dd>
                <dt>moderated at</dt>
                <dd>{foundAsset.moderatedAt ?? "—"}</dd>
                <dt>ingest status</dt>
                <dd>{foundAsset.ingestStatus}</dd>
                <dt>finalized</dt>
                <dd>{foundAsset.finalizedAt ?? "—"}</dd>
              </dl>
            ) : (
              <p>{view.body.asset.outcome === "ASSET_NOT_FOUND" ? "No asset found for that id." : "Asset evidence unavailable."}</p>
            )}
          </div>

          <div className="rounded border border-neutral-800 p-3 text-xs text-neutral-400">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Safety audit trail</h3>
            {view.body.audit.outcome === "FOUND" ? (
              view.body.audit.entries.length === 0 ? (
                <p>No safety audit entries.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {view.body.audit.entries.map((entry, i) => (
                    <div key={i} className="flex justify-between">
                      <span>
                        {entry.action} by {entry.actor}
                      </span>
                      <span>
                        {entry.reasonCode ?? "—"} · {entry.createdAt}
                      </span>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <p>Audit trail unavailable.</p>
            )}
          </div>

          {foundAsset && (
            <div className="rounded border border-neutral-800 p-3">
              <h3 className="mb-2 text-sm font-medium text-neutral-200">Action</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPendingAction("request");
                    setReasonCode("");
                    setAction({ kind: "idle" });
                  }}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                >
                  Request approval…
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingAction("approve");
                    setReasonCode("");
                    setAction({ kind: "idle" });
                  }}
                  className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950"
                >
                  Attempt release…
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingAction("reject");
                    setReasonCode("");
                    setAction({ kind: "idle" });
                  }}
                  className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 hover:bg-red-950"
                >
                  Reject…
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {pendingAction && (
        <form onSubmit={onConfirm} className="mt-3 flex flex-col gap-2 rounded border border-amber-800 p-3">
          <p className="text-sm text-amber-300">
            Confirm &quot;{pendingAction}&quot; for asset {assetId.trim()}.
          </p>
          <input
            type="text"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            placeholder="reason_code (lowercase, letters/digits/underscore)"
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!REASON_CODE_PATTERN.test(reasonCode) || action.kind === "loading"}
              className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
            >
              Confirm {pendingAction}
            </button>
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {action.kind === "loading" && <p className="mt-3 text-sm text-neutral-400">Submitting…</p>}
      {action.kind === "denied" && <p className="mt-3 text-sm text-red-400">Access denied.</p>}
      {action.kind === "invalid_target" && <p className="mt-3 text-sm text-red-400">Invalid asset id or reason code.</p>}
      {action.kind === "route_authority_denied" && (
        <p className="mt-3 text-sm text-amber-400">This admin account is not on the route-authority allowlist.</p>
      )}
      {action.kind === "unavailable" && <p className="mt-3 text-sm text-red-400">Action unavailable ({action.reasonCode}).</p>}
      {action.kind === "result" && (
        <p className="mt-3 text-sm text-neutral-300">
          {"outcome" in action.result ? JSON.stringify(action.result) : "Done."}
        </p>
      )}
    </section>
  );
}
