import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { GENERATION_ID_PATTERN } from "@/lib/orchestration/generation-api-contract";
import { recordCancelIntent } from "@/lib/orchestration/cancel-intent";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { requestGenerationCancellation } from "@/lib/temporal/generation-starter";
import { isTemporalGenerationEnabled } from "@/lib/temporal/config";

/**
 * POST /api/generations/[generationId]/cancel — the authenticated cancel
 * entry point (Phase 6R-H closure).
 *
 * THE ORDER IS THE DESIGN.
 *
 *   1. authenticate, and resolve the owner from the DURABLE ROW
 *   2. record user cancel intent durably and idempotently
 *   3. only then signal Temporal
 *
 * Durable first, transport second — the same rule the verified-webhook
 * bridge follows. If the signal fails, the intent is still recorded and a
 * retry or reconciliation can act on it; the reverse order would risk
 * telling the workflow about an intent that was never persisted.
 *
 * WHAT THIS ROUTE DOES NOT DO
 * It does not call a provider's cancel API. It does not write the cancelled
 * state. It does not settle, release or refund a credit. A browser asking to
 * cancel is a request, not a lifecycle decision: Temporal coordinates the
 * cancellation, decides when the transition is safe (a handler may be
 * mid-flight with a provider right now), and a Temporal activity — not this
 * route — is what eventually calls ProviderAdapter.cancel with provider
 * details read from the durable attempt.
 *
 * Repeated cancellation is safe by construction: the intent write is
 * idempotent and keeps the FIRST requestedAt, and the signal is a wake, not
 * a command.
 */

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ generationId: string }> }
): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  const { generationId } = await params;
  if (typeof generationId !== "string" || !GENERATION_ID_PATTERN.test(generationId)) {
    const error = new OrchestrationError("INVALID_INPUT", {
      userMessage: "generationId must be a valid UUID.",
    });
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  if (!isSupabaseAdminConfigured()) {
    const error = new OrchestrationError("PROVIDER_NOT_CONFIGURED", {
      userMessage: "The server is not fully configured.",
    });
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }

  try {
    // ---- 1 + 2. Ownership is verified inside, against the durable row -----
    const intent = await recordCancelIntent(getSupabaseAdminClient(), generationId, userId);

    if (intent.outcome === "already_terminal") {
      // Not an error: the race simply resolved the other way. The caller is
      // told which state won so the UI can settle on the truth.
      return NextResponse.json(
        { generationId, status: intent.status, cancelRequested: false, owner: "temporal" },
        { status: 200 }
      );
    }

    // ---- 3. Tell Temporal, which owns the coordination --------------------
    // A failed or absent signal is NOT a failed cancellation: the intent is
    // durable either way. It is reported so the caller knows the workflow may
    // not have noticed yet.
    let signalled = false;
    if (isTemporalGenerationEnabled()) {
      signalled = await requestGenerationCancellation(generationId);
    }

    return NextResponse.json(
      {
        generationId,
        // The generation is not cancelled yet — Temporal decides when that is
        // safe. Saying otherwise would let a UI claim a provider job stopped
        // when it may still be running and may still be billed.
        status: "processing",
        cancelRequested: true,
        alreadyRequested: intent.alreadyRequested === true,
        workflowSignalled: signalled,
        owner: "temporal",
      },
      { status: 202 }
    );
  } catch (caught) {
    const error = toOrchestrationError(caught);
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }
}
