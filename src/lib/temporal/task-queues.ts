/**
 * Cinefield Temporal task queue names (Phase 6R.2).
 *
 * A task queue is the rendezvous between a workflow and the workers allowed
 * to run it. Splitting them lets one deployment scale, fail, or be rolled
 * back independently of another — a stuck media worker must never stall
 * generation workflows.
 *
 * These are stable protocol identifiers: a running workflow keeps referring
 * to the queue it was started on, so renaming one strands in-flight work.
 * Treat changes as a migration, not an edit.
 *
 * Deliberately free of imports and secrets so both the Next.js side and the
 * ECS worker can share this file.
 */

export const TASK_QUEUES = {
  /** GenerationWorkflow and its activities (Phase 6R.3). */
  generation: "cinefield-generation",
  /** Long media work: download, verify, transcode, storage ingest (Phase 9). */
  media: "cinefield-media",
  /** Operational workflows: reconciliation, cleanup, audit (Phase 6R.11). */
  operations: "cinefield-operations",
} as const;

export type TaskQueueName = (typeof TASK_QUEUES)[keyof typeof TASK_QUEUES];
