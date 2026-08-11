import "server-only";
import { Queue } from "bullmq";
import { getBullmqConnection } from "./bullmq-connection";
import { BULLMQ_DEFAULT_JOB_OPTIONS } from "./bullmq-job-defaults";
import type { BullmqQueueName } from "./queue-names";

/**
 * Cinefield BullMQ queue construction (Phase 6R.8).
 *
 * Uses ONLY the dedicated Redis B connection (`bullmq-connection.ts`) —
 * never Redis A, never a fallback. Lazy: no `Queue` is constructed, and no
 * socket is opened, until a caller actually calls `getQueue()`.
 *
 * MEMOIZED, NOT RE-CREATED PER CALL
 * Repeated calls for the same queue name return the SAME `Queue` instance
 * — BullMQ's own `Queue` object holds real resources (an internal
 * connection reference, event listeners); constructing a fresh one per
 * call would leak them. This mirrors the same "process-wide singleton"
 * discipline `redis-client.ts`'s `getRedisClient()` already uses for
 * Redis A.
 *
 * NOT WIRED IN YET. No route, job, or workflow calls this today — this
 * phase is the queue-construction foundation only.
 */

const queues = new Map<string, Queue>();

/**
 * Returns a memoized `Queue` for the given name, or null when Redis B is
 * not enabled/configured. Accepts any queue name string (not narrowed to
 * `BullmqQueueName` alone) so the Phase 6R.8 foundation-test queue name
 * can also be constructed through this same factory — production callers
 * should still only ever pass a name from `BULLMQ_QUEUE_NAMES`.
 */
export function getQueue(name: BullmqQueueName | string): Queue | null {
  const connection = getBullmqConnection();
  if (!connection) return null;

  const existing = queues.get(name);
  if (existing) return existing;

  const queue = new Queue(name, {
    connection,
    defaultJobOptions: BULLMQ_DEFAULT_JOB_OPTIONS,
  });
  queues.set(name, queue);
  return queue;
}
