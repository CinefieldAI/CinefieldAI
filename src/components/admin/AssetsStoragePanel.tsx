"use client";

import { useState, type FormEvent } from "react";
import {
  interpretAssetResponse,
  networkErrorState,
  type AssetPanelState,
} from "@/lib/admin/asset-admin-client-state";
import type { AssetDetailView, AssetLookupIdentifierType } from "@/lib/admin/asset-admin-contract";

/**
 * Phase 16-C Assets / Storage screen — client half.
 *
 * "Where is this asset, what state is it in, and is storage evidence
 * healthy?" Read-only, storage/backup-field emphasis — see
 * `ModerationPanel.tsx` for the same underlying data with a moderation/
 * quarantine emphasis plus the release action.
 */

const IDENTIFIER_OPTIONS: { value: AssetLookupIdentifierType; label: string; placeholder: string }[] = [
  { value: "asset_id", label: "Asset id", placeholder: "uuid" },
  { value: "generation_id", label: "Generation id", placeholder: "uuid" },
];

async function fetchAssets(identifierType: AssetLookupIdentifierType, identifierValue: string): Promise<AssetPanelState> {
  let response: Response;
  try {
    const params = new URLSearchParams({ identifierType, identifierValue });
    response = await fetch(`/api/admin/assets?${params.toString()}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretAssetResponse(response.status, body);
}

function AssetCard({ asset }: { asset: AssetDetailView }) {
  return (
    <div className="rounded border border-neutral-800 p-3 text-xs text-neutral-400">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-neutral-200">{asset.assetId}</span>
        <span>{asset.status}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt>media type</dt>
        <dd>{asset.mediaType} · {asset.role}</dd>
        <dt>storage backend</dt>
        <dd>{asset.storageBackend}</dd>
        <dt>byte size</dt>
        <dd>{asset.byteSize ?? "—"}</dd>
        <dt>verified mime</dt>
        <dd>{asset.verifiedMime ?? "—"}</dd>
        <dt>checksum</dt>
        <dd className="truncate">{asset.checksumSha256 ?? "—"}</dd>
        <dt>ingest status</dt>
        <dd>{asset.ingestStatus}</dd>
        <dt>ingest failure</dt>
        <dd>{asset.ingestFailureReason ?? "—"}</dd>
        <dt>backup status</dt>
        <dd>{asset.backupStatus}</dd>
        <dt>backup backend</dt>
        <dd>{asset.backupBackend ?? "—"}</dd>
        <dt>backup completed</dt>
        <dd>{asset.backupCompletedAt ?? "—"}</dd>
        <dt>created</dt>
        <dd>{asset.createdAt}</dd>
        <dt>finalized</dt>
        <dd>{asset.finalizedAt ?? "—"}</dd>
        <dt>tombstoned</dt>
        <dd>{asset.tombstonedAt ?? "—"}</dd>
        <dt>duplicate of</dt>
        <dd>{asset.duplicateOfAssetId ?? "—"}</dd>
        <dt>generation</dt>
        <dd>{asset.generationId ?? "—"}</dd>
        <dt>owner</dt>
        <dd>{asset.clerkUserId}</dd>
      </dl>
    </div>
  );
}

export default function AssetsStoragePanel() {
  const [identifierType, setIdentifierType] = useState<AssetLookupIdentifierType>("asset_id");
  const [input, setInput] = useState("");
  const [state, setState] = useState<AssetPanelState>({ kind: "idle" });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    setState({ kind: "loading" });
    void fetchAssets(identifierType, value).then(setState);
  };

  const activeOption = IDENTIFIER_OPTIONS.find((o) => o.value === identifierType) ?? IDENTIFIER_OPTIONS[0];

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Assets / Storage</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Where is this asset, what state is it in, and is storage evidence healthy? R2 is canonical/live; S3 is DR
        backup evidence only.
      </p>

      <form onSubmit={onSubmit} className="mb-6 flex gap-2">
        <select
          value={identifierType}
          onChange={(e) => setIdentifierType(e.target.value as AssetLookupIdentifierType)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
        >
          {IDENTIFIER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={activeOption.placeholder}
          className="w-96 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
        />
        <button
          type="submit"
          disabled={state.kind === "loading" || input.trim().length === 0}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          Investigate
        </button>
      </form>

      {state.kind === "idle" && <p className="text-sm text-neutral-500">Enter an identifier to begin.</p>}
      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "invalid" && <p className="text-sm text-amber-400">That identifier is not a valid {activeOption.label.toLowerCase()}.</p>}
      {state.kind === "unavailable" && <p className="text-sm text-red-400">Storage evidence unavailable ({state.reasonCode}).</p>}
      {state.kind === "not_found" && <p className="text-sm text-amber-400">No asset found for that id.</p>}

      {state.kind === "found" && (
        <div className="flex flex-col gap-3">
          {state.result.assets.map((asset) => (
            <AssetCard key={asset.assetId} asset={asset} />
          ))}
        </div>
      )}
    </section>
  );
}
