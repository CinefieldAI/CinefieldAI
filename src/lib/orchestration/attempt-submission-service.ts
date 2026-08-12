import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import { toOrchestrationError } from "./errors";
import { executeGeneration } from "./orchestrator";
import { readPersistedProviderJob } from "./status-manager";
import { readAttempt } from "./attempt-repository";
import {
  recordExecutionFailure,
  recordExecutionSuccess,
} from "@/lib/routing/health-recorder";
import {
  claimAttemptForSubmission,
  markAttemptSubmitting,
  markAttemptTerminal,
  recordAmbiguousSubmission,
  recordFailedWithJobEvidence,
  recordProviderJob,
} from "./attempt-repository";

/**
 * Cinefield attempt submission service (Phase 6R.5).
 *
 * THE single implementation of "submit one attempt to its provider, safely".
 * Two transports call it and neither owns it:
 *   - the Temporal activity (direct dispatch mode), and
 *   - the SQS provider worker (queue dispatch mode).
 * Extracting it is what keeps the locked rule intact: the transport may
 * change, the safety logic may not be duplicated.
 *
 * AT-LEAST-ONCE SAFE
 * Both callers redeliver. Every run starts with the atomic attempt claim —
 * the B3 gate — so a duplicate invocation returns "skipped" without touching
 * a provider. The claim, not the caller, decides.
 *
 * EVIDENCE LADDER on failure (strongest first):
 *   job        the adapter captured the provider's own job id before failing
 *              (fal onEnqueue). The job exists; reconciliation queries it
 *              directly. Never resubmitted.
 *   ambiguous  a request may have reached the provider, outcome unprovable
 *              (Phase 6E fail-closed). Never resubmitted, reconcile first.
 *   none       the error provably precedes job creation; the attempt closes
 *              failed and a NEW attempt may later be opened by Phase 7.
 * The orchestrator (Phase 6E) makes this classification; this service reads
 * the classification's persisted result and mirrors it onto the attempt so
 * relational evidence and metadata evidence can never disagree.
 */

export interface AttemptSubmissionOutcome {
  /** "completed" only for synchronous providers that finish inside submit(). */
  result: "completed" | "processing" | "failed" | "ambiguous" | "skipped";
  attemptId: string;
  errorCode?: string;
}

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:submission]", JSON.stringify(fields));
}

export async function submitAttempt(params: {
  generationId: string;
  clerkUserId: string;
  attemptId: string;
}): Promise<AttemptSubmissionOutcome> {
  const admin = getSupabaseAdminClient();

  // ---- B3 gate: atomic claim, evidence must be provably absent -------------
  const claimed = await claimAttemptForSubmission(admin, params.attemptId);
  if (!claimed) {
    // Already claimed, already submitted, already carries evidence, or
    // already terminal. Submitting again is exactly the duplicate charge
    // this architecture forbids — report and do nothing.
    log({ generationId: params.generationId, attemptId: params.attemptId, result: "skipped" });
    return { result: "skipped", attemptId: params.attemptId };
  }

  // Written BEFORE the provider call: a crash during the call leaves durable
  // proof that a request may be in flight, and the claim's pending-only
  // predicate keeps every later invocation out until reconciliation.
  await markAttemptSubmitting(admin, params.attemptId);

  // PHASE 7-C: who is being asked to do the work. Read from the attempt row
  // rather than passed in, so the health signal is attributed to the provider
  // the attempt actually records — the same row reconciliation reads.
  const attemptRow = await readAttempt(admin, params.attemptId);
  const observed = {
    providerId: attemptRow?.provider ?? "unknown",
    providerModelId: attemptRow?.provider_model ?? "unknown",
  };

  const startedAt = Date.now();
  try {
    const outcome = await executeGeneration({
      generationId: params.generationId,
      clerkUserId: params.clerkUserId,
    });

    // Async providers: the orchestrator persisted the external job into
    // generations.metadata. Mirror it onto the attempt row, which is the
    // relational correlation source for webhooks and reconciliation.
    const job = await readJobFromMetadata(admin, params.generationId);
    if (job) {
      await recordProviderJob(
        admin,
        params.attemptId,
        job.id,
        outcome.status === "processing" ? "processing" : "submitted"
      );
    }

    if (outcome.status === "completed") {
      const latencyMs = Date.now() - startedAt;
      await markAttemptTerminal(admin, params.attemptId, {
        status: "succeeded",
        latencyMs,
      });
      // Phase 7-C. Best-effort, after the durable write: health telemetry
      // must never come between a finished generation and its record.
      await recordExecutionSuccess({ ...observed, latencyMs });
      return { result: "completed", attemptId: params.attemptId };
    }

    // Accepted by an async provider. That acceptance IS a success signal for
    // routing — it proves the provider is reachable and taking work — even
    // though the generation itself is not finished.
    await recordExecutionSuccess({ ...observed, latencyMs: Date.now() - startedAt });
    return { result: "processing", attemptId: params.attemptId };
  } catch (caught) {
    const error = toOrchestrationError(caught);

    // Read what Phase 6E persisted, in evidence order: a captured job id
    // outranks ambiguity, ambiguity outranks a plain failure.
    const job = await readJobFromMetadata(admin, params.generationId);
    if (job) {
      await recordFailedWithJobEvidence(admin, params.attemptId, job.id, error.code);
      log({
        generationId: params.generationId,
        attemptId: params.attemptId,
        result: "failed_with_job_evidence",
        errorCode: error.code,
      });
      // A job exists, so the provider accepted the work and then something
      // went wrong with it — that IS provider evidence, and the classifier
      // decides whether this particular code counts.
      await recordExecutionFailure({
        ...observed,
        latencyMs: Date.now() - startedAt,
        errorCode: error.code,
      });
      return { result: "failed", attemptId: params.attemptId, errorCode: error.code };
    }

    if (await hasAmbiguousMarker(admin, params.generationId)) {
      await recordAmbiguousSubmission(admin, params.attemptId, error.code);
      log({
        generationId: params.generationId,
        attemptId: params.attemptId,
        result: "ambiguous",
        errorCode: error.code,
      });
      // Ambiguity says nothing about the provider — the work may have
      // succeeded and only the acknowledgement was lost. Recorded with the
      // ambiguous flag so the recorder refuses to move the breaker.
      await recordExecutionFailure({
        ...observed,
        latencyMs: Date.now() - startedAt,
        errorCode: error.code,
        ambiguous: true,
      });
      return { result: "ambiguous", attemptId: params.attemptId, errorCode: error.code };
    }

    const latencyMs = Date.now() - startedAt;
    await markAttemptTerminal(admin, params.attemptId, {
      status: "failed",
      errorCode: error.code,
      latencyMs,
    });
    await recordExecutionFailure({ ...observed, latencyMs, errorCode: error.code });
    return { result: "failed", attemptId: params.attemptId, errorCode: error.code };
  }
}

/**
 * Reads the provider job Phase 6E may have persisted into
 * generations.metadata, so any caller reconciling an attempt after the fact
 * (this service's own catch, and the SQS worker's stale-claim recovery in
 * provider-command-handler.ts) reads the SAME evidence in the SAME order and
 * can never disagree with it.
 */
export async function readJobFromMetadata(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  generationId: string
) {
  const { data } = await admin
    .from("generations")
    .select("metadata")
    .eq("id", generationId)
    .maybeSingle();
  return readPersistedProviderJob((data?.metadata ?? null) as Record<string, unknown> | null);
}

export async function hasAmbiguousMarker(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  generationId: string
): Promise<boolean> {
  const { data } = await admin
    .from("generations")
    .select("metadata")
    .eq("id", generationId)
    .maybeSingle();
  const orchestration = ((data?.metadata ?? {}) as Record<string, unknown>).orchestration;
  return (
    typeof orchestration === "object" &&
    orchestration !== null &&
    (orchestration as Record<string, unknown>).ambiguousSubmission !== undefined &&
    (orchestration as Record<string, unknown>).ambiguousSubmission !== null
  );
}
