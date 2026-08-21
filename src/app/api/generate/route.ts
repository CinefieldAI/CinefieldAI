import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import {
  isExecuteOnlyBody,
  readGenerationId,
  respondToGenerationRequest,
} from "@/lib/orchestration/generation-api-contract";
import {
  createGeneration,
  type GenerationCreateRequest,
} from "@/lib/orchestration/generation-create-service";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";

import { guardBrowserMutation } from "@/lib/security/privileged-mutation-guard";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
/**
 * POST /api/generate — THE canonical production generation entry point.
 *
 * CANONICAL BODY (Phase 5 final convergence):
 *   {
 *     model, prompt, projectId,
 *     negativePrompt?, inputUrl?, metadata?, idempotencyKey?
 *   }
 *
 * The server creates the generation and then starts Temporal. Everything
 * internal is derived here, not accepted: the owner comes from the verified
 * session, provider and generation type from the model registry, and the
 * generation id from the database. There is no field through which a client
 * could name a provider, an attempt, a workflow, a queue, or a credit
 * outcome — the request type has none, so none can be smuggled in.
 *
 * COMPATIBILITY BODY:
 *   { generationId }
 * Executes a row that already exists. This is what the two wrapper routes
 * send, and keeping it here means one endpoint serves both shapes instead of
 * the behaviours drifting apart across routes.
 *
 * CREATION AND EXECUTION ARE SEPARATE, AND THE ORDER MATTERS. The row commits
 * first; Temporal starts after. A Temporal failure therefore leaves a
 * durable, recoverable generation rather than losing the request — and the
 * database transaction is never held open across a network call to Temporal.
 *
 * Pricing and credit reservation are deliberately not wired — Phase 10.
 */

export async function POST(request: Request): Promise<NextResponse> {
  // SECURITY_FINDINGS_9751bd11, finding 3. Same-origin check BEFORE any
  // side effect: this route mutates durable state or spends compute under an
  // ambient Clerk session, so a cross-site request must be refused before it
  // reaches auth, not after. Additive — auth and the rate-limit class below
  // are unchanged.
  const crossOrigin = guardBrowserMutation(request);
  if (crossOrigin) return crossOrigin;

  // ---- Authentication (server-side Clerk session only) --------------------
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  // Phase 12-A (application half). BEFORE any side effect: on a paid
  // path the handler has not begun, so a refusal cannot have created a
  // generation, reserved a credit, started a workflow or called a provider.
  const limited = await guardRoute({ routeClass: "paid_compute", userId });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const error = new OrchestrationError("INVALID_INPUT", {
      userMessage: "Invalid request body.",
    });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  // ---- Compatibility shape: execute an existing row ----------------------
  if (isExecuteOnlyBody(body)) {
    try {
      return respondToGenerationRequest(readGenerationId(body), userId);
    } catch (caught) {
      const error = toOrchestrationError(caught);
      return privateJson(error.toResponseBody(), { status: error.status });
    }
  }

  // ---- Canonical shape: create, then execute -----------------------------
  if (!isSupabaseAdminConfigured()) {
    const error = new OrchestrationError("PROVIDER_NOT_CONFIGURED", {
      userMessage: "The server is not fully configured.",
    });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  let generationId: string;
  try {
    const created = await createGeneration(
      getSupabaseAdminClient(),
      userId,
      body as GenerationCreateRequest
    );

    if (created.outcome === "idempotency_conflict") {
      // The key was reused with a different payload. Returning the earlier
      // generation would answer a question this caller did not ask.
      const error = new OrchestrationError("DUPLICATE_EXECUTION", {
        userMessage:
          "This idempotency key was already used for a different request.",
      });
      return privateJson(
        { ...error.toResponseBody(), reason: "idempotency_key_reused_with_different_request" },
        { status: error.status }
      );
    }

    generationId = created.generationId;
  } catch (caught) {
    const error = toOrchestrationError(caught);
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  // The row is durable from here. Starting Temporal is a separate step, so a
  // failure to start reports unavailable while the generation survives for a
  // retry or reconciliation to pick up — it is never deleted to hide an
  // orchestration failure.
  return respondToGenerationRequest(generationId, userId);
}
