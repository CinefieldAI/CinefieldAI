/**
 * Media type detection from bytes (Phase 9-B).
 *
 * WHY THIS EXISTS. `declared_content_type` is whatever the provider or the
 * browser said. Until now nothing checked it, and M3 is exactly that: a
 * response header decided how bytes would be stored and later served. A
 * `Content-Type: image/png` on an HTML document is a stored XSS waiting for
 * something to serve it inline.
 *
 * WHY IT IS DELIBERATELY PRIMITIVE. It reads a fixed-length prefix and
 * compares constant byte sequences. No allocation proportional to input, no
 * backtracking, no recursion, no container walking — so it cannot be made to
 * hang, blow the stack, or allocate a gigabyte on malformed input. That is
 * the property that matters here, not breadth of format support.
 *
 * It is NOT a parser and must never grow into one. Anything that needs to
 * decode a frame, read a moov atom, or count pages belongs in the FFmpeg lane
 * (9-C), inside the sandbox.
 *
 * WHY PLAIN .mjs AND NOT TypeScript. The sandbox child is spawned as a bare
 * `node` process — no tsx, no loader, no build step, because a sandbox that
 * depends on a dev toolchain is not one you can rely on in production. Both
 * the child and the app import THIS file, so there is exactly one detector
 * and no risk of the two drifting. `mime-detect.ts` is a typed re-export.
 *
 * NO IMPORTS AND NO SIDE EFFECTS.
 */

/**
 * @typedef {"image/jpeg"|"image/png"|"image/webp"|"image/gif"|"image/avif"
 *          |"video/mp4"|"video/webm"|"audio/mpeg"|"audio/wav"} VerifiedMime
 *
 * @typedef {"html"|"svg"|"script"|"executable"|"archive"|"pdf"|"office"} HostileKind
 *
 * @typedef {{outcome:"verified", mime:VerifiedMime}
 *          |{outcome:"hostile", kind:HostileKind}
 *          |{outcome:"unknown"}
 *          |{outcome:"empty"}} DetectionResult
 */

/**
 * @param {Uint8Array} bytes
 * @param {readonly number[]} signature
 * @param {number} [offset]
 * @returns {boolean}
 */
function startsWith(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * ASCII compare against a fixed window. Never scans the whole buffer.
 * @param {Uint8Array} bytes @param {string} text @param {number} offset
 * @returns {boolean}
 */
function asciiAt(bytes, text, offset) {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Leading ASCII whitespace and a UTF-8 BOM, bounded so an attacker cannot
 * make this walk a large buffer.
 * @param {Uint8Array} bytes @returns {number}
 */
function firstMeaningfulOffset(bytes) {
  let offset = 0;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) offset = 3;
  const whitespace = new Set([0x09, 0x0a, 0x0d, 0x20]);
  while (offset < Math.min(bytes.length, 64) && whitespace.has(bytes[offset])) offset += 1;
  return offset;
}

/** @param {Uint8Array} bytes @returns {HostileKind|null} */
function detectHostile(bytes) {
  // Windows PE / ELF / Mach-O / shebang. An "image" that starts with MZ is
  // not a corrupted image.
  if (startsWith(bytes, [0x4d, 0x5a])) return "executable";
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return "executable";
  if (startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe])) {
    return "executable";
  }
  if (startsWith(bytes, [0x23, 0x21])) return "script";

  // ZIP-family covers .zip, .docx, .xlsx, .jar — all archives as far as this
  // gate is concerned, and none of them are media.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return "archive";
  }
  if (startsWith(bytes, [0x1f, 0x8b])) return "archive";
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf])) return "archive";
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21])) return "archive";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  // Legacy OLE compound file: .doc/.xls/.ppt.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return "office";

  const start = firstMeaningfulOffset(bytes);
  // SVG IS ACTIVE CONTENT. It carries <script>, event handlers and external
  // references, so a browser rendering "an image" executes it. Refused
  // outright rather than allowlisted with sanitisation, because sanitising
  // SVG safely is its own project and nothing in Cinefield needs it.
  if (asciiAt(bytes, "<svg", start) || asciiAt(bytes, "<?xml", start)) return "svg";
  if (asciiAt(bytes, "<!DOCTYPE", start) || asciiAt(bytes, "<html", start)) return "html";
  if (asciiAt(bytes, "<!doctype", start) || asciiAt(bytes, "<HTML", start)) return "html";

  return null;
}

/**
 * Identifies the bytes, or refuses them.
 *
 * Hostile detection runs FIRST. A polyglot crafted to satisfy both an image
 * signature and an executable one must be refused, not accepted because the
 * friendly check happened to run earlier.
 *
 * @param {Uint8Array} bytes
 * @returns {DetectionResult}
 */
export function detectMediaType(bytes) {
  if (bytes.length === 0) return { outcome: "empty" };

  const hostile = detectHostile(bytes);
  if (hostile) return { outcome: "hostile", kind: hostile };

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { outcome: "verified", mime: "image/jpeg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { outcome: "verified", mime: "image/png" };
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { outcome: "verified", mime: "image/gif" };

  // RIFF....WEBP — the brand sits at offset 8, so both parts must match.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, "WEBP", 8)) {
    return { outcome: "verified", mime: "image/webp" };
  }
  // RIFF....WAVE
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, "WAVE", 8)) {
    return { outcome: "verified", mime: "audio/wav" };
  }

  // ISO base media: "ftyp" at offset 4, then the brand. AVIF and MP4 share
  // the container, so the brand is what separates them.
  if (asciiAt(bytes, "ftyp", 4)) {
    if (asciiAt(bytes, "avif", 8) || asciiAt(bytes, "avis", 8)) {
      return { outcome: "verified", mime: "image/avif" };
    }
    return { outcome: "verified", mime: "video/mp4" };
  }

  // EBML — Matroska/WebM. Distinguishing WebM from MKV needs a container
  // walk, which is a parser, which is 9-C.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { outcome: "verified", mime: "video/webm" };
  }

  // MP3: ID3 tag, or a raw frame sync.
  if (asciiAt(bytes, "ID3", 0)) return { outcome: "verified", mime: "audio/mpeg" };
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return { outcome: "verified", mime: "audio/mpeg" };
  }

  return { outcome: "unknown" };
}

/**
 * What Cinefield will store. Narrower than what the detector RECOGNISES, on
 * purpose: recognising a format is not a reason to accept it.
 *
 * @type {ReadonlySet<string>}
 */
export const ALLOWED_VERIFIED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
]);

/**
 * Whether a declared type is consistent with what the bytes actually are.
 *
 * Deliberately compares the CLASS, not the exact string. A provider that says
 * `image/jpg` for a JPEG, or `application/octet-stream` for anything, is
 * sloppy rather than hostile — while `image/png` on an MP4 is a mismatch
 * worth refusing. Both values are persisted either way, so the audit trail
 * keeps the disagreement.
 *
 * @param {string|null|undefined} declared
 * @param {VerifiedMime} verified
 * @returns {boolean}
 */
export function declarationMatches(declared, verified) {
  if (!declared) return true;

  const normalized = declared.toLowerCase().split(";")[0].trim();
  if (normalized === "application/octet-stream" || normalized === "binary/octet-stream") return true;
  if (normalized === verified) return true;

  return normalized.split("/")[0] === verified.split("/")[0];
}
