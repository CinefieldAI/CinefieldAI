import type { Generation, GenerationAttemptEvidence, GenerationAttemptStatus } from "@/types/database";

/**
 * DLQ redrive decision contract (Phase 15-D/1).
 *
 * Pure types only — no I/O, no clock, no database, no AWS SDK. This is the
 * smallest shape that can answer one question: given the durable Cinefield
 * evidence for one message parked in `cinefield-provider-dlq.fifo`, is it
 * safe to move that message back into `cinefield-provider.fifo`?
 *
 * ---------------------------------------------------------------------------
 * SCOPE: THE PROVIDER QUEUE ONLY
 * ---------------------------------------------------------------------------
 * `sqs-topology.ts` defines seven queues. Six of them (generationControl,
 * providerCallback, mediaDownload, mediaProcessing, moderation, backup) have
 * no wire-format schema and, per that file's own comment, some have no
 * consumer at all yet ("stay empty until then"). Building a redrive decision
 * for a message shape that does not exist would mean inventing one — exactly
 * what this batch is not permitted to do. This engine decides only
 * `cinefield-provider.fifo` / `cinefield-provider-dlq.fifo`, the one queue
 * with a real wire contract (`command-wire.ts`) and a real safety story (the
 * B3 atomic claim). A redrive decision engine for the other queues is future
 * work, once each has a consumer and a wire format to validate against.
 *
 * ---------------------------------------------------------------------------
 * WHAT "SAFE_TO_REDRIVE" MEANS, PRECISELY
 * ---------------------------------------------------------------------------
 * It means a redrive CANNOT cause a double submission, cannot bypass the
 * atomic attempt claim, and cannot fabricate provider or billing evidence —
 * because the durable state proves no submission was ever attempted for this
 * attempt and the generation can still legally accept one. It is a SAFETY
 * proof, not a SUCCESS prediction: the real worker (provider-command-handler)
 * still re-runs its own full re-validation (model registry, provider
 * registry, generation state) the moment a redriven message actually
 * arrives, exactly as it does for every other delivery. If that re-check
 * fails, the message is safely retained again — never a silent failure, and
 * never a state this engine could have prevented by trying to duplicate that
 * logic here.
 */

/**
 * The six decision states this engine can reach.
 *
 * Ordered from the one useful positive outcome to increasingly firm
 * refusals. `SAFE_TO_REDRIVE` is reachable through exactly one path in
 * `dlq-redrive-decision-engine.ts` — every other branch, including any
 * unmodeled combination of durable fields, refuses. Nothing here is a
 * generic "probably safe" fallback.
 */
export type DlqRedriveDecisionState =
  | "SAFE_TO_REDRIVE"
  | "REFUSE_AMBIGUOUS_PROVIDER_STATE"
  | "REFUSE_TERMINAL_GENERATION"
  | "REFUSE_INSUFFICIENT_EVIDENCE"
  | "REFUSE_INVALID_MESSAGE"
  | "UNAVAILABLE";

/**
 * Pinned membership, in the engine's own priority order. A test asserts this
 * array against the exact set the type allows, so a future state added to
 * the union without being added here (or without a corresponding branch in
 * the engine) fails loudly instead of silently inheriting default behaviour.
 */
export const DLQ_REDRIVE_DECISION_STATES: readonly DlqRedriveDecisionState[] = [
  "SAFE_TO_REDRIVE",
  "REFUSE_AMBIGUOUS_PROVIDER_STATE",
  "REFUSE_TERMINAL_GENERATION",
  "REFUSE_INSUFFICIENT_EVIDENCE",
  "REFUSE_INVALID_MESSAGE",
  "UNAVAILABLE",
];

/**
 * States in which an actual redrive (not built in this batch) may proceed.
 * Exactly one member, checked by a pinned test — the set must never grow by
 * accident.
 */
export const REDRIVE_PERMITTED_STATES: ReadonlySet<DlqRedriveDecisionState> = new Set(["SAFE_TO_REDRIVE"]);

export function isRedrivePermitted(state: DlqRedriveDecisionState): boolean {
  return REDRIVE_PERMITTED_STATES.has(state);
}

/**
 * Attempt evidence, reduced to exactly the fields the decision needs.
 *
 * Deliberately the same vocabulary `generation_attempts` already owns
 * (`GenerationAttemptStatus`, `GenerationAttemptEvidence` from
 * `@/types/database`) rather than a parallel enum — this contract does not
 * invent a second classification of attempt state, it borrows the one
 * `attempt-repository.ts` and `provider-command-handler.ts` already trust.
 */
export interface AttemptRedriveEvidence {
  readonly attemptId: string;
  readonly generationId: string;
  readonly status: GenerationAttemptStatus;
  readonly submissionEvidence: GenerationAttemptEvidence;
}

/** Generation evidence, reduced to the one field a redrive decision needs. */
export interface GenerationRedriveEvidence {
  readonly generationId: string;
  readonly status: Generation["status"];
}

/**
 * The narrow, read-only evidence boundary the pure engine depends on.
 *
 * Modelled directly on `restore-target.ts`'s `RestoreEvidenceSource`
 * (Phase 15-C/1): the engine knows this interface only, never Supabase,
 * never an AWS SDK. Every method is a READ. There is no `redrive()`, no
 * `resubmit()`, no write of any kind — a decision engine that could also
 * act would be exactly the kind of privileged actor a decision step must
 * stay independent of.
 */
export interface DlqRedriveEvidenceSource {
  /** Bounded label for logs, e.g. "supabase-generation-attempts". Never a connection string. */
  readonly label: string;

  /**
   * Returns `null` when the attempt row does not exist. Throws (or the
   * underlying read rejects) when the read itself failed — the engine
   * distinguishes "confirmed absent" (REFUSE_INSUFFICIENT_EVIDENCE) from
   * "could not determine" (UNAVAILABLE) by exactly that difference.
   */
  readAttempt(attemptId: string): Promise<AttemptRedriveEvidence | null>;

  /** Same null/throw contract as `readAttempt`, for the generation row. */
  readGeneration(generationId: string): Promise<GenerationRedriveEvidence | null>;
}

/**
 * The complete output of one decision.
 *
 * Bounded by construction: two ids (already validated as UUIDs by
 * `command-wire.ts` before they ever reach here), two queue names sourced
 * from the existing `sqs-topology.ts` contract (never invented), a closed
 * state, and a short reason code. No prompt, no provider payload, no
 * response body, no secret, no token, no header, no signed URL and no
 * arbitrary exception text has anywhere to go in this shape.
 */
export interface DlqRedriveDecision {
  readonly state: DlqRedriveDecisionState;
  /** Short code, e.g. "attempt_not_found". Never prose, never a driver message. */
  readonly reasonCode: string;
  readonly commandId?: string;
  readonly attemptId?: string;
  readonly generationId?: string;
  /** From `SQS_QUEUES.provider.name` — this engine never names a second queue. */
  readonly sourceQueue: string;
  /** From `SQS_QUEUES.provider.dlqName` — this engine never creates a DLQ. */
  readonly dlqName: string;
  readonly evaluatedAt: string;
}
