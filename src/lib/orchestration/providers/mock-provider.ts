import "server-only";
import { OrchestrationError } from "../errors";
import { encodePng, paintMockCard } from "./png-encoder";
import { encodeWav, synthesizeMockTone, wavDurationSeconds } from "./wav-encoder";
import type { ProviderAdapter } from "./provider-adapter";
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

export type MockMode = "success" | "provider-failure" | "retryable-failure" | "missing-output";

const VALID_MODES: ReadonlySet<string> = new Set<MockMode>([
  "success",
  "provider-failure",
  "retryable-failure",
  "missing-output",
]);

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

class MockProvider implements ProviderAdapter {
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
    _context: ProviderExecutionContext
  ): Promise<ProviderStatusResult> {
    void _context;
    return { status: submission.status, progress: submission.status === "completed" ? 100 : 0 };
  }

  async getResult(
    submission: ProviderSubmission,
    context: ProviderExecutionContext
  ): Promise<NormalizedOutput[]> {
    const request = PENDING_REQUESTS.get(submission.providerJobId);
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

export function registerMockRequest(request: NormalizedGenerationRequest): void {
  PENDING_REQUESTS.set(`mock-${request.generationId}`, request);
}

export function releaseMockRequest(generationId: string): void {
  PENDING_REQUESTS.delete(`mock-${generationId}`);
}

export const mockProvider: ProviderAdapter = new MockProvider();
