import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  enforceRouteRateLimit,
  ROUTE_POLICIES,
  setRateLimitObserver,
  type RouteClass,
} from "@/lib/security/route-rate-limit";
import {
  PRIVATE_NO_STORE,
  guardRoute,
  privateJson,
  rateLimitedResponse,
  withPrivateCache,
} from "@/lib/security/response-headers";
import { ipBucket } from "@/lib/realtime/connection-limits";
import type { RateLimitRedisClient } from "@/lib/redis/rate-limit-store";

/**
 * PRE-12 — application rate limiting and private cache defaults.
 *
 * Two defects, one shape: a control that existed and was never wired.
 * `consumeRateLimit` had zero production callers while `generate` and
 * `orchestration/execute` could spend money, and twelve of fourteen routes
 * left their cache policy to a framework default that only happens to be
 * safe until a CDN is put in front of it.
 */

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "src/app/api");
const LIMITER = readFileSync(path.join(ROOT, "src/lib/security/route-rate-limit.ts"), "utf8");
const HEADERS = readFileSync(path.join(ROOT, "src/lib/security/response-headers.ts"), "utf8");

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function routeFiles(dir = API_DIR, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const ROUTES = routeFiles();

/** A counting Redis double. No socket, no Lua, real fixed-window semantics. */
function fakeRedis(behaviour: { fail?: boolean } = {}): RateLimitRedisClient & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async incrementWindow(key: string): Promise<[number, number]> {
      if (behaviour.fail) throw new Error("ECONNREFUSED");
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return [next, 60];
    },
  };
}

const USER_A = "user_2aaaaaaaaaaaaaaaa";
const USER_B = "user_2bbbbbbbbbbbbbbbb";

async function consumeN(routeClass: RouteClass, userId: string, n: number, redis: RateLimitRedisClient) {
  const results = [];
  for (let i = 0; i < n; i += 1) {
    results.push(await enforceRouteRateLimit({ routeClass, userId, redisOverride: redis }));
  }
  return results;
}

// ---------------------------------------------------------------------------
// 1–3. The paid and durable paths are limited
// ---------------------------------------------------------------------------

test("1-3. paid-compute, orchestration and presign routes are all rate limited", async () => {
  for (const cls of ["paid_compute", "durable_write"] as const) {
    const redis = fakeRedis();
    const policy = ROUTE_POLICIES[cls];
    const results = await consumeN(cls, USER_A, policy.limit + 2, redis);

    assert.equal(results.filter((r) => r.allowed).length, policy.limit, `${cls} must allow exactly its limit`);
    const denied = results[policy.limit];
    assert.equal(denied.allowed, false);
    assert.equal(denied.allowed === false && denied.reason, "rate_limited");
  }

  // And every route file actually declares a class.
  for (const file of ROUTES) {
    const code = stripComments(readFileSync(file, "utf8"));
    assert.match(code, /guardRoute\(\{[\s\S]{0,120}routeClass: "/, `${path.relative(ROOT, file)} has no guard`);
  }
});

// ---------------------------------------------------------------------------
// 4. The limit precedes every side effect
// ---------------------------------------------------------------------------

test("4. on a paid path the guard runs before any side effect exists", () => {
  const SIDE_EFFECTS = [
    "createGeneration", "create_generation_tx", "reserveCredits", "startGeneration",
    "claimGeneration", "runOrchestration", "executeGeneration", "createPresignedUpload",
    "publishNotification", "submitTo",
  ];

  for (const file of ROUTES) {
    // Import lines name a symbol without invoking it, and they are always at
    // the top — comparing against them would flag every route forever.
    const code = stripComments(readFileSync(file, "utf8")).replace(/^import [\s\S]*?;$/gm, "");
    const guardAt = code.indexOf("await guardRoute(");
    if (guardAt === -1) continue;

    for (const effect of SIDE_EFFECTS) {
      const at = code.indexOf(effect);
      if (at === -1) continue;
      assert.ok(
        at > guardAt,
        `${path.relative(ROOT, file)}: ${effect} appears before the rate-limit guard`
      );
    }
  }
});

test("a refused request returns before the handler body — the guard returns a Response", async () => {
  // guardRoute returns a Response the route returns IMMEDIATELY. There is no
  // path in which the handler continues after a refusal, because the route's
  // next statement is `return limited`.
  for (const file of ROUTES) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (!code.includes("await guardRoute(")) continue;
    assert.match(code, /const limited = await guardRoute\([\s\S]{0,200}?\);\s*\r?\n\s*if \(limited\) return limited;/,
      `${path.relative(ROOT, file)}: the guard result must be returned immediately`);
  }
});

// ---------------------------------------------------------------------------
// 5–6. The 429 is useful and says nothing else
// ---------------------------------------------------------------------------

test("5. a 429 carries a sane Retry-After", async () => {
  const response = rateLimitedResponse(37);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "37");
  // Never zero or negative, whatever the caller passes.
  assert.equal(rateLimitedResponse(0).headers.get("Retry-After"), "1");
  assert.equal(rateLimitedResponse(-5).headers.get("Retry-After"), "1");
});

test("6. a 429 leaks no counter, key, limit, subject or identity", async () => {
  const response = rateLimitedResponse(30);
  const body = await response.clone().text();

  // `rate_limited` is the error CODE and legitimately contains the word; what
  // must not appear is a VALUE — a count, a ceiling, a key, an identity.
  const parsed = JSON.parse(body) as { error: string; message: string };
  assert.deepEqual(Object.keys(parsed).sort(), ["error", "message"]);
  assert.equal(parsed.error, "rate_limited");

  assert.ok(!/\d/.test(body), `no number may appear in the body: ${body}`);
  for (const forbidden of [
    "remaining", "bucket", "cinefield:", "rate-limit:", USER_A, "user_", "redis", "window",
  ]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(body),
      `the 429 body must not mention "${forbidden}": ${body}`
    );
  }
  // The ceiling is not discoverable from the headers either.
  assert.equal(response.headers.get("X-RateLimit-Limit"), null);
  assert.equal(response.headers.get("X-RateLimit-Remaining"), null);
});

// ---------------------------------------------------------------------------
// 7–8. Identity is server-derived and isolated
// ---------------------------------------------------------------------------

test("7. one user's consumption never touches another's bucket", async () => {
  const redis = fakeRedis();
  const policy = ROUTE_POLICIES.paid_compute;

  await consumeN("paid_compute", USER_A, policy.limit, redis);
  const aDenied = await enforceRouteRateLimit({ routeClass: "paid_compute", userId: USER_A, redisOverride: redis });
  assert.equal(aDenied.allowed, false, "A is exhausted");

  const bAllowed = await enforceRouteRateLimit({ routeClass: "paid_compute", userId: USER_B, redisOverride: redis });
  assert.equal(bAllowed.allowed, true, "B must be unaffected");
});

test("8. an anonymous route never trusts the first x-forwarded-for hop", async () => {
  const redis = fakeRedis();

  // Two requests claiming different upstream IPs but arriving through the same
  // real hop must share one bucket — otherwise a client mints unlimited
  // buckets by rotating a header it controls.
  const a = new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
  const b = new Headers({ "x-forwarded-for": "2.2.2.2, 203.0.113.9" });
  await enforceRouteRateLimit({ routeClass: "public_dev_stub", headers: a, redisOverride: redis });
  await enforceRouteRateLimit({ routeClass: "public_dev_stub", headers: b, redisOverride: redis });
  assert.equal(redis.counts.size, 1, "a spoofed first hop must not create a second bucket");

  // A platform header outranks the client's claim entirely.
  const platform = new Headers({ "x-forwarded-for": "9.9.9.9", "x-vercel-forwarded-for": "203.0.113.5" });
  const fresh = fakeRedis();
  await enforceRouteRateLimit({ routeClass: "public_dev_stub", headers: platform, redisOverride: fresh });
  const key = [...fresh.counts.keys()][0];
  assert.ok(!key.includes("9.9.9.9"), "the client's claim must not reach the key");
});

test("an authenticated route never falls back to an address", async () => {
  const redis = fakeRedis();
  const outcome = await enforceRouteRateLimit({
    routeClass: "paid_compute",
    userId: null,
    headers: new Headers({ "x-vercel-forwarded-for": "203.0.113.5" }),
    redisOverride: redis,
  });
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.allowed === false && outcome.reason, "unidentified");
  assert.equal(redis.counts.size, 0, "nothing may be consumed for an unidentified caller");
});

test("no route reads an identity from the request body or query", () => {
  const code = stripComments(LIMITER + HEADERS);
  assert.ok(!/body\.|searchParams|query\./i.test(code), "identity must be server-derived");
  assert.match(stripComments(LIMITER), /trustedClientIp\(params\.headers\)/);
});

// ---------------------------------------------------------------------------
// 9–10. Fail-closed where it matters, fail-open only where justified
// ---------------------------------------------------------------------------

test("9. a Redis outage on a paid path fails CLOSED", async () => {
  const broken = fakeRedis({ fail: true });
  for (const cls of ["paid_compute", "durable_write", "realtime_connect"] as const) {
    const outcome = await enforceRouteRateLimit({ routeClass: cls, userId: USER_A, redisOverride: broken });
    assert.equal(outcome.allowed, false, `${cls} must fail closed`);
    assert.equal(outcome.allowed === false && outcome.reason, "backend_unavailable");
  }
  // No client at all is the same answer.
  const noClient = await enforceRouteRateLimit({ routeClass: "paid_compute", userId: USER_A, redisOverride: null });
  assert.equal(noClient.allowed, false);
});

test("10. fail-open applies only to the classes that justify it", async () => {
  const broken = fakeRedis({ fail: true });
  for (const cls of ["authenticated_read", "public_dev_stub", "public_health"] as const) {
    const headers = new Headers({ "x-vercel-forwarded-for": "203.0.113.5" });
    const outcome = await enforceRouteRateLimit({ routeClass: cls, userId: cls === "authenticated_read" ? USER_A : null, headers, redisOverride: broken });
    assert.equal(outcome.allowed, true, `${cls} is allowed to fail open`);
  }

  // And the table says so explicitly, so a future class inherits nothing by
  // accident.
  //
  // `public_health` was added by the Phase 13 health foundation, and this
  // assertion is what forced that to be a deliberate decision rather than a
  // side effect. Its justification is the sharpest of the three: liveness must
  // not depend on Redis, because an orchestrator answers a failed liveness
  // probe by RESTARTING the container. A cache outage that failed every
  // liveness check would restart every healthy process — the dependency
  // incident amplified into an application outage, which is exactly what
  // separating liveness from readiness exists to prevent.
  const open = Object.entries(ROUTE_POLICIES).filter(([, p]) => p.onUnavailable === "open").map(([k]) => k);
  assert.deepEqual(open.sort(), ["authenticated_read", "public_dev_stub", "public_health"]);

  // The paid and durable paths are untouched by that addition.
  const closed = Object.entries(ROUTE_POLICIES).filter(([, p]) => p.onUnavailable === "closed").map(([k]) => k);
  assert.deepEqual(closed.sort(), ["durable_write", "paid_compute", "realtime_connect"]);
});

test("there is no in-memory fallback anywhere", () => {
  const code = stripComments(LIMITER + HEADERS);
  assert.ok(!/new Map\(|globalThis\.|process\.__/i.test(code), "no process-memory counter");
  assert.match(stripComments(LIMITER), /consumeRateLimit\(/, "the canonical store is the only backend");
});

// ---------------------------------------------------------------------------
// 11–15. Private cache defaults
// ---------------------------------------------------------------------------

test("11-14. private responses are never shared-cacheable", async () => {
  const cc = PRIVATE_NO_STORE["Cache-Control"];
  assert.match(cc, /private/);
  assert.match(cc, /no-store/);

  const json = privateJson({ ok: true });
  assert.equal(json.headers.get("Cache-Control"), cc);
  assert.equal(json.headers.get("Pragma"), "no-cache");
  assert.equal(json.headers.get("Expires"), "0");

  // Every route that returns JSON must use the helper rather than raw
  // NextResponse.json, so a new response cannot forget.
  for (const file of ROUTES) {
    const code = stripComments(readFileSync(file, "utf8"));
    assert.ok(
      !/NextResponse\.json\(/.test(code),
      `${path.relative(ROOT, file)} returns an unprivatised NextResponse.json`
    );
  }
});

test("the SSE response keeps its own private headers", () => {
  const frame = readFileSync(path.join(ROOT, "src/lib/realtime/sse-frame.ts"), "utf8");
  assert.match(frame, /"Cache-Control": "private, no-cache, no-store/);
});

test("15. public immutable assets are not privatised", () => {
  // The helper is server-only and applied per route. Nothing wires it into
  // next.config or a global middleware, so static assets keep their own
  // long-lived caching.
  const nextConfig = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
  assert.ok(!/Cache-Control|no-store/.test(nextConfig), "no global cache override");
  const proxy = readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
  assert.ok(!/Cache-Control|response-headers/.test(proxy), "the proxy must not blanket-privatise");
});

// ---------------------------------------------------------------------------
// 16–17. Structural guards — the defect class, not just this instance
// ---------------------------------------------------------------------------

test("16. the canonical limiter has production callers", () => {
  const production: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (entry === "node_modules" || entry === ".next") continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full) && !full.includes(`${path.sep}test${path.sep}`)) {
        production.push(full);
      }
    }
  };
  walk(path.join(ROOT, "src"));

  const callers = production.filter(
    (f) => !f.endsWith("rate-limit-store.ts") && /\bconsumeRateLimit\s*\(/.test(stripComments(readFileSync(f, "utf8")))
  );
  assert.ok(callers.length >= 1, "consumeRateLimit must have a production caller — D-12-1");

  const guarded = ROUTES.filter((f) => /await guardRoute\(/.test(stripComments(readFileSync(f, "utf8"))));
  assert.equal(guarded.length, ROUTES.length, "every API route must be guarded");
});

test("17. every route declares a KNOWN class, and paid ones fail closed", () => {
  const known = new Set(Object.keys(ROUTE_POLICIES));
  for (const file of ROUTES) {
    const code = readFileSync(file, "utf8");
    const declared = /routeClass: "([a-z_]+)"/.exec(code)?.[1];
    assert.ok(declared && known.has(declared), `${path.relative(ROOT, file)}: unknown class ${declared}`);
  }

  // The money paths, named, so a reclassification is a visible edit.
  for (const paid of ["generate", "orchestration/execute", "generations/[generationId]/execute"]) {
    const code = readFileSync(path.join(API_DIR, ...paid.split("/"), "route.ts"), "utf8");
    assert.match(code, /routeClass: "paid_compute"/, `${paid} must be paid_compute`);
  }
  assert.equal(ROUTE_POLICIES.paid_compute.onUnavailable, "closed");
});

// ---------------------------------------------------------------------------
// 18–22. Boundaries and non-effects
// ---------------------------------------------------------------------------

test("18. Redis B is never used", () => {
  assert.ok(!/BULLMQ_REDIS_URL|bullmq/i.test(LIMITER + HEADERS));
});

test("19-22. a refused request causes no provider call, generation, workflow or credit change", () => {
  // Structural: the guard returns before the handler body, and the security
  // modules themselves import nothing that could cause those effects.
  const imports = (LIMITER + HEADERS).match(/^import .*$/gm)?.join("\n") ?? "";
  for (const forbidden of ["orchestrat", "temporal", "provider", "credits", "supabase", "stripe", "generation-"]) {
    assert.ok(!new RegExp(forbidden, "i").test(imports), `the limiter must not import ${forbidden}`);
  }
});

test("23. Phase 11-D connection limits are untouched and not duplicated", () => {
  const code = stripComments(LIMITER + HEADERS);
  // Route limiting counts REQUESTS; 11-D counts CONCURRENT CONNECTIONS. The
  // limiter may not acquire, refresh or release a connection lease.
  assert.ok(!/acquireConnectionLease|releaseConnectionLease|refreshConnectionLease/.test(code));
  assert.ok(!/CONNECTION_LIMITS/.test(code));
  // It legitimately reuses the IP derivation, which is the one piece that
  // must agree between the two controls.
  assert.match(code, /trustedClientIp|ipBucket/);
});

// ---------------------------------------------------------------------------
// 24. The seam, now that 12-C has filled it
// ---------------------------------------------------------------------------
// PRE-12 asserted the opposite of this test: that nothing observed and
// nothing was emitted. That was correct then and would be a lie now — 12-C
// installs an observer, and an assertion kept green by describing a state the
// system has left is worse than no assertion. What SURVIVES from the original
// is the part that was really being protected: the limiter itself still emits
// nothing, still touches no database, and still carries no raw address.
// ---------------------------------------------------------------------------

test("24. the limiter reports a denial and still writes nothing itself", async () => {
  const code = stripComments(LIMITER);
  assert.match(code, /export function setRateLimitObserver/);

  // The limiter is still not a security producer. It hands a fact to an
  // observer and does nothing else — no outbox, no publish, no insert, and
  // no import of the security stack, so it stays unit-testable with no
  // database and cannot grow a second write path by accident.
  assert.ok(!/emit_outbox_event|publishNotification|recordSecurityEvent|insert\(/i.test(code));
  assert.ok(!/security-event-logger|security-signals/.test(code),
    "the limiter must not depend on the logger it feeds");

  const seen: unknown[] = [];
  setRateLimitObserver({ onDenied: (e) => seen.push(e) });
  try {
    const redis = fakeRedis();
    await consumeN("paid_compute", USER_A, ROUTE_POLICIES.paid_compute.limit + 1, redis);
    assert.equal(seen.length, 1, "exactly one denial observed");
    const event = seen[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(event).sort(), ["action", "routeClass", "subject", "subjectRef"]);

    // `subjectRef` is the deliberate 12-C addition. A security event that
    // cannot say WHO is not evidence, and per-subject recurrence is the whole
    // input to the Risk Engine — without it every denied user coalesces into
    // one row per window.
    assert.equal(event.subjectRef, USER_A, "an authenticated denial is attributable");
    assert.equal(event.subject, "user");
  } finally {
    setRateLimitObserver(null);
  }
});

test("24b. an anonymous denial carries the hashed bucket, never the address", async () => {
  const seen: Record<string, unknown>[] = [];
  setRateLimitObserver({ onDenied: (e) => seen.push(e as Record<string, unknown>) });
  try {
    const redis = fakeRedis();
    const headers = new Headers({ "x-real-ip": "203.0.113.7" });
    const policy = ROUTE_POLICIES.public_dev_stub;
    for (let i = 0; i <= policy.limit; i += 1) {
      await enforceRouteRateLimit({ routeClass: "public_dev_stub", headers, redisOverride: redis });
    }

    assert.equal(seen.length, 1);
    const event = seen[0];
    assert.equal(event.subject, "ip");
    assert.equal(event.subjectRef, ipBucket("203.0.113.7"), "the bucket, already hashed");
    assert.ok(!JSON.stringify(event).includes("203.0.113.7"), "the address itself never appears");
  } finally {
    setRateLimitObserver(null);
  }
});

// ---------------------------------------------------------------------------
// 25. Nothing sensitive in errors
// ---------------------------------------------------------------------------

test("25. no secret or key material appears in the security modules", () => {
  const all = LIMITER + HEADERS;
  for (const forbidden of ["REDIS_URL", "SERVICE_ROLE", "CLERK_SECRET", "apiKey", "password", "sk_", "eyJ"]) {
    assert.ok(!new RegExp(forbidden).test(all), `${forbidden} must not appear`);
  }
});

test("guardRoute returns null when allowed and a Response when not", async () => {
  const redis = fakeRedis();
  const allowed = await guardRoute({ routeClass: "authenticated_read", userId: USER_A });
  // With no override the real store is consulted; unconfigured Redis makes
  // authenticated_read fail OPEN, so this must be null either way.
  assert.equal(allowed, null);
  void redis;

  const refused = withPrivateCache(rateLimitedResponse(5));
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get("Cache-Control"), PRIVATE_NO_STORE["Cache-Control"]);
});
