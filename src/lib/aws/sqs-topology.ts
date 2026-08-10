/**
 * Cinefield SQS queue topology (Phase 6R.4).
 *
 * INTERNAL CINEFIELD OPERATIONAL POLICY — NOT PROVIDER CAPABILITY.
 * Every number here (retry counts, visibility windows, wait times) is
 * Cinefield's own operational choice, reviewable in this one file. Nothing
 * asserts anything about any AI provider's limits.
 *
 * This module is the reviewable infrastructure CONTRACT: queue names, type
 * (Standard vs FIFO), DLQ policy, and timing. The actual AWS resources are
 * created from it (console today, Terraform in 6R.16) — code never creates
 * queues at runtime.
 *
 * STANDARD vs FIFO — the audit per queue:
 *
 *   provider (FIFO)            Deduplication absorbs a duplicate dispatch of
 *                              the same command (Temporal activity retry,
 *                              double enqueue) inside SQS, and per-generation
 *                              MessageGroupId serializes commands for one
 *                              generation so two workers never process the
 *                              same generation concurrently. Both properties
 *                              are DEFENSE-IN-DEPTH — the authoritative
 *                              guards remain generation_attempts, the atomic
 *                              claim, and the DB uniqueness constraints.
 *
 *   generation-control (FIFO)  START/CANCEL/FINALIZE for one generation are
 *                              order-sensitive: a CANCEL overtaking its START
 *                              would be acted on out of order. FIFO with the
 *                              generation as the message group preserves
 *                              per-generation ordering.
 *
 *   provider-callback (Standard)  Provider callbacks arrive unordered from
 *                              the outside world anyway, and the continuation
 *                              core is idempotent by design (terminal-state
 *                              guards, finalization lease). Ordering would
 *                              add FIFO throughput limits for no property.
 *
 *   media-download / media-processing / moderation / backup (Standard)
 *                              Parallelizable, order-free work whose
 *                              idempotency comes from content (paths,
 *                              checksums), not sequence. Consumers arrive in
 *                              Phase 9 — the queues are named now so IAM and
 *                              IaC can be prepared, and stay empty until then.
 *
 * DLQ POLICY
 * Every queue gets a DLQ of the SAME type (SQS requires FIFO DLQs for FIFO
 * queues). maxReceiveCount = 5: enough redeliveries to ride out transient DB
 * or network failures, few enough that a poison message parks quickly.
 * DLQ redrive is NEVER automatic into a paid path — a redriven provider
 * command re-enters the worker, whose attempt-evidence gate decides whether
 * submission is still legal. Messages carry ids only, so a DLQ never holds a
 * secret or a payload.
 *
 * No imports, no secrets, no env reads: shared safely by app and workers.
 */

export interface QueueSpec {
  /** Physical queue name in AWS (FIFO names must end in .fifo). */
  name: string;
  fifo: boolean;
  /** DLQ name; same type as the main queue. */
  dlqName: string;
  /** Redeliveries before SQS parks the message in the DLQ. */
  maxReceiveCount: number;
  /**
   * Seconds a received message stays invisible. Sized to cover one bounded
   * worker handling (provider submit is bounded by the adapter's own 90s
   * timeout plus persistence) — NOT to cover a whole AI generation, which is
   * tracked by providerJobId after the command message is already deleted.
   */
  visibilityTimeoutSeconds: number;
  /** Long-poll wait. 20 is the SQS maximum — fewest empty receives. */
  receiveWaitTimeSeconds: number;
}

export const SQS_QUEUES = {
  provider: {
    name: "cinefield-provider.fifo",
    fifo: true,
    dlqName: "cinefield-provider-dlq.fifo",
    maxReceiveCount: 5,
    visibilityTimeoutSeconds: 180,
    receiveWaitTimeSeconds: 20,
  },
  generationControl: {
    name: "cinefield-generation-control.fifo",
    fifo: true,
    dlqName: "cinefield-generation-control-dlq.fifo",
    maxReceiveCount: 5,
    visibilityTimeoutSeconds: 60,
    receiveWaitTimeSeconds: 20,
  },
  providerCallback: {
    name: "cinefield-provider-callback",
    fifo: false,
    dlqName: "cinefield-provider-callback-dlq",
    maxReceiveCount: 5,
    visibilityTimeoutSeconds: 120,
    receiveWaitTimeSeconds: 20,
  },
  mediaDownload: {
    name: "cinefield-media-download",
    fifo: false,
    dlqName: "cinefield-media-download-dlq",
    maxReceiveCount: 5,
    visibilityTimeoutSeconds: 300,
    receiveWaitTimeSeconds: 20,
  },
  mediaProcessing: {
    name: "cinefield-media-processing",
    fifo: false,
    dlqName: "cinefield-media-processing-dlq",
    maxReceiveCount: 5,
    visibilityTimeoutSeconds: 900,
    receiveWaitTimeSeconds: 20,
  },
  moderation: {
    name: "cinefield-moderation",
    fifo: false,
    dlqName: "cinefield-moderation-dlq",
    maxReceiveCount: 5,
    visibilityTimeoutSeconds: 120,
    receiveWaitTimeSeconds: 20,
  },
  backup: {
    name: "cinefield-backup",
    fifo: false,
    dlqName: "cinefield-backup-dlq",
    maxReceiveCount: 3,
    visibilityTimeoutSeconds: 900,
    receiveWaitTimeSeconds: 20,
  },
} as const satisfies Record<string, QueueSpec>;

/**
 * Locked production region for Cinefield's AWS placement. Configuration may
 * override per environment, but no code silently introduces another region.
 */
export const DEFAULT_AWS_REGION = "eu-central-1";

/**
 * How long a provider command may sit in `claimed`/`submitting` before a
 * redelivered duplicate may treat the original handler as dead and convert
 * the attempt to ambiguous evidence. Comfortably larger than the provider
 * visibility timeout, so a live handler can never be preempted by its own
 * duplicate.
 */
export const ATTEMPT_STALE_AFTER_MS = 10 * 60 * 1000;
