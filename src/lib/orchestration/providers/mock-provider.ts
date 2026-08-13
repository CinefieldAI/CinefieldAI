import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import { OrchestrationError } from "../errors";
import { findModel } from "../model-registry";
import { readPersistedProviderJob } from "../status-manager";
import { encodePng, paintMockCard } from "./png-encoder";
import { encodeWav, synthesizeMockTone, wavDurationSeconds } from "./wav-encoder";
import type { ProviderAdapter } from "./provider-adapter";
import type { ProviderCapabilityMatrix } from "./provider-capabilities";
import type {
  NormalizedGenerationRequest,
  NormalizedOutput,
  ProviderExecutionContext,
  ProviderStatusResult,
  ProviderSubmission,
} from "../types";

/**
 * Cinefield Mock Provider — deterministic, server-only, offline.
 *
 * Calls no external API of any kind. It encodes a small, genuine PNG or WAV
 * artifact in-process so the full orchestration chain (routing → validation →
 * submission → normalization → Storage upload → completion) can be proven
 * end-to-end before any real provider adapter exists — for image and audio
 * generation types. Video mock output remains intentionally unimplemented
 * (see the MOCK_VIDEO_NOT_IMPLEMENTED branch below).
 *
 * Test modes are selected through the `mock_mode` key inside the
 * generation's existing metadata JSON (see resolveMockMode). Absent or
 * unrecognized values fall back to "success".
 */

export type MockMode =
  | "success"
  | "provider-failure"
  | "retryable-failure"
  | "missing-output"
  /**
   * Async lifecycle test modes. submit() returns "processing" with a stable
   * job id instead of finishing inline, so the generic async core
   * (persist job → continuation → status checks → shared finalization) can be
   * exercised end-to-end offline and at zero cost.
   *
   * Progression is driven by the PERSISTED providerJob.checkCount on the
   * generation row — never by wall-clock time, randomness, or in-memory
   * state — so it is deterministic and survives process and retry
   * boundaries (the continuation runs in a different process than submit).
   *
   *   async-success: check 1 → processing, 2 → processing, 3 → completed
   *   async-flaky:   check 1 → transient error, 2 → processing,
   *                  3 → processing, 4 → completed
   *   async-pending: never completes (exercises the polling ceiling)
   *   async-failure: check 1 → processing, 2 → the PROVIDER ITSELF reports
   *                  the job failed. This is the one and only way a status
   *                  check may terminally fail a row, and it was previously
   *                  unreachable offline — every other mock failure mode
   *                  throws from submit(), which is a different code path
   *                  with different evidence rules. Added in the Phase 6R.12
   *                  completion pass so the submitted → processing → failed
   *                  lifecycle can be proven end-to-end at zero cost.
   */
  | "async-success"
  | "async-flaky"
  | "async-pending"
  | "async-failure";

const VALID_MODES: ReadonlySet<string> = new Set<MockMode>([
  "success",
  "provider-failure",
  "retryable-failure",
  "missing-output",
  "async-success",
  "async-flaky",
  "async-pending",
  "async-failure",
]);

const ASYNC_MODES: ReadonlySet<string> = new Set<MockMode>([
  "async-success",
  "async-flaky",
  "async-pending",
  "async-failure",
]);

export function isAsyncMockMode(mode: MockMode): boolean {
  return ASYNC_MODES.has(mode);
}

export function resolveMockMode(metadata: Record<string, unknown> | null | undefined): MockMode {
  const raw = metadata?.mock_mode;
  if (typeof raw === "string" && VALID_MODES.has(raw)) {
    return raw as MockMode;
  }
  return "success";
}

/**
 * Mock render dimensions, kept small so encoding stays fast. The private
 * generation-outputs bucket accepts image/png but NOT image/svg+xml, so the
 * mock emits genuine PNG bytes rather than SVG.
 */
const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 512, height: 512 },
  "16:9": { width: 640, height: 360 },
  "9:16": { width: 360, height: 640 },
  "4:3": { width: 640, height: 480 },
  "3:4": { width: 480, height: 640 },
  "21:9": { width: 756, height: 324 },
  "4:5": { width: 480, height: 600 },
  "5:4": { width: 600, height: 480 },
  "2:3": { width: 420, height: 630 },
  "3:2": { width: 630, height: 420 },
};

/** Cinefield dark field + brand accent, matching the app's palette. */
const MOCK_BACKGROUND = { r: 0x0a, g: 0x0a, b: 0x0b };
const MOCK_ACCENT = { r: 0xd9, g: 0x77, b: 0x57 };

/**
 * Builds a deterministic PNG test card. The bytes are a real, spec-valid PNG
 * (see png-encoder.ts) — nothing is mislabeled. The artifact is identified as
 * a mock through the output metadata below and the UI success message, and
 * its block pattern is derived from the generation id so different runs
 * render visibly different images.
 */
function buildMockPng(request: NormalizedGenerationRequest, index: number): NormalizedOutput {
  const aspect = request.settings.aspectRatio ?? "16:9";
  const { width, height } = ASPECT_DIMENSIONS[aspect] ?? ASPECT_DIMENSIONS["16:9"];

  const pixels = paintMockCard({
    width,
    height,
    background: MOCK_BACKGROUND,
    accent: MOCK_ACCENT,
    seed: `${request.generationId}:${index}`,
  });

  return {
    type: "image",
    mimeType: "image/png",
    fileExtension: "png",
    bytes: encodePng(width, height, pixels),
    width,
    height,
    metadata: {
      mock: true,
      mockNotice: "Cinefield mock orchestration output. No real AI provider was used.",
      provider: "mock",
      workflow: request.workflow,
      aspectRatio: aspect,
      outputIndex: index,
    },
  };
}

/**
 * Builds a deterministic mock TTS output: a genuine, spec-valid WAV tone
 * (see wav-encoder.ts) whose pitch is derived from the generation id and
 * whose duration loosely tracks the input text's length. This is NOT
 * text-to-speech — it never reads or transforms the prompt text beyond its
 * length, so the original Unicode text (already unchanged in `request.prompt`
 * at this point) is never touched, translated, or re-encoded by this step.
 * It exists only to prove the audio orchestration chain end-to-end.
 */
function buildMockAudio(request: NormalizedGenerationRequest, index: number): NormalizedOutput {
  const samples = synthesizeMockTone({
    seed: `${request.generationId}:${index}`,
    textLength: request.prompt.length,
  });
  const bytes = encodeWav(samples);

  return {
    type: "audio",
    mimeType: "audio/wav",
    fileExtension: "wav",
    bytes,
    durationSeconds: wavDurationSeconds(samples),
    metadata: {
      mock: true,
      mockNotice: "Cinefield mock TTS output. No real TTS provider was used.",
      provider: "mock",
      workflow: request.workflow,
      textLength: request.prompt.length,
      voice: request.settings.voice ?? null,
      language: request.settings.language ?? null,
      outputIndex: index,
    },
  };
}

/**
 * The mock provider's capabilities are "proven" in the only sense that word
 * can mean here: it IS the implementation, so there is no external behaviour
 * left to verify. It reaches no network and creates no billable job.
 */
export const MOCK_CAPABILITIES: ProviderCapabilityMatrix = {
  submit: "proven",
  status: "proven",
  result: "proven",
  polling: "proven",
  // A mock has no reason to call itself back.
  webhook: "unsupported_by_adapter",
  webhookAuthentication: "unsupported_by_adapter",
  cancel: "proven",
  // There is never an ambiguous submission to reconcile: nothing leaves the
  // process, so "did a job get created" is never in doubt.
  reconcileAmbiguousSubmission: "unsupported_by_adapter",
  nativeIdempotency: "unsupported_by_adapter",
  executionShape: "synchronous",
  // Restart-safe by having nothing to lose. The mock reaches no network and
  // creates no billable job, so a crash costs a re-run rather than an output
  // somebody paid for. That is a genuinely different situation from Gemini's,
  // which looks similar in code and is not.
  productionExecutionDurability: "restart_safe",
};

class MockProvider implements ProviderAdapter {
  readonly capabilities = MOCK_CAPABILITIES;

  readonly providerId = "mock";

  async submit(
    request: NormalizedGenerationRequest,
    _context: ProviderExecutionContext
  ): Promise<ProviderSubmission> {
    void _context;
    const mode = resolveMockMode(request.settings.extra ?? null);

    if (mode === "provider-failure") {
      throw new OrchestrationError("PROVIDER_FAILED", {
        context: { provider: "mock", mode },
        userMessage: "Mock provider failed as requested by the test mode.",
      });
    }

    if (mode === "retryable-failure") {
      throw new OrchestrationError("PROVIDER_TIMEOUT", {
        context: { provider: "mock", mode },
        userMessage: "Mock provider timed out as requested by the test mode.",
      });
    }

    // Async test modes: accept the job and finish it later, exactly as a
    // real long-running provider does. `metadata` becomes the persisted
    // `resume` blob, so the mode travels with the job — no in-memory state.
    if (isAsyncMockMode(mode)) {
      return {
        providerJobId: `mock-${request.generationId}`,
        provider: this.providerId,
        status: "processing",
        metadata: { mock: true, mode },
      };
    }

    // Synchronous provider: the work is complete by the time submit resolves.
    return {
      providerJobId: `mock-${request.generationId}`,
      provider: this.providerId,
      status: "completed",
      metadata: { mock: true, mode },
    };
  }

  async getStatus(
    submission: ProviderSubmission,
    context: ProviderExecutionContext
  ): Promise<ProviderStatusResult> {
    const mode = readResumeMode(submission.metadata);

    if (!mode || !isAsyncMockMode(mode)) {
      // Sync submissions carry their final state already.
      return { status: submission.status, progress: submission.status === "completed" ? 100 : 0 };
    }

    // Deterministic progression from the PERSISTED check count — the value
    // recorded by the core before this check, so it is identical no matter
    // which process or transport asks.
    const checksSoFar = await readPersistedCheckCount(context.generationId);

    if (mode === "async-pending") {
      return { status: "processing", progress: 10 };
    }

    if (mode === "async-failure") {
      // NOT a thrown error: a thrown getStatus is a CHECK failure and the
      // core deliberately keeps polling. Returning "failed" is the provider
      // answering that the job itself is dead, which is the only signal that
      // may terminally fail the row.
      return checksSoFar >= 1 ? { status: "failed", progress: 0 } : { status: "processing", progress: 50 };
    }

    if (mode === "async-flaky" && checksSoFar === 0) {
      // A TRANSIENT status-check failure, not a job failure: the job is still
      // live and the core must keep the row "processing" and check again.
      throw new OrchestrationError("PROVIDER_TIMEOUT", {
        context: { provider: "mock", mode, reason: "mock_transient_status_check" },
      });
    }

    const completeAt = mode === "async-flaky" ? 3 : 2;
    return checksSoFar >= completeAt
      ? { status: "completed", progress: 100 }
      : { status: "processing", progress: 50 };
  }

  /**
   * Deterministic cancel, so Phase 6R-H can exercise all three provider
   * behaviours offline without inventing capability data for a real provider.
   *
   * The mode travels in the persisted `resume` blob, exactly like the async
   * progression does, so the outcome is stable across processes:
   *   async-pending  → throws (a cancel call that failed)
   *   async-failure  → the job is already terminal
   *   everything else → cancelled
   *
   * Adapters that do NOT implement cancel at all are represented by the
   * absence of this method on fal/cloudflare — which is the real state of
   * the world and is deliberately left alone.
   */
  async cancel(
    submission: ProviderSubmission,
    _context: ProviderExecutionContext
  ): Promise<void> {
    void _context;
    const mode = readResumeMode(submission.metadata);

    if (mode === "async-pending") {
      throw new OrchestrationError("PROVIDER_TIMEOUT", {
        context: { provider: "mock", mode, reason: "mock_cancel_transient_failure" },
      });
    }
    if (mode === "async-failure") {
      throw new OrchestrationError("PROVIDER_FAILED", {
        context: { provider: "mock", mode, reason: "mock_job_already_terminal" },
      });
    }
    // Confirmed stopped. No output is produced and nothing is finalized.
  }

  async getResult(
    submission: ProviderSubmission,
    context: ProviderExecutionContext
  ): Promise<NormalizedOutput[]> {
    // The in-memory handoff only exists within a single sync execution. An
    // async job is finalized by a later, separate process, so the request is
    // rebuilt from the generation row itself when the map is empty.
    const request =
      PENDING_REQUESTS.get(submission.providerJobId) ??
      (await rebuildRequestFromRow(context.generationId));

    if (!request) {
      throw new OrchestrationError("OUTPUT_MISSING", {
        context: { provider: "mock", generationId: context.generationId },
      });
    }

    const mode = resolveMockMode(request.settings.extra ?? null);
    if (mode === "missing-output") {
      return [];
    }

    // Video mocks are not faked. Producing a valid video container would
    // require a new dependency, and returning a mislabeled artifact would be
    // worse than failing honestly.
    if (request.generationType === "video") {
      throw new OrchestrationError("MOCK_VIDEO_NOT_IMPLEMENTED", {
        context: { provider: "mock", generationType: "video" },
        userMessage:
          "Mock video output is not implemented. Use a mock image model to test orchestration.",
      });
    }

    const count = request.settings.outputCount ?? 1;

    if (request.generationType === "audio") {
      return Array.from({ length: count }, (_, index) => buildMockAudio(request, index));
    }

    return Array.from({ length: count }, (_, index) => buildMockPng(request, index));
  }
}

/**
 * The adapter contract passes the request to submit() but only the
 * submission to getResult(). For this synchronous mock we keep the request
 * addressable between the two calls. Entries are removed by the orchestrator
 * via releaseMockRequest() once the run finishes.
 */
const PENDING_REQUESTS = new Map<string, NormalizedGenerationRequest>();

/** Reads the async mode out of the persisted `resume` blob. */
function readResumeMode(resume: Record<string, unknown> | undefined): MockMode | null {
  const raw = resume?.mode;
  return typeof raw === "string" && VALID_MODES.has(raw) ? (raw as MockMode) : null;
}

/**
 * Number of status checks the core has already recorded for this job. Read
 * straight from the persisted providerJob so mock progression is stable
 * across processes, retries and transports. Mock-only: no production
 * provider adapter reads Cinefield's own rows.
 */
async function readPersistedCheckCount(generationId: string): Promise<number> {
  const admin = getSupabaseAdminClient();
  const { data } = await admin
    .from("generations")
    .select("metadata")
    .eq("id", generationId)
    .maybeSingle();

  const job = readPersistedProviderJob((data?.metadata ?? null) as Record<string, unknown> | null);
  return job?.checkCount ?? 0;
}

/**
 * Rebuilds the minimum request the mock renderers need, from the generation
 * row plus the registry. Used only when an async job is finalized by a
 * process that never ran submit(). Mock-only.
 */
async function rebuildRequestFromRow(
  generationId: string
): Promise<NormalizedGenerationRequest | null> {
  const admin = getSupabaseAdminClient();
  const { data } = await admin
    .from("generations")
    .select("*")
    .eq("id", generationId)
    .maybeSingle();

  if (!data) return null;
  const row = data as {
    id: string;
    clerk_user_id: string;
    project_id: string;
    model: string;
    prompt: string;
    metadata: Record<string, unknown> | null;
  };

  const model = findModel(row.model);
  if (!model) return null;

  const metadata = row.metadata ?? {};
  const orchestration =
    typeof metadata.orchestration === "object" && metadata.orchestration !== null
      ? (metadata.orchestration as Record<string, unknown>)
      : {};
  const imageCount = typeof metadata.image_count === "string" ? metadata.image_count : undefined;
  const parsedCount = imageCount
    ? Number.parseInt(imageCount.split("/")[0] ?? "", 10)
    : Number.NaN;

  return {
    generationId: row.id,
    clerkUserId: row.clerk_user_id,
    projectId: row.project_id,
    modelId: row.model,
    provider: model.providerId,
    providerModelId: model.providerModelId,
    generationType: model.generationType,
    workflow:
      typeof orchestration.workflow === "string"
        ? (orchestration.workflow as NormalizedGenerationRequest["workflow"])
        : "text-to-image",
    prompt: row.prompt,
    inputs: [],
    settings: {
      aspectRatio: typeof metadata.aspect_ratio === "string" ? metadata.aspect_ratio : undefined,
      resolution: typeof metadata.resolution === "string" ? metadata.resolution : undefined,
      outputCount: Number.isInteger(parsedCount) && parsedCount > 0 ? parsedCount : undefined,
      voice: typeof metadata.voice === "string" ? metadata.voice : undefined,
      language: typeof metadata.language === "string" ? metadata.language : undefined,
      extra: metadata,
    },
  };
}

export function registerMockRequest(request: NormalizedGenerationRequest): void {
  PENDING_REQUESTS.set(`mock-${request.generationId}`, request);
}

export function releaseMockRequest(generationId: string): void {
  PENDING_REQUESTS.delete(`mock-${generationId}`);
}

export const mockProvider: ProviderAdapter = new MockProvider();
