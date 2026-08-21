import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { guardBrowserMutation } from "@/lib/security/privileged-mutation-guard";

/**
 * SECURITY_FINDINGS_9751bd11 — finding 3, and the inventory guard.
 *
 * The point of these is that a NEW mutating route cannot quietly appear
 * without a decision being recorded about it. A guard that merely counted
 * today's routes would pass forever while the real surface grew.
 */

const ROOT = process.cwd();
const API = path.join(ROOT, "src/app/api");

function walkRoutes(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walkRoutes(full));
    else if (entry === "route.ts") found.push(full);
  }
  return found;
}

const MUTATES = /export async function (POST|PUT|PATCH|DELETE)\b/;

/**
 * Every mutating route, and the decision recorded for it.
 *
 * A route is in exactly one bucket. Adding a mutating route without adding it
 * here fails `S3-1`, which is the whole point — the inventory cannot rot
 * silently.
 */
const CLASSIFICATION: Readonly<Record<string, "browser_session" | "admin_privileged" | "internal_shared_secret" | "anonymous_stub">> = {
  // --- admin: already guarded by guardPrivilegedMutation (Phase 16-E) ------
  "admin/dlq/redrive": "admin_privileged",
  "admin/feature-flags/set": "admin_privileged",
  "admin/game-day/record": "admin_privileged",
  "admin/moderation/release": "admin_privileged",
  "admin/privacy/execute": "admin_privileged",
  "admin/privileged-actions/decide": "admin_privileged",
  "admin/queue-health/bullmq-retry": "admin_privileged",
  "admin/router/disable": "admin_privileged",
  "admin/secrets/rotate": "admin_privileged",
  "admin/temporal/[generationId]/cancel": "admin_privileged",
  // A user-facing route that already used the privileged guard before this
  // batch — the precedent that this is not admin-only machinery.
  "privacy/requests": "admin_privileged",

  // --- browser session: guarded by this batch -----------------------------
  "generate": "browser_session",
  "generations/[generationId]/appeal": "browser_session",
  "generations/[generationId]/cancel": "browser_session",
  "generations/[generationId]/execute": "browser_session",
  "media/upload-url": "browser_session",
  "orchestration/analyze-image": "browser_session",
  "orchestration/embed-text": "browser_session",
  "orchestration/enhance-prompt": "browser_session",
  "orchestration/execute": "browser_session",
  "orchestration/moderate-text": "browser_session",
  "orchestration/rerank-text": "browser_session",
  "product-intelligence/compile": "browser_session",
  "product-intelligence/execute": "browser_session",

  // --- CSRF_NOT_APPLICABLE_INTERNAL_AUTH ----------------------------------
  // Shared-secret, service-to-service. No ambient browser credential exists
  // to ride on, so an origin check protects nothing here — and requiring one
  // would break a CI job that legitimately sends no Origin header.
  "internal/infra/drift-report": "internal_shared_secret",
  "internal/secrets/access-anomaly": "internal_shared_secret",

  // --- anonymous ----------------------------------------------------------
  // No session at all (routeClass public_dev_stub). CSRF requires a
  // credential the browser attaches automatically; there is none. Recorded
  // as a pre-existing unauthenticated mutation surface, not fixed here.
  "generate-video": "anonymous_stub",
};

function routeKey(file: string): string {
  return path.relative(API, path.dirname(file)).split(path.sep).join("/");
}

// ===========================================================================
// Inventory
// ===========================================================================

test("S3-1  every mutating route is explicitly classified — a new one cannot appear unnoticed", () => {
  const mutating = walkRoutes(API)
    .filter((f) => MUTATES.test(readFileSync(f, "utf8")))
    .map(routeKey)
    .sort();

  const classified = Object.keys(CLASSIFICATION).sort();

  const unclassified = mutating.filter((r) => !(r in CLASSIFICATION));
  assert.deepEqual(unclassified, [], "these mutating routes have no recorded CSRF decision");

  const stale = classified.filter((r) => !mutating.includes(r));
  assert.deepEqual(stale, [], "these classified routes no longer exist");
});

test("S3-2  every browser-session mutation calls the same-origin guard", () => {
  for (const [route, kind] of Object.entries(CLASSIFICATION)) {
    if (kind !== "browser_session") continue;
    const src = readFileSync(path.join(API, route, "route.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.match(src, /guardBrowserMutation\(request\)/, `${route} must call the guard`);
    // Before any side effect: the guard result is returned immediately.
    assert.match(src, /if \(crossOrigin\) return crossOrigin;/, `${route} must refuse immediately`);
  }
});

test("S3-3  the guard runs BEFORE auth and before the rate limiter", () => {
  for (const [route, kind] of Object.entries(CLASSIFICATION)) {
    if (kind !== "browser_session") continue;
    const src = readFileSync(path.join(API, route, "route.ts"), "utf8");
    const guard = src.indexOf("guardBrowserMutation(request)");
    const authAt = src.indexOf("await auth()");
    const limit = src.indexOf("guardRoute(");
    assert.ok(guard > 0, `${route}: guard missing`);
    if (authAt > 0) assert.ok(guard < authAt, `${route}: guard must precede auth()`);
    if (limit > 0) assert.ok(guard < limit, `${route}: guard must precede the rate limiter`);
  }
});

test("S3-4  internal shared-secret routes are NOT forced onto a browser guard", () => {
  for (const [route, kind] of Object.entries(CLASSIFICATION)) {
    if (kind !== "internal_shared_secret") continue;
    const src = readFileSync(path.join(API, route, "route.ts"), "utf8");
    assert.ok(
      !/guardBrowserMutation|guardPrivilegedMutation/.test(src),
      `${route}: CSRF_NOT_APPLICABLE_INTERNAL_AUTH — an origin check here protects nothing and breaks the CI caller`
    );
    // But the shared-secret comparison itself must be constant-time.
    assert.match(src, /timingSafeEqual/, `${route}: the shared secret must be compared in constant time`);
  }
});

test("S3-5  admin routes keep the privileged guard — this batch did not swap it out", () => {
  for (const [route, kind] of Object.entries(CLASSIFICATION)) {
    if (kind !== "admin_privileged") continue;
    const src = readFileSync(path.join(API, route, "route.ts"), "utf8");
    assert.match(src, /guardPrivilegedMutation/, `${route} must keep the stricter privileged guard`);
  }
});

// ===========================================================================
// Behaviour — the guard itself
// ===========================================================================

function req(headers: Record<string, string>): Request {
  return new Request("https://cinefield-ai.vercel.app/api/generate", { method: "POST", headers });
}

test("S3-6  same-origin JSON passes; foreign, malformed and missing Origin are refused", () => {
  assert.equal(
    guardBrowserMutation(req({ origin: "https://cinefield-ai.vercel.app", "content-type": "application/json" })),
    null,
    "the app's own origin must pass"
  );

  for (const [label, headers] of [
    ["foreign origin", { origin: "https://evil.example", "content-type": "application/json" }],
    ["http downgrade of own host", { origin: "http://cinefield-ai.vercel.app", "content-type": "application/json" }],
    ["lookalike host", { origin: "https://cinefield-ai.vercel.app.evil.example", "content-type": "application/json" }],
    ["malformed origin", { origin: "not-a-url", "content-type": "application/json" }],
    ["null origin", { origin: "null", "content-type": "application/json" }],
  ] as const) {
    const refused = guardBrowserMutation(req(headers as Record<string, string>));
    assert.ok(refused, `${label} must be refused`);
    assert.equal(refused!.status, 403, label);
  }

  const noOrigin = guardBrowserMutation(req({ "content-type": "application/json" }));
  assert.ok(noOrigin && noOrigin.status === 403, "a missing Origin is treated as suspicious, not tolerated");
});

test("S3-7  a bodyless same-origin POST passes — the locked Cinema Studio call still works", () => {
  // CinemaStudioWorkspace calls POST /api/generations/[id]/execute as a bare
  // fetch with no body and no Content-Type. That file is locked UI, so the
  // guard has to accept the shape rather than the shape being changed.
  assert.equal(
    guardBrowserMutation(req({ origin: "https://cinefield-ai.vercel.app" })),
    null,
    "no Content-Type means no body; the Origin check is the control"
  );
});

test("S3-8  a declared non-JSON body is refused — the text/plain CSRF vehicle stays closed", () => {
  for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    const refused = guardBrowserMutation(
      req({ origin: "https://cinefield-ai.vercel.app", "content-type": ct })
    );
    assert.ok(refused, `${ct} must be refused even same-origin`);
    assert.equal(refused!.status, 415, ct);
  }
});

test("S3-9  the guard is additive — it grants nothing and knows no identity", () => {
  const src = readFileSync(path.join(ROOT, "src/lib/security/privileged-mutation-guard.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["auth(", "clerk", "userId", "requireAdminAccess", "session"]) {
    assert.ok(!src.toLowerCase().includes(forbidden.toLowerCase()), `the guard must not touch ${forbidden}`);
  }
  // One definition of same-origin in this codebase, shared by both guards.
  assert.equal((src.match(/function isSameOrigin/g) ?? []).length, 1);
  assert.equal((src.match(/function requestOwnOrigin/g) ?? []).length, 1);
});

// ===========================================================================
// SECURITY_FINDINGS_9751bd11 — finding 4: immutable action pinning
// ===========================================================================

const WORKFLOWS = path.join(ROOT, ".github/workflows");
const USES = /uses:\s*(\S+)/g;

function allActionRefs(): { file: string; ref: string }[] {
  const refs: { file: string; ref: string }[] = [];
  for (const f of readdirSync(WORKFLOWS).filter((x) => x.endsWith(".yml"))) {
    const src = readFileSync(path.join(WORKFLOWS, f), "utf8");
    for (const m of src.matchAll(USES)) refs.push({ file: f, ref: m[1] });
  }
  return refs;
}

test("S4-1  every action is pinned to a full 40-character commit SHA", () => {
  const bad = allActionRefs().filter(({ ref }) => !/@[0-9a-f]{40}$/.test(ref));
  assert.deepEqual(
    bad.map((b) => `${b.file}: ${b.ref}`),
    [],
    "a moving tag, branch or short SHA lets a compromised upstream change what CI runs"
  );
  // Sanity: the guard is looking at a real inventory, not an empty one.
  assert.ok(allActionRefs().length >= 25, "the workflow inventory must not have silently emptied");
});

test("S4-2  every pinned SHA carries a readable version comment", () => {
  for (const f of readdirSync(WORKFLOWS).filter((x) => x.endsWith(".yml"))) {
    const src = readFileSync(path.join(WORKFLOWS, f), "utf8");
    for (const line of src.split("\n")) {
      if (!/uses:\s*\S+@[0-9a-f]{40}/.test(line)) continue;
      assert.match(
        line,
        /#\s*v[\d.]+/,
        `${f}: a bare SHA is unreadable in review — keep the version beside it: ${line.trim()}`
      );
    }
  }
});

test("S4-3  the two privileged lanes are pinned — OIDC apply and attestation", () => {
  for (const f of ["infra-apply.yml", "supply-chain-ci.yml"]) {
    const src = readFileSync(path.join(WORKFLOWS, f), "utf8");
    const refs = [...src.matchAll(USES)].map((m) => m[1]);
    assert.ok(refs.length > 0, `${f} must still use actions`);
    for (const ref of refs) {
      assert.match(ref, /@[0-9a-f]{40}$/, `${f}: ${ref} is the highest-privilege lane and must be SHA-pinned`);
    }
  }
});

test("S4-4  update automation exists, scoped to github-actions only", () => {
  const dependabot = readFileSync(path.join(ROOT, ".github/dependabot.yml"), "utf8");
  assert.match(dependabot, /package-ecosystem:\s*"github-actions"/);
  assert.match(dependabot, /interval:\s*"weekly"/);
  // This batch did not open an npm update stream nobody agreed to review.
  assert.ok(
    !/package-ecosystem:\s*"npm"/.test(dependabot),
    "only the github-actions ecosystem belongs to this batch"
  );
});

test("S4-5  workflow permissions were not widened by this batch", () => {
  // Least privilege as found: read-only by default, id-token only where AWS
  // OIDC is genuinely used, attestations scoped to the one job that needs it.
  const infraApply = readFileSync(path.join(WORKFLOWS, "infra-apply.yml"), "utf8");
  assert.match(infraApply, /permissions:\s*\n\s*contents:\s*read\s*\n\s*id-token:\s*write/);

  const supply = readFileSync(path.join(WORKFLOWS, "supply-chain-ci.yml"), "utf8");
  assert.match(supply, /permissions:\s*\n\s*contents:\s*read/);
  // attestations:write must stay confined to the attest job, not top-level.
  const topBlock = supply.slice(0, supply.indexOf("jobs:"));
  assert.ok(!/attestations:\s*write/.test(topBlock), "attestations must not be granted workflow-wide");
});
