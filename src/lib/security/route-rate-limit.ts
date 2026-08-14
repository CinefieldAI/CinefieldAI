import "server-only";
import { consumeRateLimit, type RateLimitRedisClient } from "@/lib/redis/rate-limit-store";
import { trustedClientIp, ipBucket } from "@/lib/realtime/connection-limits";

/**
 * Application-layer route rate limiting (Phase 12-A, application half).
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS CLOSES
 * ---------------------------------------------------------------------------
 * `consumeRateLimit` has existed, complete and tested, since Phase 6R.7 with
 * **zero production callers**. Fourteen API routes had no rate limiting at
 * all — including `generate` and `orchestration/execute`, which trigger paid
 * provider work. Until an edge WAF exists, the only thing standing between a
 * signed-in account and unbounded spend was the Clerk session.
 *
 * That is the same failure shape Phase 11 closed twice: a component built,
 * proven, and never wired. Section D below is the structural guard.
 *
 * ---------------------------------------------------------------------------
 * ONE POLICY TABLE, NOT FOURTEEN MAGIC NUMBERS
 * ---------------------------------------------------------------------------
 * Limits live here, keyed by route CLASS rather than by route, so a new
 * endpoint inherits a reviewed policy by declaring what kind of thing it is.
 * Scattering numbers across route files is how one of them ends up at 10000
 * because somebody was debugging.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE APPLICATION HALF, AND IT KNOWS IT
 * ---------------------------------------------------------------------------
 * Cloudflare and Vercel Firewall (12-A's edge half) will sit in front of this
 * and stop crude floods before they reach a function. They cannot replace it:
 * an edge rule counts requests by IP and knows nothing about which Clerk user
 * is spending, which endpoint costs money, or whether a request would create
 * durable server work. That judgement belongs here, and it survives an
 * attacker who is already past the edge.
 *
 * It also does NOT duplicate Phase 11-D. That control counts CONCURRENT SSE
 * connections a tenant holds; this one counts REQUESTS over a window. A
 * client can be inside one and outside the other, which is why both exist.
 */

/**
 * What a route is, in the only terms that change the policy.
 *
 * `paid_compute`   can cause money to be spent or a provider to be called.
 * `durable_write`  creates or mutates durable server state without provider
 *                  cost — a cancel intent, a presigned upload.
 * `authenticated_read`  reads the caller's own data. Cheap, still not free.
 * `realtime_connect`    opening or reopening an SSE stream.
 * `public_dev_stub`     unauthenticated and backed by nothing that costs.
 */
export type RouteClass =
  | "paid_compute"
  | "durable_write"
  | "authenticated_read"
  | "realtime_connect"
  | "public_dev_stub";

export interface RoutePolicy {
  /** Distinguishes independently-limited operations for one subject. */
  action: string;
  limit: number;
  windowSeconds: number;
  /**
   * What to do when Redis cannot answer.
   *
   * `closed` — refuse the request. Correct wherever the request can spend
   *            money or create durable work: an outage is exactly when an
   *            unlimited path is most dangerous, and a refusal is recoverable
   *            while an unbilled provider run is not.
   * `open`   — allow. Only for paths where the worst case is a wasted read.
   */
  onUnavailable: "closed" | "open";
  /** Seconds handed to the client when refused with no better information. */
  retryHintSeconds: number;
}

/**
 * The policy table.
 *
 * Numbers are deliberately conservative and reasoned rather than borrowed.
 * They bound abuse without binding normal use; the edge layer will add a
 * coarser, higher ceiling above them.
 *
 *   paid_compute 12/min       a person iterating on a prompt submits every
 *                             few seconds at most. Twelve leaves room for
 *                             impatience and still caps a scripted loop at
 *                             two orders of magnitude below what an
 *                             unattended script would otherwise achieve.
 *   durable_write 30/min      presign and cancel are cheap but each writes a
 *                             row; thirty covers a burst upload of a handful
 *                             of files with retries.
 *   authenticated_read 120/min  a catalog read behind a session. Generous,
 *                             because the failure mode is a wasted query.
 *   realtime_connect 20/5min  the gateway ends every connection at ~50 s, so
 *                             a healthy client reconnects about six times in
 *                             five minutes. Twenty absorbs a few tabs and a
 *                             deploy-driven reconnect storm without letting a
 *                             loop hammer the handshake.
 *   public_dev_stub 30/min    unauthenticated and in-memory, so the only
 *                             resource at stake is process memory.
 */
export const ROUTE_POLICIES: Readonly<Record<RouteClass, RoutePolicy>> = {
  paid_compute: { action: "paid-compute", limit: 12, windowSeconds: 60, onUnavailable: "closed", retryHintSeconds: 30 },
  durable_write: { action: "durable-write", limit: 30, windowSeconds: 60, onUnavailable: "closed", retryHintSeconds: 20 },
  authenticated_read: { action: "auth-read", limit: 120, windowSeconds: 60, onUnavailable: "open", retryHintSeconds: 10 },
  realtime_connect: { action: "realtime-connect", limit: 20, windowSeconds: 300, onUnavailable: "closed", retryHintSeconds: 30 },
  public_dev_stub: { action: "public-stub", limit: 30, windowSeconds: 60, onUnavailable: "open", retryHintSeconds: 20 },
};

export type LimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited" | "unidentified" | "backend_unavailable"; retryAfterSeconds: number };

/**
 * The seam PRE-12 left, now filled by Phase 12-C.
 *
 * It exists so security logging attaches in ONE place instead of in fourteen
 * route handlers. `security-signals.ts` installs the observer; nothing here
 * imports it, so the limiter still has no dependency on the security stack
 * and remains testable without a database.
 *
 * ---------------------------------------------------------------------------
 * THE PAYLOAD GREW ONE FIELD, AND WHY
 * ---------------------------------------------------------------------------
 * PRE-12 wrote: "never the user id, never the address." That was right for a
 * seam with no consumer — but a security event that cannot say WHO is not
 * evidence, and recurrence per subject is the entire input to the Risk
 * Engine. Without it every denied user coalesces into one row per window and
 * a single account hammering a paid endpoint is indistinguishable from a
 * thousand people being mildly impatient.
 *
 * So `subjectRef` is added, and the promise is narrowed to the part that was
 * actually load-bearing:
 *
 *   subject: "user"  ->  the Clerk user id. Server-verified, already the
 *                        primary key of the account, and `security_events`
 *                        has a column for exactly it.
 *   subject: "ip"    ->  the sha256 BUCKET, never the address. `ipBucket` has
 *                        already hashed it before the limiter ever saw it,
 *                        and no raw address exists at this point to leak.
 *
 * Still absent, deliberately: the Redis key, the count, the limit, the
 * window, and the raw address.
 */
export interface RateLimitObserver {
  onDenied(event: {
    routeClass: RouteClass;
    subject: "user" | "ip";
    action: string;
    /** Clerk user id, or a hashed address bucket. Never a raw address. */
    subjectRef: string;
  }): void;
}

let observer: RateLimitObserver | null = null;

/** Installed by `security-signals.ts`. Null in unit tests, and harmless. */
export function setRateLimitObserver(next: RateLimitObserver | null): void {
  observer = next;
}

export interface EnforceParams {
  routeClass: RouteClass;
  /**
   * The Clerk user id, already verified by `auth()`. Never a body or query
   * value — the identity a limiter counts against must be one the server
   * established, or an attacker simply sends a different one each request.
   */
  userId?: string | null;
  /** Only consulted for classes that permit anonymous access. */
  headers?: Headers;
  /** Test seam; production resolves Redis A through the store. */
  redisOverride?: RateLimitRedisClient | null;
}

/**
 * Consumes one unit and decides whether the route may proceed.
 *
 * IDENTITY IS SERVER-DERIVED, ALWAYS.
 *
 * An authenticated route counts against the Clerk user id. An anonymous route
 * counts against a hashed, platform-trusted address — `trustedClientIp`
 * prefers `x-vercel-forwarded-for`, then `x-real-ip`, then the LAST hop of
 * `x-forwarded-for`, never the first, because the first entry is whatever the
 * client claimed and trusting it hands an attacker an unlimited supply of
 * buckets.
 *
 * An authenticated route with no user id does not fall back to an address:
 * that would let an attacker who dropped their session share a bucket with
 * everyone else behind their NAT, or escape their own. It is refused instead
 * — and in practice the route's own `auth()` has already returned 401 before
 * this is ever reached.
 */
export async function enforceRouteRateLimit(params: EnforceParams): Promise<LimitDecision> {
  const policy = ROUTE_POLICIES[params.routeClass];
  const anonymousAllowed = params.routeClass === "public_dev_stub";

  let subject: "user" | "ip";
  let subjectId: string | null;

  if (params.userId) {
    subject = "user";
    subjectId = params.userId;
  } else if (anonymousAllowed && params.headers) {
    subject = "ip";
    subjectId = ipBucket(trustedClientIp(params.headers));
  } else {
    return { allowed: false, reason: "unidentified", retryAfterSeconds: policy.retryHintSeconds };
  }

  if (!subjectId) {
    // No trustworthy address on an anonymous route. Not a shared bucket:
    // everyone unidentifiable contending for one counter is a denial of
    // service against legitimate users, so the class's own failure mode
    // decides instead.
    return policy.onUnavailable === "open"
      ? { allowed: true }
      : { allowed: false, reason: "unidentified", retryAfterSeconds: policy.retryHintSeconds };
  }

  const outcome = await consumeRateLimit(
    { subject, subjectId, action: policy.action, limit: policy.limit, windowSeconds: policy.windowSeconds },
    params.redisOverride
  );

  if (outcome.outcome === "allowed") return { allowed: true };

  if (outcome.outcome === "limited") {
    // Fire-and-forget by contract: the observer returns void and swallows its
    // own failures, so a security-logging outage cannot delay — let alone
    // reopen — a refusal that has already been decided.
    observer?.onDenied({ routeClass: params.routeClass, subject, action: policy.action, subjectRef: subjectId });
    return {
      allowed: false,
      reason: "rate_limited",
      retryAfterSeconds: Math.max(outcome.retryAfterSeconds, 1),
    };
  }

  // Redis could not answer. Decided per class, never universally: refusing a
  // catalog read during an outage is worse than serving it, and allowing an
  // unlimited paid path during one is far worse than refusing it.
  return policy.onUnavailable === "open"
    ? { allowed: true }
    : { allowed: false, reason: "backend_unavailable", retryAfterSeconds: policy.retryHintSeconds };
}
