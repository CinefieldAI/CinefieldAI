/**
 * Artifact verification gate (Phase 14-E, code-only).
 *
 * Roadmap 14-E: "Artifact Attestation/SBOM/build provenance + OPA policy
 * gate'i AI fix dahil tüm deploymentlara uygula." Done-criterion:
 * "Doğrulanmamış artifact prod'a çıkamıyor" — an unverified artifact cannot
 * reach production. ¶431: verify attestation/digest before production deploy
 * and block what fails. ¶432: AI fix PRs go through the SAME gates, with no
 * bypass authority.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LANDS BEFORE 14-D AND NOT AFTER
 * ---------------------------------------------------------------------------
 * A Deployment Guard that approves a release without ever asking WHAT is
 * being deployed is dishonest by construction — it would answer "safe to
 * deploy" having verified only the process, never the payload. 14-D consumes
 * this gate's verdict as a required input, so the verdict has to exist first.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT: PHASE 24
 * ---------------------------------------------------------------------------
 * No signing, no key material, no SBOM generation, no attestation issuance,
 * no transparency log. Phase 24 owns the deep supply-chain program. This is
 * the narrow slice 14-E's own text asks for: given an artifact and what a
 * candidate CLAIMS about it, do they match, and is the claim usable? Digest
 * comparison and lineage binding, nothing more.
 */

/** Four states. UNKNOWN is not a synonym for UNVERIFIED — see below. */
export type ArtifactVerificationStatus = "UNVERIFIED" | "VERIFIED" | "REJECTED" | "UNKNOWN";

export type ArtifactRefusal =
  | "artifact_missing"
  | "artifact_unverified"
  | "artifact_rejected"
  | "artifact_status_unknown"
  | "digest_missing"
  | "digest_mismatch"
  | "commit_mismatch"
  | "lineage_mismatch"
  | "provenance_missing";

/**
 * Bounded artifact identity.
 *
 * `digest` is the identity that matters. A filename is not an identity — two
 * different builds produce the same filename — and neither is a PR number,
 * which identifies an intent to change rather than the bytes produced from
 * it. Both are deliberately absent from the comparison below.
 */
export interface ArtifactIdentity {
  readonly artifactId: string;
  /** Content digest. The only field that identifies the BYTES. */
  readonly digest: string;
  /** The commit these bytes were built from. */
  readonly commitSha: string;
  /** The build that produced them, for lineage. */
  readonly buildId: string;
  readonly status: ArtifactVerificationStatus;
  /** Reference to an attestation record. Phase 24 owns issuing them. */
  readonly provenanceRef?: string;
}

/**
 * What the deployment candidate believes it is deploying.
 *
 * Supplied independently of the artifact. The gate's whole job is to check
 * that these two agree — a claim that matches itself proves nothing.
 */
export interface CandidateClaim {
  readonly commitSha: string;
  readonly digest: string;
  /** The build the candidate's CI/preview lineage actually produced. */
  readonly buildId: string;
}

export interface ArtifactVerificationResult {
  readonly verified: boolean;
  readonly refusals: readonly ArtifactRefusal[];
}

/** Digests are hex of a known length. Anything else is not a digest. */
export const DIGEST_PATTERN = /^(sha256:)?[a-f0-9]{64}$/i;
export const COMMIT_SHA_PATTERN = /^[a-f0-9]{7,40}$/i;

function normalizeDigest(value: string): string {
  return value.trim().toLowerCase().replace(/^sha256:/, "");
}

/**
 * Verifies an artifact against what the candidate claims.
 *
 * FAILS CLOSED IN EVERY DIRECTION. A missing artifact, a missing digest, an
 * `UNKNOWN` status, a mismatch of any kind — all block. There is deliberately
 * no "looks close enough" path and no default-allow branch: the function
 * returns `verified: true` from exactly one place, reached only when every
 * check passed.
 *
 * `UNKNOWN` blocks with its own distinct code rather than being folded into
 * `UNVERIFIED`. They mean different things to whoever reads the refusal —
 * "we asked and the answer was no" versus "we could not find out" — and the
 * second is the one that usually means something is misconfigured.
 */
export function verifyArtifact(
  artifact: ArtifactIdentity | null | undefined,
  claim: CandidateClaim
): ArtifactVerificationResult {
  const refusals: ArtifactRefusal[] = [];

  if (!artifact) return { verified: false, refusals: ["artifact_missing"] };

  // 1. Status. Only VERIFIED may proceed; the other three each block for a
  //    reason worth telling apart.
  if (artifact.status === "UNVERIFIED") refusals.push("artifact_unverified");
  else if (artifact.status === "REJECTED") refusals.push("artifact_rejected");
  else if (artifact.status !== "VERIFIED") refusals.push("artifact_status_unknown");

  // 2. A digest must exist and be shaped like one on BOTH sides. An absent
  //    or malformed digest is not a mismatch, it is an unusable claim.
  if (!artifact.digest || !DIGEST_PATTERN.test(artifact.digest)) refusals.push("digest_missing");
  else if (!claim.digest || !DIGEST_PATTERN.test(claim.digest)) refusals.push("digest_missing");
  else if (normalizeDigest(artifact.digest) !== normalizeDigest(claim.digest)) {
    // The bytes are not the bytes that were approved.
    refusals.push("digest_mismatch");
  }

  // 3. A verified artifact from commit A cannot authorize commit B.
  if (
    !artifact.commitSha ||
    !COMMIT_SHA_PATTERN.test(artifact.commitSha) ||
    !claim.commitSha ||
    artifact.commitSha.toLowerCase() !== claim.commitSha.toLowerCase()
  ) {
    refusals.push("commit_mismatch");
  }

  // 4. Lineage: the artifact must be the one THIS candidate's CI/preview
  //    produced. Without this a stale-but-verified artifact from an earlier
  //    green build could ride along with a newer, unbuilt commit.
  if (!artifact.buildId || artifact.buildId !== claim.buildId) refusals.push("lineage_mismatch");

  // 5. A verified artifact with no provenance reference is a claim with no
  //    backing. Phase 24 issues these; 14-E only requires one to exist.
  if (artifact.status === "VERIFIED" && !artifact.provenanceRef) refusals.push("provenance_missing");

  return { verified: refusals.length === 0, refusals };
}
