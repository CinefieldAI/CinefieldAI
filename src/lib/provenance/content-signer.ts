import { createSign, createVerify, createPublicKey } from "node:crypto";

/**
 * Detached provenance signing (Phase 27-B).
 *
 * ---------------------------------------------------------------------------
 * NO KEY IS EVER GENERATED, STORED, OR DEFAULTED HERE
 * ---------------------------------------------------------------------------
 * 27-B's done criterion is literally "Signing key repoda yok ve rotation
 * sahibi tanımlı" — the signing key is not in the repository, and a rotation
 * owner is defined. Both are structural facts this file is built to keep
 * true:
 *
 *   - No key material appears in this file, this package, or this repository.
 *     `Es256Signer` RECEIVES a PEM it never persists; a test greps the whole
 *     tree for `BEGIN * PRIVATE KEY` and fails on a hit.
 *   - The key's name is registered in `secret-registry.ts` (Phase 25) with a
 *     rotation class and an owner, which is what makes the rotation owner
 *     "defined" — this package does not become a second key lifecycle owner.
 *     Phase 25's `secret.rotate` (Tier-0, two-person) remains the only path
 *     that rotates it.
 *   - The DEFAULT signer is `UnconfiguredSigner`, which signs nothing and
 *     says so. An unconfigured deployment records unsigned evidence and
 *     reports `EVIDENCE_RECORDED`, never a fabricated `SIGNED_DETACHED`.
 *
 * ---------------------------------------------------------------------------
 * ES256, AND WHY THIS IS NOT "C2PA SIGNING"
 * ---------------------------------------------------------------------------
 * The roadmap specifies ES256 ("Dev'de self-signed ES256"), so that is the
 * algorithm. But a real C2PA signature is a COSE structure embedded in the
 * asset by c2patool against a trust-list CA chain. This produces a DETACHED
 * ECDSA-P256 signature over `canonicalClaim()` — cryptographically real,
 * genuinely tamper-evident, and NOT interchangeable with a C2PA credential.
 * `ProvenanceMarkingState` keeps the two apart by name so no report can
 * blur them.
 */

export interface SignatureResult {
  readonly signature: string;
  /** Bounded identifier for the key that signed. NEVER key material. */
  readonly keyId: string;
}

export type SignOutcome =
  | { readonly ok: true; readonly result: SignatureResult }
  | { readonly ok: false; readonly reasonCode: "signer_not_configured" | "signing_failed" };

export interface ProvenanceSigner {
  /** Stable, bounded identity of this signer for audit/verification lookup. */
  readonly keyId: string | null;
  sign(claim: string): SignOutcome;
}

/**
 * The default. Always refuses, honestly.
 *
 * Same convention as `NoWorkerReloadVerifier` (Phase 25-C) and
 * `NoDeadCheckVerifier` (Phase 25-D): a seam that reports "not configured"
 * forever is safe; a seam that quietly returns success is the defect.
 */
export class UnconfiguredSigner implements ProvenanceSigner {
  readonly keyId = null;

  sign(): SignOutcome {
    return { ok: false, reasonCode: "signer_not_configured" };
  }
}

/**
 * A real ES256 signer over a caller-supplied PEM.
 *
 * The PEM comes from the Phase 25 secret provider at construction time and is
 * held only for this object's lifetime. It is never logged, never returned,
 * never written to a database, and never included in any error — the catch
 * below deliberately discards the underlying error rather than surfacing a
 * message that could echo key material.
 */
export class Es256Signer implements ProvenanceSigner {
  readonly keyId: string;
  #privateKeyPem: string;

  constructor(params: { privateKeyPem: string; keyId: string }) {
    this.#privateKeyPem = params.privateKeyPem;
    this.keyId = params.keyId;
  }

  sign(claim: string): SignOutcome {
    try {
      const signer = createSign("SHA256");
      signer.update(claim);
      signer.end();
      const signature = signer.sign(this.#privateKeyPem).toString("base64");
      return { ok: true, result: { signature, keyId: this.keyId } };
    } catch {
      // Never surface the underlying error — an OpenSSL message can contain
      // fragments of the key it failed to parse.
      return { ok: false, reasonCode: "signing_failed" };
    }
  }
}

/**
 * Verifies a detached signature against a PUBLIC key.
 *
 * Pure and side-effect free. Returns a plain boolean rather than throwing:
 * a bad signature is data, not an exception, and the caller
 * (`provenance-verifier.ts`) maps it to a bounded outcome.
 */
export function verifyEs256(params: {
  claim: string;
  signatureBase64: string;
  publicKeyPem: string;
}): boolean {
  try {
    const key = createPublicKey(params.publicKeyPem);
    const verifier = createVerify("SHA256");
    verifier.update(params.claim);
    verifier.end();
    return verifier.verify(key, Buffer.from(params.signatureBase64, "base64"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Module-level installed signer — same injection shape as `secret-access.ts`
// ---------------------------------------------------------------------------

let signer: ProvenanceSigner = new UnconfiguredSigner();

export function currentProvenanceSigner(): ProvenanceSigner {
  return signer;
}

/** Installing a real signer is a deliberate act, never a default. */
export function setProvenanceSigner(next: ProvenanceSigner): void {
  signer = next;
}

export function resetProvenanceSigner(): void {
  signer = new UnconfiguredSigner();
}
