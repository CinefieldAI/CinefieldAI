import "server-only";
import { privateJson } from "./response-headers";
import type { NextResponse } from "next/server";

/**
 * Phase 16-E security fix batch — the ONE canonical CSRF/mutation-origin
 * guard for privileged admin state changes.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The 16-E closure audit found every privileged mutation route relied only
 * on implicit protection — Clerk's session cookie's `SameSite` attribute
 * (set by CDN-loaded `@clerk/clerk-js`, unverifiable from this repository)
 * plus an informal assumption that a cross-site `fetch()` would trigger a
 * CORS preflight. Neither is a repository-owned control: a scripted
 * cross-site request using `Content-Type: text/plain` (one of the three
 * "CORS-simple" values) carrying a JSON-text body skips the preflight
 * entirely, and `Request.json()` parses it regardless of the declared
 * Content-Type. This module closes that gap with an explicit, repository-
 * owned boundary rather than an inherited one.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CHECKS, AND WHY BOTH
 * ---------------------------------------------------------------------------
 * 1. Content-Type must be genuinely `application/json`. This alone forces
 *    any cross-site attacker back onto a real CORS preflight (since
 *    `application/json` is not a CORS-simple content type) — the browser
 *    then requires an `Access-Control-Allow-Origin` response this app never
 *    sends, blocking the request before it reaches this server at all.
 * 2. `Origin` must be present and must match this request's own canonical
 *    origin (derived from `request.url`, which Next.js/the platform already
 *    resolves correctly per-deployment — never a hardcoded production
 *    domain, so this holds across production, preview deployments, and
 *    localhost with no configuration). Modern browsers send `Origin` on
 *    every state-changing (non-GET/HEAD) request, same-origin or not, so
 *    its absence is treated as suspicious rather than tolerated.
 *
 * Both checks run BEFORE `requireAdminAccess()` in every caller — cheap,
 * pure, no I/O — but this is an ADDITIVE boundary, never a replacement for
 * Clerk session authorization. A request that passes this guard still must
 * pass the real auth check; a request that fails this guard never reaches
 * it.
 *
 * ---------------------------------------------------------------------------
 * NOT A NEW AUTHENTICATION SYSTEM
 * ---------------------------------------------------------------------------
 * This module knows nothing about identity, roles, or sessions. It answers
 * exactly one question — "did this request's browser-observable shape come
 * from this app's own origin, making a real, deliberate, same-origin fetch
 * call?" — and nothing else. Server-side Clerk authorization
 * (`requireAdminAccess()`) remains the only source of "who is this."
 */

/** The canonical origin this deployment considers itself, from the request's own resolved URL — never hardcoded. */
function requestOwnOrigin(request: Request): string {
  return new URL(request.url).origin;
}

function isSameOrigin(originHeader: string, expected: string): boolean {
  try {
    const parsed = new URL(originHeader);
    const parsedExpected = new URL(expected);
    return parsed.protocol === parsedExpected.protocol && parsed.host === parsedExpected.host;
  } catch {
    return false;
  }
}

/**
 * THE ONE THING A PRIVILEGED MUTATION ROUTE HAS TO CALL, BEFORE
 * `requireAdminAccess()`. Returns a `Response` when the request must be
 * refused, or `null` when it may proceed to real authorization.
 */
export function guardPrivilegedMutation(request: Request): NextResponse | null {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return privateJson({ error: "invalid_content_type" }, { status: 415 });
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return privateJson({ error: "missing_origin" }, { status: 403 });
  }

  if (!isSameOrigin(origin, requestOwnOrigin(request))) {
    return privateJson({ error: "cross_origin_mutation_rejected" }, { status: 403 });
  }

  return null;
}
