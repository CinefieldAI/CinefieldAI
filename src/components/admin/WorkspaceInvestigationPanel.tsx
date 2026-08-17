"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  interpretWorkspaceInvestigationResponse,
  networkErrorState,
  type WorkspaceInvestigationPanelState,
} from "@/lib/admin/workspace-investigation-client-state";
import type {
  RecentWorkspaceGenerationView,
  WorkspaceSummaryView,
} from "@/lib/admin/workspace-investigation-contract";

/**
 * Phase 16-A/4 Workspace / Project Investigation screen — client half.
 *
 * Answers exactly one operator question: "what belongs to this
 * project/workspace, who owns it, and which generations can I inspect
 * end-to-end?" Manual entry, manual submit — no auto-search, no polling, no
 * action of any kind. The owner reference links out to `/admin/users`; each
 * recent generation links into `/admin/generations` — this panel never
 * re-implements user or generation investigation itself.
 *
 * Labelled "Workspace / Project" throughout, not "Workspace" alone — the
 * roadmap concept has no separate table in this schema; `public.projects` is
 * the canonical thing being investigated (see
 * `workspace-investigation-contract.ts`'s header).
 */

async function fetchWorkspaceInvestigation(projectId: string): Promise<WorkspaceInvestigationPanelState> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/workspaces/${encodeURIComponent(projectId)}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  return interpretWorkspaceInvestigationResponse(response.status, body);
}

function WorkspaceFields({ workspace }: { workspace: WorkspaceSummaryView }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-400">
      <dt>project id</dt>
      <dd>{workspace.projectId}</dd>
      <dt>title</dt>
      <dd>{workspace.title}</dd>
      <dt>status</dt>
      <dd>{workspace.status}</dd>
      <dt>owner (clerk user id)</dt>
      <dd>
        <Link
          href={`/admin/users?clerkUserId=${encodeURIComponent(workspace.ownerClerkUserId)}`}
          className="text-neutral-300 underline hover:text-neutral-100"
        >
          {workspace.ownerClerkUserId}
        </Link>
      </dd>
      <dt>created</dt>
      <dd>{workspace.createdAt}</dd>
      <dt>updated</dt>
      <dd>{workspace.updatedAt}</dd>
    </dl>
  );
}

function RecentGenerationsList({ generations }: { generations: readonly RecentWorkspaceGenerationView[] }) {
  if (generations.length === 0) {
    return <p className="text-xs text-neutral-500">No generations recorded for this project.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {generations.map((generation) => (
        <div key={generation.generationId} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-neutral-200">{generation.generationId}</span>
            <span>{generation.status}</span>
          </div>
          <div>type: {generation.generationType}</div>
          <div>
            created {generation.createdAt} · updated {generation.updatedAt} · completed{" "}
            {generation.completedAt ?? "—"}
          </div>
          <Link
            href={`/admin/generations?generationId=${encodeURIComponent(generation.generationId)}`}
            className="mt-1 inline-block text-neutral-300 underline hover:text-neutral-100"
          >
            Investigate this generation →
          </Link>
        </div>
      ))}
    </div>
  );
}

export default function WorkspaceInvestigationPanel() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<WorkspaceInvestigationPanelState>({ kind: "idle" });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = input.trim();
    if (!id) return;
    setState({ kind: "loading" });
    void fetchWorkspaceInvestigation(id).then(setState);
  };

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-neutral-100">Workspace / Project Investigation</h2>

      <form onSubmit={onSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Project id (uuid)"
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

      {state.kind === "idle" && <p className="text-sm text-neutral-500">Enter a project id to begin.</p>}
      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "not_found" && <p className="text-sm text-amber-400">No workspace found for that id.</p>}
      {state.kind === "unavailable" && (
        <p className="text-sm text-red-400">Evidence unavailable ({state.reasonCode}).</p>
      )}

      {state.kind === "partial_data" && (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-amber-400">
            Partial result ({state.result.reasonCode}) — some evidence could not be read.
          </p>
          {state.result.workspace && (
            <div className="rounded border border-neutral-800 p-3">
              <h3 className="mb-2 text-sm font-medium text-neutral-200">Workspace / Project</h3>
              <WorkspaceFields workspace={state.result.workspace} />
            </div>
          )}
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">
              Recent generations ({state.result.recentGenerations.length})
            </h3>
            <RecentGenerationsList generations={state.result.recentGenerations} />
          </div>
        </div>
      )}

      {state.kind === "no_generations" && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Workspace / Project</h3>
            <WorkspaceFields workspace={state.result.workspace} />
          </div>
          <p className="text-sm text-neutral-500">No generations recorded for this project yet.</p>
        </div>
      )}

      {state.kind === "found" && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">Workspace / Project</h3>
            <WorkspaceFields workspace={state.result.workspace} />
          </div>
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">
              Recent generations ({state.result.recentGenerations.length})
            </h3>
            <RecentGenerationsList generations={state.result.recentGenerations} />
          </div>
        </div>
      )}
    </section>
  );
}
