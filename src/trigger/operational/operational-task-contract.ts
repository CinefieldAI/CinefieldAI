/**
 * Cinefield Trigger.dev operational task contract (Phase 6R.11).
 *
 * Pure types — no network, no I/O, no Trigger.dev import — so the contract
 * can be unit-tested and reused by every operational task without pulling
 * the SDK into a test process.
 *
 * ===========================================================================
 * WHAT TRIGGER.DEV IS FOR, AFTER 6R.11
 * ===========================================================================
 *   TEMPORAL     long-running GenerationWorkflow ownership
 *   SQS          durable heavy / cross-service commands
 *   BULLMQ       short retryable background jobs
 *   KAFKA        facts that already happened
 *   TRIGGER.DEV  scheduled OPERATIONAL work — reconciliation, audit,
 *                health, cleanup planning, restore verification, security
 *                analysis, cost reconciliation
 *
 * An operational task observes and reports. It is explicitly NOT a
 * generation lifecycle owner: it must never submit a provider generation,
 * never finalize one, never bypass Temporal, and never create a second
 * provider job. Those constraints are enforced by architectural regression
 * tests, not just by convention.
 *
 * ===========================================================================
 * DETECT-BY-DEFAULT
 * ===========================================================================
 * Every task in this directory defaults to `mode: "detect"` — it reports
 * what it found and changes nothing. A task may support `mode: "repair"`
 * ONLY when the repair reuses an existing, already-idempotent service (for
 * example the credit system's own expire_stale_reservations SQL function).
 * No task in this phase invents a repair of its own, and no test ever runs
 * one.
 */

export type OperationalTaskStatus =
  /** Work was found and handled (or reported) successfully. */
  | "success"
  /** Ran correctly; there was nothing to do. */
  | "no_work"
  /** A prerequisite is missing (unconfigured service, absent data contract). Not a failure. */
  | "unavailable"
  /** Some items processed, others could not be. */
  | "partial"
  /** The task itself failed. */
  | "failed";

/** Detect reports only; repair may act, and only via existing idempotent services. */
export type OperationalMode = "detect" | "repair";

export interface OperationalTaskResult {
  status: OperationalTaskStatus;
  /**
   * Counts only — never user content, prompts, media, emails, or provider
   * payloads. Safe to log and to surface in an ops dashboard.
   */
  metrics: Record<string, number>;
  startedAt: string;
  completedAt: string;
  /**
   * Short, safe classification when status is unavailable/partial/failed.
   * Never a stack trace, never a raw driver error, never a secret.
   */
  reasonCode?: string;
  /** Identifiers of items needing attention. Ids only — never their contents. */
  flagged?: string[];
}

export interface OperationalTaskInput {
  mode?: OperationalMode;
  /** Bounded scan size so an operational pass can never become an unbounded sweep. */
  limit?: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function resolveMode(input?: OperationalTaskInput): OperationalMode {
  return input?.mode === "repair" ? "repair" : "detect";
}

export function resolveLimit(input?: OperationalTaskInput): number {
  const requested = input?.limit;
  if (requested === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_LIMIT) {
    throw new Error("operational-task: invalid limit");
  }
  return requested;
}

/** Builds a result with consistent timestamps, so every task reports the same shape. */
export function buildResult(
  startedAt: string,
  status: OperationalTaskStatus,
  metrics: Record<string, number>,
  extra?: { reasonCode?: string; flagged?: string[] }
): OperationalTaskResult {
  return {
    status,
    metrics,
    startedAt,
    completedAt: new Date().toISOString(),
    ...(extra?.reasonCode !== undefined ? { reasonCode: extra.reasonCode } : {}),
    ...(extra?.flagged !== undefined ? { flagged: extra.flagged } : {}),
  };
}

/**
 * Reduces any thrown value to a safe classification. An operational task
 * must never surface a driver message (which can carry connection strings)
 * or a stack trace in its result.
 */
export function toSafeReasonCode(caught: unknown): string {
  return caught instanceof Error ? caught.name : "UnknownError";
}
