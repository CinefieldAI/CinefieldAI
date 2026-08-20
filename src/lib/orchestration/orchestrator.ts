import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/supabaseAdmin";
import type { Generation, Project } from "@/types/database";
import { validateCapabilities } from "./capability-validator";
import {
  OrchestrationError,
  isRetryable,
  provesNoProviderJob,
  toOrchestrationError,
} from "./errors";
import { findModel, type ModelRegistryEntry } from "./model-registry";
import { normalizeOutputs } from "./output-normalizer";
import { attachSignedUrls, type StoredOutput } from "./output-storage";
// `storeAndFinalizeAsset` is deliberately NOT imported here any more. It
// writes raw provider bytes straight to R2, which is exactly the unmarked
// canonical artifact Phase 27 forbids; the Phase 9-C pipeline stores the
// SIGNED bytes instead. A structural test fails if this import returns.
import { reserveGenerationAsset, type MediaType } from "@/lib/media/asset-service";
import { hasVerifiedOriginal, ingestMediaAsset } from "@/lib/media/ingest-gate";
import { releaseAfterModeration } from "@/lib/media/quarantine-release";
// The Phase 9-C pipeline reaches `c2pa-node`, a native module. This file is in
// the import graph of `/api/generations/[id]/execute`, so it must not import
// the implementation at all — see media-processor-seam.ts for the full reason
// and for why a dynamic import was not enough. Types only; TypeScript erases
// them, leaving no runtime edge for a bundler to follow.
import type { FinalMediaStore } from "@/lib/media/media-processing-pipeline";
import { currentMediaProcessor } from "@/lib/media/media-processor-seam";
import { putAssetObject } from "@/lib/media/r2-client";
import type { ResolvedOutput } from "./output-normalizer";
import { getProviderAdapter, isProviderRegistered } from "./provider-registry";
import type { ProviderAdapter } from "./providers/provider-adapter";
import { releaseGeminiResult } from "./providers/gemini-provider";
import { releaseFalResult } from "./providers/fal-provider";
import { registerMockRequest, releaseMockRequest } from "./providers/mock-provider";
import {
  claimFinalization,
  claimGeneration,
  markCompleted,
  markFailed,
  markProcessingAsync,
  readPersistedProviderJob,
  readSubmissionEvidence,
  recordAmbiguousSubmission,
  recordAsyncStatusCheck,
  setStage,
} from "./status-manager";
import { resolveWorkflow } from "./workflow-router";
import { createFieldLogger } from "@/lib/observability/logger";
import type {
  GenerationSettings,
  NormalizedGenerationInput,
  NormalizedGenerationRequest,
  OrchestrationResult,
  PersistedProviderJob,
  ProviderExecutionContext,
  ProviderStatusResult,
  ProviderSubmission,
  TransportSource,
  WorkflowType,
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

/**
 * Phase 13-E: delegates to the Sensitive Data Guard.
 *
 * The call sites below are unchanged — the difference is that every field
 * now passes the telemetry allow-list before it reaches console or any
 * future sink. An unknown or unsafe field is dropped, not printed.
 */
const emit = createFieldLogger("orchestration");

function log(fields: LogFields): void {
  emit(fields);
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
 *
 * For text-to-speech, `generation.prompt` IS the text to speak — read
 * verbatim from the database column with no transformation, exactly as for
 * any other workflow, so the original Unicode text is preserved byte-for-
 * byte through this step.
 */
/**
 * Reads the route the router chose, from the row's own metadata.
 *
 * Returns null for a generation created before routing existed, or one whose
 * metadata is malformed — in both cases the caller falls back to the registry.
 * The provider is additionally required to be a registered adapter: a route
 * pointing at a provider this deployment cannot run must not silently become
 * an "unknown adapter" crash deep inside submission.
 */
function readRoutingSelection(
  metadata: Record<string, unknown> | null | undefined
): { providerId: string; providerModelId: string } | null {
  const routing = metadata?.routing;
  if (!routing || typeof routing !== "object") return null;
  const record = routing as Record<string, unknown>;
  if (typeof record.providerId !== "string" || typeof record.providerModelId !== "string") {
    return null;
  }
  if (!isProviderRegistered(record.providerId)) return null;
  return { providerId: record.providerId, providerModelId: record.providerModelId };
}

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
    voice: readString(metadata, "voice"),
    language: readString(metadata, "language"),
    // Carries mock_mode through to the mock provider without leaking
    // provider-specific concepts into the typed settings surface.
    extra: metadata,
  };

  const routing = readRoutingSelection(metadata);

  return {
    request: {
      generationId: generation.id,
      clerkUserId: generation.clerk_user_id,
      projectId: project.id,
      modelId: generation.model,
      // PHASE 7-B/7-C: the ROUTER decided where this runs, at creation or at
      // failover, and that decision is durable on the row. Reading it back
      // here is what makes a failover to another provider actually change the
      // destination instead of quietly re-running the registry default.
      // Absent (a generation older than routing) falls back to the registry —
      // the exact pre-routing behaviour.
      provider: routing?.providerId ?? model.providerId,
      providerModelId: routing?.providerModelId ?? model.providerModelId,
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
  // What this execution knows about an external provider job (Phase 6E):
  //   "none"    → provably no job; a failure may be requeued per the normal
  //               retry classification.
  //   "unknown" → a submit attempt got no reliable answer; the job may
  //               already exist, so every failure is recorded non-retryable
  //               and the persisted marker blocks resetForRetry until
  //               Phase 7 reconciles with the provider.
  //   "job"     → the provider returned a job id (sync or async alike);
  //               submitting again would start a second, double-billed job,
  //               so failures are non-retryable from that moment on.
  let submissionEvidence: "none" | "unknown" | "job" = "none";
  // The submission the adapter returned, kept for the failure path so sync
  // job evidence can be persisted for Phase 7 (id/provider/state only —
  // never resume data, which is not vetted for the sync case).
  let acceptedSubmission: ProviderSubmission | null = null;

  try {
    // ---- Duplicate-job / double-billing guard (Phase 6E) -------------------
    // claimGeneration only proves the row WAS "queued"; it does not prove no
    // external provider job exists — a requeued row keeps its orchestration
    // metadata. A persisted provider job is strong evidence the job is real,
    // so this generation must never reach submit() again.
    const priorEvidence = readSubmissionEvidence(existingMetadata);

    if (priorEvidence.kind === "job") {
      // Continue the existing job instead of submitting a duplicate: re-arm
      // the waiting state and hand it back to the continuation, which
      // reconciles by status check (free) rather than by resubmission
      // (billed). This also covers a persisted state of "completed" (the
      // next check finalizes) and "failed" (the next check confirms with the
      // provider and terminally fails the row).
      submissionEvidence = "job";

      const orchestrationMeta =
        typeof existingMetadata.orchestration === "object" &&
        existingMetadata.orchestration !== null
          ? (existingMetadata.orchestration as Record<string, unknown>)
          : {};
      const persistedWorkflow =
        typeof orchestrationMeta.workflow === "string"
          ? (orchestrationMeta.workflow as WorkflowType)
          : resolveWorkflow(model, []);
      workflowForLog = persistedWorkflow;

      metadata = await markProcessingAsync(admin, generationId, metadata, {
        provider: priorEvidence.job.provider,
        workflow: persistedWorkflow,
        isMock: model.isMock,
        providerJob: priorEvidence.job,
      });

      log({
        generationId,
        provider: priorEvidence.job.provider,
        modelId: model.id,
        workflow: persistedWorkflow,
        stage: "waiting-provider",
        durationMs: Date.now() - startedAt,
        result: "resumed_existing_job",
      });

      return {
        generationId,
        status: "processing",
        workflow: persistedWorkflow,
        provider: priorEvidence.job.provider,
        modelId: model.id,
        outputs: [],
        isMock: model.isMock,
      };
    }

    if (priorEvidence.kind === "ambiguous") {
      // A previous submit attempt got no reliable answer — an external job
      // may already exist, but with no job id there is nothing to continue
      // and submitting again risks a duplicate charge. Fail closed; Phase 7
      // reconciliation must prove no job exists (and clear the marker)
      // before this generation may submit again.
      submissionEvidence = "unknown";
      throw new OrchestrationError("PROVIDER_SUBMISSION_UNKNOWN", {
        context: {
          generationId,
          provider: priorEvidence.attempt.provider,
          reason: "prior_submission_outcome_unknown",
        },
      });
    }

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

    // The adapter follows the same decision the request carries. Using
    // model.providerId here instead would submit to one provider while every
    // log, attempt row and metadata field named another.
    const adapter = getProviderAdapter(request.provider);
    const context = { generationId, clerkUserId, projectId: project.id };

    if (model.isMock) {
      registerMockRequest(request);
    }

    let submission: ProviderSubmission;
    try {
      submission = await adapter.submit(request, context);
    } catch (caught) {
      const error = toOrchestrationError(caught);

      // An adapter that captured the provider's own job id before failing
      // (fal's onEnqueue hook, Phase 6R.5) attaches it to the typed error's
      // safe context. That upgrades the outcome from "ambiguous" to precise
      // JOB evidence: the external job verifiably exists under this id, so
      // resubmission stays blocked AND reconciliation can query the provider
      // directly instead of guessing. Identifier only — never a payload.
      const capturedJobId =
        typeof error.context?.providerJobId === "string" && error.context.providerJobId.length > 0
          ? error.context.providerJobId
          : null;

      if (capturedJobId && !model.isMock) {
        submissionEvidence = "job";
        acceptedSubmission = {
          providerJobId: capturedJobId,
          provider: model.providerId,
          status: "processing",
        };
        // The outer catch persists this evidence via markFailed's
        // providerJob parameter (the same path sync-tail failures use).
        throw error;
      }

      // Fail closed: the submit window is ambiguous unless the error code
      // proves no job was created. A mock provider is exempt — it makes no
      // external calls, so no external job (and no charge) can exist no
      // matter which error its test modes raise. Without that exemption the
      // zero-cost "retryable-failure" mock mode would permanently brick the
      // row with a marker only Phase 7 could clear.
      if (!model.isMock && !provesNoProviderJob(error)) {
        // The submit window closed without a reliable answer: the provider
        // may or may not have created (and started billing) a job — Phase
        // 6E.2 case C. Record that uncertainty; even if the marker write
        // itself fails, the in-memory evidence below keeps this failure
        // non-retryable either way.
        submissionEvidence = "unknown";
        try {
          metadata = await recordAmbiguousSubmission(admin, generationId, metadata, {
            provider: model.providerId,
            attemptedAt: new Date().toISOString(),
            errorCode: error.code,
          });
        } catch {
          // Best effort — the outer catch still records retryable:false.
        }
      }

      throw error;
    }

    // The adapter answered. A returned job id means an external job now
    // exists in SOME state — from here on, no failure may requeue this row
    // into a second submit(), sync and async alike (Phase 6E).
    if (submission.providerJobId) {
      submissionEvidence = "job";
      acceptedSubmission = submission;
    }

    if (submission.status === "failed") {
      throw new OrchestrationError("PROVIDER_FAILED", {
        context: { generationId, provider: model.providerId },
      });
    }

    // ---- Async branch ------------------------------------------------------
    // The provider accepted the job and will finish it later. Persist the
    // provider-neutral job state (external job id + last observed state) into
    // the row's metadata and return control immediately: no browser request
    // stays open and no API loop polls here. A background continuation
    // (checkAsyncGeneration) picks the job up from the persisted state.
    if (submission.status !== "completed") {
      if (!submission.providerJobId) {
        // The provider ACCEPTED the job asynchronously but the adapter
        // returned no job id — the job may exist, yet it can never be
        // checked. That is an ambiguous submission, not a definitive
        // failure: record it and fail closed (Phase 6E.2).
        submissionEvidence = "unknown";
        try {
          metadata = await recordAmbiguousSubmission(admin, generationId, metadata, {
            provider: model.providerId,
            attemptedAt: new Date().toISOString(),
            errorCode: "PROVIDER_SUBMISSION_UNKNOWN",
          });
        } catch {
          // Best effort — the outer catch still records retryable:false.
        }
        throw new OrchestrationError("PROVIDER_SUBMISSION_UNKNOWN", {
          context: {
            generationId,
            provider: model.providerId,
            reason: "async_submission_missing_job_id",
          },
          userMessage: "The provider did not return a job identifier.",
        });
      }

      metadata = await markProcessingAsync(admin, generationId, metadata, {
        provider: model.providerId,
        workflow,
        isMock: model.isMock,
        providerJob: {
          id: submission.providerJobId,
          provider: submission.provider,
          state: submission.status,
          lastCheckedAt: new Date().toISOString(),
          checkCount: 0,
          resume: submission.metadata,
        },
      });

      log({
        generationId,
        provider: model.providerId,
        modelId: model.id,
        workflow,
        stage: "waiting-provider",
        durationMs: Date.now() - startedAt,
        result: "async_started",
      });

      return {
        generationId,
        status: "processing",
        workflow,
        provider: model.providerId,
        modelId: model.id,
        outputs: [],
        isMock: model.isMock,
      };
    }

    // ---- Sync branch: collect, upload, finalize ----------------------------
    const result = await collectAndFinalize({
      admin,
      adapter,
      submission,
      context,
      generationId,
      clerkUserId,
      projectId: project.id,
      model,
      workflow,
      metadata,
    });

    log({
      generationId,
      provider: model.providerId,
      modelId: model.id,
      workflow,
      stage: "completed",
      durationMs: Date.now() - startedAt,
      result: "success",
    });

    return result;
  } catch (caught) {
    const error = toOrchestrationError(caught);

    // Submission retryability, not status-check retryability: this flag is
    // what resetForRetry() reads to decide whether the row may be requeued
    // for a NEW submit(). Once there is ANY evidence an external job may
    // exist — a returned job id ("job") or an unanswered submit attempt
    // ("unknown") — that answer is no, even for otherwise-transient error
    // codes. resetForRetry independently re-proves this from the persisted
    // evidence itself.
    //
    // For a SYNC submission that failed later in the chain (download,
    // normalize, upload), the job evidence exists only in memory — persist
    // its id/provider/state with the failure so Phase 7 can see the job
    // before ever considering another provider. Async paths already have
    // richer persisted job state, which must not be overwritten.
    const syncEvidenceJob =
      submissionEvidence === "job" &&
      acceptedSubmission !== null &&
      readPersistedProviderJob(metadata) === null
        ? {
            id: acceptedSubmission.providerJobId,
            provider: acceptedSubmission.provider,
            state: acceptedSubmission.status,
            lastCheckedAt: new Date().toISOString(),
            checkCount: 0,
          }
        : undefined;

    await markFailed(admin, generationId, metadata, {
      userMessage: error.userMessage,
      errorCode: error.code,
      retryable: submissionEvidence === "none" ? isRetryable(error) : false,
      providerJob: syncEvidenceJob,
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
    // Release any in-memory handoff state held between submit() and
    // getResult(), including on the failure path.
    if (model.isMock) {
      releaseMockRequest(generationId);
    }
    if (model.providerId === "fal") {
      releaseFalResult(generationId);
    }
    if (model.providerId === "gemini") {
      releaseGeminiResult(generationId);
    }
  }
}

/**
 * The Phase 9-C pipeline's storage seam, bound to Phase 9's real R2 owner.
 *
 * A thin adapter, deliberately: the pipeline must not import an S3 client,
 * and `putAssetObject` must stay the single place this application writes a
 * media object. Its own OrchestrationError is caught and flattened into the
 * seam's bounded result so the pipeline keeps returning outcomes rather than
 * throwing through two layers.
 */
const canonicalMediaStore: FinalMediaStore = {
  async put(params) {
    try {
      await putAssetObject({
        objectKey: params.objectKey,
        bytes: params.bytes,
        declaredContentType: params.contentType,
      });
      return { ok: true };
    } catch {
      return { ok: false, reasonCode: "asset_storage_failed" };
    }
  },
};

/**
 * Persists the canonical output into R2 and records it (Phase 9-A/9-B/9-C).
 *
 * ---------------------------------------------------------------------------
 * EVERY CANONICAL OUTPUT IS C2PA-MARKED. THERE IS NO UNMARKED PATH.
 * ---------------------------------------------------------------------------
 * Phase 27 requires the roadmap's "Üretilen HER görsel/video/ses çıktısına …
 * iz gömmek" — a mark embedded in EVERY generated output, not a sample. That
 * is enforced structurally here: this function performs exactly one R2 write,
 * and the bytes it writes are the SIGNED bytes returned by the Phase 9-C
 * pipeline. `storeAndFinalizeAsset` is deliberately NOT called — the raw
 * provider bytes are never stored at all, so there is no unmarked artifact in
 * existence for anything downstream to serve.
 *
 * Order (roadmap Phase 27, "Nasıl yapılacak" step 1):
 *   reserve            a key and a pending row
 *   ingest gate        Phase 9-B sandbox on the RAW bytes — hostile input is
 *                      rejected BEFORE FFmpeg ever sees it
 *   transform          Phase 9-C fixed profile
 *   C2PA embed         official ContentAuth library
 *   official verify    manifest read back as valid, or this throws
 *   store              ONE write, of the signed bytes, to the reserved key
 *   provenance         media_provenance row, marking_state EMBEDDED_C2PA
 *
 * ---------------------------------------------------------------------------
 * FAIL CLOSED IN PRODUCTION
 * ---------------------------------------------------------------------------
 * A missing signer, a failed embed, a failed official verification, or a
 * format that cannot be marked all THROW here, so `markCompleted` is
 * unreachable — the same structural guarantee the ingest gate already had,
 * extended to provenance. A generation never completes as a normal success
 * carrying media that could not be marked. `MEDIA_PROVENANCE_FAILED` is
 * classified non-retryable: retrying an unconfigured signer or an unmarkable
 * format produces the identical failure and would only burn attempts.
 */
async function persistCanonicalOriginal(
  admin: SupabaseClient,
  params: {
    generationId: string;
    clerkUserId: string;
    projectId: string;
    mediaType: MediaType;
    output: ResolvedOutput;
    /** Which output of this generation this is. Its durable identity. */
    outputIndex: number;
  }
): Promise<{ assetId: string; objectKey: string; signedBytes: Uint8Array; signedMime: string }> {
  const reserved = await reserveGenerationAsset(admin, {
    generationId: params.generationId,
    clerkUserId: params.clerkUserId,
    projectId: params.projectId,
    mediaType: params.mediaType,
    fileExtension: params.output.fileExtension,
    declaredContentType: params.output.mimeType,
    outputIndex: params.outputIndex,
  });

  // ---- Phase 9-B ingest gate, on the RAW provider bytes -------------------
  // Runs BEFORE any transform, so hostile input is refused before it reaches
  // FFmpeg, and BEFORE completion, so nothing serves media nobody has read.
  // The inspection happens in a disposable child process — see
  // media-inspector.ts for what that does and does not contain.
  const ingest = await ingestMediaAsset(admin, {
    assetId: reserved.assetId,
    ownerId: params.clerkUserId,
    bytes: params.output.bytes,
    declaredContentType: params.output.mimeType,
    // PHASE 28: the gate evaluates safety inside this call and needs the
    // output's own identity to attribute the decision, plus its metadata,
    // which is where an adapter puts a provider-native safety flag.
    safetyContext: {
      generationId: params.generationId,
      outputIndex: params.outputIndex,
      outputMetadata: params.output.metadata,
    },
  });

  if (ingest.status !== "verified") {
    // The provider may have succeeded perfectly. This is a MEDIA SAFETY
    // failure, deliberately not reported as a provider failure — conflating
    // them would send a healthy provider to the circuit breaker and tell an
    // operator to investigate the wrong system.
    throw new OrchestrationError("MEDIA_INGEST_REJECTED", {
      context: {
        operation: "ingest_gate",
        generationId: params.generationId,
        outputIndex: params.outputIndex,
        outcome: ingest.status,
        reason: ingest.reason,
      },
    });
  }

  // ---- Phase 9-C: transform → C2PA embed → official verify → ONE store ----
  // The runtime that can run FFmpeg and load c2pa-node installs this; a
  // Next.js route never does. Absent, the generation is refused rather than
  // completed with unmarked media.
  const processMedia = currentMediaProcessor();
  if (!processMedia) {
    throw new OrchestrationError("MEDIA_PROVENANCE_FAILED", {
      context: {
        operation: "c2pa_provenance",
        generationId: params.generationId,
        outputIndex: params.outputIndex,
        outcome: "PROCESSOR_NOT_INSTALLED",
        reason: "media_processor_not_installed",
      },
    });
  }

  const processed = await processMedia(admin, {
    sourceAssetId: reserved.assetId,
    bytes: params.output.bytes,
    verifiedMime: ingest.verifiedMime,
    // Cinefield output is wholly model-generated. The IPTC term is the
    // machine-readable half of AI Act Article 50(2).
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    store: canonicalMediaStore,
    // PHASE 28 → PHASE 27, through the seam Phase 27 already built for it.
    // The safety gate above classified these bytes; if it named a real-person
    // or deepfake risk, Article 50(4)'s visible-label flag travels with the
    // provenance record. Otherwise it stays NOT_ASSESSED — never
    // NONE_REQUIRED, which no classifier here is entitled to conclude.
    disclosureRequirement: ingest.disclosureRequirement,
    now: new Date(),
    // The reserved row IS the canonical asset — the signed bytes finalise it.
    target: { kind: "in_place" },
  });

  if (processed.outcome !== "COMPLETED") {
    throw new OrchestrationError("MEDIA_PROVENANCE_FAILED", {
      context: {
        operation: "c2pa_provenance",
        generationId: params.generationId,
        outputIndex: params.outputIndex,
        outcome: processed.outcome,
        reason:
          "reasonCode" in processed
            ? processed.reasonCode
            : "validationCodes" in processed
              ? processed.validationCodes.join(",").slice(0, 120)
              : processed.outcome,
      },
    });
  }

  // ---- PHASE 28: release ONLY what a classifier actually cleared ---------
  //
  // Runs here, after the pipeline, because release requires `status =
  // 'finalized'` and the asset only becomes finalized when the signed bytes
  // are stored. Attempting it at ingest time would always be refused.
  //
  // This is the missing half of the Phase 9 lifecycle. Before Phase 28 nothing
  // could produce `moderation_status = 'passed'`, so nothing could ever leave
  // quarantine and every generation completed with no deliverable output.
  //
  // FAIL-CLOSED BY OMISSION, NOT BY BRANCHING. When the gate did not clear the
  // asset this simply does not call release, and the asset stays quarantined —
  // there is no code path here that sets a status. And the SQL refuses
  // independently: `release_media_after_moderation` re-reads the row and
  // returns `moderation_not_passed` regardless of what this function believes.
  //
  // A failed release does NOT fail the generation. The output exists, is
  // C2PA-signed, and is quarantined; that is a safety outcome, not an error.
  // Throwing would also take the SAFE siblings of a multi-output batch down
  // with it, which is exactly the per-output independence Phase 28 requires.
  if (ingest.safetyCleared) {
    await releaseAfterModeration(admin, { assetId: reserved.assetId });
  }

  return {
    assetId: processed.derivedAssetId,
    objectKey: reserved.objectKey,
    // Handed back so the delivery lane serves the EXACT canonical bytes.
    signedBytes: processed.finalBytes,
    signedMime: processed.finalMime,
  };
}

/**
 * The shared tail of every successful generation, sync or async:
 * getResult → normalize → private Storage upload → completed row → signed
 * URLs in memory. Sync submissions arrive here directly from
 * executeGeneration; async ones arrive via checkAsyncGeneration once their
 * provider reports completed. Identical storage/output semantics either way.
 */
async function collectAndFinalize(params: {
  admin: SupabaseClient;
  adapter: ProviderAdapter;
  submission: ProviderSubmission;
  context: ProviderExecutionContext;
  generationId: string;
  clerkUserId: string;
  projectId: string;
  model: ModelRegistryEntry;
  workflow: WorkflowType;
  metadata: Record<string, unknown>;
}): Promise<OrchestrationResult> {
  const {
    admin,
    adapter,
    submission,
    context,
    generationId,
    clerkUserId,
    projectId,
    model,
    workflow,
  } = params;
  let metadata = params.metadata;

  if (!adapter.getResult) {
    throw new OrchestrationError("INTERNAL_ERROR", {
      context: { providerId: model.providerId, reason: "adapter_missing_getResult" },
    });
  }

  // ---- Collect + normalize output -----------------------------------------
  metadata = await setStage(admin, generationId, metadata, { stage: "downloading" });

  const rawOutputs = await adapter.getResult(submission, context);
  // The context exists only so an SSRF refusal is attributable (Phase 12-C).
  // Ids, never the URL.
  const resolvedOutputs = await normalizeOutputs(rawOutputs, {
    context: { generationId, clerkUserId },
  });

  // ---- Upload ---------------------------------------------------------------
  metadata = await setStage(admin, generationId, metadata, { stage: "uploading" });

  // ---- R2 canonical original + asset record (Phase 9-A/9-B/9-C) ----------
  //
  // THE COMPLETION BOUNDARY (M2). Provider success is not completion. Bytes
  // must reach hot storage and be recorded before this generation may be
  // called finished — the roadmap red note is explicit that COMPLETED
  // requires "output güvenli ingest + canonical asset persisted".
  //
  // Every failure below throws, so `markCompleted` is simply never reached.
  // That is the whole mechanism: there is no flag to get wrong, only an
  // ordering that cannot be skipped.
  //
  // PHASE 27: this now runs BEFORE the delivery upload, because the delivery
  // lane must serve the SIGNED bytes this produces. Uploading first would
  // hand the user the raw provider artifact — marked archival copy, unmarked
  // download — which is exactly the divergence Article 50(2) forbids.
  // EVERY output, each its own canonical asset. A generation may legitimately
  // resolve to several outputs — /generate batches 3 by default and the fal
  // image models declare maxOutputCount: 4 — and Article 50(2) applies to
  // every artifact a user receives, not just the first. So each output is
  // reserved, gated, transformed, C2PA-signed, officially verified and stored
  // as its own asset with its own provenance row.
  //
  // Sequential, not concurrent, and deliberately: each iteration runs FFmpeg
  // and a native signing pass, and a 4-image batch fanned out in parallel
  // would multiply peak memory and CPU on the worker for no ordering benefit.
  //
  // FAIL CLOSED FOR THE WHOLE BATCH. Any output that cannot be marked throws,
  // so `markCompleted` is unreachable and the user never receives a partially
  // marked set. Assets already written stay `quarantined` (the ingest gate's
  // default, never released here), so nothing orphaned becomes deliverable —
  // `isGenerationAssetDeliverable` requires EVERY output to have cleared, and
  // a failed batch has at least one that has not.
  const assets: { assetId: string; objectKey: string; signedBytes: Uint8Array; signedMime: string }[] = [];
  for (const [outputIndex, resolved] of resolvedOutputs.entries()) {
    const asset = await persistCanonicalOriginal(admin, {
      generationId,
      clerkUserId,
      projectId,
      mediaType: resolved.type === "image" ? "image" : resolved.type === "audio" ? "audio" : "video",
      output: resolved,
      outputIndex,
    });
    assets.push(asset);
  }

  // ---- The delivered outputs ARE the canonical assets ----------------------
  //
  // There is no second upload. The C2PA-signed objects `persistCanonicalOriginal`
  // wrote to R2 are the only artifacts; delivery mints presigned URLs against
  // them (attachSignedUrls -> Phase 9's createPresignedDownload). Writing a
  // second copy anywhere would reintroduce the two-storage-truths problem
  // Phase 27 exists to remove — and, before the signing fix, that second copy
  // was the unmarked one users actually downloaded.
  const uploaded: StoredOutput[] = assets.map((asset, index) => ({
    // The R2 object key — the durable delivery identity. Never a signed URL.
    storagePath: asset.objectKey,
    mimeType: asset.signedMime,
    type: resolvedOutputs[index].type,
    signedUrl: null,
  }));

  const primary = uploaded[0];

  // ---- Finalize -------------------------------------------------------------
  metadata = await setStage(admin, generationId, metadata, { stage: "finalizing" });

  // Re-read rather than trusting the value just returned: the gate is a
  // question asked of the database, so it cannot drift from what is stored.
  // Phase 9-B widened this: finalized is no longer sufficient, because a
  // finalized asset is only one whose bytes reached R2. Completion now also
  // requires that the ingest gate read those bytes and allow them.
  if (!(await hasVerifiedOriginal(admin, generationId))) {
    throw new OrchestrationError("ASSET_RECORD_FAILED", {
      context: { operation: "completion_gate", generationId },
    });
  }

  await markCompleted(admin, generationId, metadata, {
    outputUrl: primary.storagePath,
    thumbnailUrl: primary.type === "image" ? primary.storagePath : null,
    provider: model.providerId,
    workflow,
    isMock: model.isMock,
  });

  // Phase 9-E: the delivery gate runs inside attachSignedUrls. A completed
  // generation whose asset is still quarantined returns outputs with NO
  // signed URL — completion and deliverability are different facts.
  const withSignedUrls = await attachSignedUrls(admin, uploaded, { generationId });

  return {
    generationId,
    status: "completed",
    workflow,
    provider: model.providerId,
    modelId: model.id,
    outputs: withSignedUrls,
    isMock: model.isMock,
  };
}

/**
 * One status check of an async generation — THE transport-neutral
 * continuation entry point. A polling scheduler (Phase 6G) calls it between
 * controlled waits; a future webhook route or WebSocket listener calls the
 * same function when its provider signals. Nothing here knows or cares which
 * transport triggered the check, and nothing here loops or resubmits.
 *
 * Contract:
 *   RETURNS an OrchestrationResult only when the job's state is definitively
 *   known — completed (finalized through the shared tail), still
 *   processing/queued (observation recorded), or terminally failed (only
 *   when the PROVIDER ITSELF reported the job failed, or the row already
 *   reached a terminal state).
 *
 *   THROWS when the check could not be completed — transport errors,
 *   provider 429/5xx/timeouts, auth/config problems, or a finalization step
 *   that failed after the provider said completed. The row then deliberately
 *   REMAINS "processing": the provider job is (as far as anyone knows) still
 *   valid, so the correct reaction to a thrown error is to check again
 *   later, never to fail the generation and never, ever to submit() again.
 *   Because finalization failures also follow this rule, a crashed
 *   download/upload simply re-runs on the next check.
 *
 * `expected` lets a transport assert what it believes it is delivering —
 * e.g. a webhook carrying a provider name and job id — and is verified
 * against the persisted state BEFORE any provider call. `source` is recorded
 * with the observation for audit; the behavior is identical for all three.
 */
export async function checkAsyncGeneration(params: {
  generationId: string;
  clerkUserId: string;
  source?: TransportSource;
  expected?: { provider?: string; providerJobId?: string };
}): Promise<OrchestrationResult> {
  const { generationId, clerkUserId, expected } = params;
  const source: TransportSource = params.source ?? "poll";
  const startedAt = Date.now();

  if (!isSupabaseAdminConfigured()) {
    throw new OrchestrationError("PROVIDER_NOT_CONFIGURED", {
      context: { reason: "supabase_admin_not_configured" },
      userMessage: "The server is not fully configured.",
    });
  }

  const admin: SupabaseClient = getSupabaseAdminClient();

  // ---- Load + ownership (same contract as executeGeneration) ---------------
  const { data: generationRow, error: generationError } = await admin
    .from("generations")
    .select("*")
    .eq("id", generationId)
    .maybeSingle();

  if (generationError || !generationRow) {
    throw new OrchestrationError("GENERATION_NOT_FOUND", { context: { generationId } });
  }

  const generation = generationRow as Generation;
  if (generation.clerk_user_id !== clerkUserId) {
    throw new OrchestrationError("FORBIDDEN", { context: { generationId } });
  }

  const model = findModel(generation.model);
  if (!model) {
    throw new OrchestrationError("UNKNOWN_MODEL", {
      context: { generationId, modelId: generation.model },
    });
  }

  const metadataRecord = (generation.metadata ?? {}) as Record<string, unknown>;
  const orchestrationMeta =
    typeof metadataRecord.orchestration === "object" && metadataRecord.orchestration !== null
      ? (metadataRecord.orchestration as Record<string, unknown>)
      : {};
  const persistedWorkflow =
    typeof orchestrationMeta.workflow === "string"
      ? (orchestrationMeta.workflow as WorkflowType)
      : resolveWorkflow(model, []);

  const baseResult = {
    generationId,
    workflow: persistedWorkflow,
    provider: model.providerId,
    modelId: model.id,
    outputs: [] as OrchestrationResult["outputs"],
    isMock: model.isMock,
  };

  // Terminal rows are reported idempotently — a late webhook or a second
  // checker after completion/cancellation/failure is a no-op, never a write.
  if (generation.status === "completed") {
    return { ...baseResult, status: "completed" };
  }
  if (generation.status === "failed" || generation.status === "cancelled") {
    return { ...baseResult, status: "failed" };
  }

  if (generation.status !== "processing") {
    // "queued": nothing has been submitted to a provider yet.
    throw new OrchestrationError("INVALID_INPUT", {
      context: { generationId, reason: "generation_not_waiting_on_provider" },
      userMessage: "This generation is not waiting on a provider job.",
    });
  }

  const job = readPersistedProviderJob(metadataRecord);
  if (!job) {
    throw new OrchestrationError("INVALID_INPUT", {
      context: { generationId, reason: "no_persisted_provider_job" },
      userMessage: "This generation has no provider job to check.",
    });
  }

  // Transport assertion: a webhook/WS event names the job it is reporting;
  // if that does not match the persisted job, the event belongs to something
  // else and touching provider or row state on its behalf would be wrong.
  if (
    (expected?.provider !== undefined && expected.provider !== job.provider) ||
    (expected?.providerJobId !== undefined && expected.providerJobId !== job.id)
  ) {
    throw new OrchestrationError("INVALID_INPUT", {
      context: { generationId, reason: "provider_job_mismatch" },
      userMessage: "The reported provider job does not match this generation.",
    });
  }

  // The provider that actually started the job — not necessarily the one the
  // registry would pick today — answers for it. This is the same correlation
  // (generation + provider + external job id) Phase 7 will use to ask "did
  // this provider already start work?" before attempting another provider.
  const adapter = getProviderAdapter(job.provider);
  if (!adapter.getStatus) {
    throw new OrchestrationError("INTERNAL_ERROR", {
      context: { providerId: job.provider, reason: "adapter_missing_getStatus" },
    });
  }

  const submission: ProviderSubmission = {
    providerJobId: job.id,
    provider: job.provider,
    status: job.state,
    metadata: job.resume,
  };
  const context: ProviderExecutionContext = {
    generationId,
    clerkUserId,
    projectId: generation.project_id,
  };

  let metadata = metadataRecord;

  // ---- Ask the provider ----------------------------------------------------
  // A failure HERE is a status-check failure, not a job failure: the provider
  // job is still presumed live. Record the failed attempt (best effort, error
  // code only) and rethrow; the row stays "processing" and the transport
  // checks again later. markFailed is deliberately absent from this path.
  let statusResult: ProviderStatusResult;
  try {
    statusResult = await adapter.getStatus(submission, context);
  } catch (caught) {
    const error = toOrchestrationError(caught);
    await recordCheckFailure(admin, generationId, metadata, job, source, error.code);

    log({
      generationId,
      provider: job.provider,
      modelId: model.id,
      workflow: persistedWorkflow,
      stage: "waiting-provider",
      durationMs: Date.now() - startedAt,
      result: "check_failed",
      errorCode: error.code,
    });

    throw error;
  }

  const observedJob: PersistedProviderJob = {
    ...job,
    state: statusResult.status,
    lastCheckedAt: new Date().toISOString(),
    checkCount: job.checkCount + 1,
    lastCheckSource: source,
    // A successful observation clears any earlier check-failure code.
    lastCheckError: undefined,
  };

  // ---- Still running -------------------------------------------------------
  if (statusResult.status === "queued" || statusResult.status === "processing") {
    try {
      metadata = await recordAsyncStatusCheck(admin, generationId, metadata, observedJob);
    } catch (caught) {
      return await resolveTerminalRace(admin, generationId, baseResult, caught);
    }

    log({
      generationId,
      provider: job.provider,
      modelId: model.id,
      workflow: persistedWorkflow,
      stage: "waiting-provider",
      durationMs: Date.now() - startedAt,
      result: "async_pending",
    });

    return { ...baseResult, status: "processing" };
  }

  // ---- Provider reported the job failed ------------------------------------
  // The single case in which a status check terminally fails the row. It is
  // recorded with retryable:false — that flag means SUBMISSION retryability,
  // and resetForRetry() reading false is exactly what guarantees no second
  // submit() ever starts a duplicate provider job. Phase 7's failover will
  // make its own decision from the persisted generation+provider+job id.
  if (statusResult.status === "failed") {
    const failure = new OrchestrationError("PROVIDER_FAILED", {
      context: { generationId, provider: job.provider, reason: "provider_reported_failed" },
    });

    try {
      metadata = await recordAsyncStatusCheck(admin, generationId, metadata, observedJob);
    } catch (caught) {
      return await resolveTerminalRace(admin, generationId, baseResult, caught);
    }

    await markFailed(admin, generationId, metadata, {
      userMessage: failure.userMessage,
      errorCode: failure.code,
      retryable: false,
    });

    log({
      generationId,
      provider: job.provider,
      modelId: model.id,
      workflow: persistedWorkflow,
      stage: "failed",
      durationMs: Date.now() - startedAt,
      result: "failure",
      errorCode: failure.code,
    });

    return { ...baseResult, status: "failed" };
  }

  // ---- Provider says completed: same tail as the sync path -----------------
  // Tracks whether THIS check holds the single-flight finalization lease, so
  // the failure path below releases only a lease it actually owns — never a
  // concurrent finalizer's.
  let holdsFinalizeLease = false;

  try {
    metadata = await recordAsyncStatusCheck(admin, generationId, metadata, observedJob);

    // Single-flight (Phase 6F.4): exactly one completion observation may run
    // the download → upload → complete tail. Losing this claim is not an
    // error — either another checker is finalizing right now (report the row
    // as still processing; a later check will see the terminal state) or the
    // row already went terminal (report that state idempotently).
    try {
      metadata = await claimFinalization(admin, generationId, metadata);
      holdsFinalizeLease = true;
    } catch (claimCaught) {
      const claimError = toOrchestrationError(claimCaught);
      if (claimError.code !== "DUPLICATE_EXECUTION") throw claimError;

      const { data } = await admin
        .from("generations")
        .select("status")
        .eq("id", generationId)
        .maybeSingle();
      const rowStatus = (data as { status?: string } | null)?.status;
      if (rowStatus === "completed") {
        return { ...baseResult, status: "completed" };
      }
      if (rowStatus === "failed" || rowStatus === "cancelled") {
        return { ...baseResult, status: "failed" };
      }

      log({
        generationId,
        provider: job.provider,
        modelId: model.id,
        workflow: persistedWorkflow,
        stage: "waiting-provider",
        durationMs: Date.now() - startedAt,
        result: "finalize_in_progress",
      });

      return { ...baseResult, status: "processing" };
    }

    const result = await collectAndFinalize({
      admin,
      adapter,
      submission,
      context,
      generationId,
      clerkUserId,
      projectId: generation.project_id,
      model,
      workflow: persistedWorkflow,
      metadata,
    });

    log({
      generationId,
      provider: job.provider,
      modelId: model.id,
      workflow: persistedWorkflow,
      stage: "completed",
      durationMs: Date.now() - startedAt,
      result: "success",
    });

    return result;
  } catch (caught) {
    const error = toOrchestrationError(caught);

    if (error.code === "DUPLICATE_EXECUTION") {
      // Lost a race to a concurrent completion/cancellation — report the
      // row's terminal state instead of failing the transport.
      return await resolveTerminalRace(admin, generationId, baseResult, caught);
    }

    // Finalization failed AFTER the provider completed the job — a
    // Cinefield-side problem (download, normalize, upload, DB). The provider
    // result still exists under the same job id, so the row stays
    // "processing" and the next check simply re-runs this idempotent tail.
    // Failing the row here would discard a finished, possibly-paid job. The
    // finalization lease this check took is released in the same write so
    // the next checker may claim the tail again (Phase 6F.5) — retrying
    // finalization only, never resubmitting.
    await recordCheckFailure(admin, generationId, metadata, observedJob, source, error.code, {
      releaseFinalizeClaim: holdsFinalizeLease,
    });

    log({
      generationId,
      provider: job.provider,
      modelId: model.id,
      workflow: persistedWorkflow,
      stage: "waiting-provider",
      durationMs: Date.now() - startedAt,
      result: "finalize_failed",
      errorCode: error.code,
    });

    throw error;
  }
}

/**
 * Best-effort record of a failed status check: bumps checkCount, stamps the
 * transport source and the orchestration error CODE (never a message or
 * payload). Swallows its own failures — the original error is what matters.
 *
 * `releaseFinalizeClaim` is passed only by a caller that HOLDS the
 * finalization lease and is abandoning the attempt, so the next checker can
 * claim the tail again without waiting out the lease window.
 */
async function recordCheckFailure(
  admin: SupabaseClient,
  generationId: string,
  metadata: Record<string, unknown>,
  job: PersistedProviderJob,
  source: TransportSource,
  errorCode: string,
  options?: { releaseFinalizeClaim?: boolean }
): Promise<void> {
  try {
    await recordAsyncStatusCheck(
      admin,
      generationId,
      metadata,
      {
        ...job,
        lastCheckedAt: new Date().toISOString(),
        checkCount: job.checkCount + 1,
        lastCheckSource: source,
        lastCheckError: errorCode,
      },
      options?.releaseFinalizeClaim ? { releaseFinalizeClaim: true } : undefined
    );
  } catch {
    // Best effort only.
  }
}

/**
 * Resolves a DUPLICATE_EXECUTION raised because this check lost a race: the
 * row left "processing", or a concurrent worker's finalization lease made
 * this check's metadata write lose its compare-and-set. Re-reads the row and
 * reports its state idempotently. Anything else is rethrown untouched.
 */
async function resolveTerminalRace(
  admin: SupabaseClient,
  generationId: string,
  baseResult: Omit<OrchestrationResult, "status">,
  caught: unknown
): Promise<OrchestrationResult> {
  const error = toOrchestrationError(caught);
  if (error.code !== "DUPLICATE_EXECUTION") {
    throw error;
  }

  const { data } = await admin
    .from("generations")
    .select("status")
    .eq("id", generationId)
    .maybeSingle();

  const status = (data as { status?: string } | null)?.status;
  if (status === "completed") {
    return { ...baseResult, status: "completed" };
  }
  if (status === "failed" || status === "cancelled") {
    return { ...baseResult, status: "failed" };
  }
  if (status === "processing") {
    // Still processing and our write lost: another worker owns this job
    // right now (it holds the finalization lease). That is not an error —
    // the job is progressing under someone else, so report it as such and
    // let the next check observe the outcome. Deliberately no write here:
    // the whole point is not to touch state another worker owns.
    return { ...baseResult, status: "processing" };
  }

  throw error;
}
