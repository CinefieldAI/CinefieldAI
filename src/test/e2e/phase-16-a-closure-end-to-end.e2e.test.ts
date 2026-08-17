import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getAdminUserInvestigation } from "@/lib/admin/user-investigation-service";
import { getAdminWorkspaceInvestigation } from "@/lib/admin/workspace-investigation-service";
import { getGenerationInvestigation } from "@/lib/admin/generation-investigation-service";
import { getAdminRiskInvestigation } from "@/lib/admin/risk-investigation-service";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase, seedGeneration } from "./e2e-harness";

const ROOT = process.cwd();
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walkFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const ADMIN_LIB_FILES = walkFiles(path.join(ROOT, "src/lib/admin")).filter((f) => !f.endsWith(".test.ts"));
const ADMIN_API_FILES = walkFiles(path.join(ROOT, "src/app/api/admin"));
const ADMIN_PAGE_FILES = walkFiles(path.join(ROOT, "src/app/admin"));
const ADMIN_COMPONENT_FILES = walkFiles(path.join(ROOT, "src/components/admin"));
const ALL_16A_FILES = [...ADMIN_LIB_FILES, ...ADMIN_API_FILES, ...ADMIN_PAGE_FILES, ...ADMIN_COMPONENT_FILES].map(
  (f) => ({
    // Forward-slash-normalized: `path.relative` returns backslashes on
    // Windows, which would silently break every `/^src\/app\/.../ ` regex
    // below.
    file: path.relative(ROOT, f).split(path.sep).join("/"),
    text: stripComments(readFileSync(f, "utf8")),
  })
);

/**
 * `seedGeneration` (e2e-harness.ts) creates a matching `projects` row but no
 * `profiles` row — `getAdminUserInvestigation` treats a genuinely absent
 * profile as authoritative `USER_NOT_FOUND` (real `ON DELETE CASCADE`
 * reasoning, see `user-investigation-service.ts`), so this end-to-end test
 * seeds one explicitly, the same shape
 * `phase-16-a3-user-investigation.e2e.test.ts` already establishes.
 */
function seedProfile(db: FakeSupabaseClient, clerkUserId: string): void {
  if (!db.state.profiles) db.state.profiles = [];
  db.state.profiles.push({
    clerk_user_id: clerkUserId,
    display_name: "E2E Closure Flow User",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

/**
 * Phase 16-A closure — end-to-end proof of the official done criterion:
 * "Admin can follow a user/generation event end-to-end."
 *
 * One real generation, seeded once, walked from THREE independent starting
 * points (a user id, a project id, a security event's identifiers), each
 * arriving at the SAME canonical `getGenerationInvestigation` result — never
 * a second trace-chain implementation, never a second lifecycle model. Risk
 * evidence joins the same real generation/actor ids this test seeds; it is
 * not fabricated to make the flow look complete.
 *
 * This file calls the four 16-A services directly (the same production
 * functions their own API routes call) rather than driving HTTP, matching
 * every existing 16-A test's own harness convention (`installFakeSupabase`
 * + the shared production-code services) — an HTTP-level walk would only
 * re-prove `requireAdminAccess()`/`privateJson()` wiring each route's own
 * test file already covers individually.
 */

test("end-to-end: User -> recent generation -> Generation Investigation -> attempts -> trace evidence", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  const clerkUserId = "user_e2e_closure_flow";
  seedProfile(db, clerkUserId);
  const { generationId, projectId } = seedGeneration(db, {
    clerk_user_id: clerkUserId,
    status: "completed",
    prompt: "e2e closure flow secret prompt that must never leak",
  });

  const attemptId = randomUUID();
  db.state.generation_attempts = [
    {
      id: attemptId,
      generation_id: generationId,
      attempt_no: 1,
      status: "succeeded",
      provider: "mock",
      provider_model: "mock-image-v1",
      provider_job_id: "job-e2e-closure",
      submission_evidence: "job",
      submission_error_code: null,
      error_code: null,
      latency_ms: 1500,
      started_at: "2026-01-01T00:00:00.000Z",
      submitted_at: "2026-01-01T00:00:01.000Z",
      completed_at: "2026-01-01T00:00:02.000Z",
      workflow_id: "wf-e2e-closure",
      workflow_run_id: "run-e2e-closure",
    },
  ];
  db.state.outbox_events = [
    {
      aggregate_type: "generation",
      aggregate_id: generationId,
      event_type: "generation.completed",
      trace_id: "e2e-closure-trace",
      occurred_at: "2026-01-01T00:00:02.000Z",
    },
  ];
  db.state.media_assets = [
    {
      id: randomUUID(),
      clerk_user_id: clerkUserId,
      generation_id: generationId,
      generation_attempt_id: attemptId,
      role: "original",
      media_type: "image",
      quarantine_status: "released",
      moderation_status: "passed",
      moderation_engine: "e2e-engine",
      moderated_at: "2026-01-01T00:00:02.500Z",
      ingest_status: "verified",
      created_at: "2026-01-01T00:00:02.500Z",
    },
  ];

  // Also real, so a Risk lookup on the SAME ids has genuine evidence to
  // find — never fabricated purely to make this test look complete.
  if (!db.state.security_events) db.state.security_events = [];
  db.state.security_events.push(
    {
      id: randomUUID(),
      event_id: randomUUID(),
      kind: "rate_limit_denied",
      severity: "low",
      source: "route_rate_limit",
      reason_code: "e2e_closure_reason",
      actor_clerk_user_id: clerkUserId,
      tenant_id: clerkUserId,
      subject_hash: null,
      resource_type: null,
      resource_id: null,
      trace_id: null,
      risk_score: 15,
      recommended_action: "none",
      dedupe_key: "e2e-closure-user",
      window_started_at: "2026-01-01T00:00:00.000Z",
      occurred_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      policy_version: null,
    },
    {
      id: randomUUID(),
      event_id: randomUUID(),
      kind: "outbound_fetch_blocked",
      severity: "high",
      source: "outbound_fetch_gateway",
      reason_code: "e2e_closure_resource",
      actor_clerk_user_id: null,
      tenant_id: clerkUserId,
      subject_hash: null,
      resource_type: "generation",
      resource_id: generationId,
      trace_id: "e2e-closure-trace",
      risk_score: 70,
      recommended_action: "admin_review",
      dedupe_key: "e2e-closure-generation",
      window_started_at: "2026-01-01T00:00:02.000Z",
      occurred_at: "2026-01-01T00:00:02.000Z",
      created_at: "2026-01-01T00:00:02.000Z",
      policy_version: null,
    }
  );

  // ---- STEP 1: start from the user -----------------------------------
  const userResult = await getAdminUserInvestigation(db as never, clerkUserId);
  assert.equal(userResult.outcome, "FOUND");
  if (userResult.outcome !== "FOUND") return;
  assert.ok(
    userResult.recentGenerations.some((g) => g.generationId === generationId),
    "the seeded generation appears in this user's recent-generations list"
  );

  // ---- STEP 2: follow that generation into the canonical investigation ----
  const generationFromUser = await getGenerationInvestigation(db as never, generationId);
  assert.equal(generationFromUser.outcome, "FOUND");
  if (generationFromUser.outcome !== "FOUND") return;
  assert.equal(generationFromUser.attempts.length, 1, "attempt timeline is reachable");
  assert.equal(generationFromUser.attempts[0].status, "succeeded");
  const traceLink = generationFromUser.chain.find((l) => l.name === "trace_id");
  assert.equal(traceLink?.status, "AVAILABLE", "trace/correlation evidence is reachable");
  assert.equal(traceLink?.value, "e2e-closure-trace");

  // ---- STEP 3: start from the workspace/project instead -----------------
  const workspaceResult = await getAdminWorkspaceInvestigation(db as never, projectId);
  assert.equal(workspaceResult.outcome, "FOUND");
  if (workspaceResult.outcome !== "FOUND") return;
  assert.equal(workspaceResult.workspace.ownerClerkUserId, clerkUserId, "canonical owner preserved");
  assert.ok(
    workspaceResult.recentGenerations.some((g) => g.generationId === generationId),
    "the same generation is reachable from its workspace"
  );

  // ---- STEP 4: the workspace's generation resolves to the SAME investigation ----
  const generationFromWorkspace = await getGenerationInvestigation(db as never, generationId);
  assert.deepEqual(
    generationFromWorkspace,
    generationFromUser,
    "user-path and workspace-path arrive at the identical canonical Generation Investigation result — no duplicate trace-chain logic"
  );

  // ---- STEP 5: risk evidence joins the same real ids, where it exists ----
  const riskByUser = await getAdminRiskInvestigation(db as never, "clerk_user_id", clerkUserId);
  assert.equal(riskByUser.outcome, "FOUND");
  if (riskByUser.outcome === "FOUND") {
    assert.ok(riskByUser.events.some((e) => e.actorClerkUserId === clerkUserId));
  }

  const riskByGeneration = await getAdminRiskInvestigation(db as never, "generation_id", generationId);
  assert.equal(riskByGeneration.outcome, "FOUND");
  if (riskByGeneration.outcome === "FOUND") {
    assert.ok(riskByGeneration.events.some((e) => e.resourceId === generationId));
    assert.equal(riskByGeneration.mediaSafety.length, 1, "the same generation's media-safety row is reachable too");
  }

  // ---- Sensitive-data boundary held across the whole walk ----
  const wholeFlow = JSON.stringify([userResult, generationFromUser, workspaceResult, riskByUser, riskByGeneration]);
  assert.doesNotMatch(wholeFlow, /e2e closure flow secret prompt/i, "no prompt leaked anywhere across the flow");
});

test("a generation with no security_events evidence reports NO_RISK_EVIDENCE, never a fabricated link", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const clerkUserId = "user_e2e_no_risk_evidence";
  seedProfile(db, clerkUserId);
  const { generationId } = seedGeneration(db, { clerk_user_id: clerkUserId, status: "completed" });

  const userResult = await getAdminUserInvestigation(db as never, clerkUserId);
  assert.equal(userResult.outcome, "FOUND", "the generation itself is real and reachable from the user");
  if (userResult.outcome === "FOUND") {
    assert.ok(userResult.recentGenerations.some((g) => g.generationId === generationId));
  }

  const riskResult = await getAdminRiskInvestigation(db as never, "generation_id", generationId);
  assert.deepEqual(
    riskResult,
    { outcome: "NO_RISK_EVIDENCE" },
    "no security_events row exists for this generation, and none is invented just because the generation exists"
  );
});

// ===========================================================================
// CROSS-16-A SWEEP — every admin lib/api/page/component file, in one pass
// ===========================================================================

test("sensitive-data boundary: no admin surface's select() ever names a forbidden column", () => {
  const forbidden = [
    "prompt",
    "negative_prompt",
    "input_url",
    "output_url",
    "error_message",
    "metadata",
    "object_key",
    "bucket",
    "declared_content_type",
    "checksum_sha256",
    "subject_hash",
    "dedupe_key",
  ];
  for (const { file, text } of ALL_16A_FILES) {
    const selects = [...text.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]);
    for (const cols of selects) {
      for (const word of forbidden) {
        assert.doesNotMatch(cols, new RegExp(word), `${file}: select() must not include forbidden column "${word}": ${cols}`);
      }
    }
  }
});

test("sensitive-data boundary: no raw Clerk object, token, secret, or signed-URL shape anywhere across 16-A", () => {
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
    "process\\.env\\.[a-z0-9_]*secret",
  ];
  for (const { file, text } of ALL_16A_FILES) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word), `${file} mentions forbidden shape "${word}"`);
    }
  }
});

test("read-only guarantee: zero mutation authority anywhere across every 16-A lib/api file", () => {
  const banned = [
    { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "no database write" },
    { pattern: /submitAttempt\s*\(|executeGeneration\s*\(|claimAttemptForSubmission/, why: "no provider execution" },
    { pattern: /cancelPendingAttempt|requestGenerationCancellation|markAttemptTerminal/, why: "no generation/attempt mutation" },
    { pattern: /StartMessageMoveTask|SendMessageCommand|DeleteMessageCommand|ChangeMessageVisibility|PurgeQueueCommand/, why: "no DLQ/queue mutation" },
    { pattern: /setRoutingControl|clearRoutingControl/, why: "no routing mutation" },
    { pattern: /isRemediationKillSwitchEngaged/, why: "no kill-switch mutation" },
    { pattern: /releaseQuarantine|approveMediaRelease|rejectMediaAsset/, why: "no quarantine release" },
    { pattern: /runRestoreValidation|evaluateAiPrProposal/, why: "no restore/deploy/remediation authority" },
    { pattern: /reserveCredits|settleReservation|releaseReservation|credit_ledger|credit_wallets|Stripe/i, why: "no billing/credit mutation" },
    { pattern: /suspendUser|deleteUser|banUser|disableUser|changeUserRole|setUserRole|applyTemporaryBlock/i, why: "no user/enforcement mutation" },
    { pattern: /recordSecurityEvent\s*\(|assessRisk\s*\(/, why: "no writing new evidence, no re-scoring" },
  ];
  for (const { file, text } of ALL_16A_FILES) {
    for (const rule of banned) {
      assert.doesNotMatch(text, rule.pattern, `${file}: ${rule.why}`);
    }
  }
});

test("admin auth consolidation: every /api/admin/* route reuses requireAdminAccess(), never ROUTE_ADMIN_CLERK_USER_IDS", () => {
  for (const { file, text } of ALL_16A_FILES) {
    if (!/^src\/app\/api\/admin\//.test(file)) continue;
    assert.match(text, /requireAdminAccess/, `${file} must call requireAdminAccess()`);
    assert.doesNotMatch(text, /ROUTE_ADMIN_CLERK_USER_IDS/, `${file} must never reuse the Phase 7-B allowlist`);
  }
});

test("admin auth consolidation: the layout is the only place calling requireAdminAccess() outside API routes", () => {
  for (const { file, text } of ALL_16A_FILES) {
    if (!/^src\/app\/admin\//.test(file) || file.endsWith("layout.tsx")) continue;
    assert.doesNotMatch(text, /requireAdminAccess/, `${file}: pages must rely on the layout's gate, not repeat it`);
  }
});

test("cache/route security: every /api/admin/* route responds through privateJson, never NextResponse.json", () => {
  for (const { file, text } of ALL_16A_FILES) {
    if (!/^src\/app\/api\/admin\/.*route\.ts$/.test(file)) continue;
    assert.match(text, /privateJson\(/, `${file} must respond through privateJson (private, no-store)`);
    assert.doesNotMatch(text, /NextResponse\.json\(/, `${file} must not bypass privateJson`);
  }
});

test("cache/route security: the public liveness route is untouched by this batch", () => {
  const text = readFileSync(path.join(ROOT, "src/app/api/health/live/route.ts"), "utf8");
  assert.doesNotMatch(text, /requireAdminAccess|security_events|risk-investigation/i);
});

test("dashboard: /admin links to every 16-A screen, and future sections are labels, never routes", () => {
  const layoutText = readFileSync(path.join(ROOT, "src/app/admin/layout.tsx"), "utf8");
  for (const href of ["/admin/generations", "/admin/users", "/admin/workspaces", "/admin/risk"]) {
    assert.match(layoutText, new RegExp(href.replace(/\//g, "\\/")), `layout must link to ${href}`);
  }
  // FUTURE_SECTIONS entries render as <span>, never <Link>, and this test
  // fails if any of them is accidentally turned into a real href.
  for (const future of ["Incidents", "Cost / FinOps", "Restore", "Recovery", "DLQ", "Providers / Routes"]) {
    assert.doesNotMatch(layoutText, new RegExp(`href=\\{?["'\`][^"'\`]*${future.split(" ")[0]}`, "i"));
  }
});

test("dashboard: the entry-points component links out only, never duplicates a detail screen's own rendering", () => {
  const text = readFileSync(path.join(ROOT, "src/components/admin/AdminInvestigationEntryPoints.tsx"), "utf8");
  assert.doesNotMatch(text, /fetch\(|useState|useEffect/, "the dashboard entry points are static links, not a data-fetching duplicate of a detail screen");
  for (const href of ["/admin/users", "/admin/workspaces", "/admin/risk", "/admin/generations"]) {
    assert.match(text, new RegExp(href.replace(/\//g, "\\/")));
  }
});
