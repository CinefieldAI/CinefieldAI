/**
 * Cinefield BullMQ queue-name contract (Phase 6R.8).
 *
 * The single place every BullMQ queue name is defined. No other module may
 * write a queue-name string literal — the same "one reviewable contract"
 * discipline `src/lib/aws/sqs-topology.ts` applies to SQS queue names and
 * `src/lib/redis/redis-keys.ts` applies to Redis A keys.
 *
 * GROUPED BY EXECUTION CHARACTERISTICS, NOT ONE QUEUE PER TASK TYPE
 * The Phase 6R.8 roadmap lists eight example task types (thumbnail,
 * metadata, preview, optimize, notification, email, cache-refresh, short
 * webhook retry) — this deliberately does NOT create eight queues. Tasks
 * are grouped by how they actually behave under load and failure, not by
 * their product label:
 *
 *   media-short      thumbnail / metadata / preview / optimize — all
 *                     short, CPU/IO-bound media post-processing with the
 *                     same retry shape (a transient failure is worth
 *                     retrying a few times; nothing here is safe to retry
 *                     forever).
 *
 *   notifications     notification / email — both "tell the user
 *                     something happened", sharing the same delivery
 *                     semantics (idempotent send, safe to retry, no
 *                     ordering requirement between different
 *                     notifications).
 *
 *   cache-refresh     repopulating a Redis A cache entry (model-cache,
 *                     pricing-cache) after its authoritative source
 *                     changed. Distinct from media-short because failure
 *                     here is low-stakes (Redis A already fails open on a
 *                     miss) and retries can be sparser.
 *
 *   webhook-retry     short retry of an inbound/outbound webhook delivery.
 *                     Kept separate from notifications because webhook
 *                     retry has different backoff/timeout characteristics
 *                     (bounded by the remote party's own retry window) and
 *                     must never be silently merged into a generic
 *                     notification retry policy.
 *
 * NONE OF THESE QUEUES HAVE A REAL JOB HANDLER YET. This phase defines the
 * names and the job/queue plumbing only — no production job processor
 * exists for any of them. Do not assume a queue being named here means
 * work is happening on it.
 */

export const BULLMQ_QUEUE_NAMES = {
  mediaShort: "media-short",
  notifications: "notifications",
  cacheRefresh: "cache-refresh",
  webhookRetry: "webhook-retry",
} as const;

export type BullmqQueueName = (typeof BULLMQ_QUEUE_NAMES)[keyof typeof BULLMQ_QUEUE_NAMES];

/**
 * A queue reserved for THIS phase's own zero-cost/live foundation
 * validation only. Never used by a real job — kept namespaced separately
 * from the four production-shaped queues above so a future reader can
 * never mistake foundation-test traffic for real background work.
 */
export const BULLMQ_FOUNDATION_TEST_QUEUE_NAME = "6r8-foundation-test";
