import "server-only";
import { Worker, type Job } from "bullmq";
import { getBullmqConnection } from "./bullmq-connection";
import { BULLMQ_FOUNDATION_TEST_QUEUE_NAME } from "./queue-names";
import {
  buildSyntheticTestJobPayload,
  type SyntheticTestJobPayload,
  type SyntheticTestJobResult,
} from "./job-contracts";
import { getQueue } from "./queue-factory";

/**
 * Cinefield BullMQ worker foundation (Phase 6R.8).
 *
 * Proves the acquire -> enqueue -> process -> complete path works, using
 * ONE harmless synthetic no-op job. This is deliberately the ONLY worker
 * this phase creates — no production handler (thumbnail, notification,
 * cache-refresh, webhook-retry) is implemented here, matching the
 * instruction to keep unbuilt task handlers unimplemented rather than
 * stubbed-out placeholders that look more finished than they are.
 *
 * The synthetic job processor:
 *   - calls no provider
 *   - creates no generation
 *   - modifies no credits
 *   - sends no email
 *   - modifies no real asset
 *   - calls no external API
 * It only echoes its input back with a timestamp, deterministically.
 *
 * NOT AUTO-STARTED. Constructing this module does nothing — a `Worker` is
 * only created when `createSyntheticTestWorker()` is explicitly called
 * (e.g. by the Step 13/16 validation), and the caller owns closing it.
 */

export function enqueueSyntheticTestJob(testId: string, echo: string) {
  const queue = getQueue(BULLMQ_FOUNDATION_TEST_QUEUE_NAME);
  if (!queue) return null;
  const payload = buildSyntheticTestJobPayload(testId, echo);
  return queue.add("synthetic-test", payload, { jobId: testId });
}

/**
 * Creates (but does not start listening until BullMQ's own internal
 * connect resolves) a Worker bound to the foundation-test queue. Returns
 * null when Redis B is unavailable. The caller is responsible for calling
 * `.close()` when done.
 */
export function createSyntheticTestWorker(): Worker<SyntheticTestJobPayload, SyntheticTestJobResult> | null {
  const connection = getBullmqConnection();
  if (!connection) return null;

  return new Worker<SyntheticTestJobPayload, SyntheticTestJobResult>(
    BULLMQ_FOUNDATION_TEST_QUEUE_NAME,
    async (job: Job<SyntheticTestJobPayload>): Promise<SyntheticTestJobResult> => {
      return { echoed: job.data.echo, processedAt: new Date().toISOString() };
    },
    { connection }
  );
}
