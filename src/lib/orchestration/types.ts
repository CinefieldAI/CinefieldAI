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

/** The concrete transformation a request performs. */
export type WorkflowType =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "image-to-video"
  | "video-to-video"
  | "audio-to-video"
  | "text-to-audio"
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
  | "failed";

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

/** What an adapter returns from submit(). */
export interface ProviderSubmission {
  providerJobId: string;
  provider: string;
  status: ProviderJobStatus;
  metadata?: Record<string, unknown>;
}

/** What an adapter returns from getStatus(). */
export interface ProviderStatusResult {
  status: ProviderJobStatus;
  progress?: number;
  metadata?: Record<string, unknown>;
}

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
