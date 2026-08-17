"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  interpretUserInvestigationResponse,
  networkErrorState,
  type UserInvestigationPanelState,
} from "@/lib/admin/user-investigation-client-state";
import type { RecentGenerationSummaryView, UserSummaryView } from "@/lib/admin/user-investigation-contract";

/**
 * Phase 16-A/3 User Investigation screen — client half.
 *
 * Answers exactly one operator question: "what has happened for this user
 * recently, and which generation can I inspect end-to-end?" Manual entry,
 * manual submit — no auto-search, no polling, no action of any kind. Each
 * recent generation links into the already-built `/admin/generations`
 * investigation surface by id; this panel never re-implements attempt/trace
 * rendering itself.
 */

async function fetchUserInvestigation(clerkUserId: string): Promise<UserInvestigationPanelState> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/users/${encodeURIComponent(clerkUserId)}`, { cache: "no-store" });
  } catch {
    return networkErrorState();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  return interpretUserInvestigationResponse(response.status, body);
}

function UserFields({ user }: { user: UserSummaryView }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-400">
      <dt>clerk user id</dt>
      <dd>{user.clerkUserId}</dd>
      <dt>display name</dt>
      <dd>{user.displayName ?? "—"}</dd>
      <dt>created</dt>
      <dd>{user.createdAt}</dd>
      <dt>updated</dt>
      <dd>{user.updatedAt}</dd>
    </dl>
  );
}

function RecentGenerationsList({ generations }: { generations: readonly RecentGenerationSummaryView[] }) {
  if (generations.length === 0) {
    return <p className="text-xs text-neutral-500">No generations recorded for this user.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {generations.map((generation) => (
        <div key={generation.generationId} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-neutral-200">{generation.generationId}</span>
            <span>{generation.status}</span>
          </div>
          <div>
            type: {generation.generationType} · project (ref): {generation.projectId}
          </div>
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

export default function UserInvestigationPanel() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<UserInvestigationPanelState>({ kind: "idle" });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = input.trim();
    if (!id) return;
    setState({ kind: "loading" });
    void fetchUserInvestigation(id).then(setState);
  };

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-neutral-100">User Investigation</h2>

      <form onSubmit={onSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Clerk user id (user_...)"
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

      {state.kind === "idle" && <p className="text-sm text-neutral-500">Enter a Clerk user id to begin.</p>}
      {state.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {state.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {state.kind === "not_found" && <p className="text-sm text-amber-400">No user found for that id.</p>}
      {state.kind === "unavailable" && (
        <p className="text-sm text-red-400">Evidence unavailable ({state.reasonCode}).</p>
      )}

      {state.kind === "partial_data" && (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-amber-400">
            Partial result ({state.result.reasonCode}) — some evidence could not be read.
          </p>
          {state.result.user && (
            <div className="rounded border border-neutral-800 p-3">
              <h3 className="mb-2 text-sm font-medium text-neutral-200">User</h3>
              <UserFields user={state.result.user} />
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
            <h3 className="mb-2 text-sm font-medium text-neutral-200">User</h3>
            <UserFields user={state.result.user} />
          </div>
          <p className="text-sm text-neutral-500">No generations recorded for this user yet.</p>
        </div>
      )}

      {state.kind === "found" && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">User</h3>
            <UserFields user={state.result.user} />
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
