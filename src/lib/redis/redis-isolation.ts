import "server-only";
import { createHash } from "node:crypto";

/**
 * Cinefield Redis role isolation (v1.6 6R.25).
 *
 * TWO INSTANCES, TWO JOBS, AND THEY MUST NOT BE ONE INSTANCE.
 *
 *   Redis A (REDIS_URL)         application transient state — idempotency
 *                               records, rate-limit windows, distributed
 *                               locks, provider health/latency/error rate,
 *                               model and pricing caches.
 *   Redis B (BULLMQ_REDIS_URL)  BullMQ queue state, and nothing else.
 *
 * They already read different environment variables, which is necessary and
 * not sufficient: nothing stopped an operator pointing both at the same
 * instance. That is not a cosmetic misconfiguration. BullMQ stores job
 * payloads, retry sets and completed/failed lists; under memory pressure an
 * eviction policy that trims them would trim Cinefield's LOCKS and
 * IDEMPOTENCY RECORDS with equal enthusiasm, because to Redis they are just
 * keys. A queue backlog would then be able to cause a duplicate provider
 * submission — the exact class of failure the whole architecture is built to
 * prevent.
 *
 * So this module makes "A and B are the same instance" a detectable,
 * refusable condition.
 *
 * NOTHING HERE LOGS OR RETURNS A URL. Comparison is by fingerprint: a hash
 * of the normalized host and port only, with credentials deliberately
 * excluded from the digest so two URLs differing only in password still
 * count as the same instance — which they are.
 */

export type RedisRole = "application" | "bullmq";

/**
 * A short, non-reversible identifier for "which instance is this".
 *
 * Derived from host + port ONLY. The password is not part of the identity of
 * a server, and including it would let a credential rotation silently look
 * like a different instance — turning the isolation check off exactly when
 * someone is changing configuration.
 *
 * Returns null for anything unparseable, which callers must treat as
 * "cannot verify" rather than "verified different".
 */
export function redisConnectionFingerprint(url: string | undefined): string | null {
  if (typeof url !== "string" || url.trim().length === 0) return null;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase();
    if (host.length === 0) return null;
    // Redis' own defaults, so `host` and `host:6379` are one instance.
    const port = parsed.port.length > 0 ? parsed.port : "6379";
    return createHash("sha256").update(`${host}:${port}`, "utf8").digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/** True when TLS is in use. `rediss:` is the TLS scheme; `redis:` is not. */
function isTlsScheme(url: string | undefined): boolean {
  if (typeof url !== "string") return false;
  try {
    return new URL(url.trim()).protocol === "rediss:";
  } catch {
    return false;
  }
}

/** True when the URL carries a password. Presence only — never the value. */
function hasCredentials(url: string | undefined): boolean {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.password.length > 0 || parsed.username.length > 0;
  } catch {
    return false;
  }
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export type IsolationVerdict =
  /** Both roles configured, and they are demonstrably different instances. */
  | { verdict: "isolated" }
  /** Both configured and pointing at the SAME instance. A hard refusal. */
  | { verdict: "shared_instance" }
  /** Only one (or neither) is configured — nothing to violate yet. */
  | { verdict: "not_both_configured" }
  /** One of the URLs could not be parsed, so isolation cannot be asserted. */
  | { verdict: "unverifiable"; reason: string };

/**
 * Whether Redis A and Redis B are provably distinct instances.
 *
 * `unverifiable` is deliberately NOT collapsed into `isolated`. An
 * unparseable URL means the check did not run, and reporting that as a pass
 * would be the same mistake as a validator that silently ignores a keyword.
 */
export function checkRedisRoleIsolation(): IsolationVerdict {
  const a = read("REDIS_URL");
  const b = read("BULLMQ_REDIS_URL");

  if (a === undefined || b === undefined) return { verdict: "not_both_configured" };

  const fingerprintA = redisConnectionFingerprint(a);
  const fingerprintB = redisConnectionFingerprint(b);

  if (fingerprintA === null) return { verdict: "unverifiable", reason: "application_url_unparseable" };
  if (fingerprintB === null) return { verdict: "unverifiable", reason: "bullmq_url_unparseable" };

  return fingerprintA === fingerprintB ? { verdict: "shared_instance" } : { verdict: "isolated" };
}

/**
 * True when BullMQ may safely use its configured connection.
 *
 * The one thing this exists to prevent: BullMQ falling back onto — or being
 * misconfigured onto — Redis A. A shared instance returns false, so the
 * queue reports unconfigured rather than quietly writing job state into the
 * store that holds Cinefield's locks.
 */
export function isBullmqConnectionSafe(): boolean {
  const verdict = checkRedisRoleIsolation();
  // `not_both_configured` is safe by definition here: if Redis A is absent
  // there is nothing to collide with, and if Redis B is absent BullMQ is
  // already disabled by its own config gate.
  return verdict.verdict === "isolated" || verdict.verdict === "not_both_configured";
}

/**
 * Safe security description for health endpoints and startup logs.
 *
 * Booleans and a fingerprint only. The fingerprint is a hash of host:port —
 * it identifies an instance across two config values without disclosing
 * where it is, which is exactly what an operator needs to confirm isolation
 * without a URL ever reaching a log.
 */
export function describeRedisSecurity(): Record<
  RedisRole,
  { configured: boolean; tls: boolean; authenticated: boolean; instance: string | null }
> {
  const a = read("REDIS_URL");
  const b = read("BULLMQ_REDIS_URL");
  return {
    application: {
      configured: a !== undefined,
      tls: isTlsScheme(a),
      authenticated: hasCredentials(a),
      instance: redisConnectionFingerprint(a),
    },
    bullmq: {
      configured: b !== undefined,
      tls: isTlsScheme(b),
      authenticated: hasCredentials(b),
      instance: redisConnectionFingerprint(b),
    },
  };
}

/**
 * Production expectations, reported rather than enforced at import time.
 *
 * Enforcing TLS by refusing to start would take a running deployment down
 * over a configuration detail this module cannot fully judge — a connection
 * over a private VPC link is a legitimate deployment even without `rediss:`.
 * So this reports, and the caller decides.
 *
 * IMPORTANT HONESTY BOUNDARY: none of this proves network isolation. Code
 * can see a URL scheme and the presence of a credential. It cannot see a
 * firewall rule, a VPC peering config, or whether the instance answers on
 * the public internet. Those require control-plane verification and must
 * never be claimed from here.
 */
export function describeRedisHardening(): {
  rolesIsolated: boolean;
  applicationTls: boolean;
  bullmqTls: boolean;
  bothAuthenticated: boolean;
  /** Always false from code. Network reachability is not observable here. */
  networkIsolationVerified: false;
} {
  const security = describeRedisSecurity();
  return {
    rolesIsolated: checkRedisRoleIsolation().verdict === "isolated",
    applicationTls: security.application.tls,
    bullmqTls: security.bullmq.tls,
    bothAuthenticated: security.application.authenticated && security.bullmq.authenticated,
    networkIsolationVerified: false,
  };
}
