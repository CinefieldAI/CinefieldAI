import "server-only";
import { resolveGenerationOwner, type GenerationOwner } from "./execution-mode";
import { executeGeneration } from "./orchestrator";
import { startGenerationWorkflow } from "@/lib/temporal/generation-starter";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/supabaseAdmin";
import { resolveIntentStartedInline } from "./workflow-start-intent";
import type { OrchestrationResult } from "./types";
import { createFieldLogger } from "@/lib/observability/logger";
import { ensureGenerationBillingAuthorized } from "@/lib/billing/generation-credit-gate";

/**
 * Cinefield production generation execution boundary (Phase 6R-B).
 *
 * THE one place that decides what happens when an authenticated server
 * request asks for a generation to run. Extracted out of
 * src/app/api/orchestration/execute/route.ts so the ownership rules are
 * testable directly, with the route reduced to HTTP translation. There is no
 * duplicated orchestration logic here — the Temporal path starts the existing
 * workflow, and the dev path calls the existing executeGeneration.
 *
 * THE CHAIN THIS ESTABLISHES
 *   authenticated server boundary
 *     -> resolveGenerationOwner()        (server-controlled, request-blind)
 *     -> billing authorization           (server-priced, atomic credit hold)
 *     -> startGenerationWorkflow()       (existing, deterministic workflow id)
 *     -> Temporal owns the lifecycle
 *     -> submitGeneration activity -> SQS CommandBus
 *     -> provider worker -> ProviderAdapter
 *
 * Trigger.dev does not appear in it. This module imports neither
 * `generationTask` nor `asyncContinuationTask`, and must never come to.
 *
 * NO FALLBACK, ANYWHERE
 * Every failure of the Temporal path resolves to `unavailable`. It never
 * degrades to the dev path and never dispatches a Trigger task. That is the
 * whole point of the phase: a second owner appearing when the first is
 * unhealthy is exactly how one generation becomes two provider jobs and two
 * charges. Refusing is recoverable; double-billing is not.
 */

export type GenerationExecutionOutcome =
  /**
   * Temporal owns it now. The workflow is running (or this call attached to
   * one that already was — the conflict policy is USE_EXISTING). Nothing is
   * finished yet; the caller must not report a result.
   */
  | {
      outcome: "started";
      owner: "temporal";
      generationId: string;
      workflowId: string;
      runId: string;
    }
  /** Non-production dev path only. Ran inline and finished. */
  | { outcome: "completed"; owner: "direct-dev"; result: OrchestrationResult }
  /**
   * No owner could take it. Nothing was dispatched, nothing was submitted to
   * a provider, and no other owner was substituted.
   */
  | {
      outcome: "unavailable";
      reason: "temporal_generation_disabled" | "temporal_start_failed";
      /** Sanitized code only — never a Temporal error message or address. */
      errorCode?: string;
    };

/**
 * Injectable collaborators. Exists purely as a test seam, matching the
 * `deps` pattern already used by webhook-temporal-bridge.ts and the Redis
 * stores — the zero-cost tests inject a client bound to the Temporal test
 * server rather than reimplementing this decision.
 */
export interface GenerationExecutionDeps {
  resolveOwner: () => GenerationOwner;
  startWorkflow: typeof startGenerationWorkflow;
  runDirect: typeof executeGeneration;
  /**
   * Retires the durable start intent this request just satisfied (M6).
   *
   * NOT the correctness mechanism — the relay is. If this never runs the row
   * stays pending, the relay redelivers, and Temporal absorbs the duplicate
   * through USE_EXISTING. It exists so the ordinary case does not leave the
   * relay a queue of work that is already done.
   */
  resolveStartIntent: (generationId: string) => Promise<void>;
  /** Test seam for the billing gate; production uses the real implementation. */
  authorizeBilling?: typeof ensureGenerationBillingAuthorized;
}

async function retireStartIntent(generationId: string): Promise<void> {
  // Best effort by design: a failure here must never turn a successfully
  // started generation into a failed request.
  try {
    if (!isSupabaseAdminConfigured()) return;
    await resolveIntentStartedInline(getSupabaseAdminClient(), generationId);
  } catch {
    // Swallowed deliberately. The relay is the backstop.
  }
}

const defaultDeps: GenerationExecutionDeps = {
  resolveOwner: resolveGenerationOwner,
  startWorkflow: startGenerationWorkflow,
  runDirect: executeGeneration,
  resolveStartIntent: retireStartIntent,
  authorizeBilling: ensureGenerationBillingAuthorized,
};

/**
 * Phase 13-E: delegates to the Sensitive Data Guard.
 *
 * The call sites below are unchanged — the difference is that every field
 * now passes the telemetry allow-list before it reaches console or any
 * future sink. An unknown or unsafe field is dropped, not printed.
 */
const emit = createFieldLogger("generation-owner");

function log(fields: Record<string, unknown>): void {
  emit(fields);
}

/**
 * Runs one authenticated generation request under whichever owner this
 * deployment has.
 *
 * `clerkUserId` MUST come from a verified server-side session. It is passed
 * into the workflow's durable history and re-verified inside the activities
 * against the generation row, so a wrong value fails there too — but this
 * function does not, and cannot, authenticate on the caller's behalf.
 */
export async function executeGenerationRequest(
  params: { generationId: string; clerkUserId: string },
  deps: GenerationExecutionDeps = defaultDeps
): Promise<GenerationExecutionOutcome> {
  const owner = deps.resolveOwner();

  if (owner === "unavailable") {
    // Fail closed. No Trigger dispatch, no inline execution, no provider call.
    log({ generationId: params.generationId, owner, result: "refused" });
    return { outcome: "unavailable", reason: "temporal_generation_disabled" };
  }

  // SECURITY: this is the shared boundary behind /api/generate and every
  // compatibility execution route. A route cannot bypass billing merely by
  // supplying an existing generation id: real provider work is authorized
  // here, before Temporal or the direct-dev orchestrator can start.
  await (deps.authorizeBilling ?? ensureGenerationBillingAuthorized)(params);

  if (owner === "temporal") {
    try {
      const started = await deps.startWorkflow({
        generationId: params.generationId,
        clerkUserId: params.clerkUserId,
      });
      // The workflow exists now, so the durable obligation to start one is
      // satisfied. Retired AFTER the start, never before: the reverse order
      // would clear the obligation for a start that then failed.
      await deps.resolveStartIntent(params.generationId);
      log({
        generationId: params.generationId,
        owner,
        result: "started",
        workflowId: started.workflowId,
      });
      return {
        outcome: "started",
        owner: "temporal",
        generationId: params.generationId,
        workflowId: started.workflowId,
        runId: started.runId,
      };
    } catch (caught) {
      // Temporal is configured but unreachable, unauthorized, or rejecting.
      // This catch exists ONLY to sanitize and report. Adding a second owner
      // here — inline execution, a Trigger dispatch, anything — would
      // reintroduce exactly the duplicate-owner hazard this phase removes.
      const errorCode = caught instanceof Error ? caught.name : "UnknownError";
      log({ generationId: params.generationId, owner, result: "start_failed", errorCode });
      return { outcome: "unavailable", reason: "temporal_start_failed", errorCode };
    }
  }

  // ---- direct-dev: non-production only, gated by resolveGenerationOwner ----
  // Reached only in a non-production process that explicitly opted in. Errors
  // propagate to the caller unchanged, exactly as before the cutover, so local
  // debugging still sees the real orchestration error.
  const result = await deps.runDirect({
    generationId: params.generationId,
    clerkUserId: params.clerkUserId,
  });
  return { outcome: "completed", owner: "direct-dev", result };
}
