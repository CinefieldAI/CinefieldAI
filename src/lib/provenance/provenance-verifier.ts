import { canonicalClaim } from "./manifest-builder";
import { verifyEs256 } from "./content-signer";
import {
  formatSupport,
  type ProvenanceEvidence,
  type ProvenanceVerificationOutcome,
} from "./provenance-contract";

/**
 * Provenance verification (Phase 27-A/27-D).
 *
 * ---------------------------------------------------------------------------
 * PURE. NO I/O, NO CLOCK, NO NETWORK, NO DATABASE, NO REMOTE URL.
 * ---------------------------------------------------------------------------
 * Everything it reasons about arrives as an argument. In particular it never
 * fetches anything: verification takes a digest the caller already computed
 * through the Phase 9 seam, never a URL. There is no input to this function
 * that could become an SSRF path.
 *
 * ---------------------------------------------------------------------------
 * CALL ORDER IS THE FAIL-CLOSED GUARANTEE
 * ---------------------------------------------------------------------------
 * Mirrors `recovery-measurement-engine.ts` and `restore-verification-engine.
 * ts`: the order below IS the safety property, and `VERIFIED` is reachable
 * only by falling all the way through it.
 *
 *   1. no evidence at all                 -> MISSING_EVIDENCE
 *   2. format not recognised              -> UNSUPPORTED_FORMAT
 *   3. observed digest != recorded digest -> DIGEST_MISMATCH
 *   4. no signature recorded              -> SIGNER_UNAVAILABLE
 *   5. no trusted public key for keyId    -> UNTRUSTED_SIGNER
 *   6. signature fails                    -> INVALID_SIGNATURE
 *   7. everything above passed            -> VERIFIED
 *
 * Step 3 runs BEFORE any signature work on purpose. If the bytes changed,
 * the answer is "these are not the bytes that were signed" regardless of
 * whether the signature itself is well-formed — and reporting a crypto error
 * for a content substitution would point an investigation the wrong way.
 */

export interface VerifyProvenanceInput {
  /** `null` when no evidence row exists for the asset. */
  readonly evidence: ProvenanceEvidence | null;
  /**
   * SHA-256 recomputed over the bytes being verified, through the Phase 9
   * owner. Never derived inside this function — this package does not read
   * media.
   */
  readonly observedDigestSha256: string;
  /**
   * Trusted public keys by `keyId`. An empty map means no signer is trusted,
   * which yields `UNTRUSTED_SIGNER` — never a pass.
   */
  readonly trustedPublicKeys?: Readonly<Record<string, string>>;
}

export interface ProvenanceVerdict {
  readonly outcome: ProvenanceVerificationOutcome;
  readonly reasonCode: string;
  readonly mediaAssetId: string | null;
  readonly signerKeyId: string | null;
}

export function verifyProvenance(input: VerifyProvenanceInput): ProvenanceVerdict {
  const evidence = input.evidence;

  if (!evidence) {
    return {
      outcome: "MISSING_EVIDENCE",
      reasonCode: "no_provenance_evidence",
      mediaAssetId: null,
      signerKeyId: null,
    };
  }

  const base = { mediaAssetId: evidence.mediaAssetId, signerKeyId: evidence.signerKeyId };

  if (formatSupport(evidence.verifiedMime) === null) {
    return { outcome: "UNSUPPORTED_FORMAT", reasonCode: "format_not_recognised", ...base };
  }

  if (evidence.contentDigestSha256 !== input.observedDigestSha256) {
    return { outcome: "DIGEST_MISMATCH", reasonCode: "content_digest_changed", ...base };
  }

  if (!evidence.signature || !evidence.signerKeyId) {
    // Evidence exists and binds to these exact bytes, but nothing signed it.
    // Honest and useful — and specifically NOT `VERIFIED`, because an
    // unsigned record proves only that Cinefield wrote a row, not that the
    // row is authentic.
    return { outcome: "SIGNER_UNAVAILABLE", reasonCode: "evidence_unsigned", ...base };
  }

  const publicKeyPem = input.trustedPublicKeys?.[evidence.signerKeyId];
  if (!publicKeyPem) {
    return { outcome: "UNTRUSTED_SIGNER", reasonCode: "signer_key_not_trusted", ...base };
  }

  const claim = canonicalClaim({
    manifestVersion: evidence.manifestVersion,
    mediaAssetId: evidence.mediaAssetId,
    contentDigestSha256: evidence.contentDigestSha256,
    verifiedMime: evidence.verifiedMime,
    digitalSourceType: evidence.digitalSourceType,
    softwareAgent: evidence.softwareAgent,
    claimGenerator: evidence.claimGenerator,
  });

  if (!verifyEs256({ claim, signatureBase64: evidence.signature, publicKeyPem })) {
    return { outcome: "INVALID_SIGNATURE", reasonCode: "signature_did_not_verify", ...base };
  }

  return { outcome: "VERIFIED", reasonCode: "provenance_verified", ...base };
}
