import { DIGEST_PATTERN, COMMIT_SHA_PATTERN } from "./artifact-verification";

/**
 * Release provenance contract + verifier (Phase 24-B/24-C, code-only).
 *
 * Roadmap 24: "SBOM, signing, attestation ve provenance Phase 24'te
 * eklenir." 24-B done-criterion: "Artifact commit SHA ve workflow ile
 * doğrulanabiliyor." 24-C done-criterion: "Doğrulanmamış artifact
 * production'a çıkamıyor."
 *
 * ---------------------------------------------------------------------------
 * WHERE THE REAL SIGNING HAPPENS: NOT HERE
 * ---------------------------------------------------------------------------
 * This module issues no signature and calls no signing service. The real
 * attestation is produced by `.github/workflows/supply-chain-ci.yml` via
 * `actions/attest-build-provenance` — GitHub's own keyless (Sigstore-backed,
 * GitHub OIDC) build-provenance mechanism, the one tool the roadmap names
 * ("GitHub Artifact Attestations"). That workflow also independently
 * verifies its own attestation via `gh attestation verify` before the job
 * can succeed — a real cryptographic check this module does not
 * re-implement. This module is the code-owned, testable HALF of 24-B/24-C:
 * the bounded record shape evidence is reported in, and a pure structural
 * verifier over that shape — the same "decide, never execute or sign" split
 * `artifact-verification.ts` (14-E) and `deployment-guard.ts` (14-D)
 * already established for this exact directory.
 *
 * ---------------------------------------------------------------------------
 * REUSES 14-E, DOES NOT DUPLICATE IT
 * ---------------------------------------------------------------------------
 * `DIGEST_PATTERN`/`COMMIT_SHA_PATTERN` are imported, not redefined.
 * `ArtifactIdentity.provenanceRef` (14-E) is exactly what this module's
 * `attestationSubjectDigest` is meant to fill — 14-E's own header already
 * says "Phase 24 issues these; 14-E only requires one to exist." This module
 * is that issuer's bounded evidence shape, not a second artifact-identity
 * concept.
 *
 * ---------------------------------------------------------------------------
 * HONEST SCOPE: MERGE-TO-MAIN, NOT A SEPARATE PRODUCTION DEPLOY STEP
 * ---------------------------------------------------------------------------
 * This repository has no application-level production-deploy execution path
 * (`deployment-policy-gate.ts`'s own header — deploys happen externally via
 * Vercel). The practical, honest place "before production" maps to in THIS
 * architecture is merge-to-main, since Vercel auto-deploys from main. The
 * supply-chain-ci workflow's verify step is wired as a required PR check
 * (via `required-checks.ts`'s `supply_chain_scan`), not a fabricated
 * post-merge production gate this codebase does not actually control.
 */

export type ReleaseProvenanceVerificationState = "VERIFIED" | "INVALID" | "MISSING_EVIDENCE" | "UNSUPPORTED" | "UNAVAILABLE";

export type ReleaseProvenanceRefusal =
  | "record_missing"
  | "digest_missing"
  | "digest_malformed"
  | "commit_sha_missing"
  | "commit_sha_malformed"
  | "commit_mismatch"
  | "workflow_run_missing"
  | "attestation_subject_missing"
  | "attestation_subject_mismatch";

/**
 * Bounded release-metadata evidence, written by the CI workflow's
 * "Record release metadata" step (see supply-chain-ci.yml) to a workflow
 * artifact + step summary — never read live by this application today (no
 * GitHub Actions run-history integration exists; see
 * `deploy-restore-admin-contract.ts`'s honest `PROVENANCE_EVIDENCE_
 * UNAVAILABLE` state). Deliberately excludes anything from the forbidden
 * list: no prompt, no provider payload, no signed URL, no credential, no
 * session claim, no private key, no access token — every field here is a
 * commit-shaped id, a digest, a URL to a PUBLIC GitHub Actions run page, or
 * a timestamp.
 */
export interface ReleaseProvenanceRecord {
  /** The SBOM/build-info file this record is about — a filename, not a secret path. */
  readonly artifactId: string;
  /** sha256 digest of that file's bytes, computed in CI. */
  readonly digest: string;
  readonly commitSha: string;
  readonly workflowRunId: string;
  /** Public GitHub Actions run URL — never a signed/private URL. */
  readonly workflowRunUrl: string;
  readonly environment: string;
  readonly buildTimestamp: string;
  /**
   * The subject digest GitHub Artifact Attestations recorded for this
   * artifact, once `gh attestation verify` has independently confirmed it
   * in CI. Absent until that step has run — never fabricated by this
   * module.
   */
  readonly attestationSubjectDigest?: string;
}

export interface ReleaseProvenanceVerificationResult {
  readonly state: ReleaseProvenanceVerificationState;
  readonly refusals: readonly ReleaseProvenanceRefusal[];
}

/**
 * Verifies a release-provenance record's SHAPE and internal consistency
 * against an expected commit — never a cryptographic signature check (that
 * already happened in CI via `gh attestation verify`; re-deriving it here
 * without the real transparency-log/OIDC material would be exactly the
 * "reinvent crypto we don't need to" failure mode this module's header
 * warns against).
 *
 * FAILS CLOSED IN EVERY DIRECTION, matching `verifyArtifact()`'s own
 * discipline: a missing record, a missing/malformed digest, a missing
 * attestation subject, or a commit mismatch — all block. `VERIFIED` is
 * returned from exactly one place, reached only once every check passed.
 */
export function verifyReleaseProvenance(
  record: ReleaseProvenanceRecord | null | undefined,
  expectedCommitSha: string
): ReleaseProvenanceVerificationResult {
  if (!record) return { state: "MISSING_EVIDENCE", refusals: ["record_missing"] };

  const refusals: ReleaseProvenanceRefusal[] = [];

  if (!record.digest) refusals.push("digest_missing");
  else if (!DIGEST_PATTERN.test(record.digest)) refusals.push("digest_malformed");

  if (!record.commitSha) refusals.push("commit_sha_missing");
  else if (!COMMIT_SHA_PATTERN.test(record.commitSha)) refusals.push("commit_sha_malformed");
  else if (!expectedCommitSha || record.commitSha.toLowerCase() !== expectedCommitSha.toLowerCase()) {
    refusals.push("commit_mismatch");
  }

  if (!record.workflowRunId || !record.workflowRunUrl) refusals.push("workflow_run_missing");

  if (!record.attestationSubjectDigest) {
    refusals.push("attestation_subject_missing");
  } else if (!DIGEST_PATTERN.test(record.attestationSubjectDigest)) {
    refusals.push("attestation_subject_mismatch");
  } else if (
    // Only compare against the record's own digest when THAT digest is
    // itself present and well-formed — otherwise a missing/malformed own
    // digest would also spuriously report as a "mismatch" against nothing,
    // muddying a MISSING_EVIDENCE case into INVALID for the wrong reason.
    record.digest &&
    DIGEST_PATTERN.test(record.digest) &&
    normalizeDigest(record.attestationSubjectDigest) !== normalizeDigest(record.digest)
  ) {
    refusals.push("attestation_subject_mismatch");
  }

  if (refusals.length === 0) return { state: "VERIFIED", refusals: [] };

  // MISSING_EVIDENCE (nothing usable was supplied) vs. INVALID (something
  // was supplied but it does not check out) — the same distinction
  // `artifact-verification.ts` draws between `digest_missing` and
  // `digest_mismatch`, kept explicit here rather than folded into one code.
  const onlyMissingEvidence = refusals.every((r) =>
    ["digest_missing", "commit_sha_missing", "workflow_run_missing", "attestation_subject_missing", "record_missing"].includes(r)
  );
  return { state: onlyMissingEvidence ? "MISSING_EVIDENCE" : "INVALID", refusals };
}

function normalizeDigest(value: string): string {
  return value.trim().toLowerCase().replace(/^sha256:/, "");
}
