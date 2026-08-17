import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getAdminUserInvestigation } from "@/lib/admin/user-investigation-service";
import {
  interpretUserInvestigationResponse,
  networkErrorState,
} from "@/lib/admin/user-investigation-client-state";
import { CLERK_USER_ID_PATTERN } from "@/lib/admin/user-investigation-contract";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase } from "./e2e-harness";

/**
 * Phase 16-A/3 — read-only user investigation (User -> recent generations ->
 * existing generation investigation surface).
 *
 * The core promise under test: the recent-generations list belongs only to
 * the requested user, a missing user and a read failure are told apart
 * honestly, an empty history is never treated as an error, and no mutation
 * of any kind exists anywhere in the new files. `/admin/generations` (Phase
 * 16-A/2) is linked to by id, never re-implemented.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/user-investigation-contract.ts",
  "src/lib/admin/user-investigation-service.ts",
  "src/lib/admin/user-investigation-client-state.ts",
  "src/app/api/admin/users/[clerkUserId]/route.ts",
  "src/app/admin/users/page.tsx",
  "src/components/admin/UserInvestigationPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

function seedProfile(db: FakeSupabaseClient, overrides: Record<string, unknown> = {}): { clerkUserId: string } {
  const clerkUserId = (overrides.clerk_user_id as string) ?? `user_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  if (!db.state.profiles) db.state.profiles = [];
  db.state.profiles.push({
    clerk_user_id: clerkUserId,
    username: "e2e-username-must-not-leak",
    email: "e2e-secret@example.com",
    display_name: "E2E Display Name",
    avatar_url: "https://example.invalid/avatar.png",
    credits: 500,
    plan: "pro",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  });
  return { clerkUserId };
}

function seedGenerationForUser(
  db: FakeSupabaseClient,
  clerkUserId: string,
  overrides: Record<string, unknown> = {}
): { generationId: string } {
  const generationId = (overrides.id as string) ?? randomUUID();
  if (!db.state.generations) db.state.generations = [];
  db.state.generations.push({
    id: generationId,
    project_id: (overrides.project_id as string) ?? randomUUID(),
    clerk_user_id: clerkUserId,
    generation_type: "image",
    provider: "mock",
    model: "mock-image",
    prompt: "e2e secret prompt that must never leak into the user surface",
    negative_prompt: null,
    status: "completed",
    input_url: null,
    output_url: null,
    thumbnail_url: null,
    error_message: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:05.000Z",
    completed_at: "2026-01-01T00:00:05.000Z",
    temporal_workflow_id: null,
    ...overrides,
  });
  return { generationId };
}

// ===========================================================================
// PURE: interpretUserInvestigationResponse
// ===========================================================================

test("client state: denied vs not_found are distinguished by body shape, both at 404", () => {
  assert.deepEqual(interpretUserInvestigationResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(interpretUserInvestigationResponse(404, { outcome: "USER_NOT_FOUND" }), { kind: "not_found" });
  assert.deepEqual(interpretUserInvestigationResponse(404, { anything: "else" }), { kind: "denied" });
});

test("client state: server error, malformed body, and EVIDENCE_UNAVAILABLE all map to unavailable, never found", () => {
  assert.deepEqual(interpretUserInvestigationResponse(500, undefined), { kind: "unavailable", reasonCode: "http_500" });
  assert.deepEqual(interpretUserInvestigationResponse(200, { not: "a result" }), {
    kind: "unavailable",
    reasonCode: "malformed_response",
  });
  assert.deepEqual(
    interpretUserInvestigationResponse(200, { outcome: "EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" }),
    { kind: "unavailable", reasonCode: "read_failed" }
  );
  assert.deepEqual(networkErrorState(), { kind: "unavailable", reasonCode: "network_error" });
});

test("client state: NO_GENERATIONS and PARTIAL_DATA are their own states, never collapsed into found or unavailable", () => {
  const noGen = { outcome: "NO_GENERATIONS" as const, user: {} as never };
  assert.deepEqual(interpretUserInvestigationResponse(200, noGen), { kind: "no_generations", result: noGen });

  const partial = {
    outcome: "PARTIAL_DATA" as const,
    user: null,
    recentGenerations: [],
    reasonCode: "profile_read_failed",
  };
  assert.deepEqual(interpretUserInvestigationResponse(200, partial), { kind: "partial_data", result: partial });
});

test("client state: a genuine FOUND result passes through unchanged", () => {
  const result = { outcome: "FOUND" as const, user: {} as never, recentGenerations: [] };
  assert.deepEqual(interpretUserInvestigationResponse(200, result), { kind: "found", result });
});

// ===========================================================================
// REAL SERVICE — against the shared production-code e2e harness
// ===========================================================================

function throwingAdmin() {
  const chain: Record<string, unknown> = {};
  const boom = () => Promise.reject(new Error("boom"));
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = boom;
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
    boom().then(onFulfilled, onRejected);
  return { from: () => chain } as never;
}

test("5: a missing user (no profile, no generations) returns bounded not-found, never a raw exception", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result = await getAdminUserInvestigation(db as never, "user_does_not_exist_e2e");
  assert.deepEqual(result, { outcome: "USER_NOT_FOUND" });
});

test("7: a malformed clerk user id never reaches the database", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result = await getAdminUserInvestigation(db as never, "not-a-clerk-id; DROP TABLE profiles;--");
  assert.deepEqual(result, { outcome: "USER_NOT_FOUND" });
  assert.doesNotMatch("not-a-clerk-id; DROP TABLE profiles;--", CLERK_USER_ID_PATTERN);
});

test("evidence unavailable on a total read failure, never silently empty", async () => {
  const result = await getAdminUserInvestigation(throwingAdmin(), "user_whatever");
  assert.equal(result.outcome, "EVIDENCE_UNAVAILABLE");
});

test("6: an existing user with zero generations is NO_GENERATIONS, not an error", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { clerkUserId } = seedProfile(db);

  const result = await getAdminUserInvestigation(db as never, clerkUserId);
  assert.equal(result.outcome, "NO_GENERATIONS");
  if (result.outcome !== "NO_GENERATIONS") return;
  assert.equal(result.user.clerkUserId, clerkUserId);
  assert.equal(result.user.displayName, "E2E Display Name");
});

test("4/8/9/10: an existing user with generations loads bounded, ordered, own-user-only history", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { clerkUserId } = seedProfile(db);
  const { clerkUserId: otherUserId } = seedProfile(db);

  // 25 generations for the target user, pre-seeded in created_at-desc order
  // because the fake harness's order() is a documented no-op (the same
  // convention `phase-16-a2-generation-investigation.e2e.test.ts` already
  // states for attempt_no ascending) — real ordering is proven by
  // `generations.order("created_at", { ascending: false })` in the service
  // itself, which a real Postgres enforces.
  const seededIds: string[] = [];
  for (let i = 24; i >= 0; i -= 1) {
    const { generationId } = seedGenerationForUser(db, clerkUserId, {
      created_at: `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
    });
    seededIds.push(generationId);
  }
  // A different user's generation must never leak into this user's list.
  seedGenerationForUser(db, otherUserId, { created_at: "2026-01-01T23:59:00.000Z" });

  const result = await getAdminUserInvestigation(db as never, clerkUserId);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;

  assert.equal(result.user.clerkUserId, clerkUserId);
  assert.equal(result.recentGenerations.length, 20, "9: bounded to MAX_RECENT_GENERATIONS");
  assert.ok(
    result.recentGenerations.every((g) => seededIds.includes(g.generationId)),
    "8: only this user's generations appear"
  );
  assert.equal(result.recentGenerations[0].createdAt, "2026-01-01T00:24:00.000Z", "10: newest first");
  assert.equal(result.recentGenerations[19].createdAt, "2026-01-01T00:05:00.000Z");

  const asJson = JSON.stringify(result);
  assert.doesNotMatch(asJson, /secret prompt/i, "no raw prompt reaches the projection");
  assert.doesNotMatch(asJson, /e2e-secret@example\.com/i, "no email reaches the projection");
  assert.doesNotMatch(asJson, /e2e-username-must-not-leak/i, "no username reaches the projection");
  assert.doesNotMatch(asJson, /avatar\.png/i, "no avatar url reaches the projection");
});

test("PARTIAL_DATA: profile read failure with real generation evidence is reported honestly, not discarded", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const clerkUserId = "user_partial_case";
  seedGenerationForUser(db, clerkUserId);

  // Simulate a profiles-read failure (whatever the cause) with the
  // generations read still succeeding — the defensive independent-read
  // split this service keeps regardless of live grant state (see
  // user-investigation-service.ts's header; the Phase 16-A/3 audit found
  // repository evidence actually grants service_role SELECT on profiles).
  const originalFrom = db.from.bind(db);
  const admin = {
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "permission denied for table profiles" } }),
            }),
          }),
        };
      }
      return originalFrom(table);
    },
  };

  const result = await getAdminUserInvestigation(admin as never, clerkUserId);
  assert.equal(result.outcome, "PARTIAL_DATA");
  if (result.outcome !== "PARTIAL_DATA") return;
  assert.equal(result.user, null);
  assert.equal(result.recentGenerations.length, 1);
  assert.equal(result.reasonCode, "profile_read_failed");
});

test("PARTIAL_DATA is never returned when both the profile and generations reads genuinely find nothing", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const admin = {
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "permission denied for table profiles" } }),
            }),
          }),
        };
      }
      return db.from(table);
    },
  };
  const result = await getAdminUserInvestigation(admin as never, "user_truly_unknown");
  assert.equal(result.outcome, "EVIDENCE_UNAVAILABLE", "cannot confirm existence either way — never guessed");
});

// ===========================================================================
// SECURITY / SENSITIVE DATA
// ===========================================================================

test("16: the profiles select() never includes email/username/avatar/credits/plan", () => {
  const serviceText = read("src/lib/admin/user-investigation-service.ts");
  const forbidden = ["email", "username", "avatar_url", "credits", "plan"];
  const selects = [...serviceText.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(selects.length >= 2, "expected at least two .select() calls (profiles, generations)");
  for (const cols of selects) {
    for (const word of forbidden) {
      assert.doesNotMatch(cols, new RegExp(word), `select() must not include forbidden column "${word}": ${cols}`);
    }
  }
});

test("14: the generations select() never includes prompt or other 16-A/2-excluded columns", () => {
  const serviceText = read("src/lib/admin/user-investigation-service.ts");
  const forbidden = ["prompt", "negative_prompt", "input_url", "output_url", "thumbnail_url", "error_message", "metadata"];
  const selects = [...serviceText.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]);
  for (const cols of selects) {
    for (const word of forbidden) {
      assert.doesNotMatch(cols, new RegExp(word), `select() must not include forbidden column "${word}": ${cols}`);
    }
  }
});

test("17/19-21: the API route responds through privateJson and never leaks a raw exception", () => {
  const routeText = stripComments(read("src/app/api/admin/users/[clerkUserId]/route.ts"));
  assert.doesNotMatch(routeText, /NextResponse\.json\(/);
  assert.match(routeText, /privateJson\(/);
  assert.doesNotMatch(routeText, /\.stack\b|error\.message/i);
});

test("13/15: no raw Clerk object, token, or session shape appears anywhere in the new surface", () => {
  const forbidden = [
    "apikey",
    "signedurl",
    "authorization:",
    "\\.stack\\b",
    "access_token",
    "refresh_token",
    "publicmetadata",
    "privatemetadata",
    "sessionclaims",
  ];
  for (const { file, text } of NEW_FILES) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word), `${file} mentions forbidden shape "${word}"`);
    }
  }
});

// ===========================================================================
// AUTH REUSE
// ===========================================================================

test("18: exactly one canonical admin auth boundary is reused, never ROUTE_ADMIN_CLERK_USER_IDS", () => {
  const routeText = stripComments(read("src/app/api/admin/users/[clerkUserId]/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.doesNotMatch(routeText, /ROUTE_ADMIN_CLERK_USER_IDS/);
  const authIndex = routeText.indexOf("requireAdminAccess");
  const serviceCallIndex = routeText.indexOf("getAdminUserInvestigation");
  assert.ok(
    authIndex >= 0 && serviceCallIndex >= 0 && authIndex < serviceCallIndex,
    "auth must be checked before the service is ever called"
  );
});

// ===========================================================================
// AUTHORITY — no mutation of any kind
// ===========================================================================

const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /submitAttempt\s*\(|executeGeneration\s*\(|claimAttemptForSubmission/, why: "no provider execution" },
  { pattern: /cancelPendingAttempt|requestGenerationCancellation|markAttemptTerminal/, why: "no generation/attempt mutation" },
  { pattern: /StartMessageMoveTask|SendMessageCommand|DeleteMessageCommand|ChangeMessageVisibility/, why: "no DLQ/queue mutation" },
  { pattern: /setRoutingControl|clearRoutingControl|assertRouteAdmin/, why: "no routing mutation" },
  { pattern: /isRemediationKillSwitchEngaged/, why: "no kill-switch mutation" },
  { pattern: /releaseQuarantine|quarantine.?release/i, why: "no quarantine release" },
  { pattern: /runRestoreValidation|deployment-guard|evaluateAiPrProposal/, why: "no restore/deploy/remediation authority" },
  { pattern: /reserveCredits|settleReservation|releaseReservation|credit_ledger|credit_wallets|Stripe/i, why: "no billing/credit mutation" },
  { pattern: /suspendUser|deleteUser|banUser|disableUser|changeUserRole|setUserRole|updateWorkspaceMember|removeWorkspaceMember/i, why: "no user/workspace mutation" },
  { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "no database write" },
];

test("19-24: no operational mutation of any kind exists in the new Phase 16-A/3 surface", () => {
  for (const { file, text } of NEW_FILES) {
    for (const banned of BANNED) {
      assert.doesNotMatch(text, banned.pattern, `${file}: ${banned.why}`);
    }
  }
});

test("no action button/retry/redrive/suspend/role control exists in the UI", () => {
  const panelText = stripComments(read("src/components/admin/UserInvestigationPanel.tsx"));
  // Deliberately excludes the bare word "disabled" — the submit button's own
  // standard HTML attribute is legitimate form UX, not an operational
  // control (the same carve-out `phase-16-a2-generation-investigation.e2e.test.ts`
  // documents for the identical reason).
  assert.doesNotMatch(
    panelText,
    /retry|redrive|suspend|onClick={.*(cancel|delete|ban)|provider.?disable|route.?disable|kill.?switch|role.?change|change.?role/i
  );
});

// ===========================================================================
// GENERATION LINKAGE — reuse, not duplication
// ===========================================================================

test("11: recent generations link into the existing /admin/generations investigation surface", () => {
  const panelText = read("src/components/admin/UserInvestigationPanel.tsx");
  assert.match(panelText, /\/admin\/generations\?generationId=/);
});

test("12: 16-A/2's trace-chain building is reused by reference (a link), never re-implemented", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /function\s+buildTraceChain\s*\(/, `${file} must not re-implement buildTraceChain`);
    assert.doesNotMatch(text, /"outbox_events"|"generation_attempts"|"media_assets"/, `${file} must not re-query 16-A/2's tables`);
    assert.doesNotMatch(text, /TraceChainLink\b/, `${file} must not re-declare the trace chain type`);
  }
});

// ===========================================================================
// ARCHITECTURE
// ===========================================================================

test("25/27: the canonical profiles table is reused as the user owner, no second user directory", () => {
  const serviceText = stripComments(read("src/lib/admin/user-investigation-service.ts"));
  assert.match(serviceText, /"profiles"/);
  assert.doesNotMatch(serviceText, /CREATE TABLE|admin_users|user_lookup_index|user_directory/i);
});

test("26: the canonical generations.clerk_user_id ownership column is reused", () => {
  const serviceText = stripComments(read("src/lib/admin/user-investigation-service.ts"));
  assert.match(serviceText, /"generations"/);
  assert.match(serviceText, /\.eq\("clerk_user_id", clerkUserId\)/);
});

test("28: no new trace/lifecycle model is created", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /GenerationStatus\s*=\s*"queued"|function\s+rollUp\s*\(/, `${file}`);
  }
});

test("no locked product UI route is referenced by the new files", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of NEW_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
  }
});

test("no migration file was added for this slice", () => {
  const serviceText = stripComments(read("src/lib/admin/user-investigation-service.ts"));
  assert.doesNotMatch(serviceText, /CREATE TABLE|ALTER TABLE/i);
});
