import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getAdminWorkspaceInvestigation } from "@/lib/admin/workspace-investigation-service";
import {
  interpretWorkspaceInvestigationResponse,
  networkErrorState,
} from "@/lib/admin/workspace-investigation-client-state";
import { PROJECT_ID_PATTERN } from "@/lib/admin/workspace-investigation-contract";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase } from "./e2e-harness";

/**
 * Phase 16-A/4 — read-only workspace/project investigation (Workspace ->
 * owner reference -> recent generations -> existing generation
 * investigation surface), plus the Phase 16-A/3 stale profile-grant
 * commentary correction.
 *
 * The core promise under test: the recent-generations list belongs only to
 * the requested project, a missing project and a read failure are told
 * apart honestly, an empty history is never treated as an error, the owner
 * reference is a bare id (never a re-implemented profile lookup), and no
 * mutation of any kind exists anywhere in the new files. `/admin/users` and
 * `/admin/generations` are linked to by id, never re-implemented.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/workspace-investigation-contract.ts",
  "src/lib/admin/workspace-investigation-service.ts",
  "src/lib/admin/workspace-investigation-client-state.ts",
  "src/app/api/admin/workspaces/[projectId]/route.ts",
  "src/app/admin/workspaces/page.tsx",
  "src/components/admin/WorkspaceInvestigationPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

function seedProject(db: FakeSupabaseClient, overrides: Record<string, unknown> = {}): { projectId: string } {
  const projectId = (overrides.id as string) ?? randomUUID();
  if (!db.state.projects) db.state.projects = [];
  db.state.projects.push({
    id: projectId,
    clerk_user_id: (overrides.clerk_user_id as string) ?? "user_project_owner",
    title: "E2E Project Title",
    description: "e2e secret description that must never leak into the workspace surface",
    thumbnail_url: "https://example.invalid/thumb.png",
    status: "draft",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  });
  return { projectId };
}

function seedGenerationForProject(
  db: FakeSupabaseClient,
  projectId: string,
  overrides: Record<string, unknown> = {}
): { generationId: string } {
  const generationId = (overrides.id as string) ?? randomUUID();
  if (!db.state.generations) db.state.generations = [];
  db.state.generations.push({
    id: generationId,
    project_id: projectId,
    clerk_user_id: (overrides.clerk_user_id as string) ?? "user_project_owner",
    generation_type: "image",
    provider: "mock",
    model: "mock-image",
    prompt: "e2e secret prompt that must never leak into the workspace surface",
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
// AUTH: unauthenticated / non-admin / admin (items 1-3)
// ===========================================================================
// The pure decision core (`decideAdminAccess`, Phase 16/1) is already
// exhaustively tested by `phase-16-1-admin-health.e2e.test.ts` ("1: no
// session is denied" / "2: authenticated but not on the allowlist is
// denied" / "3: an id on the allowlist is admitted") — it is the same
// single boundary every Phase 16 admin surface shares, not re-implemented or
// re-decided here. What THIS route needs proven is that it actually reuses
// that boundary, before the service ever runs — see "exactly one canonical
// admin auth boundary is reused" below.

// ===========================================================================
// PURE: interpretWorkspaceInvestigationResponse
// ===========================================================================

test("client state: denied vs not_found are distinguished by body shape, both at 404", () => {
  assert.deepEqual(interpretWorkspaceInvestigationResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(interpretWorkspaceInvestigationResponse(404, { outcome: "WORKSPACE_NOT_FOUND" }), {
    kind: "not_found",
  });
  assert.deepEqual(interpretWorkspaceInvestigationResponse(404, { anything: "else" }), { kind: "denied" });
});

test("client state: server error, malformed body, and EVIDENCE_UNAVAILABLE all map to unavailable, never found", () => {
  assert.deepEqual(interpretWorkspaceInvestigationResponse(500, undefined), {
    kind: "unavailable",
    reasonCode: "http_500",
  });
  assert.deepEqual(interpretWorkspaceInvestigationResponse(200, { not: "a result" }), {
    kind: "unavailable",
    reasonCode: "malformed_response",
  });
  assert.deepEqual(
    interpretWorkspaceInvestigationResponse(200, { outcome: "EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" }),
    { kind: "unavailable", reasonCode: "read_failed" }
  );
  assert.deepEqual(networkErrorState(), { kind: "unavailable", reasonCode: "network_error" });
});

test("client state: NO_GENERATIONS and PARTIAL_DATA are their own states, never collapsed into found or unavailable", () => {
  const noGen = { outcome: "NO_GENERATIONS" as const, workspace: {} as never };
  assert.deepEqual(interpretWorkspaceInvestigationResponse(200, noGen), { kind: "no_generations", result: noGen });

  const partial = {
    outcome: "PARTIAL_DATA" as const,
    workspace: null,
    recentGenerations: [],
    reasonCode: "project_read_failed",
  };
  assert.deepEqual(interpretWorkspaceInvestigationResponse(200, partial), { kind: "partial_data", result: partial });
});

test("client state: a genuine FOUND result passes through unchanged", () => {
  const result = { outcome: "FOUND" as const, workspace: {} as never, recentGenerations: [] };
  assert.deepEqual(interpretWorkspaceInvestigationResponse(200, result), { kind: "found", result });
});

// ===========================================================================
// REAL SERVICE — against the shared production-code e2e harness (items 4-8)
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

test("5: a missing workspace (no project, no generations) returns bounded not-found, never a raw exception", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result = await getAdminWorkspaceInvestigation(db as never, randomUUID());
  assert.deepEqual(result, { outcome: "WORKSPACE_NOT_FOUND" });
});

test("a malformed project id never reaches the database", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result = await getAdminWorkspaceInvestigation(db as never, "not-a-uuid; DROP TABLE projects;--");
  assert.deepEqual(result, { outcome: "WORKSPACE_NOT_FOUND" });
  assert.doesNotMatch("not-a-uuid; DROP TABLE projects;--", PROJECT_ID_PATTERN);
});

test("evidence unavailable on a total read failure, never silently empty", async () => {
  const result = await getAdminWorkspaceInvestigation(throwingAdmin(), randomUUID());
  assert.equal(result.outcome, "EVIDENCE_UNAVAILABLE");
});

test("an existing project with zero generations is NO_GENERATIONS, not an error", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { projectId } = seedProject(db);

  const result = await getAdminWorkspaceInvestigation(db as never, projectId);
  assert.equal(result.outcome, "NO_GENERATIONS");
  if (result.outcome !== "NO_GENERATIONS") return;
  assert.equal(result.workspace.projectId, projectId);
  assert.equal(result.workspace.title, "E2E Project Title");
});

test("4/7/8/9: an existing project with generations loads bounded, ordered, own-project-only history", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { projectId } = seedProject(db);
  const { projectId: otherProjectId } = seedProject(db);

  const seededIds: string[] = [];
  for (let i = 24; i >= 0; i -= 1) {
    const { generationId } = seedGenerationForProject(db, projectId, {
      created_at: `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
    });
    seededIds.push(generationId);
  }
  // A different project's generation must never leak into this project's list.
  seedGenerationForProject(db, otherProjectId, { created_at: "2026-01-01T23:59:00.000Z" });

  const result = await getAdminWorkspaceInvestigation(db as never, projectId);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;

  assert.equal(result.workspace.projectId, projectId);
  assert.equal(result.recentGenerations.length, 20, "bounded to MAX_RECENT_GENERATIONS");
  assert.ok(
    result.recentGenerations.every((g) => seededIds.includes(g.generationId)),
    "8: only this project's generations appear"
  );
  assert.equal(result.recentGenerations[0].createdAt, "2026-01-01T00:24:00.000Z", "9: newest first");
  assert.equal(result.recentGenerations[19].createdAt, "2026-01-01T00:05:00.000Z");

  const asJson = JSON.stringify(result);
  assert.doesNotMatch(asJson, /secret prompt/i, "no raw prompt reaches the projection");
  assert.doesNotMatch(asJson, /secret description/i, "no description reaches the projection");
  assert.doesNotMatch(asJson, /thumb\.png/i, "no thumbnail url reaches the projection");
});

test("6: the owner reference comes from the canonical projects.clerk_user_id column", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { projectId } = seedProject(db, { clerk_user_id: "user_specific_owner" });

  const result = await getAdminWorkspaceInvestigation(db as never, projectId);
  assert.equal(result.outcome, "NO_GENERATIONS");
  if (result.outcome !== "NO_GENERATIONS") return;
  assert.equal(result.workspace.ownerClerkUserId, "user_specific_owner");
});

test("PARTIAL_DATA: project read failure with real generation evidence is reported honestly, not discarded", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const projectId = randomUUID();
  seedGenerationForProject(db, projectId);

  const originalFrom = db.from.bind(db);
  const admin = {
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "transient read failure" } }),
            }),
          }),
        };
      }
      return originalFrom(table);
    },
  };

  const result = await getAdminWorkspaceInvestigation(admin as never, projectId);
  assert.equal(result.outcome, "PARTIAL_DATA");
  if (result.outcome !== "PARTIAL_DATA") return;
  assert.equal(result.workspace, null);
  assert.equal(result.recentGenerations.length, 1);
  assert.equal(result.reasonCode, "project_read_failed");
});

test("PARTIAL_DATA when project read succeeds but generations read fails", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { projectId } = seedProject(db);

  const originalFrom = db.from.bind(db);
  const admin = {
    from: (table: string) => {
      if (table === "generations") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: null, error: { message: "transient read failure" } }),
              }),
            }),
          }),
        };
      }
      return originalFrom(table);
    },
  };

  const result = await getAdminWorkspaceInvestigation(admin as never, projectId);
  assert.equal(result.outcome, "PARTIAL_DATA");
  if (result.outcome !== "PARTIAL_DATA") return;
  assert.ok(result.workspace);
  assert.equal(result.workspace?.projectId, projectId);
  assert.equal(result.recentGenerations.length, 0);
  assert.equal(result.reasonCode, "generations_read_failed");
});

test("PARTIAL_DATA is never returned when both the project and generations reads genuinely find nothing", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const admin = {
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "transient read failure" } }),
            }),
          }),
        };
      }
      return db.from(table);
    },
  };
  const result = await getAdminWorkspaceInvestigation(admin as never, randomUUID());
  assert.equal(result.outcome, "EVIDENCE_UNAVAILABLE", "cannot confirm existence either way — never guessed");
});

// ===========================================================================
// SECURITY / SENSITIVE DATA (item 12)
// ===========================================================================

test("the projects select() never includes description or thumbnail_url", () => {
  const serviceText = read("src/lib/admin/workspace-investigation-service.ts");
  const forbidden = ["description", "thumbnail_url"];
  const selects = [...serviceText.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(selects.length >= 2, "expected at least two .select() calls (projects, generations)");
  for (const cols of selects) {
    for (const word of forbidden) {
      assert.doesNotMatch(cols, new RegExp(word), `select() must not include forbidden column "${word}": ${cols}`);
    }
  }
});

test("the generations select() never includes prompt or other excluded columns", () => {
  const serviceText = read("src/lib/admin/workspace-investigation-service.ts");
  const forbidden = [
    "prompt",
    "negative_prompt",
    "input_url",
    "output_url",
    "thumbnail_url",
    "error_message",
    "metadata",
    "provider",
    "model",
  ];
  const selects = [...serviceText.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]);
  for (const cols of selects) {
    for (const word of forbidden) {
      assert.doesNotMatch(cols, new RegExp(word), `select() must not include forbidden column "${word}": ${cols}`);
    }
  }
});

test("the API route responds through privateJson and never leaks a raw exception", () => {
  const routeText = stripComments(read("src/app/api/admin/workspaces/[projectId]/route.ts"));
  assert.doesNotMatch(routeText, /NextResponse\.json\(/);
  assert.match(routeText, /privateJson\(/);
  assert.doesNotMatch(routeText, /\.stack\b|error\.message/i);
});

test("no raw Clerk object, token, or session shape appears anywhere in the new surface", () => {
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
// AUTH REUSE (item 14)
// ===========================================================================

test("exactly one canonical admin auth boundary is reused, never ROUTE_ADMIN_CLERK_USER_IDS", () => {
  const routeText = stripComments(read("src/app/api/admin/workspaces/[projectId]/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.doesNotMatch(routeText, /ROUTE_ADMIN_CLERK_USER_IDS/);
  const authIndex = routeText.indexOf("requireAdminAccess");
  const serviceCallIndex = routeText.indexOf("getAdminWorkspaceInvestigation");
  assert.ok(
    authIndex >= 0 && serviceCallIndex >= 0 && authIndex < serviceCallIndex,
    "auth must be checked before the service is ever called"
  );
});

// ===========================================================================
// AUTHORITY — no mutation of any kind (items 11, 15)
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
  { pattern: /suspendUser|deleteUser|banUser|disableUser|changeUserRole|setUserRole|transferOwnership|renameProject|deleteProject|updateWorkspaceMember|removeWorkspaceMember/i, why: "no user/project/workspace mutation" },
  { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "no database write" },
];

test("no operational mutation of any kind exists in the new Phase 16-A/4 surface", () => {
  for (const { file, text } of NEW_FILES) {
    for (const banned of BANNED) {
      assert.doesNotMatch(text, banned.pattern, `${file}: ${banned.why}`);
    }
  }
});

test("no action button/edit/delete/rename/transfer/member-management control exists in the UI", () => {
  const panelText = stripComments(read("src/components/admin/WorkspaceInvestigationPanel.tsx"));
  // Deliberately excludes the bare word "disabled" — the submit button's own
  // standard HTML attribute is legitimate form UX, not an operational
  // control (the same carve-out `phase-16-a3-user-investigation.e2e.test.ts`
  // documents for the identical reason).
  assert.doesNotMatch(
    panelText,
    /retry|redrive|suspend|onClick={.*(cancel|delete|ban|rename|transfer)|provider.?disable|route.?disable|kill.?switch|role.?change|change.?role|member/i
  );
});

// ===========================================================================
// GENERATION / USER LINKAGE — reuse, not duplication (item 11)
// ===========================================================================

test("recent generations link into the existing /admin/generations investigation surface", () => {
  const panelText = read("src/components/admin/WorkspaceInvestigationPanel.tsx");
  assert.match(panelText, /\/admin\/generations\?generationId=/);
});

test("the owner reference links into the existing /admin/users investigation surface", () => {
  const panelText = read("src/components/admin/WorkspaceInvestigationPanel.tsx");
  assert.match(panelText, /\/admin\/users\?clerkUserId=/);
});

test("16-A/2's trace-chain building is reused by reference, never re-implemented", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /function\s+buildTraceChain\s*\(/, `${file} must not re-implement buildTraceChain`);
    assert.doesNotMatch(
      text,
      /"outbox_events"|"generation_attempts"|"media_assets"/,
      `${file} must not re-query 16-A/2's tables`
    );
    assert.doesNotMatch(text, /TraceChainLink\b/, `${file} must not re-declare the trace chain type`);
  }
});

test("16-A/3's user investigation is reused by reference, never re-implemented", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(
      text,
      /function\s+getAdminUserInvestigation\s*\(/,
      `${file} must not re-implement getAdminUserInvestigation`
    );
    assert.doesNotMatch(text, /"profiles"/, `${file} must not query profiles — owner is a bare project reference`);
  }
});

// ===========================================================================
// ARCHITECTURE — no new workspace model (items 10, 6)
// ===========================================================================

test("the canonical projects table is reused as the workspace, no second workspace/membership model", () => {
  const serviceText = stripComments(read("src/lib/admin/workspace-investigation-service.ts"));
  assert.match(serviceText, /"projects"/);
  // Quoted/underscored forms only — a bare /workspaces/i would false-positive
  // on identifiers like `WorkspaceSummaryView` (case-folds to a string that
  // starts with "workspaces").
  assert.doesNotMatch(serviceText, /CREATE TABLE|"workspaces"|workspace_members|workspace_directory/i);
});

test("the canonical generations.project_id relation is reused", () => {
  const serviceText = stripComments(read("src/lib/admin/workspace-investigation-service.ts"));
  assert.match(serviceText, /"generations"/);
  assert.match(serviceText, /\.eq\("project_id", projectId\)/);
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
  const serviceText = stripComments(read("src/lib/admin/workspace-investigation-service.ts"));
  assert.doesNotMatch(serviceText, /CREATE TABLE|ALTER TABLE/i);
});

// ===========================================================================
// PHASE 16-A/3 STALE COMMENTARY CORRECTION (items 15, 16)
// ===========================================================================

test("15: the stale 'profiles missing SELECT' claim no longer appears in 16-A/3's contract or service", () => {
  const files = [
    "src/lib/admin/user-investigation-contract.ts",
    "src/lib/admin/user-investigation-service.ts",
  ];
  for (const rel of files) {
    const text = read(rel);
    assert.doesNotMatch(
      text,
      /grants?\s+`?service_role`?\s+only\s+`?REFERENCES,TRIGGER,TRUNCATE,MAINTAIN`?\s*—?\s*no\s+`?SELECT`?/i,
      `${rel} must not restate the stale missing-SELECT claim as fact`
    );
    assert.doesNotMatch(
      text,
      /grant\s+`?SELECT`?\s+on\s+`?public\.profiles`?\s+to\s+`?service_role`?/i,
      `${rel} must not instruct a future migration to fix a gap that repository evidence contradicts`
    );
  }
});

test("15: the corrected repository finding (CONFIRMED_PRESENT) is stated in the contract", () => {
  const contractText = read("src/lib/admin/user-investigation-contract.ts");
  assert.match(contractText, /CONFIRMED_PRESENT/);
  assert.match(contractText, /credit_system\.sql/);
});

test("16: the profiles/generations independent-read semantics remain unchanged", async () => {
  const { getAdminUserInvestigation } = await import("@/lib/admin/user-investigation-service");
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const clerkUserId = "user_16a4_regression_check";
  if (!db.state.generations) db.state.generations = [];
  db.state.generations.push({
    id: randomUUID(),
    project_id: randomUUID(),
    clerk_user_id: clerkUserId,
    generation_type: "image",
    provider: "mock",
    model: "mock-image",
    prompt: null,
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
  });

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
  assert.equal(result.outcome, "PARTIAL_DATA", "profiles failure still degrades honestly, unchanged by this batch");
});

test("17: no migration file exists anywhere in the new or modified surface for this batch", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE|DROP TABLE/i, file);
  }
});

test("18: no locked product UI file is touched by this batch's admin layout change", () => {
  const layoutText = read("src/app/admin/layout.tsx");
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const locked of lockedDirs) {
    assert.doesNotMatch(layoutText, new RegExp(`["'/]${locked}["'/]`));
  }
});
