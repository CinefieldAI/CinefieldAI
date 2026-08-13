/**
 * Typed surface for the media type detector (Phase 9-B).
 *
 * The implementation lives in `mime-detect.mjs` and is deliberately plain
 * JavaScript: the sandbox child is spawned as a bare `node` process, with no
 * tsx, no loader and no build step, because a sandbox that depends on a dev
 * toolchain is not one you can rely on in production. Both the child and the
 * application import that same file, so there is exactly one detector and the
 * two sides cannot drift.
 *
 * This module adds nothing but types.
 */

export type VerifiedMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/avif"
  | "video/mp4"
  | "video/webm"
  | "audio/mpeg"
  | "audio/wav";

export type HostileKind =
  | "html"
  | "svg"
  | "script"
  | "executable"
  | "archive"
  | "pdf"
  | "office";

export type DetectionResult =
  | { outcome: "verified"; mime: VerifiedMime }
  | { outcome: "hostile"; kind: HostileKind }
  | { outcome: "unknown" }
  | { outcome: "empty" };

import * as detector from "./mime-detect.mjs";

export const detectMediaType = detector.detectMediaType as (bytes: Uint8Array) => DetectionResult;

export const ALLOWED_VERIFIED_MIMES = detector.ALLOWED_VERIFIED_MIMES as ReadonlySet<string>;

export const declarationMatches = detector.declarationMatches as (
  declared: string | null | undefined,
  verified: VerifiedMime
) => boolean;
