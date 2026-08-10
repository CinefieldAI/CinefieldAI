/**
 * Cinefield async continuation polling policy.
 *
 * INTERNAL CINEFIELD ORCHESTRATION POLICY — NOT A PROVIDER CAPABILITY.
 *
 * Nothing in this file describes how long any external provider takes, how
 * often a provider permits status checks, or when a provider expires a job.
 * No provider has been integrated for async generation, so no such figure is
 * known and none is asserted here. These are Cinefield's own conservative
 * limits on how much polling effort one generation may consume before a human
 * or a Phase 7 reconciliation pass takes over.
 *
 * They are deliberately provider-neutral: the same numbers apply to every
 * provider, and a provider-specific override must never be added here (that
 * would put provider branching into generic orchestration). When a real
 * provider is integrated and its documented behavior is known, the right move
 * is to revisit these values as a whole, not to special-case one provider.
 *
 * Every value lives in this one module so the policy can be reviewed and
 * tuned in a single place.
 */

/** Seconds to wait after submission before the first status check. */
export const FIRST_CHECK_DELAY_SECONDS = 10;

/**
 * Staged wait between status checks, in seconds. Early checks are close
 * together so short jobs finish promptly; later checks spread out so a long
 * job costs little. `nextCheckDelaySeconds` clamps to the last stage.
 */
const CHECK_INTERVAL_STAGES: ReadonlyArray<{ upToCheck: number; seconds: number }> = [
  { upToCheck: 8, seconds: 15 },
  { upToCheck: 20, seconds: 30 },
  { upToCheck: 60, seconds: 60 },
];

/** Wait applied once every stage above has been passed. */
const CHECK_INTERVAL_TAIL_SECONDS = 120;

/**
 * Hard ceiling on status checks for one generation, across ALL transports.
 * Reaching it stops polling — it never fails the generation, never clears the
 * provider job, and never resubmits.
 */
export const MAX_STATUS_CHECKS = 90;

/**
 * Hard ceiling on wall-clock time one continuation controller may spend
 * polling, in seconds (60 minutes). Bounds the run even if individual checks
 * are unusually slow or the check count grows differently than expected.
 */
export const MAX_POLLING_WALL_CLOCK_SECONDS = 60 * 60;

/**
 * Checks a workflow spends watching a DISPATCHED command's attempt row —
 * waiting for a provider worker to pick the command off the queue and finish
 * the submission — before treating the dispatch as abandoned (worker down,
 * queue stalled, message parked in the DLQ). Same staged delays as status
 * checks. Cinefield operational policy, not a provider figure.
 */
export const MAX_DISPATCH_PICKUP_CHECKS = 30;

/**
 * Grace loop for finalizing cancellation while an attempt may still be
 * claimed/submitting — a handler could be mid-flight with a provider right
 * now, and forcing cancellation into that window risks erasing evidence of
 * a job that may already be billed (see cancelGeneration in
 * worker/activities/generation-activities.ts). Used both by the checkpoint
 * that runs before the workflow's first submission and by a hard Temporal
 * cancellation's cleanup; the poll/dispatch-observe loops elsewhere reuse
 * their own existing cadence instead of this one. Cinefield operational
 * policy, not a provider figure.
 */
export const CANCEL_SETTLE_MAX_ATTEMPTS = 6;
export const CANCEL_SETTLE_INTERVAL_SECONDS = 5;

/**
 * Consecutive failed status checks tolerated before the controller stops.
 * Transient failures (network, 429, 5xx) are expected and retried within this
 * budget; a sustained failure run means checking is not working right now and
 * further polling is waste. Stopping never resubmits.
 */
export const MAX_CONSECUTIVE_CHECK_FAILURES = 6;

/**
 * Wait before the next status check.
 *
 * @param checkIndex 0 for the check that follows FIRST_CHECK_DELAY_SECONDS,
 *                   incrementing by one per check thereafter.
 */
export function nextCheckDelaySeconds(checkIndex: number): number {
  for (const stage of CHECK_INTERVAL_STAGES) {
    if (checkIndex < stage.upToCheck) return stage.seconds;
  }
  return CHECK_INTERVAL_TAIL_SECONDS;
}
