import type { HealthStatus } from "@/lib/health/health-contract";
import type { BullmqQueueSnapshot } from "./bullmq-admin-contract";

/**
 * Phase 16-B admin Queue Health contract — "are critical SQS and auxiliary
 * BullMQ lanes healthy?"
 *
 * Combines two ALREADY-REAL, already-owned read paths for one operator
 * glance rather than building a third: the SQS/redis-b `DependencyReport`
 * Phase 13's `readiness()` already produces (`sqs-command-health`), and the
 * Phase 15-D/3 DLQ peek (`dlq-presence`) already reused by the Failed
 * Jobs/DLQ page. This is not a duplicate CloudWatch alarm or a second
 * queue-health truth — it is these two existing truths, read together.
 */

export type DlqPresenceState = "EMPTY" | "MESSAGE_PRESENT" | "UNKNOWN";

export interface SqsCommandHealthView {
  readonly status: HealthStatus;
  readonly reason: string;
  readonly dlqPresence: DlqPresenceState;
}

export interface BullmqAuxiliaryHealthView {
  readonly configured: boolean;
  readonly queues: readonly BullmqQueueSnapshot[];
}

export interface QueueHealthResult {
  readonly sqs: SqsCommandHealthView;
  readonly bullmq: BullmqAuxiliaryHealthView;
  readonly evaluatedAt: string;
}
