/**
 * Cinefield orchestration — provider-neutral type contracts.
 *
 * These types are the shared vocabulary between the model registry, the
 * workflow router, the capability validator, provider adapters, and the
 * orchestrator. They deliberately contain no provider-specific shapes so
 * that adding a real provider later requires no changes here.
 */

/** Matches the existing public.generations.generation_type CHECK constraint. */
export type GenerationType = "image" | "video" | "audio";

/**
 * The concrete transformation a request performs.
 *
 * Audio currently supports only "text-to-speech". Future audio workflows
 * (text-to-music, speech-to-speech, audio enhancement) are deliberately not
 * declared yet — adding one is a single union entry here plus a
 * workflow-router.ts branch and a model-registry.ts entry, the same pattern
 * every existing workflow already follows.
 */
export type WorkflowType =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "image-to-video"
  | "video-to-video"
  | "audio-to-video"
  | "text-to-speech"
  | "image-upscale"
  | "video-upscale"
  | "background-remove"
  | "lip-sync";

/**
 * Fine-grained progress within a single orchestration run. This is richer
 * than the database's status column and is persisted only inside the
 * generations.metadata JSON — the schema is not changed.
 */
export type OrchestrationStage =
  | "validating"
  | "routing"
  | "submitting"
  | "processing"
  | "waiting-provider"
  | "downloading"
  | "uploading"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled";

/** How an input file participates in the request. */
export type InputRole = "source" | "reference" | "start-frame" | "end-frame" | "mask" | "audio";

/** A single input file, already stored in the private generation-inputs bucket. */
export interface NormalizedGenerationInput {
  storagePath: string;
  mimeType: string;
  originalFileName: string;
  sizeBytes: number;
  role: InputRole;
  metadata?: Record<string, unknown>;
}

/** Provider-neutral generation settings sourced from the UI. */
export interface GenerationSettings {
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  outputCount?: number;
  thinking?: string;
  seed?: number;
  /** Voice identifier for text-to-speech (and future speech-to-speech). */
  voice?: string;
  /** BCP-47-ish language hint (e.g. "en", "de", "tr") for audio workflows. */
  language?: string;
  extra?: Record<string, unknown>;
}

/** The fully-resolved request handed to a provider adapter. */
export interface NormalizedGenerationRequest {
  generationId: string;
  clerkUserId: string;
  projectId: string;
  modelId: string;
  provider: string;
  providerModelId: string;
  generationType: GenerationType;
  workflow: WorkflowType;
  prompt: string;
  negativePrompt?: string;
  inputs: NormalizedGenerationInput[];
  settings: GenerationSettings;
}

/** Lifecycle of a job as reported by a provider. */
export type ProviderJobStatus = "queued" | "processing" | "completed" | "failed";

/**
 * How a status update reached Cinefield. The continuation core treats all
 * three identically — this exists only so persisted check metadata can say
 * where an observation came from. Provider-specific transport names never
 * appear here.
 */
export type TransportSource = "poll" | "webhook" | "websocket";

/** What an adapter returns from submit(). */
export interface ProviderSubmission {
  providerJobId: string;
  provider: string;
  status: ProviderJobStatus;
  /**
   * Adapter-owned extras. For an async submission (status queued/processing)
   * this is persisted verbatim as the job's resume data and handed back to
   * getStatus()/getResult() later — so it must contain ONLY safe, replayable
   * values (e.g. which endpoint variant was used). Never secrets, auth
   * headers, signed or temporary URLs, or raw provider payloads.
   */
  metadata?: Record<string, unknown>;
}

/** What an adapter returns from getStatus(). */
export interface ProviderStatusResult {
  status: ProviderJobStatus;
  progress?: number;
  metadata?: Record<string, unknown>;
}

/**
 * The async job state persisted in generations.metadata under
 * `orchestration.providerJob` while a long-running provider works.
 *
 * Provider-neutral on purpose: `id` is whatever the external provider calls
 * its own job — Runway's task id, xAI's request id, Runware's taskUUID,
 * Google's operation name — but the generic core only ever sees this one
 * field. Whatever safe extras an adapter needs to check its own job later
 * (never secrets, signed URLs, or raw provider payloads) travel in `resume`,
 * which the core stores and returns verbatim without reading into it.
 *
 * Any transport can continue from this state — REST polling, a webhook
 * handler, or a WebSocket listener all end at the same continuation entry
 * point (`checkAsyncGeneration`) with nothing here assuming which one runs.
 */
export interface PersistedProviderJob {
  /** External provider's own job/task identifier. */
  id: string;
  provider: string;
  /** Last normalized provider state observed for the job. */
  state: ProviderJobStatus;
  /** ISO timestamp of the submit or the most recent status check. */
  lastCheckedAt: string;
  /** How many status checks have run so far (0 right after submit). */
  checkCount: number;
  /** Which transport delivered the most recent observation. */
  lastCheckSource?: TransportSource;
  /**
   * Orchestration error CODE of the most recent failed status check (never a
   * message or payload). Present only while the last check failed; a
   * successful observation clears it.
   */
  lastCheckError?: string;
  /** Adapter-owned safe resume data, persisted verbatim. */
  resume?: Record<string, unknown>;
}

/**
 * Persisted marker for an AMBIGUOUS submission: Cinefield sent (or may have
 * sent) a submit request to a provider but never received a reliable answer,
 * so it is unknown whether an external job — and its charge — exists.
 *
 * Stored in generations.metadata under `orchestration.ambiguousSubmission`.
 * While present, the generation is not eligible for automatic resubmission:
 * Phase 7 reconciliation must first prove with the provider that no job was
 * created (and clear this marker) before any new submit may run. Carries
 * codes and timestamps only — never request payloads, responses, headers,
 * temporary URLs, or credentials.
 */
export interface PersistedAmbiguousSubmission {
  provider: string;
  /** ISO timestamp of the submit attempt whose outcome is unknown. */
  attemptedAt: string;
  /** Orchestration error CODE that made the outcome unknown. */
  errorCode: string;
}

/**
 * Why a continuation controller stopped polling an async job that had not
 * reached a terminal state.
 *
 *   "poll-ceiling"      → Cinefield's own check-count or wall-clock limit was
 *                         reached (see async-polling-policy.ts).
 *   "check-failures"    → too many consecutive status checks failed.
 *   "operational-error" → checking cannot succeed as configured (e.g. the
 *                         provider adapter is not configured or its
 *                         credentials are rejected).
 *
 * None of these say anything about the provider job itself, which is why the
 * generation stays "processing" with its providerJob intact: the job may well
 * still be running and may still have been billed. Stopping is a statement
 * about Cinefield's polling effort, not about the job's outcome.
 */
export type ContinuationHaltReason = "poll-ceiling" | "check-failures" | "operational-error";

/**
 * Persisted record that automatic continuation stopped, stored under
 * `orchestration.continuation`. Codes and counters only — never provider
 * messages, payloads, URLs, or credentials. Phase 7 reconciliation reads this
 * to find generations whose provider job needs a human or a reconciler.
 */
export interface PersistedContinuationHalt {
  reason: ContinuationHaltReason;
  haltedAt: string;
  /** Provider-job check count observed when polling stopped. */
  checkCount: number;
  /** Orchestration error CODE of the last failed check, when there was one. */
  lastErrorCode?: string;
}

/**
 * Everything Cinefield knows about whether an external provider job exists
 * for a generation — the three-way distinction duplicate/double-billing
 * protection is built on:
 *
 *   "none"      → provably never submitted, or the provider definitively
 *                 rejected the request before creating a job; initial
 *                 submission is allowed.
 *   "ambiguous" → a submit attempt ran but its outcome is unknown; nothing
 *                 may resubmit until reconciliation proves no job exists.
 *   "job"       → a provider accepted a job (external id known); the
 *                 continuation owns it and submit() must never run again.
 *
 * Phase 7 failover will ask exactly this question — "did provider A already
 * start this job?" — before it may ever try provider B.
 */
export type SubmissionEvidence =
  | { kind: "none" }
  | { kind: "ambiguous"; attempt: PersistedAmbiguousSubmission }
  | { kind: "job"; job: PersistedProviderJob };

/** A single produced artifact, normalized away from provider specifics. */
export interface NormalizedOutput {
  type: GenerationType;
  mimeType: string;
  fileExtension: string;
  /** Preferred: raw bytes, so no external download step is required. */
  bytes?: Uint8Array;
  /** Alternative: a URL the server may download from. */
  sourceUrl?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  metadata: Record<string, unknown>;
}

/**
 * Server-side execution context passed to adapters. Deliberately carries no
 * secrets — adapters read their own credentials from server-only env vars.
 */
export interface ProviderExecutionContext {
  generationId: string;
  clerkUserId: string;
  projectId: string;
  /** Signal for cooperative cancellation / timeouts. */
  signal?: AbortSignal;
}

/** Result surfaced by the orchestrator to the API route. */
export interface OrchestrationResult {
  generationId: string;
  status: "completed" | "processing" | "failed";
  workflow: WorkflowType;
  provider: string;
  modelId: string;
  outputs: Array<{
    storagePath: string;
    mimeType: string;
    type: GenerationType;
    signedUrl: string | null;
  }>;
  isMock: boolean;
}
