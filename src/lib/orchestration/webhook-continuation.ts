import "server-only";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { OrchestrationError } from "./errors";
import { checkAsyncGeneration } from "./orchestrator";
import { findGenerationByProviderJob } from "./status-manager";
import type { OrchestrationResult, ProviderJobStatus, TransportSource } from "./types";

/**
 * Cinefield generic push-transport continuation boundary (Phase 6I).
 *
 * A provider that pushes (webhook or WebSocket) must land here, never on the
 * orchestration core directly. The intended shape is:
 *
 *   provider-specific route + signature verifier   (Phase 8)
 *        ↓  produces
 *   VerifiedWebhookEvent                            (this file)
 *        ↓
 *   continueFromPushEvent()                         (this file)
 *        ↓
 *   checkAsyncGeneration()                          (Phase 6C core)
 *        ↓
 *   existing state machine + shared finalization
 *
 * WHY THERE IS NO PUBLIC ROUTE YET
 * Every provider signs and shapes its callbacks differently — different
 * signature algorithms, header names, timestamp windows, replay defenses and
 * event schemas. There is no honest "universal" verifier, and a public
 * endpoint that accepted unverified provider data would be an open door for
 * anyone who learned a job id. So Phase 6I ships the boundary and the
 * contract only; the first public route arrives in Phase 8 together with a
 * real provider's real signature verification.
 *
 * WHAT THIS LAYER DOES NOT TRUST
 * Nothing in the event chooses what Cinefield acts on except the external
 * job identity. The generation, its owner, and the provider of record are
 * all read from Cinefield's own persisted evidence. An event cannot name a
 * user, cannot point at an arbitrary generation, and cannot supply an
 * output, a URL, or a result payload — the outcome is always re-read from
 * the provider through the normal adapter path.
 */

/**
 * The provider-neutral event shape a provider-specific verifier must produce.
 * Deliberately minimal: anything not needed to identify the job is dropped
 * at the verifier boundary rather than carried inward.
 *
 * Explicitly NOT part of this contract, and never to be added: API keys,
 * webhook secrets, raw auth headers, raw provider request/response bodies,
 * signed URLs, or temporary provider output URLs. The normalized state below
 * is an observation hint only — the authoritative status and the outputs are
 * always re-fetched through the provider adapter.
 */
export interface NormalizedWebhookEvent {
  /** Cinefield provider id (registry id), set by the verifier, not the payload. */
  provider: string;
  /** The external provider's own job/task id, as carried by the event. */
  providerJobId: string;
  /**
   * Normalized state the event reports, when it reports one. Informational:
   * the continuation still asks the adapter for authoritative status, so a
   * spoofed or stale hint cannot advance a generation on its own.
   */
  reportedState?: ProviderJobStatus;
  /**
   * Cinefield generation id, ONLY when the provider echoes back metadata
   * Cinefield itself sent. Treated as a hint that must agree with the
   * persisted correlation — never as authority.
   */
  correlationGenerationId?: string;
  /**
   * Provider's own event identifier, when it supplies one. Recorded for
   * logging today; durable cross-request deduplication using it is Phase 8
   * work (see the replay note below).
   */
  eventId?: string;
  /** Which push transport delivered this event. */
  transport: Extract<TransportSource, "webhook" | "websocket">;
}

declare const VERIFIED: unique symbol;

/**
 * A NormalizedWebhookEvent that a provider-specific verifier has
 * authenticated. The brand is unforgeable from outside this module: a plain
 * object literal does not satisfy the type, so an unverified payload cannot
 * reach continueFromPushEvent even by mistake. The only way to obtain one is
 * markWebhookEventVerified(), which a verifier calls after — and only
 * after — it has checked that provider's signature.
 */
export type VerifiedWebhookEvent = NormalizedWebhookEvent & { readonly [VERIFIED]: true };

/**
 * Called by a provider-specific verifier once, and only once, its own
 * signature/authentication check has passed. This function performs no
 * verification itself — it cannot, because the scheme is provider-specific.
 * It exists so that "verified" is a type-level fact the continuation can
 * rely on rather than a convention someone can forget.
 */
export function markWebhookEventVerified(event: NormalizedWebhookEvent): VerifiedWebhookEvent {
  return event as VerifiedWebhookEvent;
}

/**
 * Continues an async generation from an authenticated push event.
 *
 * Correlation and safety, in order:
 *   1. The job is looked up by the PERSISTED (provider, providerJobId) pair.
 *      An unknown job is refused — the event is not allowed to create,
 *      resume, or invent anything.
 *   2. The owner comes from the row, never from the event.
 *   3. When the event carries a Cinefield generation id, it must agree with
 *      the row found by job id; a mismatch is refused rather than resolved.
 *   4. checkAsyncGeneration re-verifies (provider, job id) against the
 *      persisted state through its `expected` assertion before any provider
 *      call, so a mismatch that slipped past step 1 still fails safely.
 *
 * Idempotency and replay: this function adds no new state. It relies on the
 * guards that already exist and that Phase 6H exercised — terminal rows are
 * reported without writing, the finalization lease admits exactly one
 * download/upload, and markCompleted/markFailed/markCancelled are
 * compare-and-set. A provider replaying the same completion event is
 * therefore harmless. What is NOT yet covered is provider-level replay
 * defense (signature timestamp windows, nonce/event-id rejection); that is
 * Phase 8 work and would need a durable event store, which this phase
 * deliberately does not invent.
 *
 * Racing with polling is likewise already safe: both transports converge on
 * checkAsyncGeneration, exactly one wins the finalization claim, and the
 * loser reports the row's current state as a no-op.
 */
export async function continueFromPushEvent(
  event: VerifiedWebhookEvent
): Promise<OrchestrationResult> {
  if (!isSupabaseAdminConfigured()) {
    throw new OrchestrationError("PROVIDER_NOT_CONFIGURED", {
      context: { reason: "supabase_admin_not_configured" },
    });
  }

  if (!event.provider || !event.providerJobId) {
    throw new OrchestrationError("INVALID_INPUT", {
      context: { reason: "webhook_event_missing_job_identity" },
    });
  }

  const admin = getSupabaseAdminClient();
  const match = await findGenerationByProviderJob(admin, event.provider, event.providerJobId);

  if (!match) {
    // No generation holds this provider job. Refuse — never fall back to a
    // broader search, and never let the event nominate a target.
    throw new OrchestrationError("GENERATION_NOT_FOUND", {
      context: { reason: "no_generation_for_provider_job", provider: event.provider },
    });
  }

  if (
    event.correlationGenerationId !== undefined &&
    event.correlationGenerationId !== match.generationId
  ) {
    throw new OrchestrationError("INVALID_INPUT", {
      context: { reason: "webhook_correlation_mismatch", provider: event.provider },
    });
  }

  return await checkAsyncGeneration({
    generationId: match.generationId,
    // Server-derived from the row. The event has no say in whose generation
    // this is, so a valid signature for provider X still cannot reach
    // another user's work.
    clerkUserId: match.clerkUserId,
    source: event.transport,
    expected: { provider: event.provider, providerJobId: event.providerJobId },
  });
}
