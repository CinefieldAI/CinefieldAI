import { createHash } from "node:crypto";

/**
 * Cinefield idempotency identity composition (Phase 6R-E / v1.6 6R.24).
 *
 * WHAT WAS WRONG WITH A BARE CLIENT KEY
 * `idempotency-store.ts` claims an identity string, and until now callers
 * were free to pass a client-supplied UUID straight through. Two failures
 * follow from that, and neither is exotic:
 *
 *   1. CROSS-TENANT COLLISION. Two users send the same key — deliberately or
 *      by picking a non-random one — and the second gets the first's claim.
 *      In a system where a claim gates a paid generation, that is one user
 *      reading another's result.
 *   2. KEY REUSE WITH A DIFFERENT REQUEST. The same client retries with an
 *      edited prompt but the same key, and gets back a result for the
 *      request it no longer wants. The key stops meaning "this operation"
 *      and starts meaning "whatever ran first".
 *
 * The identity therefore binds THREE things:
 *
 *   client key   + authenticated actor + canonical request hash
 *
 * The actor comes from the verified server-side session, never from the
 * request body. The canonical hash is computed from the request Cinefield
 * actually intends to run, after normalization — so a reordered JSON object
 * is the same request, and a changed prompt is not.
 *
 * PURE AND DEPENDENCY-FREE. No Redis, no I/O, no environment. It computes an
 * identifier; the store decides what to do with it.
 */

/** Matches redis-keys.ts's IDENTIFIER_PATTERN, so the output is always a legal key segment. */
const IDENTIFIER_SAFE = /^[A-Za-z0-9_-]{1,128}$/;

/** Bounds a client key before it is hashed. Long enough for a UUID and then some. */
const MAX_CLIENT_KEY_LENGTH = 200;

export interface IdempotencyIdentityInput {
  /** The caller's own key for one intent. Bounded, never trusted alone. */
  clientKey: string;
  /**
   * The AUTHENTICATED actor. Must come from a verified server-side session.
   *
   * Cinefield's tenant unit today is the Clerk user id; when a workspace
   * column lands (6R.21) this becomes `<workspaceId>:<userId>` and every
   * previously issued identity changes with it — which is correct, because
   * the scope it protects genuinely changed.
   */
  actorId: string;
  /** The canonical, server-normalized request. Key order is irrelevant. */
  canonicalRequest: unknown;
}

/**
 * Stable JSON: object keys sorted at every depth, so two structurally equal
 * requests hash identically regardless of how they were serialized.
 *
 * Arrays keep their order on purpose — element order is meaningful in a
 * request (input files, for one) and sorting it would make two genuinely
 * different requests collide.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` disappears in JSON anyway; dropping it here keeps
    // {a:1} and {a:1,b:undefined} from hashing differently.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** SHA-256 of the canonical form. Hex, so it is always identifier-safe. */
export function canonicalRequestHash(request: unknown): string {
  return createHash("sha256").update(canonicalJson(request), "utf8").digest("hex");
}

export type IdempotencyIdentityResult =
  | { ok: true; identity: string; requestHash: string }
  | { ok: false; reason: "invalid_client_key" | "invalid_actor" };

/**
 * Derives the identity the store should claim.
 *
 * The result is a hash of all three inputs rather than a readable
 * concatenation, for two reasons: it is always a legal Redis key segment
 * whatever the inputs contained, and it does not write an actor id into a key
 * that ends up in logs and metrics.
 *
 * Because the hash covers the request, the SAME key with a DIFFERENT request
 * produces a DIFFERENT identity — so it does not collide with, and cannot
 * return, the first request's result. Detecting that as an explicit "key
 * reused with a different payload" rejection needs a stored reverse mapping;
 * see `bindsSameOperation` below for the check callers should make when they
 * have the prior record.
 */
export function deriveIdempotencyIdentity(
  input: IdempotencyIdentityInput
): IdempotencyIdentityResult {
  const clientKey = input.clientKey?.trim() ?? "";
  const actorId = input.actorId?.trim() ?? "";

  if (clientKey.length === 0 || clientKey.length > MAX_CLIENT_KEY_LENGTH) {
    return { ok: false, reason: "invalid_client_key" };
  }
  if (actorId.length === 0 || actorId.length > MAX_CLIENT_KEY_LENGTH) {
    return { ok: false, reason: "invalid_actor" };
  }

  const requestHash = canonicalRequestHash(input.canonicalRequest);

  // Length-prefixed so no combination of inputs can impersonate another by
  // moving the boundary between fields.
  const material = [
    `k${clientKey.length}:${clientKey}`,
    `a${actorId.length}:${actorId}`,
    `r${requestHash.length}:${requestHash}`,
  ].join("|");

  const identity = createHash("sha256").update(material, "utf8").digest("hex");
  // Hex of a SHA-256 is 64 chars — comfortably inside IDENTIFIER_PATTERN.
  if (!IDENTIFIER_SAFE.test(identity)) {
    throw new Error("idempotency-identity: derived identity is not identifier-safe");
  }

  return { ok: true, identity, requestHash };
}

/**
 * Whether a stored claim describes the SAME operation as the one now being
 * attempted.
 *
 * Callers that persist the request hash alongside a claim use this to turn a
 * silent divergence into an explicit refusal: same key, same actor, different
 * request means the client reused a key it should not have, and returning the
 * earlier result would answer a question nobody asked.
 */
export function bindsSameOperation(storedRequestHash: string, attemptedRequestHash: string): boolean {
  // Constant-time-ish is unnecessary here (neither value is a secret), but
  // exact equality is: a prefix match would defeat the whole point.
  return storedRequestHash === attemptedRequestHash;
}
