import type { GenerationCreateRequest } from "@/lib/orchestration/generation-create-service";
import { mapMetadataToInputs, mapMetadataToSettings } from "@/lib/orchestration/generation-settings-mapper";
import type { GenerationType } from "@/lib/orchestration/types";
import type { GenerationManifest } from "./generation-manifest-contract";
import type { UserIntent } from "./user-intent-contract";

/**
 * Compatibility seam (Phase 17).
 *
 * Proves the semantic layer can feed the EXISTING generation admission seam
 * (generation-create-service.ts's createGeneration()) without becoming a
 * second generation path. Both directions are pure, synchronous mappers —
 * neither calls Temporal, reserves credits, or writes a database row. The
 * live /api/generate route is left untouched: nothing here is wired into it
 * yet, by design (narrowest-safe-integration rule, Phase 17 brief Section
 * 16/17 — Option B).
 *
 * KNOWN, DOCUMENTED LIMITATION: GenerationCreateRequest carries a single
 * `inputUrl`, while a GenerationManifest can carry several `references`
 * (Cinema Studio's multi-reference workflows). Only the first reference
 * survives the manifest -> request direction; this mirrors the existing
 * seam's own real shape rather than silently inventing multi-input support
 * it does not have. Extending GenerationCreateRequest to accept multiple
 * inputs is out of Phase 17's scope — it would touch the live creation path,
 * which is explicitly not authorized here.
 *
 * PHASE 22 CORRECTIVE BATCH — SEMANTIC VERSION TRACEABILITY
 * `manifestVersion`/`compilerVersion`/`intentId` now travel into
 * `metadata.semanticVersion`, the same namespaced-key convention
 * generation-create-service.ts's own `routing` key already established for
 * server-derived facts riding alongside UI settings in one jsonb column —
 * no new migration, no second generation path. This makes them reachable at
 * `generations.metadata.semanticVersion` for any generation admitted through
 * POST /api/product-intelligence/execute (the one live caller of this
 * function). The PRIMARY POST /api/generate path builds its
 * GenerationCreateRequest directly from client UI state and never compiles
 * a manifest at all, so a generation admitted there still carries no
 * semantic version — that is an honest, disclosed scope limit of this
 * batch (see docs/security-gates.md's Phase 22 section), not something this
 * seam can fix without making the manifest compiler mandatory on the
 * primary path, which is a Phase 17 redesign this corrective batch is not
 * authorized to make.
 *
 * `provenance` (which field came from the user vs. a specialist vs. a
 * registry default) is deliberately NOT copied here — it answers a
 * different question ("why does this manifest look the way it does") than
 * "which manifest/compiler version produced it", and copying it would grow
 * this seam's scope past the traceability gap this batch exists to close.
 */

function outputCountFraction(outputCount: number | undefined): string | undefined {
  if (outputCount === undefined) return undefined;
  return `${outputCount}/${outputCount}`;
}

/** GenerationManifest -> the exact metadata shape generation-settings-mapper.ts already reads. */
export function mapGenerationManifestToCreateRequest(manifest: GenerationManifest): GenerationCreateRequest {
  const firstReference = manifest.references[0];
  const metadata: Record<string, unknown> = {};

  if (manifest.settings.aspectRatio !== undefined) metadata.aspect_ratio = manifest.settings.aspectRatio;
  if (manifest.settings.resolution !== undefined) metadata.resolution = manifest.settings.resolution;
  if (manifest.settings.durationSeconds !== undefined) metadata.duration_seconds = manifest.settings.durationSeconds;
  const imageCount = outputCountFraction(manifest.settings.outputCount);
  if (imageCount !== undefined) metadata.image_count = imageCount;
  if (manifest.settings.thinking !== undefined) metadata.thinking = manifest.settings.thinking;
  if (manifest.settings.voice !== undefined) metadata.voice = manifest.settings.voice;
  if (manifest.settings.language !== undefined) metadata.language = manifest.settings.language;
  if (firstReference) {
    metadata.mime_type = firstReference.mimeType;
  }
  metadata.semanticVersion = {
    manifestVersion: manifest.manifestVersion,
    compilerVersion: manifest.compilerVersion,
    intentId: manifest.intentId,
  };

  return {
    model: manifest.modelId,
    prompt: manifest.prompt,
    projectId: manifest.projectId,
    negativePrompt: manifest.negativePrompt ?? null,
    inputUrl: firstReference?.storagePath ?? null,
    metadata,
  };
}

/**
 * The reverse direction: an existing GenerationCreateRequest -> UserIntent,
 * reading through the SAME generation-settings-mapper.ts functions the
 * creation and execution paths already use, so this never disagrees with
 * either about what a metadata field means.
 */
export function mapUserIntentFromGenerationCreateRequest(
  request: GenerationCreateRequest,
  generationType: GenerationType,
  intentId: string
): UserIntent {
  const settings = mapMetadataToSettings(request.metadata);
  const inputs = mapMetadataToInputs(request.inputUrl, request.metadata);

  return {
    intentId,
    projectId: request.projectId,
    generationType,
    modelId: request.model,
    prompt: request.prompt,
    negativePrompt: request.negativePrompt ?? undefined,
    settings: {
      aspectRatio: settings.aspectRatio,
      resolution: settings.resolution,
      durationSeconds: settings.durationSeconds,
      outputCount: settings.outputCount,
      thinking: settings.thinking,
      voice: settings.voice,
      language: settings.language,
    },
    references: inputs.map((input) => ({ storagePath: input.storagePath, mimeType: input.mimeType })),
    styleHints: [],
  };
}
