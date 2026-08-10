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
import type { CommandWireV1 } from "@/lib/contracts/command-wire";
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

export interface HandlerOutcome {
  action: "delete" | "retain";
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

export async function handleProviderCommand(command: CommandWireV1): Promise<HandlerOutcome> {
  const admin = getSupabaseAdminClient();

  // ---- Correlate: the attempt row is the only authority --------------------
  const attempt = await readAttempt(admin, command.attemptId);
  if (!attempt) {
    // The attempt is created BEFORE the command is enqueued, so a missing
    // row is a real anomaly, not a race. No reconstruction is guessed; the
    // message rides its redelivery budget into the DLQ.
    return { action: "retain", reason: "attempt_not_found" };
  }

  if (attempt.generation_id !== command.generationId) {
    // The command's two ids disagree with the database. Nothing about this
    // message can be trusted; never call a provider from it.
    return { action: "retain", reason: "generation_mismatch" };
  }

  // ---- Duplicates of already-decided work are safe to delete ---------------
  if (
    attempt.status === "succeeded" ||
    attempt.status === "failed" ||
    attempt.status === "cancelled"
  ) {
    return { action: "delete", reason: `already_terminal:${attempt.status}` };
  }

  if (attempt.provider_job_id !== null || attempt.submission_evidence !== "none") {
    // Evidence already exists — the earlier delivery did its job. This
    // duplicate has nothing left to do and must never submit.
    return { action: "delete", reason: "evidence_already_recorded" };
  }

  // ---- Crash-window recovery ----------------------------------------------
  if (attempt.status === "claimed" || attempt.status === "submitting") {
    if (!isAttemptClaimStale(attempt.updated_at, Date.now())) {
      // A live handler may still be mid-call (FIFO ordering makes true
      // concurrency rare, but visibility expiry can produce it). Preempting
      // it could discard a job id about to be persisted — wait instead.
      return { action: "retain", reason: "possibly_in_flight" };
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
        return { action: "delete", reason: "stale_claim_recovered_job_evidence_failed" };
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
      return { action: "delete", reason: "stale_claim_recovered_job_evidence" };
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
    return { action: "delete", reason: "stale_claim_marked_ambiguous" };
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
    return { action: "retain", reason: "generation_not_found" };
  }
  const generation = data as Generation;

  const model = findModel(generation.model);
  if (!model) {
    return { action: "retain", reason: "unknown_model" };
  }
  if (model.providerId !== attempt.provider || !isProviderRegistered(attempt.provider)) {
    // The attempt's recorded provider disagrees with the registry's current
    // resolution (or is not registered at all). Submitting under a mismatch
    // could bill the wrong provider — poison, not a judgment call.
    return { action: "retain", reason: "provider_mismatch" };
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
  return { action: "delete", reason: `submitted:${outcome.result}` };
}
