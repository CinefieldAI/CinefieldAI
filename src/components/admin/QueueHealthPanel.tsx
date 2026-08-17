"use client";

import { useEffect, useState } from "react";
import {
  interpretBullmqFailedResponse,
  interpretBullmqRetryResponse,
  interpretQueueHealthResponse,
  networkErrorState,
  type BullmqFailedPanelState,
  type BullmqRetryPanelState,
  type QueueHealthPanelState,
} from "@/lib/admin/queue-health-client-state";
import type { BullmqFailedJobView } from "@/lib/admin/bullmq-admin-contract";

/**
 * Phase 16-B Queue Health screen — client half.
 *
 * Are critical SQS and auxiliary BullMQ lanes healthy? Loads automatically
 * on mount (a pure read, matching `SystemHealthPanel`'s own convention);
 * the BullMQ failed-job list and its retry action are a second, explicit
 * step below.
 */

async function fetchQueueHealth(): Promise<QueueHealthPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/queue-health", { cache: "no-store" });
  } catch {
    return networkErrorState();
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretQueueHealthResponse(response.status, body);
}

async function fetchBullmqFailed(): Promise<BullmqFailedPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/queue-health/bullmq-failed", { cache: "no-store" });
  } catch {
    return { kind: "idle" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return interpretBullmqFailedResponse(response.status, body);
}

async function postBullmqRetry(queueName: string, jobId: string, reason: string): Promise<BullmqRetryPanelState> {
  let response: Response;
  try {
    response = await fetch("/api/admin/queue-health/bullmq-retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queueName, jobId, reason }),
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
  return interpretBullmqRetryResponse(response.status, body);
}

export default function QueueHealthPanel() {
  const [health, setHealth] = useState<QueueHealthPanelState>({ kind: "loading" });
  const [failed, setFailed] = useState<BullmqFailedPanelState>({ kind: "idle" });
  const [target, setTarget] = useState<BullmqFailedJobView | null>(null);
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<BullmqRetryPanelState>({ kind: "idle" });

  useEffect(() => {
    void fetchQueueHealth().then(setHealth);
    void fetchBullmqFailed().then(setFailed);
  }, []);

  const onConfirmRetry = () => {
    if (!target || !reason.trim()) return;
    setAction({ kind: "loading" });
    void postBullmqRetry(target.queueName, target.jobId, reason.trim()).then((result) => {
      setAction(result);
      setTarget(null);
      if (result.kind === "retried") void fetchBullmqFailed().then(setFailed);
    });
  };

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-neutral-100">Queue Health</h2>
      <p className="mb-4 text-xs text-neutral-500">Are critical SQS and auxiliary BullMQ lanes healthy?</p>

      {health.kind === "loading" && <p className="text-sm text-neutral-400">Loading…</p>}
      {health.kind === "denied" && <p className="text-sm text-red-400">Access denied.</p>}
      {health.kind === "unavailable" && <p className="text-sm text-red-400">Health unavailable ({health.reasonCode}).</p>}

      {health.kind === "found" && (
        <div className="mb-6 flex flex-col gap-4">
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">SQS command lane (critical)</h3>
            <p className="text-xs text-neutral-400">
              status: {health.result.sqs.status} · reason: {health.result.sqs.reason} · dlq: {health.result.sqs.dlqPresence}
            </p>
          </div>
          <div className="rounded border border-neutral-800 p-3">
            <h3 className="mb-2 text-sm font-medium text-neutral-200">BullMQ auxiliary lanes</h3>
            <p className="mb-2 text-xs text-neutral-400">
              {health.result.bullmq.configured ? "configured" : "not configured (Redis B unprovisioned)"}
            </p>
            {health.result.bullmq.configured && (
              <div className="flex flex-col gap-1">
                {health.result.bullmq.queues.map((q) => (
                  <div key={q.queueName} className="flex justify-between text-xs text-neutral-400">
                    <span>{q.queueName}</span>
                    <span>
                      waiting {q.waiting} · active {q.active} · failed {q.failed} · completed {q.completed} · delayed{" "}
                      {q.delayed}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded border border-neutral-800 p-3">
        <h3 className="mb-2 text-sm font-medium text-neutral-200">Failed auxiliary jobs</h3>
        {failed.kind === "idle" && <p className="text-xs text-neutral-500">Loading…</p>}
        {failed.kind === "not_configured" && <p className="text-xs text-neutral-500">BullMQ is not configured.</p>}
        {failed.kind === "denied" && <p className="text-xs text-red-400">Access denied.</p>}
        {failed.kind === "found" && (
          <div className="flex flex-col gap-2">
            {failed.result.jobs.length === 0 ? (
              <p className="text-xs text-neutral-500">No failed jobs.</p>
            ) : (
              failed.result.jobs.map((job) => (
                <div key={`${job.queueName}:${job.jobId}`} className="rounded border border-neutral-900 p-2 text-xs text-neutral-400">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-neutral-200">
                      {job.queueName} · {job.name} · {job.jobId}
                    </span>
                    <span>attempts: {job.attemptsMade}</span>
                  </div>
                  <div>reason: {job.failedReason ?? "—"}</div>
                  <div>failed at: {job.failedAt}</div>
                  <button
                    type="button"
                    onClick={() => {
                      setTarget(job);
                      setReason("");
                      setAction({ kind: "idle" });
                    }}
                    className="mt-1 rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-900"
                  >
                    Retry…
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {target && (
        <div className="mt-3 flex flex-col gap-2 rounded border border-amber-800 p-3">
          <p className="text-sm text-amber-300">
            Confirm retry of {target.queueName} job {target.jobId}. Job state is rechecked on the server before retrying.
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
              type="button"
              onClick={onConfirmRetry}
              disabled={reason.trim().length === 0 || action.kind === "loading"}
              className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
            >
              Confirm retry
            </button>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {action.kind === "loading" && <p className="mt-3 text-sm text-neutral-400">Retrying…</p>}
      {action.kind === "denied" && <p className="mt-3 text-sm text-red-400">Access denied.</p>}
      {action.kind === "invalid_target" && <p className="mt-3 text-sm text-red-400">Invalid job or missing reason.</p>}
      {action.kind === "not_configured" && <p className="mt-3 text-sm text-red-400">BullMQ is not configured.</p>}
      {action.kind === "job_not_found" && <p className="mt-3 text-sm text-amber-400">That job no longer exists.</p>}
      {action.kind === "not_failed" && <p className="mt-3 text-sm text-amber-400">That job is no longer in a failed state.</p>}
      {action.kind === "unavailable" && <p className="mt-3 text-sm text-red-400">Retry unavailable ({action.reasonCode}).</p>}
      {action.kind === "retried" && (
        <p className="mt-3 text-sm text-green-400">
          Retried {action.result.queueName} job {action.result.jobId}.
        </p>
      )}
    </section>
  );
}
