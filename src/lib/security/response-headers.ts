import "server-only";
import { NextResponse } from "next/server";
import { enforceRouteRateLimit, type LimitDecision, type RouteClass } from "./route-rate-limit";
import { installSecuritySignals } from "./security-signals";
import { enterRequestTrace } from "@/lib/observability/trace-scope";

/**
 * Phase 12-C. Connected HERE, at module load, because this is the module
 * every guarded route already imports — so the security logger cannot be
 * left with no producers by someone forgetting a wiring step.
 *
 * An explicit call rather than a bare side-effect import: a side-effect
 * import is exactly the line a tidy-up removes, and removing it would empty
 * the evidence table silently instead of breaking a build. A structural test
 * asserts this call still exists.
 */
installSecuritySignals();

/**
 * Private response defaults and the guarded route helper (Phase 12-A,
 * application half).
 *
 * ---------------------------------------------------------------------------
 * NO SHARED CACHE, BY DEFAULT RATHER THAN BY MEMORY
 * ---------------------------------------------------------------------------
 * The roadmap red note is explicit: "Authenticated/private BFF cevapları
 * shared cache'e girmemeli… generation, billing, admin, private asset
 * metadata ve presigned URL cevaplarında NO-SHARED-CACHE varsayılanı."
 *
 * Today twelve of fourteen routes emit no cache header at all and rely on the
 * framework's default. That default is currently safe because every route is
 * dynamic — and it is exactly the assumption that breaks the day a CDN is put
 * in front of the origin, which is what 12-A's edge half does. A response
 * whose privacy depends on nobody adding a cache layer is not private; it is
 * lucky.
 *
 * So the header is stated, not inherited. `private` keeps it out of any shared
 * cache; `no-store` keeps it out of the browser's disk cache too, which
 * matters on a shared machine for generation output and presigned URLs.
 * `Pragma` and `Expires` are there for intermediaries old enough to ignore
 * `Cache-Control`, and cost two header bytes to satisfy.
 *
 * PUBLIC IMMUTABLE ASSETS ARE NOT TOUCHED. Next.js serves `_next/static` and
 * the public folder with its own long-lived caching, and this module is never
 * applied there. Privatising a hashed static bundle would throw away the CDN
 * for nothing.
 */

export const PRIVATE_NO_STORE: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

/** Adds the private-cache headers to a response, in place. */
export function withPrivateCache<T extends Response>(response: T): T {
  for (const [name, value] of Object.entries(PRIVATE_NO_STORE)) {
    response.headers.set(name, value);
  }
  return response;
}

/** A JSON response that is private by construction rather than by remembering. */
export function privateJson(body: unknown, init?: ResponseInit): NextResponse {
  return withPrivateCache(NextResponse.json(body, init));
}

/**
 * The 429 body.
 *
 * A fixed shape carrying one useful fact and nothing else. NOT included, on
 * purpose: the current count, the limit, the window, the bucket, the Redis
 * key, the subject kind, the user id, the address hash. A client that learns
 * it hit an IP ceiling rather than a user ceiling has learned something about
 * the other people behind its NAT; a client that learns the limit has learned
 * how to sit just under it.
 *
 * `retryAfterSeconds` is the exception because it is the one thing that makes
 * the client behave better rather than worse.
 */
export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  const response = NextResponse.json(
    { error: "rate_limited", message: "Too many requests. Please retry shortly." },
    { status: 429 }
  );
  response.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  return withPrivateCache(response);
}

/** A refusal when the limiter itself cannot answer and the class fails closed. */
export function limiterUnavailableResponse(retryAfterSeconds: number): NextResponse {
  const response = NextResponse.json(
    { error: "temporarily_unavailable", message: "Service is temporarily unavailable. Please retry shortly." },
    { status: 503 }
  );
  response.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  return withPrivateCache(response);
}

/**
 * THE ONE THING A ROUTE HAS TO CALL.
 *
 * Returns a `Response` when the request must be refused, or `null` when it may
 * proceed. Putting the limit here — before the handler body runs — is what
 * makes the ordering guarantee real: on a paid path the check happens before
 * any generation row, credit reservation, workflow start or provider call
 * exists, because the handler has not begun.
 *
 * A route that forgets to call this is caught by the structural guard in
 * `phase-12-pre-rate-limit.e2e.test.ts` rather than discovered in a bill.
 */
export async function guardRoute(params: {
  routeClass: RouteClass;
  userId?: string | null;
  headers?: Headers;
}): Promise<NextResponse | null> {
  // ---- PHASE 13-A: the common request boundary binds the trace ----------
  //
  // Every one of the 14 API routes already calls guardRoute first, so this is
  // the one place a trace can be established without wrapping 14 handler
  // bodies or duplicating traceparent parsing in each.
  //
  // It CANNOT affect the decision below. Minting is a crypto random draw that
  // does not fail, it reads no request field the limiter uses, and it returns
  // nothing the limiter consults — a trace is a label, never an input to a
  // security control. The rate limit, the identity and the fail-closed
  // behaviour are all exactly as PRE-12 left them.
  enterRequestTrace(params.headers);

  const decision: LimitDecision = await enforceRouteRateLimit(params);
  if (decision.allowed) return null;

  if (decision.reason === "rate_limited") return rateLimitedResponse(decision.retryAfterSeconds);
  // `unidentified` and `backend_unavailable` are both "we cannot safely let
  // this through", and both are reported as a transient service condition —
  // telling a caller which one it was describes our internals, not their
  // request.
  return limiterUnavailableResponse(decision.retryAfterSeconds);
}
