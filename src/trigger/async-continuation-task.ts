import { task, wait } from "@trigger.dev/sdk";
import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import {
  FIRST_CHECK_DELAY_SECONDS,
  MAX_CONSECUTIVE_CHECK_FAILURES,
  MAX_POLLING_WALL_CLOCK_SECONDS,
  MAX_STATUS_CHECKS,
  nextCheckDelaySeconds,
} from "@/lib/orchestration/async-polling-policy";
import { type OrchestrationErrorCode, toOrchestrationError } from "@/lib/orchestration/errors";
// checkAsyncGeneration is the ONLY orchestration entry point this file may
// import. executeGeneration is deliberately absent: it is the sole function
// that can reach provider.submit(), and a continuation must never submit.
import { checkAsyncGeneration } from "@/lib/orchestration/orchestrator";
import { recordContinuationHalt } from "@/lib/orchestration/status-manager";
import type { ContinuationHaltReason } from "@/lib/orchestration/types";

/**
 * Cinefield's generic async continuation controller.
 *
 * One long-running provider job, checked repeatedly until it finishes. This
 * is a TRANSPORT, not orchestration: every decision about state, evidence,
 * finalization and safety already lives behind checkAsyncGeneration, which a
 * future webhook route or WebSocket listener will call in exactly the same
 * way. Nothing provider-specific appears here, and nothing here is required
 * for the orchestration core to work — polling is simply the first transport
 * to be built.
 *
 * WHAT THIS TASK CANNOT DO
 * It cannot start a provider job. It imports checkAsyncGeneration and
 * nothing else from the orchestrator; executeGeneration — the only path to
 * provider.submit() — is not imported, so no continuation retry, timeout, or
 * error branch can produce a second external (billable) generation.
 *
 * PAYLOAD
 * Only the two identifiers needed to find the row: generationId and the
 * clerkUserId captured server-side at dispatch. The external providerJobId is
 * never accepted from a caller — it is read from the row's own persisted
 * evidence inside checkAsyncGeneration, so no client can point a continuation
 * at somebody else's provider job.
 */
export interface AsyncContinuationPayload {
  generationId: string;
  clerkUserId: string;
}

/**
 * Error codes for which further polling is pointless: the row is gone, not
 * ours, not in a continuable state, or the provider adapter cannot be asked
 * at all. Stopping preserves every piece of evidence; it never resubmits.
 * Everything else (network, 429, 5xx, storage/database blips) is transient
 * and stays within the consecutive-failure budget.
 */
const NON_CONTINUABLE_CODES: OrchestrationErrorCode[] = [
  "GENERATION_NOT_FOUND",
  "FORBIDDEN",
  "INVALID_INPUT",
  "UNKNOWN_MODEL",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_AUTH_ERROR",
  "INTERNAL_ERROR",
];

interface ContinuationOutcome {
  generationId: string;
  result: "completed" | "failed" | "halted";
  checks: number;
  reason?: ContinuationHaltReason;
  errorCode?: string;
}

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:continuation]", JSON.stringify(fields));
}

/**
 * Persists why polling stopped and returns the outcome. Best effort: the
 * marker is informational, so a failed write must not turn a clean stop into
 * a thrown error (which Trigger.dev would surface as a failed run).
 */
async function halt(
  generationId: string,
  reason: ContinuationHaltReason,
  checks: number,
  errorCode?: string
): Promise<ContinuationOutcome> {
  try {
    const admin = getSupabaseAdminClient();
    const { data } = await admin
      .from("generations")
      .select("metadata")
      .eq("id", generationId)
      .maybeSingle();

    await recordContinuationHalt(
      admin,
      generationId,
      (data?.metadata ?? null) as Record<string, unknown> | null,
      {
        reason,
        haltedAt: new Date().toISOString(),
        checkCount: checks,
        ...(errorCode ? { lastErrorCode: errorCode } : {}),
      }
    );
  } catch {
    // Informational only — never mask a clean stop.
  }

  log({ generationId, result: "halted", reason, checks, errorCode });
  return { generationId, result: "halted", checks, reason, errorCode };
}

export const asyncContinuationTask = task({
  id: "cinefield-async-continuation",
  // Compute-time seconds. Trigger.dev checkpoints wait.for(), so the waits
  // between checks do NOT count toward this — only the checks themselves do.
  maxDuration: 300,
  // One attempt on purpose. A thrown continuation must not be restarted from
  // check zero: that would double the polling load and, if two chains ran at
  // once, race the finalization lease for no benefit. The loop already has
  // its own failure budget, and every stop path preserves the provider job.
  retry: { maxAttempts: 1 },
  run: async (payload: AsyncContinuationPayload): Promise<ContinuationOutcome> => {
    const { generationId, clerkUserId } = payload;
    const startedAt = Date.now();
    let consecutiveFailures = 0;
    let lastErrorCode: string | undefined;

    // Bounded loop, not `while (true)`: it can run at most MAX_STATUS_CHECKS
    // iterations, and wait.for() checkpoints the run so no worker sits in a
    // sleep. Every exit path returns or halts — none resubmits.
    for (let checkIndex = 0; checkIndex < MAX_STATUS_CHECKS; checkIndex += 1) {
      const delaySeconds =
        checkIndex === 0 ? FIRST_CHECK_DELAY_SECONDS : nextCheckDelaySeconds(checkIndex);
      await wait.for({ seconds: delaySeconds });

      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      if (elapsedSeconds >= MAX_POLLING_WALL_CLOCK_SECONDS) {
        return await halt(generationId, "poll-ceiling", checkIndex, lastErrorCode);
      }

      let status: "completed" | "processing" | "failed";
      try {
        // "poll" is recorded with the observation purely for audit; the
        // orchestration core treats all transports identically.
        const outcome = await checkAsyncGeneration({
          generationId,
          clerkUserId,
          source: "poll",
        });
        status = outcome.status;
        consecutiveFailures = 0;
        lastErrorCode = undefined;
      } catch (caught) {
        // A failed CHECK is not a failed job (Phase 6D): the provider job is
        // presumed live, the row stays "processing", and the correct
        // reaction is to check again — never to fail the generation and
        // never to submit anything.
        const error = toOrchestrationError(caught);
        lastErrorCode = error.code;

        if (NON_CONTINUABLE_CODES.includes(error.code)) {
          return await halt(generationId, "operational-error", checkIndex + 1, error.code);
        }

        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_CHECK_FAILURES) {
          return await halt(generationId, "check-failures", checkIndex + 1, error.code);
        }

        log({ generationId, result: "check_failed", errorCode: error.code, consecutiveFailures });
        continue;
      }

      if (status === "completed" || status === "failed") {
        // Terminal. checkAsyncGeneration already ran the shared finalization
        // tail (for completed) or recorded the provider's own failure, and it
        // reports terminal rows idempotently — so a late continuation that
        // arrives after the fact simply returns the same answer without
        // writing anything.
        log({ generationId, result: status, checks: checkIndex + 1 });
        return { generationId, result: status, checks: checkIndex + 1 };
      }
    }

    return await halt(generationId, "poll-ceiling", MAX_STATUS_CHECKS, lastErrorCode);
  },
});
