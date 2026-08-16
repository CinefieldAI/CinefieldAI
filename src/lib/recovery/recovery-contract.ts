import type { DependencyName, RuntimeName } from "@/lib/health/health-contract";

/**
 * Recovery incident contract (Phase 15-D/2).
 *
 * Pure types only — no I/O, no clock, no database, no AWS SDK. This package
 * answers a narrower question than it might sound like: given the durable
 * timestamps of one recovery, and whatever RTO/RPO targets (if any) apply to
 * it, what is the deterministic, fail-closed classification of that
 * recovery? It does not detect incidents, does not execute a redrive, does
 * not run chaos, and does not invent a business number.
 *
 * ---------------------------------------------------------------------------
 * NO TARGET != SUCCESS
 * ---------------------------------------------------------------------------
 * `RTO_TARGETS` and `RPO_TARGETS` (recovery-target-registry.ts) ship EMPTY.
 * A target is a business decision — a number someone with the authority to
 * set an SLA commitment approved — and no such approval exists in this
 * repository today. `RECOVERED_NO_TARGET` exists as its own state precisely
 * so an empty registry can never be read as "everything met its target";
 * `rtoMet`/`rpoMet` are `undefined`, never `true`, when no target resolves.
 */

/**
 * The bounded set of recovery scenarios this package can classify.
 *
 * Deliberately narrow and deliberately not free-form — a "reason" string
 * describing what happened belongs in `reasonCode`, never in a fabricated
 * eighth class invented to describe one incident.
 */
export type RecoveryClass =
  | "queue_recovery"
  | "worker_recovery"
  | "dependency_recovery"
  | "database_recovery"
  | "media_recovery"
  | "realtime_recovery"
  | "region_outage";

export const RECOVERY_CLASSES: readonly RecoveryClass[] = [
  "queue_recovery",
  "worker_recovery",
  "dependency_recovery",
  "database_recovery",
  "media_recovery",
  "realtime_recovery",
  "region_outage",
];

/**
 * WHAT was affected, reusing Phase 13's own closed vocabulary
 * (`DependencyName` for a dependency, `RuntimeName` for a whole runtime)
 * rather than inventing a second component taxonomy. `recovery-contract.ts`
 * does not redefine what "supabase" or "provider-worker" means — it only
 * borrows the names.
 */
export type AffectedComponent = DependencyName | RuntimeName;

/**
 * The six states a recovery measurement can conclude with.
 *
 * `RECOVERY_INCOMPLETE` deliberately covers TWO distinct facts, both meaning
 * "not provably, safely recovered yet": the service has not reported
 * restored, OR it has, but required validation evidence (Phase 15-C for
 * database/media recovery) has not PASSED. Neither can be mistaken for
 * success, which is the property this state exists to guarantee.
 * `EVIDENCE_UNAVAILABLE` is reserved for the narrower case where required
 * evidence could not be OBTAINED at all (a read failed, a source is
 * unreachable) — a known negative fact and a missing fact are kept apart on
 * purpose, the same distinction `dlq-redrive-decision-engine.ts` draws
 * between `REFUSE_INSUFFICIENT_EVIDENCE` and `UNAVAILABLE`.
 */
export type RecoveryResultState =
  | "RECOVERED_WITHIN_TARGET"
  | "RECOVERED_OUTSIDE_TARGET"
  | "RECOVERED_NO_TARGET"
  | "RECOVERY_INCOMPLETE"
  | "EVIDENCE_UNAVAILABLE"
  | "INVALID_EVIDENCE";

export const RECOVERY_RESULT_STATES: readonly RecoveryResultState[] = [
  "RECOVERED_WITHIN_TARGET",
  "RECOVERED_OUTSIDE_TARGET",
  "RECOVERED_NO_TARGET",
  "RECOVERY_INCOMPLETE",
  "EVIDENCE_UNAVAILABLE",
  "INVALID_EVIDENCE",
];

/** States that represent a definite, non-fabricated success. Exactly one member. */
export const RECOVERY_SUCCESS_STATES: ReadonlySet<RecoveryResultState> = new Set([
  "RECOVERED_WITHIN_TARGET",
]);

export function isRecoverySuccess(state: RecoveryResultState): boolean {
  return RECOVERY_SUCCESS_STATES.has(state);
}

/**
 * The raw, caller-supplied evidence for one recovery incident.
 *
 * Bounded by construction: two ids, a closed class, a closed component name,
 * four ISO timestamps (three optional), and a short reason code. No prompt,
 * no payload, no stack trace, no database row, no secret, no signed URL, and
 * no arbitrary metadata bag has anywhere to go in this shape — there is no
 * field capable of holding one.
 */
export interface RecoveryIncidentEvidence {
  readonly incidentId: string;
  readonly correlationId?: string;
  readonly recoveryClass: RecoveryClass;
  readonly affectedComponent: AffectedComponent;
  /** Short code, e.g. "sqs_dlq_depth_exhausted". Never prose, never a driver message. */
  readonly reasonCode: string;
  /** ISO 8601. When the incident began (detection). */
  readonly startedAt: string;
  /** ISO 8601. When active recovery work began, if tracked separately from detection. */
  readonly recoveryStartedAt?: string;
  /** ISO 8601. When the affected component reported service restored. */
  readonly serviceRestoredAt?: string;
  /** ISO 8601. When post-restore validation (if any) completed. */
  readonly validationCompletedAt?: string;
}

/**
 * The complete output of one measurement: the input evidence plus every
 * computed field. Mirrors `RestoreEvidence` (Phase 15-C/1) — an evidence
 * shape that carries its own identity rather than requiring the caller to
 * re-associate a bare verdict with the incident it came from.
 */
export interface RecoveryEvidence {
  readonly incidentId: string;
  readonly correlationId?: string;
  readonly recoveryClass: RecoveryClass;
  readonly affectedComponent: AffectedComponent;
  readonly result: RecoveryResultState;
  readonly reasonCode: string;
  readonly recoveryDurationMs?: number;
  readonly validationDurationMs?: number;
  readonly targetRtoMs?: number;
  readonly rtoMet?: boolean;
  readonly observedDataLossSeconds?: number;
  readonly targetRpoSeconds?: number;
  readonly rpoMet?: boolean;
  readonly evaluatedAt: string;
}
