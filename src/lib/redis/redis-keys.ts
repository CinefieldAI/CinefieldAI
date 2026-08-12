import "server-only";

/**
 * Cinefield Redis keyspace contract (Phase 6R.7 — Redis Application State).
 *
 * The single place every Redis key Cinefield ever writes is named. No other
 * module may build a Redis key by string concatenation — every future
 * caller (provider health, rate limiting, idempotency, model/pricing cache,
 * distributed locks) imports a builder from here instead. This is the same
 * discipline `sqs-topology.ts` applies to queue names and
 * `command-wire.ts` applies to the command wire shape: one reviewable file
 * is the contract, and nothing downstream invents its own naming.
 *
 * VERSIONING
 * Every key is prefixed with `cinefield:v{REDIS_KEY_VERSION}:`. A future
 * change to a key's shape bumps this constant rather than rewriting keys
 * in place, so an old and a new format can coexist during a rollout instead
 * of silently colliding or corrupting each other — the same reason
 * `command-wire.ts` carries an explicit `v` field.
 *
 * WHAT MAY NEVER APPEAR IN A KEY
 * Secrets, raw user content (prompts, emails, free-form text), or anything
 * that was not already safe to log. Every builder below accepts only
 * identifiers (provider ids, model ids, database ids, a fixed set of
 * subject types) — never a caller-supplied free-form string. Each
 * identifier is validated against IDENTIFIER_PATTERN before it is allowed
 * into a key, which also protects the namespace boundary itself: an
 * identifier containing `:` could otherwise be crafted to inject extra key
 * segments.
 *
 * KEYS/SCAN
 * Every key here is meant to be looked up by its exact, deterministic name
 * — computed from the same builder function the writer used. Application
 * code must never use Redis KEYS or SCAN against the `cinefield:` prefix to
 * discover keys at runtime; that pattern doesn't scale and turns an O(1)
 * lookup into an O(n) scan. KEYS/SCAN remain fine for manual, one-off
 * operational inspection outside application code, never for control flow.
 *
 * TTL OWNERSHIP
 * Redis must never become a durable source of truth (see redis-config.ts
 * and the Phase 6R.7 audit) — every key in this contract is expected to
 * carry an expiry. REDIS_KEY_TTL_SECONDS documents who owns picking that
 * TTL when the first real caller for a namespace lands; it is not enforced
 * by this module (there is no Redis command in Phase C), only documented,
 * since no caller exists yet to set it.
 *
 * ZERO CALLERS IN PHASE C
 * This module builds strings only. It does not import ioredis, does not
 * call getRedisClient(), and issues no Redis command — it can be
 * unit-tested with no network access and no Redis Cloud connection.
 */

export const REDIS_KEY_VERSION = 1;

/** The logical namespaces Redis Application State is scoped to. */
export type RedisKeyNamespace =
  | "provider-health"
  | "provider-latency"
  | "provider-error-rate"
  | "circuit-breaker"
  | "routing-control"
  | "rate-limit"
  | "idempotency"
  | "model-cache"
  | "pricing-cache"
  | "lock";

/**
 * Documents which category owns setting an expiry once a real caller
 * exists, and roughly why. Not enforced here — see TTL OWNERSHIP above.
 */
export const REDIS_KEY_TTL_SECONDS: Readonly<Record<RedisKeyNamespace, number>> = {
  // Health/latency/error-rate are point-in-time provider observability
  // signals; a stale entry must expire quickly rather than report a provider
  // as healthy (or unhealthy) long after the observation that produced it.
  "provider-health": 120,
  "provider-latency": 120,
  "provider-error-rate": 300,
  // Phase 7-C. Longer than the health signals it is derived from, and for the
  // opposite reason: an expired breaker key reads as CLOSED, so a TTL shorter
  // than the cooldown would silently reopen a provider Cinefield had just
  // decided to stop sending traffic to. Long enough to outlive the cooldown,
  // short enough that a breaker cannot outlive the incident by hours.
  "circuit-breaker": 1_800,
  // Phase 7-E. An emergency kill that outlives its incident is a silent
  // capacity loss nobody remembers to undo, so a runtime control expires and
  // has to be re-made. Long enough to cover an incident, short enough that
  // "we forgot" is bounded. Anything that must hold permanently belongs in
  // PostgreSQL, not here.
  "routing-control": 3_600,
  // A rate-limit counter's TTL is the window itself — it must expire
  // exactly when the window it counts ends.
  "rate-limit": 60,
  // Mirrors the 24h idempotencyKeyTTL already used for the Trigger.dev
  // continuation dispatch (src/trigger/generation-task.ts) — long enough to
  // absorb a delayed retry, short enough not to accumulate forever.
  idempotency: 86_400,
  // Registry-shaped data that changes at deploy time, not per-request.
  "model-cache": 3_600,
  "pricing-cache": 3_600,
  // A lock must expire fast enough that a crashed holder cannot strand a
  // resource — this is a safety ceiling, not the lock's intended hold time.
  lock: 30,
} as const;

/**
 * Identifiers allowed into a key: safe to log, safe to concatenate, cannot
 * inject a `:` and forge a different namespace or key shape. Deliberately
 * the same shape as a UUID, a slug, or a short code — never free text.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function identifier(label: string, value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`redis-keys: invalid ${label} identifier`);
  }
  return value;
}

function buildKey(namespace: RedisKeyNamespace, ...segments: string[]): string {
  return [`cinefield`, `v${REDIS_KEY_VERSION}`, namespace, ...segments].join(":");
}

/** `cinefield:v1:provider-health:<providerId>` */
export function providerHealthKey(providerId: string): string {
  return buildKey("provider-health", identifier("providerId", providerId));
}

/** `cinefield:v1:provider-latency:<providerId>` */
export function providerLatencyKey(providerId: string): string {
  return buildKey("provider-latency", identifier("providerId", providerId));
}

/** `cinefield:v1:provider-error-rate:<providerId>` */
export function providerErrorRateKey(providerId: string): string {
  return buildKey("provider-error-rate", identifier("providerId", providerId));
}

/**
 * `cinefield:v1:circuit-breaker:<providerId>:<providerModelId>`
 *
 * Scoped to the provider MODEL, not just the provider (Phase 7-C). One
 * endpoint failing is the common case — a model deprecated upstream, a single
 * overloaded pool — and tripping every route through that provider because of
 * it would turn a narrow outage into a total one.
 *
 * `providerModelId` is not a safe key segment on its own: real ids contain
 * "/" and "." ("fal-ai/flux/schnell"). It is encoded to the identifier
 * alphabet rather than rejected, since the alternative is a keyspace that
 * cannot express the ids the system actually routes to.
 */
export function circuitBreakerKey(providerId: string, providerModelId: string): string {
  return buildKey(
    "circuit-breaker",
    identifier("providerId", providerId),
    identifier("providerModelId", encodeKeySegment(providerModelId))
  );
}

/**
 * Makes an arbitrary provider-owned id safe for a key segment.
 *
 * Deterministic and collision-free within the alphabet it produces: every
 * character outside [A-Za-z0-9_-] becomes "_" plus its hex code, so "a/b" and
 * "a.b" cannot map to the same segment the way a plain replace would.
 */
export function encodeKeySegment(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("redis-keys: empty key segment");
  }
  const encoded = value.replace(/[^A-Za-z0-9-]/g, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return `_${code.toString(16)}`;
  });
  if (encoded.length > 128) {
    throw new Error("redis-keys: key segment too long");
  }
  return encoded;
}

/**
 * `cinefield:v1:routing-control:<kind>:<encodedTargetId>`
 *
 * `kind` is one of model / provider / provider-model / route, so a control on
 * a provider cannot collide with one on a route that happens to share an id.
 * Target ids are encoded because provider model ids and Cinefield model ids
 * both contain characters the key alphabet rejects.
 */
export function routingControlKey(kind: string, targetId: string): string {
  return buildKey(
    "routing-control",
    identifier("controlKind", kind.replace(/-/g, "_")),
    identifier("targetId", encodeKeySegment(targetId))
  );
}

/** The kind of subject a rate-limit counter is scoped to. */
export type RateLimitSubject = "user" | "ip";

/**
 * `cinefield:v1:rate-limit:<subject>:<subjectId>:<action>:<windowId>`
 *
 * `action` distinguishes independently-limited operations for the SAME
 * subject (e.g. "generate" vs "login-attempt") — added in Phase 6R.7's
 * rate-limit foundation after an audit found the original 3-segment shape
 * (subject/subjectId/windowId only) had no way to represent this: two
 * unrelated limiters for the same user would collide on the exact same
 * key within the same window. No production caller existed yet, so this
 * was a safe, additive contract fix rather than a breaking migration.
 *
 * `windowId` is the caller's own encoding of the current window (e.g. a
 * floored-minute timestamp already turned into a string) — this module
 * does not compute time, matching the "no Date.now() at import time" rule
 * observability code elsewhere in Cinefield already follows.
 */
export function rateLimitKey(
  subject: RateLimitSubject,
  subjectId: string,
  action: string,
  windowId: string
): string {
  return buildKey(
    "rate-limit",
    subject,
    identifier("subjectId", subjectId),
    identifier("action", action),
    identifier("windowId", windowId)
  );
}

/** The kind of operation an idempotency key is scoped to. */
export type IdempotencyScope = "attempt" | "command";

/** `cinefield:v1:idempotency:<scope>:<id>` */
export function idempotencyKey(scope: IdempotencyScope, id: string): string {
  return buildKey("idempotency", scope, identifier("id", id));
}

/** `cinefield:v1:model-cache:<modelId>` */
export function modelCacheKey(modelId: string): string {
  return buildKey("model-cache", identifier("modelId", modelId));
}

/** `cinefield:v1:pricing-cache:<modelId>` */
export function pricingCacheKey(modelId: string): string {
  return buildKey("pricing-cache", identifier("modelId", modelId));
}

/**
 * `cinefield:v1:lock:<resourceType>:<resourceId>`
 *
 * `resourceType` is an identifier, not a fixed enum, because Cinefield does
 * not yet know every resource a future lock will guard — it is still
 * validated by the same IDENTIFIER_PATTERN, so it can never inject a `:`
 * or widen into an unrelated namespace.
 */
export function lockKey(resourceType: string, resourceId: string): string {
  return buildKey("lock", identifier("resourceType", resourceType), identifier("resourceId", resourceId));
}
