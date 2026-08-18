import type { GenerationType, WorkflowType } from "@/lib/orchestration/types";

/**
 * Cinefield Product Intelligence — GenerationManifest contract (Phase 17).
 *
 * The Manifest Compiler's OUTPUT. A GenerationManifest describes WHAT should
 * be generated — never HOW it is executed. It carries no provider identity,
 * no queue/transport detail, no Temporal state, no retry counter, no billing
 * settlement state, and no raw provider response. Those all remain owned by
 * the existing orchestration/Temporal/billing layers untouched by Phase 17
 * (see docs/architecture/CINEFIELD_ARCHITECTURE_CONTRACT.md, Phase 17
 * section).
 *
 * Provider-neutral by construction: no field here is named after or scoped
 * to a specific provider (no `fal.*`, `runway.*`, `openai.*`, `xai.*`,
 * `providerJobId`, `providerUrl`, ...). The one provider-adjacent fact this
 * layer is allowed to know — the Cinefield model id — is the same
 * registry-internal id generation-create-service.ts already accepts from
 * clients today; it names a Cinefield concept, not a provider one.
 */

export const GENERATION_MANIFEST_VERSION = "1.0.0";

/**
 * Bounded outcome enum (Phase 17 brief, failure semantics). PROFILE_NOT_FOUND
 * is included per the brief's own enum even though the Phase 17 reality
 * audit confirmed no Studio Profile concept exists yet (MISSING) — it is
 * intentionally unreachable in this batch (UserIntent has no profile
 * reference to fail on) and is reserved for when a profile system exists.
 */
export type ManifestOutcome =
  | "VALID"
  | "PARTIAL"
  | "UNSUPPORTED_CAPABILITY"
  | "INVALID_INTENT"
  | "POLICY_REFUSED"
  | "PROFILE_NOT_FOUND"
  | "CONFLICTING_CONTROLS"
  | "COMPILER_UNAVAILABLE"
  | "SPECIALIST_UNAVAILABLE";

/**
 * Where one manifest field's final value came from. Bounded decision codes
 * only — never chain-of-thought or free-text reasoning (Phase 17
 * reproducibility/explainability rule).
 */
export type ManifestFieldSource = "explicit_user" | "specialist_suggested" | "registry_default";

export interface ManifestFieldProvenance {
  field: string;
  source: ManifestFieldSource;
}

export interface ManifestSettings {
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  outputCount?: number;
  thinking?: string;
  seed?: number;
  voice?: string;
  language?: string;
}

export interface ManifestReference {
  storagePath: string;
  mimeType: string;
}

/**
 * WHAT should be generated. Deliberately excludes: provider, credentials,
 * queue receipt, Temporal state, retry counter, billing settlement state,
 * raw provider response — those are lifecycle-owner fields Phase 17 must
 * never hold (binding ownership rule, Phase 17 brief).
 */
export interface GenerationManifest {
  manifestVersion: typeof GENERATION_MANIFEST_VERSION;
  intentId: string;
  projectId: string;
  generationType: GenerationType;
  workflow: WorkflowType;
  /** Cinefield registry model id — the same id space model-registry.ts already defines. Never a provider-native id. */
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  settings: ManifestSettings;
  references: ManifestReference[];
  provenance: ManifestFieldProvenance[];
  /** Safety Specialist's verdict. "unavailable" is never treated as "safe" — see manifest-compiler.ts. */
  policyCheck: { outcome: "safe" | "flagged" | "unavailable" };
}

/** What the Manifest Compiler returns for every intent — a manifest, or a bounded refusal. Never throws. */
export type ManifestCompileResult =
  | { outcome: "VALID"; manifest: GenerationManifest }
  | { outcome: "PARTIAL"; manifest: GenerationManifest; reasonCodes: string[] }
  | { outcome: Exclude<ManifestOutcome, "VALID" | "PARTIAL">; reasonCodes: string[] };
