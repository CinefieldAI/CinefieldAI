import "server-only";

/**
 * Canonical R2 object keys (Phase 9-A).
 *
 * THE KEY IS SERVER PROPERTY. A browser may say what it wants to upload; it
 * may never say where. Letting a client choose the key is how one tenant
 * writes into another's namespace, how a traversal escapes the prefix, and
 * how an upload silently overwrites an existing asset. Security gate 4 is
 * explicit: "objectKey server tarafında üretilir; istemci belirleyemez."
 *
 * WHAT REPLACED WHAT
 * The Supabase path builder hardcoded `mock-output-` into every object name —
 * for every provider, including real ones. The Phase 8-A live fal validation
 * stored a genuine 308 KB provider image under a filename that says "mock".
 * Anyone auditing by filename would read it exactly backwards. Provenance is
 * not a filename: it lives in `media_assets`, where it can be queried and
 * cannot be inferred wrongly.
 *
 * The scheme is provider-neutral on purpose. A key that named its provider
 * would go stale the moment a route changed, and would leak the commercial
 * shape of the platform to anyone who ever saw a URL.
 */

/** Where an asset came from. Decides the top-level lane, and nothing else. */
export type AssetSource = "provider_output" | "browser_upload" | "internal";

/**
 * What this object IS relative to its asset. `original` is the bytes as
 * received; derived variants (thumbnail, preview, transcode) arrive in 9-C
 * and hang off the same asset id.
 */
export type AssetRole = "original" | "derived";

export interface AssetKeyParams {
  /** Tenant scope. Every key starts here, so a prefix is a tenant boundary. */
  ownerId: string;
  assetId: string;
  source: AssetSource;
  role: AssetRole;
  /** Lowercase, dot-free, already validated by `safeExtension`. */
  extension: string;
  /** Only for derived variants, e.g. "thumb". Ignored for originals. */
  variant?: string;
}

/**
 * Lane prefixes carry the roadmap's quarantine vocabulary verbatim, because
 * the two lanes are genuinely different trust stories and the red note is
 * explicit that merging their labels is a mistake:
 *
 *   provider output  → QUARANTINE / OUTPUT (INGEST)
 *   browser upload   → QUARANTINE / INPUT
 *
 * Nothing here implements the quarantine WORKFLOW — that is 9-E. This is the
 * naming that keeps 9-B and 9-E from having to rewrite every key later.
 */
const LANE: Record<AssetSource, string> = {
  provider_output: "quarantine/output",
  browser_upload: "quarantine/input",
  internal: "internal",
};

/** Anything not in this set cannot appear anywhere in a key we generate. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Reduces a client-supplied filename to an extension we are willing to write.
 *
 * The filename itself never reaches the key. Only the extension survives, and
 * only if it is short and alphanumeric — so `../../etc/passwd`, a name with a
 * NUL, and `file.php%00.png` all collapse to either a plain extension or the
 * fallback. Extension is presentation metadata; it asserts nothing about the
 * bytes, which is 9-B's job.
 */
export function safeExtension(candidate: string | undefined, fallback = "bin"): string {
  if (!candidate) return fallback;

  const trimmed = candidate.trim().toLowerCase();
  const dot = trimmed.lastIndexOf(".");
  const raw = dot >= 0 ? trimmed.slice(dot + 1) : trimmed;

  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : fallback;
}

/**
 * Builds the one canonical key for an asset object.
 *
 * Deterministic: the same asset id and role always produce the same key, so a
 * retry re-writes the same object instead of littering the bucket with
 * near-duplicates. That is what makes replay safe (see the finalization
 * boundary) — the asset id is the identity, not the upload attempt.
 */
export function buildAssetObjectKey(params: AssetKeyParams): string {
  const { ownerId, assetId, source, role, extension } = params;

  for (const [name, value] of [
    ["ownerId", ownerId],
    ["assetId", assetId],
  ] as const) {
    if (!SAFE_SEGMENT.test(value)) {
      // Not a user-facing case: these are server-derived ids. Failing loudly
      // beats writing a key nobody can address.
      throw new Error(`unsafe_key_segment_${name}`);
    }
  }

  const ext = safeExtension(extension);
  const lane = LANE[source];

  if (role === "original") {
    return `${lane}/${ownerId}/${assetId}/original.${ext}`;
  }

  const variant = params.variant && SAFE_SEGMENT.test(params.variant) ? params.variant : "derived";
  return `${lane}/${ownerId}/${assetId}/derived/${variant}.${ext}`;
}

/**
 * True when a key belongs to this owner's namespace.
 *
 * Used to refuse a key that arrived from anywhere but `buildAssetObjectKey` —
 * defence in depth for the presign endpoint, which must never sign a key it
 * did not itself produce.
 */
export function keyBelongsToOwner(objectKey: string, ownerId: string): boolean {
  if (!SAFE_SEGMENT.test(ownerId)) return false;
  if (objectKey.includes("..") || objectKey.includes("//")) return false;

  return Object.values(LANE).some((lane) => objectKey.startsWith(`${lane}/${ownerId}/`));
}
