import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError, toOrchestrationError } from "@/lib/orchestration/errors";
import { guardBrowserMutation } from "@/lib/security/privileged-mutation-guard";
import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { createFieldLogger } from "@/lib/observability/logger";
import { parseUserIntent } from "@/lib/product-intelligence/user-intent-contract";
import { coordinateUserIntent } from "@/lib/product-intelligence/core-coordinator";
import { compileManifest } from "@/lib/product-intelligence/manifest-compiler";

/**
 * POST /api/product-intelligence/compile
 *
 * Phase 17. Compiles a UserIntent into a GenerationManifest (or a bounded
 * refusal) and returns it. This endpoint NEVER creates a generations row,
 * NEVER starts a Temporal workflow, NEVER reserves credits, and NEVER
 * writes any terminal state — it is a pure compile-and-preview surface.
 * Temporal remains the only generation lifecycle owner; nothing here feeds
 * a manifest into the live creation path automatically (see
 * compatibility-seam.ts for the mapper a caller may use to do that itself,
 * through the EXISTING /api/generate seam, unmodified by this route).
 *
 * Reuses the same auth + rate-limit shape as the other opt-in orchestration
 * intelligence endpoints (/api/orchestration/enhance-prompt,
 * /api/orchestration/moderate-text) rather than inventing a new one.
 */

const emit = createFieldLogger("product-intelligence-compile");

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

  // Phase 12-A (application half). Before any side effect.
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

  try {
    const coordinated = await coordinateUserIntent(intent);
    const compiled = compileManifest(coordinated);

    // Codes and lengths only — never the prompt text itself (Phase 13-E
    // sensitive-data boundary, matching generation-create-service.ts's own
    // log() convention).
    emit({
      op: "compile",
      result: compiled.outcome,
      promptLength: intent.prompt.length,
      hasModelId: Boolean(intent.modelId),
    });

    return privateJson(compiled, { status: 200 });
  } catch (caught) {
    const error = toOrchestrationError(caught);
    return privateJson(error.toResponseBody(), { status: error.status });
  }
}
