import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  bootstrapAdminIds,
  decideAdminAccess,
  isBootstrapAdmin,
} from "@/lib/admin/admin-auth";
import {
  projectAdminHealth,
  type AdminHealthRuntimeProjection,
} from "@/lib/admin/admin-health-projection";
import { interpretHealthResponse, networkErrorState } from "@/lib/admin/admin-health-client-state";
import { RUNTIME_NAMES, type ReadinessReport } from "@/lib/health/health-contract";

/**
 * Phase 16/1 — read-only Admin Operations Center + System Health.
 *
 * The core promise under test: the admin boundary defaults to deny in every
 * shape (no session, wrong session, unreadable source), Phase 13 health
 * truth is reused verbatim and never re-derived, and nothing in the new
 * surface can execute a provider, mutate a route, spend money, or touch a
 * queue.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ADMIN_FILES = [
  "src/lib/admin/admin-auth.ts",
  "src/lib/admin/require-admin-access.ts",
  "src/lib/admin/admin-health-projection.ts",
  "src/lib/admin/admin-health-service.ts",
  "src/lib/admin/admin-health-client-state.ts",
  "src/app/api/admin/health/route.ts",
  "src/app/admin/layout.tsx",
  "src/app/admin/page.tsx",
  "src/components/admin/SystemHealthPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

// ===========================================================================
// AUTH
// ===========================================================================

test("1: no session is denied", () => {
  const result = decideAdminAccess(null);
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, "no_session");
  assert.equal(result.clerkUserId, null);
});

test("2: authenticated but not on the allowlist is denied", () => {
  const empty = decideAdminAccess("user_not_listed");
  assert.equal(empty.allowed, false);
  assert.equal(empty.reasonCode, "not_admin");
  assert.equal(empty.clerkUserId, "user_not_listed");
});

test("3: an id on the allowlist is admitted", () => {
  const saved = process.env.CINEFIELD_ADMIN_CLERK_USER_IDS;
  process.env.CINEFIELD_ADMIN_CLERK_USER_IDS = "user_admin_1,user_admin_2";
  try {
    const result = decideAdminAccess("user_admin_2");
    assert.equal(result.allowed, true);
    assert.equal(result.reasonCode, "allowed");
  } finally {
    if (saved === undefined) delete process.env.CINEFIELD_ADMIN_CLERK_USER_IDS;
    else process.env.CINEFIELD_ADMIN_CLERK_USER_IDS = saved;
  }
});

test("an id NOT on a non-empty allowlist is still denied", () => {
  const saved = process.env.CINEFIELD_ADMIN_CLERK_USER_IDS;
  process.env.CINEFIELD_ADMIN_CLERK_USER_IDS = "user_admin_1";
  try {
    const result = decideAdminAccess("user_someone_else");
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, "not_admin");
  } finally {
    if (saved === undefined) delete process.env.CINEFIELD_ADMIN_CLERK_USER_IDS;
    else process.env.CINEFIELD_ADMIN_CLERK_USER_IDS = saved;
  }
});

test("4: an unset/empty/malformed allowlist source denies everyone, never fails open", () => {
  for (const raw of [undefined, "", "   ", ",,,", "\t\n"]) {
    assert.equal(bootstrapAdminIds(raw).size, 0, `raw=${JSON.stringify(raw)}`);
    assert.equal(isBootstrapAdmin("user_anyone", raw), false);
  }
});

test("bootstrapAdminIds trims and drops empty entries, never invents a match", () => {
  const ids = bootstrapAdminIds(" user_a , user_b ,, user_c ");
  assert.deepEqual([...ids].sort(), ["user_a", "user_b", "user_c"]);
});

test("isBootstrapAdmin rejects a non-string/empty clerkUserId defensively", () => {
  assert.equal(isBootstrapAdmin("", "user_a"), false);
});

test("admin-auth.ts (the pure decision core) never imports @clerk/nextjs/server, so it stays loadable by this test process", () => {
  const authText = stripComments(read("src/lib/admin/admin-auth.ts"));
  assert.doesNotMatch(authText, /@clerk\/nextjs/, "the Clerk SDK import belongs only in require-admin-access.ts");
  const wrapperText = stripComments(read("src/lib/admin/require-admin-access.ts"));
  assert.match(wrapperText, /@clerk\/nextjs\/server/);
  assert.match(wrapperText, /decideAdminAccess/);
});

test("5: no client-side-only authorization — the auth boundary runs server-side", () => {
  const authText = read("src/lib/admin/admin-auth.ts");
  assert.match(authText, /^import "server-only";/m, "admin-auth.ts must be server-only");
  const layoutText = read("src/app/admin/layout.tsx");
  assert.doesNotMatch(layoutText, /"use client"/, "the admin auth gate must not live in a client component");
  assert.match(layoutText, /requireAdminAccess/, "the layout must call the canonical boundary");
});

test("6: no NEXT_PUBLIC admin identity exists anywhere in the new surface", () => {
  for (const { file, text } of ADMIN_FILES) {
    assert.doesNotMatch(text, /NEXT_PUBLIC/i, `${file} must not expose admin identity to the client`);
  }
});

test("no query-string or cookie bypass exists in the admin boundary", () => {
  const authText = stripComments(read("src/lib/admin/admin-auth.ts"));
  assert.doesNotMatch(authText, /searchParams|req\.query|cookies\(\)|request\.headers\.get\(["']cookie/i);
});

// ===========================================================================
// API
// ===========================================================================

test("7: the protected admin health route exists and requires admin access first", () => {
  const routeText = stripComments(read("src/app/api/admin/health/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  const authIndex = routeText.indexOf("requireAdminAccess");
  const collectIndex = routeText.indexOf("collectAdminHealth");
  assert.ok(authIndex >= 0 && collectIndex >= 0 && authIndex < collectIndex, "auth must be checked before health is collected");
});

test("8: the public liveness route is unchanged in shape and untouched by the admin surface", () => {
  const liveText = stripComments(read("src/app/api/health/live/route.ts"));
  assert.doesNotMatch(liveText, /admin|readiness|dependencyHealth/i, "liveness must stay minimal, no admin/readiness coupling");
  assert.match(liveText, /liveness\(\)/);
});

test("9: Phase 13 readiness() is reused verbatim, never re-implemented", () => {
  const serviceText = stripComments(read("src/lib/admin/admin-health-service.ts"));
  assert.match(serviceText, /import\s*\{\s*readiness\s*\}\s*from\s*"@\/lib\/health\/health-service"/);
  assert.doesNotMatch(serviceText, /function\s+readiness\s*\(|function\s+rollUp\s*\(/);
});

function reports(overrides: Partial<Record<string, Partial<ReadinessReport>>> = {}): ReadinessReport[] {
  return RUNTIME_NAMES.map((runtime) => ({
    runtime,
    status: "HEALTHY" as const,
    reasons: [],
    dependencies: [],
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides[runtime],
  }));
}

test("10: UNKNOWN dependency status is passed through unchanged, never upgraded", () => {
  const list = reports();
  list[0] = {
    ...list[0],
    dependencies: [{ dependency: "redis-a", status: "UNKNOWN", reason: "unreachable", criticality: "DEGRADED_ALLOWED" }],
  };
  const projection = projectAdminHealth(list, "2026-01-01T00:00:00.000Z");
  assert.equal(projection.runtimes[0].dependencies[0].status, "UNKNOWN");
});

test("11: UNREADY never becomes HEALTHY in the overall rollup", () => {
  const list = reports();
  list[2] = { ...list[2], status: "UNREADY", reasons: ["timeout"] };
  const projection = projectAdminHealth(list, "2026-01-01T00:00:00.000Z");
  assert.equal(projection.overallStatus, "UNREADY");
});

test("worst-of severity ordering: UNREADY > UNKNOWN(worst-per-runtime, defensive) > DEGRADED > HEALTHY", () => {
  const degradedOnly = reports();
  degradedOnly[1] = { ...degradedOnly[1], status: "DEGRADED" };
  assert.equal(projectAdminHealth(degradedOnly, "t").overallStatus, "DEGRADED");

  const allHealthy = reports();
  assert.equal(projectAdminHealth(allHealthy, "t").overallStatus, "HEALTHY");
});

test("12: AdminHealthProjection carries no field outside the documented shape", () => {
  const projection = projectAdminHealth(reports(), "2026-01-01T00:00:00.000Z");
  assert.deepEqual(Object.keys(projection).sort(), ["checkedAt", "overallStatus", "runtimes"]);
  const runtime: AdminHealthRuntimeProjection = projection.runtimes[0];
  assert.deepEqual(Object.keys(runtime).sort(), ["dependencies", "reasons", "runtime", "status"]);
});

test("13/14: no secret, token, header, signed URL, prompt, or stack trace field exists anywhere in the new surface", () => {
  const forbidden = ["prompt", "apikey", "signedurl", "authorization", "\\.stack\\b", "connectionstring", "provider_payload"];
  for (const { file, text } of ADMIN_FILES) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word), `${file} mentions forbidden shape "${word}"`);
    }
  }
});

test("15: the admin health route responds through privateJson (private, no-store)", () => {
  const routeText = stripComments(read("src/app/api/admin/health/route.ts"));
  assert.doesNotMatch(routeText, /NextResponse\.json\(/, "must use privateJson, not a raw NextResponse.json");
  assert.match(routeText, /privateJson\(/g);
});

// ===========================================================================
// UI (structural — no DOM renderer in this test harness, consistent with the
// rest of this codebase's test suite)
// ===========================================================================

test("16: /admin requires admin authorization via the layout", () => {
  const layoutText = stripComments(read("src/app/admin/layout.tsx"));
  assert.match(layoutText, /access\.allowed/);
  assert.match(layoutText, /Access denied/i);
});

test("17/19-22: the panel derives a distinct state for every documented outcome", () => {
  assert.deepEqual(interpretHealthResponse(404, undefined), { kind: "denied" });
  assert.deepEqual(interpretHealthResponse(500, undefined), { kind: "unavailable", reasonCode: "http_500" });
  assert.deepEqual(interpretHealthResponse(200, { not: "a projection" }), {
    kind: "unavailable",
    reasonCode: "malformed_response",
  });
  const projection = projectAdminHealth(reports(), "2026-01-01T00:00:00.000Z");
  assert.deepEqual(interpretHealthResponse(200, projection), { kind: "loaded", projection });
  assert.deepEqual(networkErrorState(), { kind: "unavailable", reasonCode: "network_error" });
});

test("HEALTHY / DEGRADED / UNREADY / UNKNOWN all map to a rendered label in the panel", () => {
  const panelText = read("src/components/admin/SystemHealthPanel.tsx");
  for (const status of ["HEALTHY", "DEGRADED", "UNREADY", "UNKNOWN"]) {
    assert.match(panelText, new RegExp(status), `panel has no rendering for ${status}`);
  }
});

test("18: dependencies render per runtime", () => {
  const panelText = read("src/components/admin/SystemHealthPanel.tsx");
  assert.match(panelText, /runtime\.dependencies\.map/);
});

test("23: no fake/decorative metric literal exists in the panel", () => {
  const panelText = stripComments(read("src/components/admin/SystemHealthPanel.tsx"));
  assert.doesNotMatch(panelText, /Math\.random|fakeData|mockMetric|placeholder.*(count|chart)/i);
});

test("24: no locked product UI route is touched by this batch", () => {
  const lockedDirs = [
    "src/app/generate",
    "src/components/cinema-studio",
    "src/app/audio",
    "src/app/marketing-studio",
    "src/app/supercomputer",
    "src/app/image",
  ];
  // Structural: none of the new admin files import from a locked directory.
  for (const { file, text } of ADMIN_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(locked.replace("src/", "")), `${file} must not reference ${locked}`);
    }
  }
});

// ===========================================================================
// AUTHORITY — no operational mutation anywhere in the new surface
// ===========================================================================

const BANNED_IDENTIFIERS: { pattern: RegExp; why: string }[] = [
  { pattern: /StartMessageMoveTask|SendMessageCommand|DeleteMessageCommand|ChangeMessageVisibility|PurgeQueueCommand/, why: "no DLQ/queue mutation" },
  { pattern: /setRoutingControl|clearRoutingControl|listRoutesForAdmin|assertRouteAdmin/, why: "no routing mutation" },
  { pattern: /isRemediationKillSwitchEngaged|REMEDIATION_ENABLED/, why: "no kill-switch mutation" },
  { pattern: /releaseQuarantine|quarantine.?release/i, why: "no quarantine release" },
  { pattern: /runRestoreValidation|createThrowawayPostgresSource/, why: "no restore execution" },
  { pattern: /deployment-guard|evaluateAiPrProposal/, why: "no deploy/rollback/remediation authority" },
  { pattern: /reserveCredits|settleReservation|releaseReservation|cost_amount|credit_ledger|credit_wallets|Stripe/i, why: "no billing/credit mutation" },
  { pattern: /submitAttempt\s*\(|executeGeneration\s*\(|claimAttemptForSubmission/, why: "no provider execution" },
  { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "no database write" },
];

test("25-30: no operational mutation of any kind exists in the new Phase 16 surface", () => {
  for (const { file, text } of ADMIN_FILES) {
    for (const banned of BANNED_IDENTIFIERS) {
      assert.doesNotMatch(text, banned.pattern, `${file}: ${banned.why}`);
    }
  }
});

test("31: nothing in the new surface registers with AI PR/remediation authority", () => {
  for (const { file, text } of ADMIN_FILES) {
    assert.doesNotMatch(text, /ai-pr-authority|requireAiWritePolicy|evaluateAiPrProposal/, `${file} must not touch AI write authority`);
  }
});

// ===========================================================================
// ARCHITECTURE
// ===========================================================================

test("32: no second health evaluator exists — HealthStatus/rollUp semantics are imported, never redefined", () => {
  for (const { file, text } of ADMIN_FILES) {
    assert.doesNotMatch(text, /function\s+rollUp\s*\(|"HEALTHY"\s*\|\s*"DEGRADED"\s*\|\s*"UNREADY"/, `${file} must import, not redefine, the health contract`);
  }
});

test("33: no apps/admin monorepo was created", () => {
  const entries = readdirSync(ROOT, { withFileTypes: true });
  assert.equal(entries.some((e) => e.isDirectory() && e.name === "apps"), false);
});

test("34: exactly one canonical admin auth boundary is used by both the API route and the layout", () => {
  const routeText = stripComments(read("src/app/api/admin/health/route.ts"));
  const layoutText = stripComments(read("src/app/admin/layout.tsx"));
  assert.match(routeText, /requireAdminAccess/);
  assert.match(layoutText, /requireAdminAccess/);
  // Neither reimplements a parallel check.
  for (const text of [routeText, layoutText]) {
    assert.doesNotMatch(text, /ROUTE_ADMIN_CLERK_USER_IDS/);
  }
});

test("35: existing Phase 13 types are imported, never shadowed with a new name", () => {
  const projectionText = read("src/lib/admin/admin-health-projection.ts");
  assert.match(projectionText, /from "@\/lib\/health\/health-contract"/);
  assert.doesNotMatch(projectionText, /AdminHealthStatus|OpsHealthStatus/);
});

test("ROUTE_ADMIN_CLERK_USER_IDS is never silently promoted into the Phase 16 boundary", () => {
  const authText = stripComments(read("src/lib/admin/admin-auth.ts"));
  assert.doesNotMatch(authText, /ROUTE_ADMIN_CLERK_USER_IDS/);
});
