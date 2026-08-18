import "server-only";
import { resolveWorkflow } from "@/lib/orchestration/workflow-router";
import type { ModelRegistryEntry } from "@/lib/orchestration/model-registry";
import { toReferenceInputs } from "./specialists/capability-specialist";
import type { CoordinatorResult } from "./core-coordinator";
import {
  GENERATION_MANIFEST_VERSION,
  type GenerationManifest,
  type ManifestCompileResult,
  type ManifestFieldProvenance,
  type ManifestSettings,
} from "./generation-manifest-contract";

/**
 * Manifest Compiler (Phase 17).
 *
 * Deterministic. Never selects a provider, never starts a Temporal workflow,
 * never reserves credits, never writes a terminal generation state — it only
 * turns a CoordinatorResult into a GenerationManifest (or a bounded
 * refusal).
 *
 * Conflict-resolution precedence, applied in this exact order (Phase 17
 * brief, Section 14): safety/policy > capability > explicit user choice >
 * profile > specialist suggestion > default. There is no profile system yet
 * (Phase 17 reality audit: MISSING), so that tier is skipped, not
 * fabricated.
 */

const SETTINGS_FIELDS = [
  "aspectRatio",
  "resolution",
  "durationSeconds",
  "outputCount",
  "thinking",
  "seed",
  "voice",
  "language",
] as const;

function composePrompt(prompt: string, styleHints: string[]): string {
  if (styleHints.length === 0) return prompt;
  return `${prompt}\n\n${styleHints.join(", ")}`;
}

function compileSettings(
  intentSettings: Record<string, unknown>,
  model: ModelRegistryEntry
): { settings: ManifestSettings; provenance: ManifestFieldProvenance[] } {
  const settings: ManifestSettings = {};
  const provenance: ManifestFieldProvenance[] = [];

  for (const field of SETTINGS_FIELDS) {
    const explicitValue = intentSettings[field];
    if (explicitValue !== undefined) {
      (settings as Record<string, unknown>)[field] = explicitValue;
      provenance.push({ field: `settings.${field}`, source: "explicit_user" });
      continue;
    }
  }

  // Registry defaults fill ONLY the gaps explicit choice left open — never
  // overwrite an explicit value (explicit user choice outranks default).
  if (settings.aspectRatio === undefined && model.defaults.aspectRatio !== undefined) {
    settings.aspectRatio = model.defaults.aspectRatio;
    provenance.push({ field: "settings.aspectRatio", source: "registry_default" });
  }
  if (settings.resolution === undefined && model.defaults.resolution !== undefined) {
    settings.resolution = model.defaults.resolution;
    provenance.push({ field: "settings.resolution", source: "registry_default" });
  }
  if (settings.durationSeconds === undefined && model.defaults.durationSeconds !== undefined) {
    settings.durationSeconds = model.defaults.durationSeconds;
    provenance.push({ field: "settings.durationSeconds", source: "registry_default" });
  }
  if (settings.outputCount === undefined) {
    settings.outputCount = model.defaults.outputCount;
    provenance.push({ field: "settings.outputCount", source: "registry_default" });
  }

  return { settings, provenance };
}

export function compileManifest(result: CoordinatorResult): ManifestCompileResult {
  const { intent, capability, prompt: promptSpecialist, safety } = result;

  // ---- Tier 1: safety/policy ----------------------------------------------
  // A flagged intent is refused outright. This is the ONLY case that
  // overrides even capability — an unsafe request is refused before the
  // compiler even asks whether the model could technically do it.
  if (safety.outcome === "flagged") {
    return { outcome: "POLICY_REFUSED", reasonCodes: ["CONTENT_FLAGGED", ...safety.categories] };
  }

  // ---- Tier 2: capability --------------------------------------------------
  if (capability.outcome === "unknown_model") {
    return { outcome: "INVALID_INTENT", reasonCodes: ["UNKNOWN_MODEL"] };
  }
  if (capability.outcome === "unsupported") {
    return { outcome: "UNSUPPORTED_CAPABILITY", reasonCodes: [capability.reasonCode] };
  }

  const { model, workflow } = capability;

  // Explicit-workflow-vs-actual-inputs conflict: the user named a workflow
  // that does not match what their own attached references imply. Detected
  // by re-deriving the input-implied workflow with the SAME canonical
  // resolveWorkflow() the capability specialist already trusts — never a
  // second, independent inference.
  if (intent.workflow && intent.references.length > 0) {
    try {
      const inputImplied = resolveWorkflow(model, toReferenceInputs(intent));
      if (inputImplied !== intent.workflow) {
        return {
          outcome: "CONFLICTING_CONTROLS",
          reasonCodes: [`workflow:${intent.workflow}`, `input_implied_workflow:${inputImplied}`],
        };
      }
    } catch {
      // resolveWorkflow() throwing here means the references alone are
      // unsupported — already covered by capability.outcome above when no
      // explicit workflow masked it. With an explicit workflow present we
      // don't double-refuse; the explicit, already-validated workflow wins.
    }
  }

  const { settings, provenance: settingsProvenance } = compileSettings(
    intent.settings as unknown as Record<string, unknown>,
    model
  );

  const provenance: ManifestFieldProvenance[] = [
    { field: "modelId", source: "explicit_user" },
    { field: "workflow", source: intent.workflow ? "explicit_user" : "specialist_suggested" },
    { field: "prompt", source: "explicit_user" },
    ...settingsProvenance,
  ];

  // Prompt-specialist output is recorded as advisory provenance only; it
  // never silently overwrites the user's own prompt text (explicit user
  // choice outranks specialist suggestion — see the precedence rule above,
  // and the Manifest Honesty rule against silently rewriting user content).
  if (promptSpecialist.applied) {
    provenance.push({ field: "prompt.specialistSuggestion", source: "specialist_suggested" });
  }

  const manifest: GenerationManifest = {
    manifestVersion: GENERATION_MANIFEST_VERSION,
    intentId: intent.intentId,
    projectId: intent.projectId,
    generationType: model.generationType,
    workflow,
    modelId: model.id,
    prompt: composePrompt(intent.prompt, intent.styleHints),
    negativePrompt: intent.negativePrompt,
    settings,
    references: intent.references.map((reference) => ({ ...reference })),
    provenance,
    policyCheck: { outcome: safety.outcome },
  };

  // Safety unavailable is never treated as safe: the manifest is still
  // produced (Cloudflare being off must not hard-stop the whole layer, the
  // same degrade-gracefully rule content-moderation.ts itself already
  // follows), but the outcome is downgraded to PARTIAL so a caller can see
  // that policy review did not actually run for this manifest.
  if (safety.outcome === "unavailable") {
    return { outcome: "PARTIAL", manifest, reasonCodes: ["SPECIALIST_UNAVAILABLE:safety"] };
  }

  return { outcome: "VALID", manifest };
}
