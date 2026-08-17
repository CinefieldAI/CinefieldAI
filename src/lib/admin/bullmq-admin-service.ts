import "server-only";
import { getBullmqConnection } from "@/lib/bullmq/bullmq-connection";
import { getQueue } from "@/lib/bullmq/queue-factory";
import { BULLMQ_QUEUE_NAMES, type BullmqQueueName } from "@/lib/bullmq/queue-names";
import { createLogger } from "@/lib/observability/logger";
import {
  BULLMQ_JOB_ID_PATTERN,
  isValidBullmqActionReason,
  type BullmqFailedJobView,
  type BullmqFailedJobsResult,
  type BullmqHealthResult,
  type BullmqQueueSnapshot,
  type BullmqRetryResult,
} from "./bullmq-admin-contract";

/**
 * The Phase 16-B admin BullMQ auxiliary-queue read + retry service.
 *
 * Real `Queue`/`Job` API calls against the EXISTING Phase 6R.8 foundation
 * (`getQueue()`, `BULLMQ_QUEUE_NAMES`) — no second queue engine, no second
 * connection. `job.data` and `job.stacktrace` are never read or returned
 * anywhere in this file; only bounded id/name/count/timestamp fields and a
 * truncated `failedReason`.
 */

const auditLog = createLogger("admin-bullmq");
const FAILED_REASON_MAX_LENGTH = 300;
const MAX_FAILED_JOBS_PER_QUEUE = 20;

const QUEUE_NAME_VALUES: readonly BullmqQueueName[] = Object.values(BULLMQ_QUEUE_NAMES);

function boundedFailedReason(reason: unknown): string | null {
  if (typeof reason !== "string" || reason.length === 0) return null;
  return reason.length > FAILED_REASON_MAX_LENGTH ? `${reason.slice(0, FAILED_REASON_MAX_LENGTH)}…` : reason;
}

function isKnownQueueName(value: unknown): value is BullmqQueueName {
  return typeof value === "string" && (QUEUE_NAME_VALUES as readonly string[]).includes(value);
}

export async function getAdminBullmqHealth(): Promise<BullmqHealthResult> {
  if (!getBullmqConnection()) return { outcome: "NOT_CONFIGURED" };

  try {
    const queues: BullmqQueueSnapshot[] = await Promise.all(
      QUEUE_NAME_VALUES.map(async (queueName): Promise<BullmqQueueSnapshot> => {
        const queue = getQueue(queueName);
        const counts = queue
          ? await queue.getJobCounts("waiting", "active", "failed", "completed", "delayed")
          : { waiting: 0, active: 0, failed: 0, completed: 0, delayed: 0 };
        return {
          queueName,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
          delayed: counts.delayed ?? 0,
        };
      })
    );
    return { outcome: "FOUND", queues };
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "bullmq_read_failed" };
  }
}

export async function listAdminBullmqFailedJobs(): Promise<BullmqFailedJobsResult> {
  if (!getBullmqConnection()) return { outcome: "NOT_CONFIGURED" };

  const jobs: BullmqFailedJobView[] = [];
  for (const queueName of QUEUE_NAME_VALUES) {
    const queue = getQueue(queueName);
    if (!queue) continue;
    try {
      const failed = await queue.getFailed(0, MAX_FAILED_JOBS_PER_QUEUE - 1);
      for (const job of failed) {
        if (!job.id) continue;
        jobs.push({
          queueName,
          jobId: job.id,
          name: job.name,
          attemptsMade: job.attemptsMade ?? 0,
          failedReason: boundedFailedReason(job.failedReason),
          failedAt: new Date(job.timestamp).toISOString(),
        });
      }
    } catch {
      // Best-effort per queue: one unreadable queue must not blank the
      // others out.
    }
  }
  return { outcome: "FOUND", jobs };
}

export async function retryAdminBullmqJob(
  actorClerkUserId: string,
  queueNameInput: unknown,
  jobIdInput: unknown,
  reasonInput: unknown
): Promise<BullmqRetryResult> {
  if (!isKnownQueueName(queueNameInput) || typeof jobIdInput !== "string" || !BULLMQ_JOB_ID_PATTERN.test(jobIdInput) || !isValidBullmqActionReason(reasonInput)) {
    return { outcome: "INVALID_TARGET" };
  }
  const queueName = queueNameInput;
  const jobId = jobIdInput;
  const reason = reasonInput.trim();

  if (!getBullmqConnection()) return { outcome: "NOT_CONFIGURED" };
  const queue = getQueue(queueName);
  if (!queue) return { outcome: "NOT_CONFIGURED" };

  let job;
  try {
    job = await queue.getJob(jobId);
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "bullmq_read_failed" };
  }
  if (!job) return { outcome: "JOB_NOT_FOUND" };

  // Fresh recheck, never trusting a state the client claims — the same
  // "recompute immediately before acting" discipline the DLQ redrive
  // executor uses.
  let state: string;
  try {
    state = await job.getState();
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "bullmq_state_read_failed" };
  }
  if (state !== "failed") {
    auditLog.info("bullmq_retry_refused", { actorClerkUserId, queueName, jobId, reason, state });
    return { outcome: "NOT_FAILED" };
  }

  try {
    await job.retry();
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "bullmq_retry_failed" };
  }

  auditLog.info("bullmq_retry_applied", { actorClerkUserId, queueName, jobId, reason });
  return { outcome: "RETRIED", queueName, jobId };
}
