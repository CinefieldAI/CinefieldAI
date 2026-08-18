import { OrchestrationError } from "@/lib/orchestration/errors";
import type { GenerationType, WorkflowType } from "@/lib/orchestration/types";

/**
 * Cinefield Product Intelligence — UserIntent contract (Phase 17).
 *
 * UserIntent is the semantic-layer INPUT: what a caller says they want,
 * before any capability, safety, or provider decision is made. It is
 * deliberately narrow — bounded to fields the existing capability registry
 * (model-registry.ts / capability-validator.ts) can actually validate, plus
 * an optional free-text style hint for the creative-control vocabulary
 * (genre, camera, lighting, era, ...) that the Phase 17 reality audit
 * confirmed is NOT yet backed by a canonical, per-field capability source
 * (no Control/Panel Schema Registry exists — see docs/architecture). This
 * layer does not fabricate structured support for controls the registry
 * cannot validate; it deliberately passes creative-style language through as
 * bounded free text that composes into the eventual prompt, exactly how
 * Cinema Studio already builds prompts today.
 *
 * Explicitly out of scope, and never accepted here: provider identity,
 * queue transport, workflow/attempt identifiers, billing state, credentials,
 * or any other value that would let a caller pretend to be the lifecycle
 * layer. See generation-manifest-contract.ts for the same rule enforced on
 * the OUTPUT side.
 */

/** Same UUID shape generation-create-service.ts already enforces. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_PROMPT_LENGTH = 10_000;
const MAX_STYLE_HINT_LENGTH = 2_000;
const MAX_STYLE_HINTS = 16;
const MAX_REFERENCES = 8;

const GENERATION_TYPES: readonly GenerationType[] = ["image", "video", "audio"];

/** Bounded, provider-neutral settings a caller may express intent for. */
export interface UserIntentSettings {
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  outputCount?: number;
  thinking?: string;
  seed?: number;
  voice?: string;
  language?: string;
}

/** A single already-uploaded reference input. Storage path only — never bytes. */
export interface UserIntentReference {
  storagePath: string;
  mimeType: string;
}

/**
 * What a caller says they want. Every field here is either capability-
 * validated (settings, modelId, workflow) or bounded free text (prompt,
 * styleHints) — nothing here is a lifecycle, provider, or billing field.
 */
export interface UserIntent {
  /** Correlates one intent through Coordinator -> Specialists -> Compiler. Caller-supplied or generated. */
  intentId: string;
  projectId: string;
  generationType: GenerationType;
  /** Explicit model choice, when the caller already knows it. Optional — the Coordinator may still need to pick. */
  modelId?: string;
  /** Explicit workflow choice. Optional — resolveWorkflow() already infers this from inputs when omitted. */
  workflow?: WorkflowType;
  prompt: string;
  negativePrompt?: string;
  settings: UserIntentSettings;
  references: UserIntentReference[];
  /**
   * Bounded free-text creative-style vocabulary (genre, camera, era, tempo,
   * lighting, palette, ...). Composed into the eventual prompt by the
   * Manifest Compiler, never validated as a structured capability, and
   * never fabricated as a canonical control — see the file header.
   */
  styleHints: string[];
}

export type UserIntentInput = {
  intentId?: unknown;
  projectId?: unknown;
  generationType?: unknown;
  modelId?: unknown;
  workflow?: unknown;
  prompt?: unknown;
  negativePrompt?: unknown;
  settings?: unknown;
  references?: unknown;
  styleHints?: unknown;
};

function isGenerationType(value: unknown): value is GenerationType {
  return typeof value === "string" && (GENERATION_TYPES as readonly string[]).includes(value);
}

function invalid(userMessage: string): never {
  throw new OrchestrationError("INVALID_INPUT", { userMessage });
}

function parseSettings(raw: unknown): UserIntentSettings {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    invalid("Invalid settings.");
  }
  const candidate = raw as Record<string, unknown>;
  const settings: UserIntentSettings = {};

  if (candidate.aspectRatio !== undefined) {
    if (typeof candidate.aspectRatio !== "string") invalid("aspectRatio must be a string.");
    settings.aspectRatio = candidate.aspectRatio;
  }
  if (candidate.resolution !== undefined) {
    if (typeof candidate.resolution !== "string") invalid("resolution must be a string.");
    settings.resolution = candidate.resolution;
  }
  if (candidate.durationSeconds !== undefined) {
    if (typeof candidate.durationSeconds !== "number" || !Number.isFinite(candidate.durationSeconds)) {
      invalid("durationSeconds must be a number.");
    }
    settings.durationSeconds = candidate.durationSeconds;
  }
  if (candidate.outputCount !== undefined) {
    if (typeof candidate.outputCount !== "number" || !Number.isInteger(candidate.outputCount)) {
      invalid("outputCount must be an integer.");
    }
    settings.outputCount = candidate.outputCount;
  }
  if (candidate.thinking !== undefined) {
    if (typeof candidate.thinking !== "string") invalid("thinking must be a string.");
    settings.thinking = candidate.thinking;
  }
  if (candidate.seed !== undefined) {
    if (typeof candidate.seed !== "number" || !Number.isInteger(candidate.seed)) {
      invalid("seed must be an integer.");
    }
    settings.seed = candidate.seed;
  }
  if (candidate.voice !== undefined) {
    if (typeof candidate.voice !== "string") invalid("voice must be a string.");
    settings.voice = candidate.voice;
  }
  if (candidate.language !== undefined) {
    if (typeof candidate.language !== "string") invalid("language must be a string.");
    settings.language = candidate.language;
  }
  return settings;
}

function parseReferences(raw: unknown): UserIntentReference[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) invalid("references must be an array.");
  if (raw.length > MAX_REFERENCES) invalid(`references exceeds the ${MAX_REFERENCES}-item limit.`);
  return raw.map((entry) => {
    if (typeof entry !== "object" || entry === null) invalid("Invalid reference entry.");
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.storagePath !== "string" || candidate.storagePath.trim().length === 0) {
      invalid("reference.storagePath is required.");
    }
    if (typeof candidate.mimeType !== "string" || candidate.mimeType.trim().length === 0) {
      invalid("reference.mimeType is required.");
    }
    return { storagePath: candidate.storagePath, mimeType: candidate.mimeType };
  });
}

function parseStyleHints(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) invalid("styleHints must be an array.");
  if (raw.length > MAX_STYLE_HINTS) invalid(`styleHints exceeds the ${MAX_STYLE_HINTS}-item limit.`);
  return raw.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) invalid("Invalid style hint.");
    if (entry.length > MAX_STYLE_HINT_LENGTH) invalid("A style hint is too long.");
    return entry;
  });
}

/**
 * Parses and validates a raw, untrusted body into a UserIntent. Fails
 * closed: any structurally invalid or oversized field throws INVALID_INPUT
 * rather than coercing a guess. Mirrors the discipline
 * generation-create-service.ts's validate() already applies to
 * GenerationCreateRequest, but scoped to the semantic layer's own fields.
 */
export function parseUserIntent(raw: unknown, fallbackIntentId: string): UserIntent {
  if (typeof raw !== "object" || raw === null) invalid("Invalid request body.");
  const candidate = raw as UserIntentInput;

  const intentId =
    candidate.intentId === undefined
      ? fallbackIntentId
      : typeof candidate.intentId === "string" && UUID.test(candidate.intentId)
        ? candidate.intentId
        : invalid("intentId must be a UUID.");

  if (typeof candidate.projectId !== "string" || !UUID.test(candidate.projectId)) {
    invalid("A valid project is required.");
  }
  if (!isGenerationType(candidate.generationType)) {
    invalid("generationType must be one of: image, video, audio.");
  }
  if (typeof candidate.prompt !== "string") {
    invalid("A prompt is required.");
  }
  if (candidate.prompt.length > MAX_PROMPT_LENGTH) {
    invalid("The prompt is too long.");
  }
  if (candidate.negativePrompt !== undefined) {
    if (typeof candidate.negativePrompt !== "string") invalid("negativePrompt must be a string.");
    if (candidate.negativePrompt.length > MAX_PROMPT_LENGTH) invalid("negativePrompt is too long.");
  }
  if (candidate.modelId !== undefined && typeof candidate.modelId !== "string") {
    invalid("modelId must be a string.");
  }
  if (candidate.workflow !== undefined && typeof candidate.workflow !== "string") {
    invalid("workflow must be a string.");
  }

  return {
    intentId,
    projectId: candidate.projectId,
    generationType: candidate.generationType,
    modelId: candidate.modelId as string | undefined,
    workflow: candidate.workflow as WorkflowType | undefined,
    prompt: candidate.prompt,
    negativePrompt: candidate.negativePrompt as string | undefined,
    settings: parseSettings(candidate.settings),
    references: parseReferences(candidate.references),
    styleHints: parseStyleHints(candidate.styleHints),
  };
}
