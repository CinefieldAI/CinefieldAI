/**
 * Cinefield provider command handler (Phase 6R.5).
 *
 * The decision core of the SQS provider worker, separated from the receive
 * loop so it can be exercised in zero-cost tests without any AWS connection.
 *
 * INPUT: one parsed, schema-valid wire command.
 * OUTPUT: what to do with the queue message —
 *   "delete"  a safe durable outcome exists (per the ack rule these are:
 *             provider evidence persisted / safe terminal persisted /
 *             ambiguous evidence persisted / duplicate of an already-handled
 *             command)
 *   "retain"  no safe durable outcome; the message stays for redelivery and
 *             eventually the DLQ. Poison messages take this path — the
 *             handler never guesses.
 *
 * EVERY DELIVERY IS TREATED AS A POSSIBLE DUPLICATE. The handler decides
 * nothing from the message beyond identity; the attempt row decides, and the
 * atomic claim inside submitAttempt is the gate that makes a duplicate
 * delivery end as "skipped" instead of a second provider job.
 */

import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import { findModel } from "@/lib/orchestration/model-registry";
import { isProviderRegistered } from "@/lib/orchestration/provider-registry";
import { readJobFromMetadata, submitAttempt } from "@/lib/orchestration/attempt-submission-service";
import {
  markAttemptTerminal,
  readAttempt,
  recordAmbiguousSubmission,
  recordFailedWithJobEvidence,
  recordProviderJob,
  touchAttemptHeartbeat,
} from "@/lib/orchestration/attempt-repository";
import { ATTEMPT_STALE_AFTER_MS } from "@/lib/aws/sqs-topology";
import { parseCommand, serializeCommand, type CommandWireV1 } from "@/lib/contracts/command-wire";
import type { Generation } from "@/types/database";

/**
 * How often the handler refreshes an attempt's liveness clock while it owns
 * a submission (Phase 6R Package B review fix). Comfortably inside
 * ATTEMPT_STALE_AFTER_MS (10 minutes) — a 60s cadence still leaves roughly a
 * 10x margin against a missed tick or a GC pause before a competing worker
 * could mistake a live handler for a dead one. Cinefield operational policy,
 * not a provider figure.
 */
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Why a message ended the way it did, independent of what happens to the
 * message (Phase 6R-C).
 *
 * `action` answers "delete or redeliver". `classification` answers "was this
 * command ever going to work". They are deliberately orthogonal, because the
 * four useful combinations all occur:
 *
 *   safe          + delete   the command did its job (or a duplicate found it
 *                            already done)
 *   ambiguous     + delete   a submission MAY have reached the provider;
 *                            evidence is persisted and the message must not
 *                            be redelivered into a blind resubmit
 *   retryable     + retain   no durable decision was possible yet; redelivery
 *                            may succeed, and the redelivery budget bounds it
 *   non_retryable + retain   the command is provably invalid and will never
 *                            become valid. Retained so the redelivery budget
 *                            carries it to the DLQ for investigation rather
 *                            than deleting the only evidence.
 *   non_retryable + delete   provably nothing to do, and nothing to
 *                            investigate — a benign race, e.g. the generation
 *                            already reached a terminal state elsewhere.
 *
 * Before this existed every failure was an undifferentiated `retain`, so a
 * permanently-invalid command and a transient database blip were
 * indistinguishable in logs and metrics, and both silently burned the whole
 * redelivery budget.
 */
export type CommandClassification = "safe" | "ambiguous" | "retryable" | "non_retryable";

export interface HandlerOutcome {
  action: "delete" | "retain";
  classification: CommandClassification;
  /** Safe classification for logs — codes and ids only, never payloads. */
  reason: string;
}

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:provider-worker]", JSON.stringify(fields));
}

/**
 * Pure staleness decision, exported so the crash-window rule can be tested
 * with synthetic timestamps: the updated_at trigger makes backdating a real
 * row impossible, and shrinking the production threshold for a test would
 * violate the policy rules. True when the claim is old enough that its
 * handler is provably not alive anymore.
 */
export function isAttemptClaimStale(updatedAtIso: string, nowMs: number): boolean {
  const updatedAtMs = Date.parse(updatedAtIso);
  if (Number.isNaN(updatedAtMs)) return false;
  return nowMs - updatedAtMs >= ATTEMPT_STALE_AFTER_MS;
}

/** Generation states in which a provider.submit command still means anything. */
const SUBMITTABLE_GENERATION_STATUSES: ReadonlySet<string> = new Set(["queued", "processing"]);

export async function handleProviderCommand(command: CommandWireV1): Promise<HandlerOutcome> {
  const admin = getSupabaseAdminClient();

  // ---- 0. Re-validate the message against the wire contract ---------------
  // The worker already parsed it; this repeats the check because the handler
  // is a reusable entry point and "the caller validated it" is exactly the
  // assumption that stops being true when a second caller appears. Cheap,
  // and it makes the trust boundary self-contained rather than inherited.
  const revalidated = parseCommand(serializeCommand(command));
  if (!revalidated.ok) {
    return {
      action: "retain",
      classification: "non_retryable",
      reason: `schema_invalid:${revalidated.reason}`,
    };
  }

  // ---- 1. Correlate: the attempt row is the only authority ----------------
  const attempt = await readAttempt(admin, command.attemptId);
  if (!attempt) {
    // The attempt is created BEFORE the command is enqueued, so a missing
    // row is a real anomaly rather than a race. Retryable only in the weak
    // sense that a read could have failed oddly; the redelivery budget bounds
    // it and the DLQ is where it belongs.
    return { action: "retain", classification: "retryable", reason: "attempt_not_found" };
  }

  if (attempt.generation_id !== command.generationId) {
    // The command's two ids disagree with the database. Nothing about this
    // message can be trusted; never call a provider from it. This can never
    // become valid — the row's generation_id does not change — so it is
    // poison, retained only so the DLQ preserves it for investigation.
    return { action: "retain", classification: "non_retryable", reason: "generation_mismatch" };
  }

  // ---- 2. Duplicates of already-decided work are safe to delete -----------
  if (
    attempt.status === "succeeded" ||
    attempt.status === "failed" ||
    attempt.status === "cancelled"
  ) {
    return {
      action: "delete",
      classification: "safe",
      reason: `already_terminal:${attempt.status}`,
    };
  }

  if (attempt.provider_job_id !== null || attempt.submission_evidence !== "none") {
    // Evidence already exists — the earlier delivery did its job. This
    // duplicate has nothing left to do and must never submit.
    return { action: "delete", classification: "safe", reason: "evidence_already_recorded" };
  }

  // ---- 3. Crash-window recovery -------------------------------------------
  if (attempt.status === "claimed" || attempt.status === "submitting") {
    if (!isAttemptClaimStale(attempt.updated_at, Date.now())) {
      // A live handler may still be mid-call (FIFO ordering makes true
      // concurrency rare, but visibility expiry can produce it). Preempting
      // it could discard a job id about to be persisted — wait instead.
      return { action: "retain", classification: "retryable", reason: "possibly_in_flight" };
    }
    // The claim is stale: its handler died between the claim and a durable
    // outcome. A request MAY have reached the provider. Before declaring
    // that outcome merely "unknown", check the SAME evidence source
    // submitAttempt's own catch already trusts — Phase 6E may have persisted
    // a real provider job (or an already-recorded ambiguous marker) into
    // generations.metadata before the handler died. Reading it here, in the
    // same order, is what keeps relational and metadata evidence from ever
    // disagreeing; skipping straight to "ambiguous" would downgrade a
    // provable job to a guess and could later strand a live billed job that
    // reconciliation can no longer find by (provider, provider_job_id).
    const job = await readJobFromMetadata(admin, command.generationId);
    if (job) {
      if (job.state === "failed") {
        // The provider itself already answered — the job exists and it
        // failed. Record it as a resolved failure WITH job evidence
        // (stronger than ambiguous: reconciliation can confirm this by id
        // instead of guessing), never as "still unknown".
        const recorded = await recordFailedWithJobEvidence(
          admin,
          command.attemptId,
          job.id,
          "PROVIDER_FAILED"
        );
        log({
          attemptId: command.attemptId,
          generationId: command.generationId,
          result: "stale_claim_recovered_job_evidence_failed",
          applied: recorded,
        });
        return {
          action: "delete",
          classification: "safe",
          reason: "stale_claim_recovered_job_evidence_failed",
        };
      }

      const recorded = await recordProviderJob(
        admin,
        command.attemptId,
        job.id,
        job.state === "completed" ? "submitted" : "processing"
      );

      if (job.state === "completed" && recorded) {
        // generations.status is already "completed" — an independent
        // transport (webhook or a Temporal poll) ran Phase 6F finalization
        // while this handler was dead. Close the attempt too instead of
        // leaving it non-terminal with nothing left to ever revisit it.
        await markAttemptTerminal(admin, command.attemptId, { status: "succeeded" });
      }

      log({
        attemptId: command.attemptId,
        generationId: command.generationId,
        result: "stale_claim_recovered_job_evidence",
        applied: recorded,
      });
      return { action: "delete", classification: "safe", reason: "stale_claim_recovered_job_evidence" };
    }

    // No job id was ever persisted for this generation — the request may or
    // may not have reached the provider, and there is nothing to query it
    // by. This IS the ambiguous case; record it (never resubmit) and retire
    // the message.
    const recorded = await recordAmbiguousSubmission(
      admin,
      command.attemptId,
      "PROVIDER_SUBMISSION_UNKNOWN"
    );
    log({
      attemptId: command.attemptId,
      generationId: command.generationId,
      result: "stale_claim_marked_ambiguous",
      applied: recorded,
    });
    // AMBIGUOUS, not safe: a request may already have reached the provider.
    // The message is retired precisely so redelivery cannot turn an unknown
    // outcome into a blind second submission.
    return { action: "delete", classification: "ambiguous", reason: "stale_claim_marked_ambiguous" };
  }

  // ---- Fresh submission ----------------------------------------------------
  // attempt.status === "pending" with no evidence: load the generation to
  // recover the server-side owner and re-verify the provider selection
  // against the registry. Nothing from the message body is trusted for
  // routing.
  const { data, error } = await admin
    .from("generations")
    .select("*")
    .eq("id", command.generationId)
    .maybeSingle();

  if (error || !data) {
    // generation_attempts.generation_id carries a FOREIGN KEY to
    // generations(id) ON DELETE CASCADE, so an existing attempt whose
    // generation is missing is not replication lag — it is impossible under
    // the schema. Treat it as poison rather than retrying into the same
    // contradiction.
    return { action: "retain", classification: "non_retryable", reason: "generation_not_found" };
  }
  const generation = data as Generation;

  // ---- 4. Generation STATE must still admit a submission ------------------
  // Previously only the ATTEMPT's status was checked here. A stale command
  // whose generation had meanwhile been completed, failed or cancelled — by
  // a webhook, a Temporal poll, or a cancellation — reached submitAttempt
  // and was stopped one layer deeper, by claimGeneration's queued-only
  // compare-and-set. That guard is real and no provider was ever called, but
  // it surfaced as a thrown DUPLICATE_EXECUTION that closed the attempt as
  // FAILED, which misrepresents a benign race as a generation failure.
  //
  // Checking here makes the refusal explicit, keeps the attempt untouched,
  // and gives the message a deterministic classification instead of an
  // exception path. The claim below remains the authority — this is an
  // earlier, cheaper agreement with it, never a replacement.
  if (!SUBMITTABLE_GENERATION_STATUSES.has(generation.status)) {
    log({
      attemptId: command.attemptId,
      generationId: command.generationId,
      result: "generation_not_submittable",
      generationStatus: generation.status,
    });
    // Nothing to do and nothing to investigate: the generation resolved
    // elsewhere, which is a legitimate race. Retire the message rather than
    // parking a benign duplicate in the DLQ.
    return {
      action: "delete",
      classification: "non_retryable",
      reason: `generation_not_submittable:${generation.status}`,
    };
  }

  const model = findModel(generation.model);
  if (!model) {
    // The registry does not know this model. Redelivery cannot change that
    // within the message's life — only a deploy could.
    return { action: "retain", classification: "non_retryable", reason: "unknown_model" };
  }
  if (model.providerId !== attempt.provider || !isProviderRegistered(attempt.provider)) {
    // The attempt's recorded provider disagrees with the registry's current
    // resolution (or is not registered at all). Submitting under a mismatch
    // could bill the wrong provider — poison, not a judgment call.
    //
    // Note what this also forecloses: the message cannot select a provider.
    // The provider comes from the attempt row and is cross-checked against
    // the registry's own resolution of the generation's model. SQS is
    // transport; routing is not negotiable over the wire.
    return { action: "retain", classification: "non_retryable", reason: "provider_mismatch" };
  }

  // Heartbeat while submitAttempt owns the attempt. Its runtime is NOT
  // bounded by any single provider timeout — a synchronous provider's
  // finalization tail (download, normalize, upload) runs after the
  // provider's own call returns and can itself stall — so without this,
  // isAttemptClaimStale's clock would go untouched past ATTEMPT_STALE_AFTER_MS
  // for any submission that simply takes a while, and a second worker could
  // then preempt a perfectly live handler mid-call. The interval is cleared
  // in `finally` regardless of outcome.
  const heartbeat = setInterval(() => {
    touchAttemptHeartbeat(admin, command.attemptId).catch((caught) => {
      log({
        attemptId: command.attemptId,
        generationId: command.generationId,
        result: "heartbeat_failed",
        error: caught instanceof Error ? caught.name : "UnknownError",
      });
    });
  }, HEARTBEAT_INTERVAL_MS);

  let outcome;
  try {
    outcome = await submitAttempt({
      generationId: command.generationId,
      // Server-derived from the row — the queue message never carries or
      // chooses an owner.
      clerkUserId: generation.clerk_user_id,
      attemptId: command.attemptId,
    });
  } finally {
    clearInterval(heartbeat);
  }

  log({
    attemptId: command.attemptId,
    generationId: command.generationId,
    result: outcome.result,
    errorCode: outcome.errorCode,
  });

  // Every submitAttempt outcome is durable by construction: completed,
  // processing (job id persisted), failed (terminal persisted), ambiguous
  // (evidence persisted), skipped (another delivery already decided). All
  // satisfy the ack rule, so the message retires.
  //
  // "ambiguous" keeps its own classification all the way out: the evidence is
  // persisted and the message is retired, which together are what stop a
  // redelivery from becoming a blind second submission.
  return {
    action: "delete",
    classification: outcome.result === "ambiguous" ? "ambiguous" : "safe",
    reason: `submitted:${outcome.result}`,
  };
}
