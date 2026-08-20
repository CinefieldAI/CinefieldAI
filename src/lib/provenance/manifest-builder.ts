import {
  CLAIM_GENERATOR,
  digitalSourceTypeUri,
  type C2paManifest,
  type DigitalSourceType,
} from "./provenance-contract";

/**
 * C2PA manifest builder (Phase 27-A).
 *
 * Pure. No I/O, no clock, no crypto, no database. Produces exactly the
 * structure the roadmap's own "Nasıl yapılacak" step 2 specifies, and one
 * canonical serialization of it for signing.
 *
 * ---------------------------------------------------------------------------
 * ONE MANIFEST SHAPE FOR IMAGE, VIDEO AND AUDIO
 * ---------------------------------------------------------------------------
 * 27-A asks for an "image/video/audio manifest template". They are the SAME
 * template: what differs between an MP4 and a WAV is the container's ability
 * to carry the manifest (see `FORMAT_PROVENANCE_SUPPORT`), never the
 * assertion. `c2pa.created` with an IPTC `digitalSourceType` says "a trained
 * model made this" identically for all three, and forking it per media type
 * would produce three vocabularies that drift.
 */

/** Bounded: a model/provider label an external reader can interpret. Never a payload. */
const SOFTWARE_AGENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ()._/-]{0,120}$/;

export interface BuildManifestInput {
  readonly digitalSourceType: DigitalSourceType;
  /**
   * Roadmap's literal example: "Cinefield (model via provider)". A model or
   * provider identity is permitted here; a prompt, a payload or a credential
   * is refused by `SOFTWARE_AGENT_PATTERN`.
   */
  readonly softwareAgent: string;
}

export type BuildManifestResult =
  | { readonly ok: true; readonly manifest: C2paManifest }
  | { readonly ok: false; readonly reasonCode: "software_agent_malformed" };

export function buildC2paManifest(input: BuildManifestInput): BuildManifestResult {
  if (!SOFTWARE_AGENT_PATTERN.test(input.softwareAgent)) {
    return { ok: false, reasonCode: "software_agent_malformed" };
  }

  return {
    ok: true,
    manifest: {
      claim_generator: CLAIM_GENERATOR,
      assertions: [
        {
          label: "c2pa.actions",
          data: {
            actions: [
              {
                action: "c2pa.created",
                digitalSourceType: digitalSourceTypeUri(input.digitalSourceType),
                softwareAgent: input.softwareAgent,
              },
            ],
          },
        },
      ],
    },
  };
}

/**
 * The exact bytes a signature covers.
 *
 * ---------------------------------------------------------------------------
 * WHY A HAND-WRITTEN CANONICAL FORM RATHER THAN JSON.stringify(manifest)
 * ---------------------------------------------------------------------------
 * A signature must cover the CONTENT DIGEST too, not just the manifest —
 * otherwise the same signed manifest could be lifted onto different bytes and
 * still verify, which is the one attack this whole package exists to prevent.
 * And it must be byte-stable: `JSON.stringify` preserves insertion order, so
 * two structurally identical manifests built by different code paths could
 * serialize differently and fail verification for no real reason.
 *
 * So the claim is a fixed, ordered, newline-delimited field list. Adding a
 * field is a `MANIFEST_VERSION` bump, and the version is inside the signed
 * bytes — an old signature cannot silently validate against a new shape.
 */
export interface CanonicalClaimInput {
  readonly manifestVersion: string;
  readonly mediaAssetId: string;
  readonly contentDigestSha256: string;
  readonly verifiedMime: string;
  readonly digitalSourceType: DigitalSourceType;
  readonly softwareAgent: string;
  readonly claimGenerator: string;
}

export function canonicalClaim(input: CanonicalClaimInput): string {
  return [
    `v=${input.manifestVersion}`,
    `asset=${input.mediaAssetId}`,
    `digest=${input.contentDigestSha256}`,
    `mime=${input.verifiedMime}`,
    `dst=${input.digitalSourceType}`,
    `agent=${input.softwareAgent}`,
    `gen=${input.claimGenerator}`,
  ].join("\n");
}
