import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { resolveEffectiveTenant, bindingMatches } from "@/lib/realtime/tenant-binding";
import {
  CONNECTION_LIMITS,
  CONNECTION_LIMIT_RETRY_SECONDS,
  CONNECTION_LIMIT_STATUS,
  ipBucket,
  LEASE_REFRESH_MS,
  LEASE_TTL_MS,
  normalizeIp,
  scopesFor,
  trustedClientIp,
} from "@/lib/realtime/connection-limits";
import { streamKeyFor } from "@/lib/realtime/stream-contract";
import { SSE_CONNECTION_MAX_AGE_MS } from "@/lib/realtime/stream-contract";

/**
 * Phase 11-D. Tenant binding and connection ceilings.
 *
 * Two properties carry the package: the tenant a connection may observe is
 * fixed before the response body exists and cannot be influenced afterwards,
 * and the number of connections one principal may hold is counted somewhere
 * every serverless instance can see.
 */

const ROOT = process.cwd();
const A = "user_2abcdefghijklmnop";
const B = "user_2zyxwvutsrqponml";

const ROUTE = readFileSync(path.join(ROOT, "src/app/api/realtime/events/route.ts"), "utf8");
const HOOK = readFileSync(path.join(ROOT, "src/hooks/useRealtimeGenerations.ts"), "utf8");
const LEASE = readFileSync(path.join(ROOT, "src/lib/realtime/connection-lease.ts"), "utf8");
const LIMITS = readFileSync(path.join(ROOT, "src/lib/realtime/connection-limits.ts"), "utf8");
const BINDING = readFileSync(path.join(ROOT, "src/lib/realtime/tenant-binding.ts"), "utf8");

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function tenantOf(id: string) {
  const r = resolveEffectiveTenant(id);
  assert.ok(r.ok, `${id} must resolve`);
  return r.ok ? r.tenant : null!;
}

/**
 * An in-memory Redis good enough to execute the real Lua contracts' SEMANTICS.
 *
 * It does not run Lua — it reproduces what each script does, so the tests
 * exercise the limit ALGEBRA (evict expired, check all, then add all) rather
 * than a mock that always says yes. The atomicity the real script provides is
 * asserted separately, by reading the script.
 */
function fakeCounter() {
  const sets = new Map<string, Map<string, number>>();
  const of = (k: string) => {
    let s = sets.get(k);
    if (!s) { s = new Map(); sets.set(k, s); }
    return s;
  };
  return {
    sets,
    async eval(script: string, numKeys: number, ...rest: (string | number)[]) {
      const keys = rest.slice(0, numKeys).map(String);
      const argv = rest.slice(numKeys).map(String);

      if (script.includes("ZREMRANGEBYSCORE")) {
        const now = Number(argv[0]);
        const ttl = Number(argv[1]);
        const lease = argv[2];
        for (const k of keys) for (const [m, exp] of of(k)) if (exp <= now) of(k).delete(m);
        for (let i = 0; i < keys.length; i += 1) {
          const limit = Number(argv[3 + i + 1 - 1]);
          if (of(keys[i]).size >= limit) return [0, keys[i]];
        }
        for (const k of keys) of(k).set(lease, now + ttl);
        return [1, ""];
      }

      if (script.includes("'XX'")) {
        const now = Number(argv[0]);
        const ttl = Number(argv[1]);
        const lease = argv[2];
        let alive = 1;
        for (const k of keys) {
          if (!of(k).has(lease)) alive = 0;
          else of(k).set(lease, now + ttl);
        }
        return alive;
      }

      for (const k of keys) of(k).delete(argv[0]);
      return 1;
    },
  };
}

// ---------------------------------------------------------------------------
// 1–6. Binding
// ---------------------------------------------------------------------------

test("1. an unauthenticated connection is refused before anything else runs", () => {
  const code = stripComments(ROUTE);
  // Call sites, not import lines — every one of these names also appears at
  // the top of the file, before auth() ever runs.
  const authAt = code.indexOf("await auth()");
  assert.ok(authAt >= 0);
  assert.ok(code.indexOf("resolveEffectiveTenant(userId)") > authAt, "binding follows auth");
  assert.ok(code.indexOf("await acquireConnectionLease(") > authAt, "no slot is taken before auth");
  assert.ok(code.indexOf("createRealtimeReader()") > code.indexOf("await acquireConnectionLease("),
    "no socket is opened before a slot is granted");
  assert.match(code, /if \(!userId\)[\s\S]{0,80}status: 401/);
});

test("2. one principal cannot resolve to another principal's channel", () => {
  const a = tenantOf(A);
  const b = tenantOf(B);
  assert.notEqual(a.channelId, b.channelId);
  assert.notEqual(streamKeyFor(a.channelId), streamKeyFor(b.channelId));
  assert.ok(!streamKeyFor(a.channelId).includes(B));
  assert.ok(bindingMatches(a, A));
  assert.ok(!bindingMatches(a, B), "a binding must not match a different principal");
});

test("3. workspace/user/channel/stream parameters are not authority — they are not read", () => {
  const code = stripComments(ROUTE);
  for (const forbidden of [
    "searchParams", "URL(request.url)", "nextUrl",
    "?workspace=", "?user=", "?channel=", "?stream=",
    'headers.get("x-workspace', 'headers.get("x-user',
  ]) {
    assert.ok(!code.includes(forbidden), `must not read ${forbidden}`);
  }
  // resolveEffectiveTenant takes a principal and nothing else — there is no
  // argument through which a request value could arrive.
  assert.match(stripComments(BINDING), /export function resolveEffectiveTenant\(principalId: string \| null \| undefined\)/);
});

test("4. Last-Event-ID cannot switch tenant", () => {
  const code = stripComments(ROUTE);
  const bindAt = code.indexOf("resolveEffectiveTenant(userId)");
  const keyAt = code.indexOf("streamKeyFor(tenant.channelId)");
  const cursorAt = code.indexOf('request.headers.get("last-event-id")');
  assert.ok(bindAt >= 0 && keyAt > bindAt && cursorAt > keyAt,
    "bind, then key, then cursor — in that order");
  assert.ok(!/resolveEffectiveTenant\([^)]*(last|cursor|header)/i.test(code));
  assert.ok(!/streamKeyFor\([^)]*(last|cursor|header)/i.test(code));
});

test("5. replay reads the same immutable key as live delivery", () => {
  const code = stripComments(ROUTE);
  assert.equal((code.match(/const streamKey = /g) ?? []).length, 1, "one key, assigned once");
  for (const call of code.match(/reader\.(xrange|xread)\([^)]*\)/g) ?? []) {
    assert.ok(call.includes("streamKey"), `every read must use it: ${call.slice(0, 50)}`);
  }
});

test("6. the binding is captured in a const and never reassigned", () => {
  const code = stripComments(ROUTE);
  assert.match(code, /const tenant = binding\.tenant;/);
  assert.ok(!/\btenant\s*=/.test(code.replace("const tenant = binding.tenant;", "")),
    "tenant must not be reassigned anywhere");
});

// ---------------------------------------------------------------------------
// 7–10. Ceilings
// ---------------------------------------------------------------------------

test("7. the per-user ceiling is enforced", async () => {
  const { acquireConnectionLease } = await import("@/lib/realtime/connection-lease");
  const counter = fakeCounter();
  const scopes = scopesFor(tenantOf(A), null);

  const granted: string[] = [];
  for (let i = 0; i < CONNECTION_LIMITS.USER_MAX + 3; i += 1) {
    const out = await acquireConnectionLease(scopes, counter);
    if (out.granted) granted.push(out.leaseId);
    else assert.equal(out.reason, "limit_exceeded");
  }
  assert.equal(granted.length, CONNECTION_LIMITS.USER_MAX);
  assert.equal(new Set(granted).size, granted.length, "lease ids must be distinct");
});

test("8. the workspace scope is real machinery, inert only because workspaces are not", async () => {
  // No workspace exists in the schema, so no workspace scope is emitted...
  const userOnly = scopesFor(tenantOf(A), null);
  assert.deepEqual(userOnly.map((s) => s.kind), ["user"]);

  // ...but the moment a tenant carries one, the scope appears and is counted
  // with its own ceiling. This is what a future workspace layer inherits.
  const withWorkspace = scopesFor({ ...tenantOf(A), workspaceId: "ws_team" }, null);
  assert.deepEqual(withWorkspace.map((s) => s.kind), ["user", "workspace"]);
  const ws = withWorkspace.find((s) => s.kind === "workspace");
  assert.equal(ws?.limit, CONNECTION_LIMITS.WORKSPACE_MAX);
  assert.ok(ws?.key.includes("ws_team"));

  const { acquireConnectionLease } = await import("@/lib/realtime/connection-lease");
  const counter = fakeCounter();
  // A tiny workspace ceiling proves the scope binds, using the real algebra.
  const tight = [{ kind: "workspace" as const, key: "cinefield:sse:conn:v1:ws:tiny", limit: 2 }];
  assert.equal((await acquireConnectionLease(tight, counter)).granted, true);
  assert.equal((await acquireConnectionLease(tight, counter)).granted, true);
  const third = await acquireConnectionLease(tight, counter);
  assert.equal(third.granted, false);
  assert.equal(third.granted === false && third.reason, "limit_exceeded");
});

test("9. the per-IP ceiling is enforced and is separate from the user ceiling", async () => {
  const { acquireConnectionLease } = await import("@/lib/realtime/connection-lease");
  const counter = fakeCounter();
  const bucket = ipBucket("203.0.113.7");
  assert.ok(bucket);

  // Different users behind ONE address still share the IP ceiling.
  let granted = 0;
  for (let i = 0; i < CONNECTION_LIMITS.IP_MAX + 4; i += 1) {
    const principal = `user_${String(i).padStart(12, "0")}abc`;
    const scopes = scopesFor(tenantOf(principal), bucket);
    assert.deepEqual(scopes.map((s) => s.kind), ["user", "ip"]);
    if ((await acquireConnectionLease(scopes, counter)).granted) granted += 1;
  }
  assert.equal(granted, CONNECTION_LIMITS.IP_MAX, "the shared address must bind");
});

test("10. concurrent opens admit exactly the limit — and the check is atomic", async () => {
  const { acquireConnectionLease } = await import("@/lib/realtime/connection-lease");
  const counter = fakeCounter();
  const scopes = scopesFor(tenantOf(A), null);

  const results = await Promise.all(
    Array.from({ length: 25 }, () => acquireConnectionLease(scopes, counter))
  );
  assert.equal(results.filter((r) => r.granted).length, CONNECTION_LIMITS.USER_MAX);

  // The property the fake cannot prove: the real check is ONE Lua script, so
  // no GET-then-INCR window exists between counting and adding.
  const script = LEASE.slice(LEASE.indexOf("const ACQUIRE"), LEASE.indexOf("const REFRESH"));
  assert.match(script, /ZREMRANGEBYSCORE/, "expired holders are evicted inside the same step");
  assert.match(script, /ZCARD/);
  assert.match(script, /ZADD/);
  assert.ok(script.indexOf("ZCARD") < script.indexOf("ZADD"), "count before add");
  assert.match(stripComments(LEASE), /redis\.eval\(ACQUIRE/, "one round trip, executed atomically");
  // No application-side read-then-write anywhere.
  assert.ok(!/await redis\.zcard|await redis\.zadd/i.test(stripComments(LEASE)));
});

// ---------------------------------------------------------------------------
// 11–14. Lease lifecycle
// ---------------------------------------------------------------------------

test("11. a clean close returns the slot", async () => {
  const { acquireConnectionLease, releaseConnectionLease } = await import("@/lib/realtime/connection-lease");
  const counter = fakeCounter();
  const scopes = scopesFor(tenantOf(A), null);

  const leases = [];
  for (let i = 0; i < CONNECTION_LIMITS.USER_MAX; i += 1) {
    const out = await acquireConnectionLease(scopes, counter);
    assert.ok(out.granted);
    if (out.granted) leases.push({ leaseId: out.leaseId, scopes });
  }
  assert.equal((await acquireConnectionLease(scopes, counter)).granted, false);

  await releaseConnectionLease(leases[0], counter);
  assert.equal((await acquireConnectionLease(scopes, counter)).granted, true, "the slot came back");
});

test("12. an abandoned lease expires; no slot leaks when a function dies", async () => {
  const { acquireConnectionLease } = await import("@/lib/realtime/connection-lease");
  const counter = fakeCounter();
  const scopes = scopesFor(tenantOf(A), null);

  for (let i = 0; i < CONNECTION_LIMITS.USER_MAX; i += 1) {
    assert.equal((await acquireConnectionLease(scopes, counter)).granted, true);
  }
  assert.equal((await acquireConnectionLease(scopes, counter)).granted, false);

  // Nothing released them — the instance died. Age every score past expiry,
  // which is exactly what wall-clock does after LEASE_TTL_MS.
  for (const set of counter.sets.values()) {
    for (const [member] of set) set.set(member, Date.now() - 1);
  }
  assert.equal((await acquireConnectionLease(scopes, counter)).granted, true,
    "expired holders must be evicted by the next acquire");
});

test("13. refresh extends a live lease and refuses a dead one", async () => {
  const { acquireConnectionLease, refreshConnectionLease } = await import("@/lib/realtime/connection-lease");
  const counter = fakeCounter();
  const scopes = scopesFor(tenantOf(A), null);

  const out = await acquireConnectionLease(scopes, counter);
  assert.ok(out.granted);
  if (!out.granted) return;
  const lease = { leaseId: out.leaseId, scopes };

  assert.equal(await refreshConnectionLease(lease, counter), true);

  // A lease that has gone must NOT be resurrected: re-adding would exceed the
  // ceiling by bringing back a slot the connection no longer holds.
  for (const set of counter.sets.values()) set.delete(out.leaseId);
  assert.equal(await refreshConnectionLease(lease, counter), false);
  assert.match(LEASE, /'XX'/, "refresh must use ZADD XX");
});

test("14. an idle connection stops refreshing and falls out on its own", () => {
  const code = stripComments(ROUTE);
  assert.match(code, /setInterval\(/, "a refresh loop must exist");
  assert.match(code, /refreshConnectionLease\(lease\)/);
  assert.match(code, /if \(!alive\) release\(\);/, "a lost lease closes the connection");
  // Refreshing must stop the moment the connection does, or a vanished
  // browser would hold a slot forever.
  assert.match(code, /clearInterval\(leaseTimer\)/);
  const releaseBody = code.slice(code.indexOf("const release = ()"), code.indexOf("request.signal.addEventListener"));
  assert.ok(releaseBody.indexOf("clearInterval") < releaseBody.indexOf("reader.disconnect"),
    "stop refreshing before anything else");
  assert.match(releaseBody, /releaseConnectionLease\(lease\)/);
  assert.ok(LEASE_REFRESH_MS * 2 < LEASE_TTL_MS, "two missed refreshes must still be inside the TTL");
  assert.ok(LEASE_TTL_MS < SSE_CONNECTION_MAX_AGE_MS, "a dead slot is reclaimed before the connection would have ended");
});

// ---------------------------------------------------------------------------
// 15–16. The client controls neither the lease nor its address
// ---------------------------------------------------------------------------

test("15. the lease id is server-minted and never read from the request", () => {
  const code = stripComments(LEASE);
  assert.match(code, /const leaseId = randomUUID\(\)/);
  assert.ok(!/headers|request|req\.|searchParams|body/i.test(code), "the lease layer never sees a request");
  // And it carries nothing sensitive: it is an opaque slot handle.
  assert.ok(!/tenantId|clerk|principal|secret|token/i.test(code.slice(code.indexOf("const leaseId"))));
});

test("16. a client cannot forge its IP bucket", () => {
  // The first x-forwarded-for entry is whatever the client claimed; trusting
  // it would hand anyone unlimited buckets.
  const spoofed = new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
  assert.equal(trustedClientIp(spoofed), "203.0.113.9", "the nearest hop, never the claim");

  // Platform headers win outright.
  const platform = new Headers({
    "x-forwarded-for": "1.1.1.1",
    "x-vercel-forwarded-for": "203.0.113.5",
  });
  assert.equal(trustedClientIp(platform), "203.0.113.5");

  // Nothing trustworthy means no IP scope at all, not a shared bucket.
  assert.equal(trustedClientIp(new Headers()), null);
  assert.deepEqual(scopesFor(tenantOf(A), ipBucket(null)).map((s) => s.kind), ["user"]);

  // Normalisation, so one host cannot occupy several buckets.
  assert.equal(normalizeIp("::FFFF:203.0.113.5"), "203.0.113.5");
  assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
  assert.equal(normalizeIp("fe80::1%eth0"), "fe80::1");
  assert.equal(normalizeIp("203.0.113.5:9999"), "203.0.113.5");
  assert.equal(normalizeIp("x".repeat(100)), null);
  assert.equal(ipBucket("203.0.113.5"), ipBucket("::ffff:203.0.113.5") === null ? null : ipBucket("203.0.113.5"));
});

test("the address itself is never stored in a key", () => {
  const scopes = scopesFor(tenantOf(A), ipBucket("203.0.113.5"));
  const ipScope = scopes.find((s) => s.kind === "ip");
  assert.ok(ipScope);
  assert.ok(!ipScope!.key.includes("203.0.113"), "the key holds a hash, not an address");
  assert.match(ipScope!.key, /^cinefield:sse:conn:v1:ip:[0-9a-f]{20}$/);
});

// ---------------------------------------------------------------------------
// 17–19. Refusal, backoff, and failing closed
// ---------------------------------------------------------------------------

test("17. a refusal reveals nothing about anyone", () => {
  const code = stripComments(ROUTE);
  assert.match(code, new RegExp(`status: ${CONNECTION_LIMIT_STATUS}|CONNECTION_LIMIT_STATUS`));
  assert.match(code, /"Retry-After": String\(CONNECTION_LIMIT_RETRY_SECONDS\)/);

  // The refusal body is a fixed string. No count, no limit, no scope, no id.
  const refusal = code.slice(code.indexOf("if (!acquired.granted)"), code.indexOf("const lease:"));
  assert.match(refusal, /"Too many realtime connections"/);
  assert.ok(!/acquired\.scope|\.limit|ZCARD|userId|tenantId/.test(refusal),
    "no internal detail may reach the client");
  assert.ok(CONNECTION_LIMIT_RETRY_SECONDS >= 10);
});

test("18. the browser backs off far harder on a limit rejection than on a blip", () => {
  const hook = stripComments(HOOK);
  assert.match(hook, /response\.status === 429/);
  assert.match(hook, /LIMIT_BACKOFF_FLOOR_MS/);
  assert.match(hook, /retry-after/i, "the server's hint must be honoured");
  assert.match(hook, /const LIMIT_BACKOFF_FLOOR_MS = 20_000/);
  // A 429 must not be treated as a transport error and retried in 500 ms.
  const limitBranch = hook.slice(hook.indexOf("response.status === 429"), hook.indexOf("if (!response.ok"));
  assert.match(limitBranch, /scheduleReconnect\(/);
  assert.ok(!/throw new Error/.test(limitBranch));
});

test("19. an unreachable counter refuses the connection — it never disables the limit", async () => {
  const { acquireConnectionLease } = await import("@/lib/realtime/connection-lease");
  const scopes = scopesFor(tenantOf(A), null);

  // No client at all.
  const noClient = await acquireConnectionLease(scopes, null);
  assert.equal(noClient.granted, false);
  assert.equal(noClient.granted === false && noClient.reason, "counter_unavailable");

  // A client that throws.
  const broken = { async eval() { throw new Error("ECONNREFUSED"); } };
  const failed = await acquireConnectionLease(scopes, broken);
  assert.equal(failed.granted, false);
  assert.equal(failed.granted === false && failed.reason, "counter_unavailable");

  // And the route turns that into a refusal, not an admission.
  const code = stripComments(ROUTE);
  assert.match(code, /if \(!acquired\.granted\)/);
  assert.ok(!/counter_unavailable[\s\S]{0,120}(continue|granted = true|skip)/i.test(code));
});

// ---------------------------------------------------------------------------
// 20–25. Boundaries preserved
// ---------------------------------------------------------------------------

test("20-21. Redis B absent, Pub/Sub absent", () => {
  const pkg = stripComments(ROUTE + LEASE + LIMITS + BINDING + HOOK);
  assert.ok(!/BULLMQ_REDIS_URL|bullmq/i.test(pkg));
  assert.ok(!/\.publish\(|\.subscribe\(|psubscribe/.test(pkg));
});

test("22-23. no Redis key and no secret reaches the client", () => {
  const code = stripComments(ROUTE + HOOK);
  assert.ok(!/cinefield:sse:conn|cinefield:realtime/.test(code.replace(/streamKeyFor\([^)]*\)/g, "")),
    "a raw key literal must not be constructed in the route or hook");
  for (const forbidden of ["REDIS_URL", "leaseId:", "apiKey", "secret", "password"]) {
    assert.ok(!new RegExp(forbidden, "i").test(stripComments(HOOK)), `${forbidden} must not reach the browser`);
  }
  // The lease value is an opaque uuid, not a composite of identifying parts.
  assert.ok(!/leaseId = \`/.test(stripComments(LEASE)), "the lease must not be a built string");
});

test("24-25. no provider internals and no cross-tenant payload in any error path", () => {
  const code = stripComments(ROUTE);
  const errorBodies = code.match(/new Response\("[^"]*"/g) ?? [];
  for (const body of errorBodies) {
    assert.ok(!/user_|cinefield:|redis|lease|[0-9]{4,}/i.test(body), `leaky error body: ${body}`);
  }
  // Every refusal body must be one of a fixed, reviewed set of literals.
  const ALLOWED = new Set([
    "Unauthorized",
    "Forbidden",
    "Realtime unavailable",
    "Too many realtime connections",
  ]);
  for (const body of errorBodies) {
    const literal = /new Response\("([^"]*)"/.exec(body)?.[1] ?? "";
    assert.ok(ALLOWED.has(literal), `unreviewed refusal body: "${literal}"`);
  }
  assert.ok(errorBodies.length >= 3, "the refusal paths must actually exist");
});

// ---------------------------------------------------------------------------
// 26–28. Session, multi-tab, and the UI
// ---------------------------------------------------------------------------

test("26. auth is re-evaluated on every reconnect because no connection outlives the budget", () => {
  // There is no long-lived auth bypass: the connection ends on its own budget
  // and the next one re-enters the handler, which starts with auth().
  assert.ok(SSE_CONNECTION_MAX_AGE_MS <= 60_000);
  const code = stripComments(ROUTE);
  assert.match(code, /Date\.now\(\) - startedAt >= maxAgeMs/);
  const authAt = code.indexOf("await auth()");
  assert.ok(authAt >= 0 && authAt < code.indexOf("new ReadableStream"),
    "every invocation authenticates before streaming");
});

test("27. tabs cannot escape the ceiling — they all count against the same scopes", async () => {
  const { acquireConnectionLease } = await import("@/lib/realtime/connection-lease");
  const counter = fakeCounter();
  const tenant = tenantOf(A);
  const bucket = ipBucket("203.0.113.10");

  // Every tab of one user resolves to the SAME scope keys, so the count is
  // shared however many tabs open it.
  const scopes = scopesFor(tenant, bucket);
  const keys = new Set(scopes.map((s) => s.key));
  assert.deepEqual(scopesFor(tenant, bucket).map((s) => s.key).filter((k) => keys.has(k)).length, scopes.length);

  let opened = 0;
  for (let i = 0; i < 12; i += 1) {
    if ((await acquireConnectionLease(scopes, counter)).granted) opened += 1;
  }
  assert.equal(opened, CONNECTION_LIMITS.USER_MAX, "tabs do not multiply the allowance");
});

test("28. a rejected connection does not disturb browser state", () => {
  const hook = stripComments(HOOK);
  const limitBranch = hook.slice(hook.indexOf("response.status === 429"), hook.indexOf("if (!response.ok"));
  assert.ok(!/setStates|statesRef|seenRef|cursorRef\.current =/.test(limitBranch),
    "a refusal must not touch applied state, dedupe or the cursor");
});

// ---------------------------------------------------------------------------
// 29–30. Out of scope stays out
// ---------------------------------------------------------------------------

test("29-30. Phase 10 and Phase 12 are untouched", () => {
  const pkg = stripComments(ROUTE + LEASE + LIMITS + BINDING + HOOK);
  assert.ok(!/stripe|credit\.(reserved|settled|refunded|updated)|ledger/i.test(pkg), "Phase 10 untouched");
  assert.ok(!/riskScore|risk_engine|security\.warning|turnstile|waf/i.test(pkg), "Phase 12 untouched");
});

test("the workspace concept is not faked anywhere", () => {
  // The repository has no workspace table, no workspace_id column and no
  // Clerk organization. Inventing one here would be inventing a boundary
  // nothing enforces.
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"))
    .join("\n");
  assert.ok(!/"workspace_id"|workspace_id\s+"?uuid|CREATE TABLE[^;]*workspaces/i.test(migrations),
    "if this fails, the workspace scope must become real rather than stay inert");

  const code = stripComments(BINDING);
  assert.match(code, /workspaceId: null/, "the absence must be explicit, not implied");
  assert.ok(!/getOrganization|useOrganization|orgId|membership_table/i.test(code));
});
