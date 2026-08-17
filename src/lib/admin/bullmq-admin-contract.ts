import type { BullmqQueueName } from "@/lib/bullmq/queue-names";

/**
 * Phase 16-B admin BullMQ auxiliary-queue contract.
 *
 * ---------------------------------------------------------------------------
 * AUXILIARY, NEVER CRITICAL — AND HONESTLY EMPTY TODAY
 * ---------------------------------------------------------------------------
 * `queue-names.ts`'s own header states plainly: none of the four named
 * queues (`media-short`, `notifications`, `cache-refresh`, `webhook-retry`)
 * has a real job handler yet, and Redis B is unprovisioned in every
 * environment (`infra/modules/redis/main.tf`). This surface is real,
 * reusable code against the real `getQueue()`/BullMQ API — it is not a
 * stub — but until a future phase wires a real producer, every queue it
 * reports on will honestly show zero jobs everywhere, and `NOT_CONFIGURED`
 * in this environment specifically (no `BULLMQ_REDIS_URL`). That is the
 * correct, honest state to display, not a reason to fake data.
 */

export interface BullmqQueueSnapshot {
  readonly queueName: BullmqQueueName;
  readonly waiting: number;
  readonly active: number;
  readonly failed: number;
  readonly completed: number;
  readonly delayed: number;
}

export type BullmqHealthResult =
  | { readonly outcome: "NOT_CONFIGURED" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly queues: readonly BullmqQueueSnapshot[] };

export interface BullmqFailedJobView {
  readonly queueName: BullmqQueueName;
  readonly jobId: string;
  readonly name: string;
  readonly attemptsMade: number;
  /** Bounded/truncated. Never `job.stacktrace`, never `job.data`. */
  readonly failedReason: string | null;
  readonly failedAt: string;
}

export type BullmqFailedJobsResult =
  | { readonly outcome: "NOT_CONFIGURED" }
  | { readonly outcome: "FOUND"; readonly jobs: readonly BullmqFailedJobView[] };

export type BullmqRetryResult =
  | { readonly outcome: "NOT_CONFIGURED" }
  | { readonly outcome: "INVALID_TARGET" }
  | { readonly outcome: "JOB_NOT_FOUND" }
  | { readonly outcome: "NOT_FAILED" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "RETRIED"; readonly queueName: BullmqQueueName; readonly jobId: string };

export const BULLMQ_ACTION_REASON_MAX_LENGTH = 500;

export function isValidBullmqActionReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= BULLMQ_ACTION_REASON_MAX_LENGTH;
}

/** BullMQ's own default job-id shape (numeric or a caller-supplied bounded string). */
export const BULLMQ_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
