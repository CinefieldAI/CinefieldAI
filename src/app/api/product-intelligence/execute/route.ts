import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { createGeneration } from "@/lib/orchestration/generation-create-service";
import { respondToGenerationRequest } from "@/lib/orchestration/generation-api-contract";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { guardBrowserMutation } from "@/lib/security/privileged-mutation-guard";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { createFieldLogger } from "@/lib/observability/logger";
import { parseUserIntent } from "@/lib/product-intelligence/user-intent-contract";
import { coordinateUserIntent } from "@/lib/product-intelligence/core-coordinator";
import { compileManifest } from "@/lib/product-intelligence/manifest-compiler";
import { mapGenerationManifestToCreateRequest } from "@/lib/product-intelligence/compatibility-seam";

/**
 * POST /api/product-intelligence/execute
 *
 * Phase 17-A real admission integration: request -> UserIntent -> Product
 * Intelligence -> GenerationManifest -> existing generation admission ->
 * Temporal, as one real, live HTTP path — not a dangling compatibility
 * mapper.
 *
 * PLAN != EXECUTION. This route recompiles the intent fresh (never trusts a
 * client-supplied manifest) and proceeds to real admission ONLY when the
 * outcome is exactly "VALID" — PARTIAL (e.g. safety unavailable) and every
 * refusal outcome stop here and are returned unexecuted, unchanged from what
 * POST /api/product-intelligence/compile would already report. A caller
 * that wants to preview before committing should call /compile first; this
 * route is the deliberate, separate "yes, actually do it" step.
 *
 * NO SECOND LIFECYCLE: once a manifest is VALID, this calls the exact same
 * two canonical functions POST /api/generate calls, in the same order —
 * createGeneration() then respondToGenerationRequest() — the same pattern
 * that route's own doc comment already describes as normal ("the two
 * wrapper routes" pattern). Nothing here creates a row, starts Temporal, or
 * reserves a credit through any other path. /api/generate/route.ts is not
 * modified by this file.
 *
 * TENANT OWNERSHIP: createGeneration()'s own create_generation_tx RPC
 * already verifies the project belongs to the authenticated clerk_user_id
 * (surfacing a foreign project as GENERATION_NOT_FOUND) — reused verbatim,
 * not reimplemented, so this path inherits that check automatically.
 */

const emit = createFieldLogger("product-intelligence-execute");

export async function POST(request: Request): Promise<NextResponse> {
  // SECURITY_FINDINGS_9751bd11, finding 3. Same-origin check BEFORE any
  // side effect: this route mutates durable state or spends compute under an
  // ambient Clerk session, so a cross-site request must be refused before it
  // reaches auth, not after. Additive — auth and the rate-limit class below
  // are unchanged.
  const crossOrigin = guardBrowserMutation(request);
  if (crossOrigin) return crossOrigin;

  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  // Phase 12-A (application half). Before any side effect: on a paid path
  // the handler has not begun, so a refusal cannot have created a
  // generation, started a workflow, or called a provider.
  const limited = await guardRoute({ routeClass: "paid_compute", userId });
  if (limited) return limited;

  let intent;
  try {
    const body: unknown = await request.json();
    intent = parseUserIntent(body, randomUUID());
  } catch (caught) {
    const error = toOrchestrationError(caught);
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  let compiled;
  try {
    const coordinated = await coordinateUserIntent(intent);
    compiled = compileManifest(coordinated);
  } catch (caught) {
    const error = toOrchestrationError(caught);
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  emit({
    op: "execute_compile",
    result: compiled.outcome,
    promptLength: intent.prompt.length,
    hasModelId: Boolean(intent.modelId),
  });

  // Anything short of a clean VALID compile stops here, unexecuted. This IS
  // the approval gate: only a fully-passed plan may proceed to real
  // admission.
  if (compiled.outcome !== "VALID") {
    return privateJson(compiled, { status: 200 });
  }

  if (!isSupabaseAdminConfigured()) {
    const error = new OrchestrationError("PROVIDER_NOT_CONFIGURED", {
      userMessage: "The server is not fully configured.",
    });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  const createRequest = mapGenerationManifestToCreateRequest(compiled.manifest);

  let generationId: string;
  try {
    const created = await createGeneration(getSupabaseAdminClient(), userId, createRequest);

    if (created.outcome === "idempotency_conflict") {
      const error = new OrchestrationError("DUPLICATE_EXECUTION", {
        userMessage: "This idempotency key was already used for a different request.",
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

  // The row is durable from here — the same guarantee /api/generate makes.
  return respondToGenerationRequest(generationId, userId);
}
