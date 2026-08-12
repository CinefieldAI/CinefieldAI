import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrchestrationError } from "./errors";
import { findModel } from "./model-registry";
import { canonicalRequestHash, deriveIdempotencyIdentity } from "@/lib/redis/idempotency-identity";
import { validateCapabilities } from "./capability-validator";
import { mapMetadataToInputs, mapMetadataToSettings } from "./generation-settings-mapper";
import { resolveWorkflow } from "./workflow-router";
import { resolveHealthyRoute } from "@/lib/routing/health-aware-router";

function log(fields: Record<string, unknown>): void {
  // Identifiers and codes only — never a prompt, a credential or a payload.
  console.info("[cinefield:generation-create]", JSON.stringify(fields));
}

/**
 * Server-side generation creation (Phase 5 final convergence).
 *
 * WHAT MOVED, AND WHY IT MATTERS
 * The browser used to insert the generations row under RLS and then hand the
 * id to the server. That worked, but it put the last piece of the production
 * path on the wrong side of the trust boundary: the client decided when a
 * generation came into existence, chose its provider and generation_type
 * fields, and produced two rows for two clicks before any server code ran.
 *
 * Now the client describes what it WANTS and the server decides everything
 * else. Provider and generation type are re-derived from the model registry
 * rather than accepted; the owner comes from a verified session; the project
 * is re-checked against that owner; and the row plus its idempotency identity
 * are written in one statement so a duplicate cannot slip between them.
 *
 * WHAT THE CLIENT MAY STILL SEND
 * Product inputs only — model, prompt, settings, an already-uploaded input
 * path. Nothing that names an internal identity. There is deliberately no
 * field for provider, providerJobId, attemptId, workflowId, queue, worker, or
 * a credit outcome, so none can be smuggled in.
 *
 * NOT DONE HERE, ON PURPOSE
 * No provider is called, no attempt is created, no workflow is started, and
 * no credit is reserved. Creation and execution are separate steps: the
 * caller commits the row first and starts Temporal afterwards, so a Temporal
 * failure leaves a durable, recoverable generation rather than losing the
 * request.
 */

/** Product inputs a client may supply. Internal identities are absent by design. */
export interface GenerationCreateRequest {
  /** Cinefield model id. Must resolve in the server registry. */
  model: string;
  prompt: string;
  /** Project to attach to. Ownership is re-verified server-side. */
  projectId: string;
  negativePrompt?: string | null;
  /** Storage path of an input already uploaded by the authenticated client. */
  inputUrl?: string | null;
  /** UI settings: aspect_ratio, resolution, image_count, voice, ... */
  metadata?: Record<string, unknown>;
  /** Caller's key for ONE intent. Bounded; never trusted on its own. */
  idempotencyKey?: string;
}

export type GenerationCreateOutcome =
  | { outcome: "created"; generationId: string }
  /** An equivalent request already produced this generation. */
  | { outcome: "replayed"; generationId: string; status: string }
  /**
   * The key was reused with a DIFFERENT payload. Returning the earlier
   * generation would answer a question the caller did not ask.
   */
  | { outcome: "idempotency_conflict" };

const MAX_PROMPT_LENGTH = 10_000;
const MAX_METADATA_BYTES = 16_384;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The canonical form of a request, used for the hash.
 *
 * Only the fields that make two requests genuinely the same operation. The
 * idempotency key itself is excluded — it identifies the intent, it is not
 * part of what was asked for — and so is anything the server derives, since
 * including a derived value would make the hash depend on registry data that
 * can legitimately change between deploys.
 */
function canonicalForm(request: GenerationCreateRequest): Record<string, unknown> {
  return {
    model: request.model,
    prompt: request.prompt,
    projectId: request.projectId,
    negativePrompt: request.negativePrompt ?? null,
    inputUrl: request.inputUrl ?? null,
    metadata: request.metadata ?? {},
  };
}

/** Validates product inputs. Throws typed errors; never guesses a value. */
function validate(request: GenerationCreateRequest): void {
  if (typeof request.projectId !== "string" || !UUID.test(request.projectId)) {
    throw new OrchestrationError("INVALID_INPUT", { userMessage: "A valid project is required." });
  }
  if (typeof request.model !== "string" || request.model.length === 0) {
    throw new OrchestrationError("INVALID_INPUT", { userMessage: "A model is required." });
  }
  if (typeof request.prompt !== "string") {
    throw new OrchestrationError("INVALID_INPUT", { userMessage: "A prompt is required." });
  }
  if (request.prompt.length > MAX_PROMPT_LENGTH) {
    throw new OrchestrationError("INVALID_INPUT", { userMessage: "The prompt is too long." });
  }
  if (request.metadata !== undefined) {
    if (typeof request.metadata !== "object" || request.metadata === null || Array.isArray(request.metadata)) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid settings." });
    }
    if (Buffer.byteLength(JSON.stringify(request.metadata), "utf8") > MAX_METADATA_BYTES) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "Settings payload is too large." });
    }
  }
  if (request.idempotencyKey !== undefined) {
    if (
      typeof request.idempotencyKey !== "string" ||
      request.idempotencyKey.length < 8 ||
      request.idempotencyKey.length > 200
    ) {
      throw new OrchestrationError("INVALID_INPUT", {
        userMessage: "Invalid idempotency key.",
      });
    }
  }
}

/**
 * Creates (or replays) one generation.
 *
 * `clerkUserId` MUST come from a verified server-side session. Passing a
 * client-supplied value would defeat both the ownership check and the
 * tenant-scoping of the idempotency identity.
 */
export async function createGeneration(
  admin: SupabaseClient,
  clerkUserId: string,
  request: GenerationCreateRequest
): Promise<GenerationCreateOutcome> {
  validate(request);

  // The registry is authoritative for routing. A client naming a model it
  // does not have is refused; a client naming a provider is not possible,
  // because there is no field for one.
  const model = findModel(request.model);
  if (!model) {
    throw new OrchestrationError("UNKNOWN_MODEL", {
      userMessage: "This model is not available.",
    });
  }
  if (!model.enabled) {
    throw new OrchestrationError("MODEL_DISABLED", { context: { modelId: model.id } });
  }

  // ---- PHASE 7-F: capability validation, at the earliest safe point -------
  //
  // Before a row exists, before a workflow starts, before an attempt is
  // claimed, before any provider is contacted. An unsupported aspect ratio or
  // an over-limit duration is a property of the REQUEST, knowable here, and
  // discovering it three layers deep costs a durable row and a workflow that
  // exist only to fail.
  //
  // The same validator the orchestrator already runs, reading settings
  // through the same mapper — so a request accepted here cannot be refused
  // later for a capability reason, and vice versa.
  const inputs = mapMetadataToInputs(request.inputUrl, request.metadata);
  const workflow = resolveWorkflow(model, inputs);
  validateCapabilities({
    model,
    workflow,
    prompt: request.prompt,
    inputs,
    settings: mapMetadataToSettings(request.metadata),
  });

  // ---- PHASE 7-B: where will this run? ------------------------------------
  //
  // Resolved here so the decision is durable with the generation rather than
  // re-derived at execution time from whatever the route table says later.
  // The router selects; it does not create, execute, or own anything.
  //
  // A model with no eligible route is refused BEFORE the row is created. The
  // alternative — a durable generation nothing can ever run — is a queue of
  // work that silently never completes.
  // PHASE 7-C: hard eligibility first, then health. A model with no route at
  // all and a model whose every route is behind an open breaker are different
  // failures and get different typed errors — one is a misconfiguration, the
  // other is an outage that heals itself.
  const routing = await resolveHealthyRoute(admin, {
    cinefieldModelId: model.id,
    // PHASE 7-D: the request's own billing shape, derived server-side from
    // the already-validated settings. A client can ask for four images; it
    // cannot tell the server what four images cost.
    costShape: { outputCount: mapMetadataToSettings(request.metadata).outputCount ?? 1 },
  });
  if (routing.outcome !== "selected") {
    log({
      modelId: model.id,
      result: routing.outcome,
      // Codes only, so an operator can see which switch is off.
      rejected: routing.decision.evaluations
        .filter((evaluation) => evaluation.rejection)
        .map((evaluation) => evaluation.rejection),
    });
    throw new OrchestrationError(
      routing.outcome === "no_healthy_route" ? "NO_HEALTHY_ROUTE" : "NO_ELIGIBLE_ROUTE",
      { context: { modelId: model.id } }
    );
  }

  const requestHash = canonicalRequestHash(canonicalForm(request));

  // Scoped to the actor as well as the payload (6R.24). The derived identity
  // is not sent to the database — the row's own (clerk_user_id,
  // idempotency_key) index already scopes by tenant — but deriving it here
  // validates the inputs through the same contract every other idempotent
  // surface uses, and keeps one definition of what an identity is.
  if (request.idempotencyKey) {
    const identity = deriveIdempotencyIdentity({
      clientKey: request.idempotencyKey,
      actorId: clerkUserId,
      canonicalRequest: canonicalForm(request),
    });
    if (!identity.ok) {
      throw new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid idempotency key." });
    }
  }

  const { data, error } = await admin.rpc("create_generation_tx", {
    p_clerk_user_id: clerkUserId,
    p_project_id: request.projectId,
    // Derived, never accepted.
    p_generation_type: model.generationType,
    p_provider: model.providerId,
    p_model: model.id,
    p_prompt: request.prompt,
    // The routing decision travels with the generation. Recorded under a
    // dedicated key so it never collides with UI settings, and read back by
    // describeGeneration so the provider that EXECUTES is the one the router
    // chose — not whatever the registry would resolve to at execution time.
    p_metadata: {
      ...(request.metadata ?? {}),
      routing: {
        routeId: routing.selection.routeId,
        modelVersionId: routing.selection.modelVersionId,
        modelVersion: routing.selection.modelVersion,
        providerId: routing.selection.providerId,
        providerModelId: routing.selection.providerModelId,
        selectionReason: routing.selection.selectionReason,
        selectedAt: new Date().toISOString(),
      },
    },
    p_input_url: request.inputUrl ?? null,
    p_negative_prompt: request.negativePrompt ?? null,
    p_idempotency_key: request.idempotencyKey ?? null,
    p_request_hash: requestHash,
  });

  if (error) {
    // A project that does not belong to the caller surfaces as not-found, so
    // the API never confirms the existence of someone else's project.
    if (typeof error.message === "string" && error.message.includes("project_not_found")) {
      throw new OrchestrationError("GENERATION_NOT_FOUND", {
        userMessage: "Project not found.",
      });
    }
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { operation: "create_generation_tx" },
    });
  }

  const result = data as {
    generation_id: string;
    created: boolean;
    request_hash: string | null;
    status: string;
  };

  if (result.created) {
    return { outcome: "created", generationId: result.generation_id };
  }

  // Same key, different payload. Refuse rather than hand back a generation
  // for a request nobody made — silently serving the earlier one is how a
  // user gets an image of the prompt they edited away from.
  if (
    request.idempotencyKey &&
    result.request_hash !== null &&
    result.request_hash !== requestHash
  ) {
    return { outcome: "idempotency_conflict" };
  }

  return { outcome: "replayed", generationId: result.generation_id, status: result.status };
}
