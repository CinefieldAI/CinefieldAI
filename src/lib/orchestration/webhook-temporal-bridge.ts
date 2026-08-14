import "server-only";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import {
  findAttemptByProviderJob,
  recordProviderObservation,
} from "./attempt-repository";
import {
  signalProviderEvent,
  type ProviderEventSignalOutcome,
} from "@/lib/temporal/provider-event-signal";
import type { VerifiedWebhookEvent } from "./webhook-continuation";
import type { GenerationAttempt } from "@/types/database";
import { createFieldLogger } from "@/lib/observability/logger";

/**
 * Cinefield verified-webhook → Temporal bridge (Phase 6R.10).
 *
 * THE CHAIN THIS COMPLETES
 *   raw provider webhook
 *     → provider-specific signature verification        (Phase 8, per-provider)
 *     → VerifiedWebhookEvent                            (webhook-continuation.ts)
 *     → attempt correlation + durable observation       (here)
 *     → Temporal signal                                 (here)
 *     → GenerationWorkflow continues                    (worker/workflows/)
 *
 * WHY THE TYPE IS THE SECURITY BOUNDARY
 * This function accepts only `VerifiedWebhookEvent`, whose branding symbol
 * is unexported and unforgeable from outside webhook-continuation.ts — the
 * only way to obtain one is `markWebhookEventVerified()`, which a
 * provider-specific verifier calls after checking that provider's
 * signature. A plain object literal does not satisfy the type, so an
 * unverified payload cannot reach this code path even by mistake. Nothing
 * here re-implements signature verification; duplicating it would create a
 * second, divergent notion of "verified".
 *
 * WHAT IS NEVER TRUSTED FROM THE EVENT
 * The event names an external job, nothing more. The attempt, the
 * generation, and the owner are all resolved from Cinefield's OWN durable
 * rows via UNIQUE(provider, provider_job_id). A callback cannot nominate a
 * generation, cannot supply a user identity, and cannot reach another
 * user's work even with a valid signature for its own provider.
 *
 * RELATIONSHIP TO continueFromPushEvent()
 * `webhook-continuation.ts`'s `continueFromPushEvent` drives the SAME
 * outcome through the in-process continuation core (checkAsyncGeneration).
 * That path remains correct and untouched — it is what a deployment
 * running without Temporal ownership uses. This bridge is the
 * Temporal-owned equivalent: instead of finalizing inline, it records the
 * observation and hands control to the workflow that owns the generation's
 * lifecycle. Neither path finalizes twice; both converge on the same
 * lease-guarded finalization tail inside checkAsyncGeneration.
 *
 * ORDERING IS DELIBERATE: DURABLE FIRST, SIGNAL SECOND
 * The attempt observation is written before the signal is sent. If the
 * signal then fails, the provider's observation is still durably recorded
 * and the caller gets an explicitly retryable outcome — a later
 * redelivery or reconciliation can signal again. The reverse order would
 * risk telling the workflow about state that was never persisted.
 */

/**
 * The two collaborators this bridge needs. Exists as an explicit seam so
 * zero-cost tests can inject in-memory fakes instead of a Supabase
 * connection and a Temporal client — the same `testOverride` pattern every
 * Redis store and the outbox publisher already use in this codebase.
 */
export interface WebhookBridgeDeps {
  isAdminConfigured: typeof isSupabaseAdminConfigured;
  getAdmin: typeof getSupabaseAdminClient;
  signal: typeof signalProviderEvent;
}

const defaultDeps: WebhookBridgeDeps = {
  isAdminConfigured: isSupabaseAdminConfigured,
  getAdmin: getSupabaseAdminClient,
  signal: signalProviderEvent,
};

export type WebhookBridgeOutcome =
  /** Observation recorded (or already current) and the workflow was signalled. */
  | { outcome: "accepted"; generationId: string; attemptId: string }
  /**
   * The event is valid but had no effect: the attempt already left the
   * observable window (terminal, or a newer state), so this is a duplicate
   * or out-of-order delivery. Safe and final — nothing to retry.
   */
  | { outcome: "already_processed"; generationId: string; attemptId: string }
  /** No attempt holds this (provider, providerJobId). Nothing was mutated. */
  | { outcome: "unknown_job" }
  /** The event contradicts durable state (provider/generation mismatch). Nothing was mutated. */
  | { outcome: "rejected"; reason: string }
  /**
   * The observation IS durable but Temporal could not be told. The caller
   * must surface this as retryable — never as success.
   */
  | { outcome: "signal_unavailable"; generationId: string; attemptId: string; errorCode: string }
  /** Server-side prerequisite missing (e.g. admin client unconfigured). Nothing was mutated. */
  | { outcome: "unavailable"; reason: string };

/**
 * Phase 13-E: delegates to the Sensitive Data Guard.
 *
 * The call sites below are unchanged — the difference is that every field
 * now passes the telemetry allow-list before it reaches console or any
 * future sink. An unknown or unsafe field is dropped, not printed.
 */
const emit = createFieldLogger("webhook-temporal-bridge");

function log(fields: Record<string, unknown>): void {
  emit(fields);
}

/** Attempt states in which an inbound provider observation is still meaningful. */
const OBSERVABLE_ATTEMPT_STATUSES: ReadonlySet<string> = new Set(["submitted", "processing"]);

/**
 * Maps the normalized provider job status onto the signal's status hint.
 * An unrecognized state fails safely (null) rather than being forwarded as
 * something the workflow might act on.
 */
function toSignalStatus(
  reportedState: VerifiedWebhookEvent["reportedState"]
): "processing" | "completed" | "failed" | null {
  switch (reportedState) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "processing":
    case "queued":
      return "processing";
    default:
      // Includes undefined: a callback that reports no state at all is
      // still a legitimate "something changed, go look" nudge.
      return reportedState === undefined ? "processing" : null;
  }
}

/**
 * Correlates a verified provider event to its attempt, records the
 * observation durably, and signals the owning GenerationWorkflow.
 *
 * `deps` is injectable purely as a test seam — production callers omit it
 * and get the real Supabase admin client and Temporal transport.
 */
export async function bridgeVerifiedWebhookToTemporal(
  event: VerifiedWebhookEvent,
  deps: WebhookBridgeDeps = defaultDeps
): Promise<WebhookBridgeOutcome> {
  const signalFn = deps.signal;

  if (!deps.isAdminConfigured()) {
    return { outcome: "unavailable", reason: "supabase_admin_not_configured" };
  }
  if (!event.provider || !event.providerJobId) {
    return { outcome: "rejected", reason: "missing_job_identity" };
  }

  const signalStatus = toSignalStatus(event.reportedState);
  if (signalStatus === null) {
    // Unknown provider state: refuse rather than guess what it means.
    log({ provider: event.provider, result: "rejected", reason: "unknown_provider_state" });
    return { outcome: "rejected", reason: "unknown_provider_state" };
  }

  const admin = deps.getAdmin();

  // ---- Correlate from Cinefield's own durable rows, never from the event --
  let attempt: GenerationAttempt | null;
  try {
    attempt = await findAttemptByProviderJob(admin, event.provider, event.providerJobId);
  } catch {
    return { outcome: "unavailable", reason: "correlation_failed" };
  }

  if (!attempt) {
    // Unknown external job. Refuse — never broaden the search, never let
    // the event nominate a target, never mutate anything.
    log({ provider: event.provider, result: "unknown_job" });
    return { outcome: "unknown_job" };
  }

  // A correlation hint that disagrees with durable state is a refusal, not
  // something to resolve in the event's favour.
  if (
    event.correlationGenerationId !== undefined &&
    event.correlationGenerationId !== attempt.generation_id
  ) {
    log({ provider: event.provider, result: "rejected", reason: "correlation_mismatch" });
    return { outcome: "rejected", reason: "correlation_mismatch" };
  }

  // Defense in depth: findAttemptByProviderJob already filtered on provider,
  // so a mismatch here would mean the row itself disagrees with the query.
  if (attempt.provider !== event.provider) {
    log({ provider: event.provider, result: "rejected", reason: "provider_mismatch" });
    return { outcome: "rejected", reason: "provider_mismatch" };
  }

  const generationId = attempt.generation_id;
  const attemptId = attempt.id;

  // ---- Durable observation FIRST -----------------------------------------
  // A terminal or otherwise-past attempt is a duplicate/out-of-order
  // delivery: report it as already handled rather than forcing a
  // regression. This is the state-machine guard, not an error path.
  if (!OBSERVABLE_ATTEMPT_STATUSES.has(attempt.status)) {
    log({ generationId, attemptId, result: "already_processed", attemptStatus: attempt.status });
    return { outcome: "already_processed", generationId, attemptId };
  }

  try {
    // Monotonic by predicate: only submitted/processing can be written, so a
    // racing terminal write between the read above and this update still
    // wins and this returns false.
    const applied = await recordProviderObservation(admin, attemptId, "processing");
    if (!applied) {
      log({ generationId, attemptId, result: "already_processed", reason: "transition_not_applicable" });
      return { outcome: "already_processed", generationId, attemptId };
    }
  } catch {
    return { outcome: "unavailable", reason: "attempt_update_failed" };
  }

  // ---- Signal SECOND ------------------------------------------------------
  const signalResult: ProviderEventSignalOutcome = await signalFn(generationId, {
    attemptId,
    providerJobId: event.providerJobId,
    status: signalStatus,
  });

  if (signalResult.outcome === "signalled") {
    log({ generationId, attemptId, result: "accepted", status: signalStatus });
    return { outcome: "accepted", generationId, attemptId };
  }

  if (signalResult.outcome === "workflow_not_found") {
    // The observation is durable; there is simply no live workflow to tell.
    // Not retryable — a finished or never-Temporal-owned generation is not
    // going to grow a workflow on redelivery, and creating one here
    // (signalWithStart) would be exactly the duplicate-workflow bug the
    // deterministic workflow id exists to prevent.
    log({ generationId, attemptId, result: "workflow_not_found" });
    return { outcome: "already_processed", generationId, attemptId };
  }

  // Durable state is intact; only delivery failed. Explicitly retryable —
  // never reported as success.
  return {
    outcome: "signal_unavailable",
    generationId,
    attemptId,
    errorCode: signalResult.errorCode,
  };
}
