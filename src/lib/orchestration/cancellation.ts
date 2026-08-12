import "server-only";
import type { GenerationAttempt } from "@/types/database";

/**
 * Cinefield cancellation semantics (Phase 6R-H).
 *
 * THREE THINGS THAT ARE NOT THE SAME THING, AND ONE STATE MACHINE THAT IS NOT
 * THE OTHER. Collapsing any of them into a single boolean is how a cancelled
 * generation quietly turns back into a completed one, or how a user is
 * charged for work they cancelled.
 *
 *   A. USER CANCEL INTENT — "I no longer want this."
 *      A durable Cinefield fact, recorded the moment an authenticated owner
 *      asks. It is true regardless of what any provider can or will do, and
 *      it never stops being true.
 *
 *   B. PROVIDER CANCELLABILITY — "can the external job actually be stopped?"
 *      A property of someone else's system. Most providers cannot stop a
 *      running job; some have no cancel API at all. Cinefield does not get to
 *      decide this and must not pretend to.
 *
 *   C. TEMPORAL CANCELLATION — "should the workflow stop waiting?"
 *      A coordination decision owned by the GenerationWorkflow. It is what
 *      turns A into a generation lifecycle transition, after considering B.
 *
 * And separately:
 *
 *   CINEFIELD GENERATION STATE  (generations.status)
 *      queued | processing | completed | failed | cancelled
 *      The user-facing truth. Only Temporal transitions it.
 *
 *   PROVIDER ATTEMPT STATE      (generation_attempts.status + submission_evidence)
 *      pending | claimed | submitting | submitted | processing |
 *      succeeded | failed | cancelled, with evidence none | ambiguous | job
 *      What we observed about someone else's job. NEVER authority over the
 *      generation.
 *
 * The permitted direction is one-way:
 *
 *   provider observation → durable attempt update → Temporal signal/poll →
 *   Temporal decides the generation transition
 *
 * A provider saying "succeeded" does not make a generation completed; it
 * makes an ATTEMPT succeeded, which the workflow then reflects — or, if the
 * user already cancelled, does not.
 *
 * This module is pure: types and one deterministic classifier. It performs no
 * I/O, mutates nothing, and settles nothing.
 */

// ---------------------------------------------------------------------------
// A. User cancel intent
// ---------------------------------------------------------------------------

export type CancelIntentOutcome =
  /** Intent recorded and the generation transitioned to cancelled. */
  | { outcome: "cancelled"; generationId: string }
  /**
   * The generation had already reached a terminal state. The intent is not an
   * error and is not retried — the race simply resolved the other way.
   */
  | { outcome: "already_terminal"; generationId: string; status: string }
  /** No owner could act on it (workflow unreachable). Explicitly retryable. */
  | { outcome: "unavailable"; reason: string };

// ---------------------------------------------------------------------------
// B. Provider cancellability
// ---------------------------------------------------------------------------

/**
 * What actually happened when Cinefield asked a provider to stop.
 *
 * `unsupported` is a first-class outcome, not a failure: an adapter without a
 * cancel() is the common case, and reporting it honestly is what keeps the
 * settlement classification below correct. None of these outcomes ever
 * justifies submitting the job somewhere else — that would be a second
 * billable job created by a cancellation.
 */
export type ProviderCancelOutcome =
  /** The provider confirmed the job is stopped. */
  | { outcome: "cancelled" }
  /** This adapter implements no cancel at all. The remote job runs on. */
  | { outcome: "unsupported" }
  /** The job had already finished (either way) before the request landed. */
  | { outcome: "already_terminal" }
  /** The call failed. Whether the job stopped is unknown. */
  | { outcome: "failed"; errorCode: string }
  /** No provider job existed to cancel — nothing was ever submitted. */
  | { outcome: "no_job" };

// ---------------------------------------------------------------------------
// Settlement classification (evidence for Phase 10 — NOT a billing decision)
// ---------------------------------------------------------------------------

/**
 * A deterministic reading of what a cancellation means for money, derived
 * ONLY from durable evidence.
 *
 * Phase 10 owns settle/release/refund. This does not move a single credit and
 * must not grow the ability to: what it provides is the input Phase 10 needs
 * to make that decision exactly once, computed the same way every time
 * instead of re-derived ad hoc at the point of refund.
 *
 * The classes are deliberately conservative. Anything that cannot be PROVEN
 * costless lands in a class that requires reconciliation, because the failure
 * mode of guessing "free" is refunding a job the provider actually billed.
 */
export type CancellationSettlementClass =
  /**
   * Nothing was ever sent. No provider job can exist, so no provider cost
   * can exist. The safest class, and the only one that is free by proof
   * rather than by assumption.
   */
  | "pre_submit_cancel"
  /**
   * A provider job existed and the provider CONFIRMED it stopped. Whether
   * that is free depends on the provider's own policy — which Cinefield does
   * not know and must not invent — so this is "confirmed stopped", not
   * "confirmed free".
   */
  | "provider_confirmed_cancel"
  /**
   * A provider job exists and was not confirmed stopped: the adapter cannot
   * cancel, the cancel failed, or the job had already finished. Assume it is
   * billable.
   */
  | "provider_uncancellable_or_completed"
  /**
   * A submission may or may not have reached the provider and there is no job
   * id to ask about. Reconciliation must resolve it before any settlement.
   */
  | "unknown_reconcile";

export interface CancellationEvidence {
  settlementClass: CancellationSettlementClass;
  /** The attempt this reading came from, or null when none was ever opened. */
  attemptId: string | null;
  /** Present only when a real external job is known to exist. */
  providerJobId: string | null;
  /** True when Phase 10 must NOT settle from this reading alone. */
  requiresReconciliation: boolean;
}

/**
 * Classifies a cancellation from durable state alone.
 *
 * Reads the attempt's own evidence ladder — the same one the submission
 * service and the provider worker already use — so there is one notion of
 * "does an external job exist", not a second one invented for refunds.
 *
 * `providerCancel` is optional because the provider may never have been
 * asked (nothing was submitted, or the adapter has no cancel).
 */
export function classifyCancellation(
  attempt: GenerationAttempt | null,
  providerCancel?: ProviderCancelOutcome
): CancellationEvidence {
  // No attempt was ever opened: nothing can have been sent anywhere.
  if (!attempt) {
    return {
      settlementClass: "pre_submit_cancel",
      attemptId: null,
      providerJobId: null,
      requiresReconciliation: false,
    };
  }

  const base = { attemptId: attempt.id, providerJobId: attempt.provider_job_id ?? null };

  // Ambiguity outranks everything below it. A request may have reached the
  // provider and there is no job id to ask about — the one case where
  // Cinefield genuinely does not know, and the one that must never be
  // settled from a guess.
  if (attempt.submission_evidence === "ambiguous") {
    return { ...base, settlementClass: "unknown_reconcile", requiresReconciliation: true };
  }

  // Provably nothing sent: no job id, no evidence, and the attempt never left
  // the states that precede a provider call.
  const neverSent =
    attempt.submission_evidence === "none" &&
    attempt.provider_job_id === null &&
    (attempt.status === "pending" || attempt.status === "cancelled");

  if (neverSent) {
    return { ...base, settlementClass: "pre_submit_cancel", requiresReconciliation: false };
  }

  // An attempt sitting in claimed/submitting with no evidence yet is IN the
  // dangerous window: a request may be in flight right now. Not provably
  // pre-submit, not provably billable.
  if (
    attempt.submission_evidence === "none" &&
    (attempt.status === "claimed" || attempt.status === "submitting")
  ) {
    return { ...base, settlementClass: "unknown_reconcile", requiresReconciliation: true };
  }

  // A job exists. What the provider said about stopping it decides the rest.
  if (providerCancel?.outcome === "cancelled") {
    return { ...base, settlementClass: "provider_confirmed_cancel", requiresReconciliation: false };
  }

  if (providerCancel?.outcome === "failed") {
    // The cancel call itself failed: the job's fate is unknown, and it is a
    // real job. Reconcile rather than assume either way.
    return { ...base, settlementClass: "unknown_reconcile", requiresReconciliation: true };
  }

  // unsupported / already_terminal / never asked, with a real job in play.
  return {
    ...base,
    settlementClass: "provider_uncancellable_or_completed",
    requiresReconciliation: false,
  };
}

// ---------------------------------------------------------------------------
// The one-way rule, as an assertable predicate
// ---------------------------------------------------------------------------

/** Cinefield generation states, mirroring the generations_status_check constraint. */
export const GENERATION_STATES = ["queued", "processing", "completed", "failed", "cancelled"] as const;
export type GenerationState = (typeof GENERATION_STATES)[number];

/** Provider attempt states, mirroring the generation_attempts_status_check constraint. */
export const ATTEMPT_STATES = [
  "pending",
  "claimed",
  "submitting",
  "submitted",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

export const TERMINAL_GENERATION_STATES: ReadonlySet<GenerationState> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Whether a generation may move from `from` to `to`.
 *
 * A terminal state is terminal: nothing reopens it. This is the predicate the
 * SQL compare-and-sets already enforce, expressed once in TypeScript so a
 * caller can ask before writing and a test can assert the whole matrix
 * without a database.
 */
export function isLegalGenerationTransition(from: GenerationState, to: GenerationState): boolean {
  if (TERMINAL_GENERATION_STATES.has(from)) return false;
  if (from === to) return false;
  if (to === "queued") return false; // nothing goes back to the start
  if (from === "queued") return to === "processing" || TERMINAL_GENERATION_STATES.has(to);
  // from === "processing"
  return TERMINAL_GENERATION_STATES.has(to);
}

/**
 * The reflection rule, stated as code: what a provider observation means for
 * the generation, GIVEN that the user may already have cancelled.
 *
 * This is the function that stops "the provider succeeded" from becoming
 * "the generation completed" behind a cancellation. It returns what the
 * workflow SHOULD do; it does not do it, and nothing else may bypass it.
 */
export function reflectAttemptOntoGeneration(params: {
  generationState: GenerationState;
  attemptState: AttemptState;
  userCancelRequested: boolean;
}): { transitionTo: GenerationState | null; reason: string } {
  const { generationState, attemptState, userCancelRequested } = params;

  if (TERMINAL_GENERATION_STATES.has(generationState)) {
    return { transitionTo: null, reason: "generation_already_terminal" };
  }

  // A cancelled INTENT outranks a late provider success. The provider's work
  // is recorded on the attempt — the evidence is never destroyed — but the
  // generation the user cancelled does not come back to life.
  if (userCancelRequested) {
    return { transitionTo: "cancelled", reason: "user_cancel_intent_outranks_late_completion" };
  }

  if (attemptState === "succeeded") return { transitionTo: "completed", reason: "attempt_succeeded" };
  if (attemptState === "failed") return { transitionTo: "failed", reason: "attempt_failed" };
  if (attemptState === "cancelled") return { transitionTo: "cancelled", reason: "attempt_cancelled" };

  // Every non-terminal attempt state: keep waiting. The provider being
  // "processing" is not a generation transition.
  return { transitionTo: null, reason: "attempt_not_terminal" };
}
