import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/supabaseAdmin";
import type { Generation, Project } from "@/types/database";
import { validateCapabilities } from "./capability-validator";
import { OrchestrationError, isRetryable, toOrchestrationError } from "./errors";
import { findModel, type ModelRegistryEntry } from "./model-registry";
import { normalizeOutputs } from "./output-normalizer";
import { attachSignedUrls, uploadOutputs } from "./output-storage";
import { getProviderAdapter } from "./provider-registry";
import { registerMockRequest, releaseMockRequest } from "./providers/mock-provider";
import { claimGeneration, markCompleted, markFailed, setStage } from "./status-manager";
import { resolveWorkflow } from "./workflow-router";
import type {
  GenerationSettings,
  NormalizedGenerationInput,
  NormalizedGenerationRequest,
  OrchestrationResult,
} from "./types";

/**
 * The Cinefield orchestrator.
 *
 * Owns the full server-side execution chain for one generation:
 *   ownership → claim → registry → normalize → route → validate →
 *   submit → normalize output → upload → complete
 *
 * Every failure path funnels through a typed OrchestrationError and, where
 * safe, records status = failed with a sanitized message.
 */

interface LogFields {
  generationId: string;
  provider?: string;
  modelId?: string;
  workflow?: string;
  stage?: string;
  durationMs?: number;
  result?: string;
  errorCode?: string;
}

/** Minimal sanitized server log. Never includes prompts, tokens, or payloads. */
function log(fields: LogFields): void {
  console.info("[cinefield:orchestration]", JSON.stringify(fields));
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Turns the persisted generations row into a provider-neutral request.
 * Settings originate from the metadata the browser wrote at insert time, but
 * every one of them is re-validated afterwards by the capability validator.
 */
function normalizeRequest(params: {
  generation: Generation;
  project: Project;
  model: ModelRegistryEntry;
}): { request: Omit<NormalizedGenerationRequest, "workflow">; inputs: NormalizedGenerationInput[] } {
  const { generation, project, model } = params;
  const metadata = (generation.metadata ?? {}) as Record<string, unknown>;

  const inputs: NormalizedGenerationInput[] = [];
  if (generation.input_url) {
    const mimeType = readString(metadata, "mime_type");
    if (mimeType) {
      inputs.push({
        storagePath: generation.input_url,
        mimeType,
        originalFileName: readString(metadata, "original_file_name") ?? "input",
        sizeBytes: readNumber(metadata, "file_size") ?? 0,
        role: "source",
      });
    }
  }

  // image_count arrives as a UI fraction string such as "3/4"; the numerator
  // is the requested output count.
  let outputCount: number | undefined;
  const imageCount = readString(metadata, "image_count");
  if (imageCount) {
    const parsed = Number.parseInt(imageCount.split("/")[0] ?? "", 10);
    if (Number.isInteger(parsed) && parsed > 0) outputCount = parsed;
  }

  const settings: GenerationSettings = {
    aspectRatio: readString(metadata, "aspect_ratio"),
    resolution: readString(metadata, "resolution"),
    durationSeconds: readNumber(metadata, "duration_seconds"),
    outputCount,
    thinking: readString(metadata, "thinking"),
    // Carries mock_mode through to the mock provider without leaking
    // provider-specific concepts into the typed settings surface.
    extra: metadata,
  };

  return {
    request: {
      generationId: generation.id,
      clerkUserId: generation.clerk_user_id,
      projectId: project.id,
      modelId: generation.model,
      provider: model.providerId,
      providerModelId: model.providerModelId,
      // The registry is the server-side source of truth. The row's
      // generation_type reflects the UI mode the browser was in, which may
      // not match the model's actual output type.
      generationType: model.generationType,
      prompt: generation.prompt,
      negativePrompt: generation.negative_prompt ?? undefined,
      inputs,
      settings,
    },
    inputs,
  };
}

/**
 * Executes one generation. `clerkUserId` must come from a verified
 * server-side Clerk session — never from the request body.
 */
export async function executeGeneration(params: {
  generationId: string;
  clerkUserId: string;
}): Promise<OrchestrationResult> {
  const { generationId, clerkUserId } = params;
  const startedAt = Date.now();

  if (!isSupabaseAdminConfigured()) {
    throw new OrchestrationError("PROVIDER_NOT_CONFIGURED", {
      context: { reason: "supabase_admin_not_configured" },
      userMessage: "The server is not fully configured.",
    });
  }

  const admin: SupabaseClient = getSupabaseAdminClient();

  // ---- Load + ownership ----------------------------------------------------
  const { data: generationRow, error: generationError } = await admin
    .from("generations")
    .select("*")
    .eq("id", generationId)
    .maybeSingle();

  if (generationError || !generationRow) {
    throw new OrchestrationError("GENERATION_NOT_FOUND", { context: { generationId } });
  }

  const generation = generationRow as Generation;

  // FORBIDDEN and GENERATION_NOT_FOUND both surface as 404 so the API does
  // not confirm the existence of another user's generation.
  if (generation.clerk_user_id !== clerkUserId) {
    throw new OrchestrationError("FORBIDDEN", { context: { generationId } });
  }

  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("*")
    .eq("id", generation.project_id)
    .maybeSingle();

  if (projectError || !projectRow) {
    throw new OrchestrationError("GENERATION_NOT_FOUND", {
      context: { generationId, reason: "project_missing" },
    });
  }

  const project = projectRow as Project;
  if (project.clerk_user_id !== clerkUserId) {
    throw new OrchestrationError("FORBIDDEN", { context: { generationId } });
  }

  // ---- Registry ------------------------------------------------------------
  const model = findModel(generation.model);
  if (!model) {
    throw new OrchestrationError("UNKNOWN_MODEL", {
      context: { generationId, modelId: generation.model },
      userMessage: "This model is not wired into the Cinefield orchestration chain yet.",
    });
  }
  if (!model.enabled) {
    throw new OrchestrationError("MODEL_DISABLED", { context: { modelId: model.id } });
  }

  const existingMetadata = (generation.metadata ?? {}) as Record<string, unknown>;

  // ---- Claim (duplicate protection) ---------------------------------------
  // Compare-and-set on status = "queued". Runs before any provider work.
  await claimGeneration(admin, generationId, existingMetadata);

  let metadata = existingMetadata;
  let workflowForLog: string | undefined;

  try {
    // ---- Normalize + route ------------------------------------------------
    const { request: partialRequest, inputs } = normalizeRequest({
      generation,
      project,
      model,
    });

    metadata = await setStage(admin, generationId, metadata, { stage: "routing" });

    const workflow = resolveWorkflow(model, inputs);
    workflowForLog = workflow;

    const request: NormalizedGenerationRequest = { ...partialRequest, workflow };

    // ---- Validate ---------------------------------------------------------
    validateCapabilities({
      model,
      workflow,
      prompt: request.prompt,
      inputs,
      settings: request.settings,
    });

    // ---- Submit -----------------------------------------------------------
    metadata = await setStage(admin, generationId, metadata, {
      stage: "submitting",
      provider: model.providerId,
      workflow,
      isMock: model.isMock,
    });

    const adapter = getProviderAdapter(model.providerId);
    const context = { generationId, clerkUserId, projectId: project.id };

    if (model.isMock) {
      registerMockRequest(request);
    }

    const submission = await adapter.submit(request, context);

    if (submission.status === "failed") {
      throw new OrchestrationError("PROVIDER_FAILED", {
        context: { generationId, provider: model.providerId },
      });
    }

    // This phase supports synchronous providers only. An async provider would
    // return queued/processing here and be picked up by a future queue worker.
    if (submission.status !== "completed") {
      throw new OrchestrationError("INTERNAL_ERROR", {
        context: { generationId, reason: "async_provider_not_supported_yet" },
        userMessage: "Asynchronous providers are not supported yet.",
      });
    }

    if (!adapter.getResult) {
      throw new OrchestrationError("INTERNAL_ERROR", {
        context: { providerId: model.providerId, reason: "adapter_missing_getResult" },
      });
    }

    // ---- Collect + normalize output ---------------------------------------
    metadata = await setStage(admin, generationId, metadata, { stage: "downloading" });

    const rawOutputs = await adapter.getResult(submission, context);
    const resolvedOutputs = await normalizeOutputs(rawOutputs);

    // ---- Upload -----------------------------------------------------------
    metadata = await setStage(admin, generationId, metadata, { stage: "uploading" });

    const uploaded = await uploadOutputs(admin, resolvedOutputs, {
      clerkUserId,
      projectId: project.id,
      generationId,
    });

    // ---- Finalize ---------------------------------------------------------
    metadata = await setStage(admin, generationId, metadata, { stage: "finalizing" });

    const primary = uploaded[0];
    await markCompleted(admin, generationId, metadata, {
      outputUrl: primary.storagePath,
      thumbnailUrl: primary.type === "image" ? primary.storagePath : null,
      provider: model.providerId,
      workflow,
      isMock: model.isMock,
    });

    const withSignedUrls = await attachSignedUrls(admin, uploaded);

    log({
      generationId,
      provider: model.providerId,
      modelId: model.id,
      workflow,
      stage: "completed",
      durationMs: Date.now() - startedAt,
      result: "success",
    });

    return {
      generationId,
      status: "completed",
      workflow,
      provider: model.providerId,
      modelId: model.id,
      outputs: withSignedUrls,
      isMock: model.isMock,
    };
  } catch (caught) {
    const error = toOrchestrationError(caught);

    await markFailed(admin, generationId, metadata, {
      userMessage: error.userMessage,
      errorCode: error.code,
      retryable: isRetryable(error),
    });

    log({
      generationId,
      provider: model.providerId,
      modelId: model.id,
      workflow: workflowForLog,
      stage: "failed",
      durationMs: Date.now() - startedAt,
      result: "failure",
      errorCode: error.code,
    });

    throw error;
  } finally {
    if (model.isMock) {
      releaseMockRequest(generationId);
    }
  }
}
