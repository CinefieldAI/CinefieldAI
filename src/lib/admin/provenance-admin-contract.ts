import type {
  DigitalSourceType,
  DisclosureRequirement,
  ProvenanceMarkingState,
} from "@/lib/provenance/provenance-contract";

/**
 * Phase 27-D Admin provenance / marking-coverage contract — read-only.
 *
 * Mirrors `game-day-admin-contract.ts`'s own shape. Bounded to exactly the
 * fields section 31 permits: media id, generation id, digest state, credential
 * state, signer/trust state, verification state, createdAt. No object key, no
 * bucket, no prompt, no token, no signature material beyond a presence flag.
 */
export interface ProvenanceCoverage {
  readonly totalFinalizedAssets: number;
  readonly markedAssets: number;
  readonly signedAssets: number;
  /** Marked / total, 0–1, rounded to 4dp. `null` when there is nothing to divide. */
  readonly markedRatio: number | null;
  readonly embeddedC2paAssets: number;
}

export interface ProvenanceRow {
  readonly mediaAssetId: string;
  readonly generationId: string | null;
  readonly markingState: ProvenanceMarkingState;
  readonly digitalSourceType: DigitalSourceType;
  readonly verifiedMime: string;
  readonly formatSupport: string;
  /** Presence only — the signature itself is never sent to a browser. */
  readonly signed: boolean;
  readonly signerKeyId: string | null;
  readonly disclosureRequirement: DisclosureRequirement;
  readonly createdAt: string;
}

export interface ProvenanceAdminView {
  readonly coverage: ProvenanceCoverage;
  readonly recent: readonly ProvenanceRow[];
  /**
   * Honest status of the embedding path. Always false today: the roadmap
   * places the C2PA embed step after FFmpeg, and Phase 9-C is unbuilt.
   */
  readonly embeddingPipelineAvailable: boolean;
  /** Whether a real signer is installed. False on an unconfigured deployment. */
  readonly signerConfigured: boolean;
}

export type ProvenanceAdminResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly view: ProvenanceAdminView };
