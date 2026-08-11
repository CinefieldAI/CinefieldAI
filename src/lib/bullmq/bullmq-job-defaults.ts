/**
 * Cinefield BullMQ technical defaults (Phase 6R.8).
 *
 * No network, no I/O — pure constants, safe to import anywhere.
 *
 * TECHNICAL DEFAULTS ONLY — NEVER A BUSINESS SLA
 * `attempts`, `backoff`, and retention are conservative engineering
 * choices to keep a job from retrying forever and to keep Redis B's
 * memory bounded — they are not a product promise about how fast a
 * thumbnail or a notification email must land. A future real job type may
 * override these per-job if it has a genuine, documented reason to; this
 * file only sets what a job gets if it does not.
 *
 * ===========================================================================
 * BULLMQ RETRY DOES NOT REPLACE BUSINESS IDEMPOTENCY
 * ===========================================================================
 * A BullMQ `jobId` can prevent an OBVIOUS duplicate enqueue (BullMQ itself
 * refuses to create a second job with an already-active identical jobId) —
 * but that is a queue-level convenience, not a correctness guarantee.
 * BullMQ does NOT provide exactly-once execution: a worker can crash after
 * completing real work but before BullMQ records the job as finished, and
 * the job will be retried. Any durable business effect a future job
 * performs (writing to Postgres, mutating a Storage object, calling an
 * external API) MUST remain idempotent at the service/DB layer on its own
 * — the same discipline `generation_attempts`'s
 * `claimAttemptForSubmission` CAS already provides for provider
 * submission, and the same reason `src/lib/redis/idempotency-store.ts`
 * exists as a separate, deliberate mechanism. Nothing in this file
 * weakens or substitutes for either of those.
 */

export const BULLMQ_DEFAULT_JOB_OPTIONS = {
  /** Bounded retry count — a job must not retry forever. */
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 1_000 },
  /** Bounds Redis B memory: completed jobs are GC'd after 1h / the last 1000, whichever is smaller. */
  removeOnComplete: { age: 3_600, count: 1_000 },
  /** Failed jobs kept longer for debugging, still bounded. */
  removeOnFail: { age: 86_400, count: 1_000 },
} as const;
