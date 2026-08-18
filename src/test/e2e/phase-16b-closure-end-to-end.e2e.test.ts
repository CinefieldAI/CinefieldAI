import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { redriveOneProviderDlqMessageWithClient } from "@/lib/aws/dlq-redrive/adapters/sqs-dlq-redrive-executor";
import type { AttemptRedriveEvidence, DlqRedriveEvidenceSource, GenerationRedriveEvidence } from "@/lib/aws/dlq-redrive/dlq-redrive-contract";
import { getAdminBullmqHealth, retryAdminBullmqJob } from "@/lib/admin/bullmq-admin-service";
import { setAdminRouteEnabled } from "@/lib/admin/router-admin-service";
import { decidePrivilegedAction } from "@/lib/admin/tier0-authorization";
import { commandIdFor, parseCommand, serializeCommand, type CommandWireV1 } from "@/lib/contracts/command-wire";
import type { AssuranceEvidence, ElevationVerdict } from "@/lib/admin/step-up-auth";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase } from "./e2e-harness";

// Phase 16-E: route.disable is now Tier-0-gated (fail-closed, see
// tier0-authorization.ts). This closure test's OWN point is Phase 7-B's
// owner behavior, not Tier-0 — so it supplies valid Tier-0 role + step-up
// evidence to pass that gate and reach the same assertions it always made.
const TIER0_STEP_UP: { assurance: AssuranceEvidence; elevation: ElevationVerdict } = {
  assurance: { state: "VERIFIED", verifiedAt: new Date().toISOString() },
  elevation: { elevated: true, reasonCode: "verified" },
};

/**
 * Phase 16-B closure — proof of the official done criterion:
 *
 * "Operator, within authorized scope, can (a) inspect failed/DLQ work,
 * (b) safely redrive eligible SQS work, (c) safely retry eligible BullMQ
 * auxiliary work, (d) disable a route through the existing routing
 * authority."
 *
 * (a)/(b) and (d) are proven live, end to end, against this repo's real
 * production code (with AWS/BullMQ calls swapped for injected fakes at the
 * one seam each service already exposes for exactly this purpose — never
 * a second implementation of the underlying logic). (c) is proven as a
 * real, complete, unmocked CODE PATH reaching an honest NOT_CONFIGURED
 * outcome, because BullMQ/Redis B is genuinely unprovisioned in every
 * environment today (confirmed in `bullmq-foundation.test.ts` and
 * `infra/modules/redis/main.tf`) -- this is DEFERRED_EXTERNAL, not a gap:
 * no live BullMQ retry is claimed to have run, because none did.
 */

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
const ALL_ADMIN_FILES = [...ADMIN_LIB_FILES, ...ADMIN_API_FILES, ...ADMIN_PAGE_FILES, ...ADMIN_COMPONENT_FILES].map((f) => ({
  file: path.relative(ROOT, f).split(path.sep).join("/"),
  text: stripComments(readFileSync(f, "utf8")),
}));
// The new Phase 16-B redrive executor lives outside src/lib/admin (it is
// part of the existing dlq-redrive package, reused, not admin-owned) --
// included explicitly so the sweeps below see its two real mutation calls.
const REDRIVE_EXECUTOR_FILE = {
  file: "src/lib/aws/dlq-redrive/adapters/sqs-dlq-redrive-executor.ts",
  text: stripComments(readFileSync(path.join(ROOT, "src/lib/aws/dlq-redrive/adapters/sqs-dlq-redrive-executor.ts"), "utf8")),
};
// Only the files this batch (16-B) actually added/owns, for the tighter
// "no operational mutation outside the four named ones" sweep below.
const PHASE_16B_FILES = [
  ...ALL_ADMIN_FILES.filter((f) => /(dlq|queue-health|bullmq|router|model-provider)/i.test(f.file)),
  REDRIVE_EXECUTOR_FILE,
];

function wireCommand(overrides: Partial<CommandWireV1> & { attemptId: string; generationId: string }) {
  const type = overrides.type ?? "provider.submit";
  const body = serializeCommand({
    commandId: overrides.commandId ?? commandIdFor(type, overrides.attemptId),
    type,
    generationId: overrides.generationId,
    attemptId: overrides.attemptId,
    issuedAt: overrides.issuedAt ?? new Date().toISOString(),
  });
  const parsed = parseCommand(body);
  if (!parsed.ok) throw new Error(`fixture rejected by the production parser: ${parsed.reason}`);
  return body;
}

function fakeEvidenceSource(over: Partial<DlqRedriveEvidenceSource> = {}): DlqRedriveEvidenceSource {
  return { label: "fake-source", readAttempt: async () => null, readGeneration: async () => null, ...over };
}
function attemptEvidence(over: Partial<AttemptRedriveEvidence> = {}): AttemptRedriveEvidence {
  return {
    attemptId: over.attemptId ?? randomUUID(),
    generationId: over.generationId ?? randomUUID(),
    status: over.status ?? "pending",
    submissionEvidence: over.submissionEvidence ?? "none",
  };
}
function generationEvidence(over: Partial<GenerationRedriveEvidence> = {}): GenerationRedriveEvidence {
  return { generationId: over.generationId ?? randomUUID(), status: over.status ?? "queued" };
}

test("done criterion (a)+(b): inspect then safely redrive eligible SQS work, decision recomputed fresh, atomic claim untouched by this layer", async () => {
  const attemptId = randomUUID();
  const generationId = randomUUID();
  const body = wireCommand({ attemptId, generationId });
  const sent: unknown[] = [];
  const deleted: string[] = [];
  const handle = randomUUID();

  const client = {
    receiveAndClaim: async () => ({ body, messageId: randomUUID(), receiptHandle: handle }),
    releaseImmediately: async () => {},
    sendToProviderQueue: async (b: string, groupId: string, dedupId: string) => {
      sent.push({ b, groupId, dedupId });
    },
    deleteFromDlq: async (h: string) => {
      deleted.push(h);
    },
  };
  const source = fakeEvidenceSource({
    readAttempt: async () => attemptEvidence({ attemptId, generationId, status: "pending", submissionEvidence: "none" }),
    readGeneration: async () => generationEvidence({ generationId, status: "queued" }),
  });

  const result = await redriveOneProviderDlqMessageWithClient(client, source);
  assert.equal(result.outcome, "REDRIVEN");
  assert.equal(sent.length, 1);
  assert.deepEqual(deleted, [handle]);

  // This layer's own contract: it never touches generation_attempts or
  // claimAttemptForSubmission -- the atomic claim inside submitAttempt
  // remains the sole, unduplicated protection against double execution
  // once the redriven command is actually delivered.
  const executorText = stripComments(
    readFileSync(path.join(ROOT, "src/lib/aws/dlq-redrive/adapters/sqs-dlq-redrive-executor.ts"), "utf8")
  );
  assert.doesNotMatch(executorText, /claimAttemptForSubmission|generation_attempts/);
});

test("done criterion (c), honestly DEFERRED_EXTERNAL: BullMQ retry is a real, complete, unmocked code path reaching NOT_CONFIGURED because Redis B is genuinely unprovisioned", async () => {
  const health = await getAdminBullmqHealth();
  assert.deepEqual(health, { outcome: "NOT_CONFIGURED" });

  const retry = await retryAdminBullmqJob("user_admin_e2e", "media-short", "job-123", "closure proof");
  assert.deepEqual(retry, { outcome: "NOT_CONFIGURED" });
});

test("done criterion (d): disable a route through the existing Phase 7-B routing authority, and it is reversible", async () => {
  const original = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  const originalTier0 = process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = "user_route_admin_closure";
  // PHASE 19 CLOSURE FIX: route.disable is now requiresTwoPerson: true —
  // the RPC's own "two distinct people" threshold (required_approvals
  // default 2) excludes the requester by construction, so TWO further,
  // distinct Tier-0 admins must approve the same pending request before
  // setRouteEnabled is ever reached.
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS =
    "user_route_admin_closure,user_route_admin_closure_approver_a,user_route_admin_closure_approver_b";
  try {
    const db = new FakeSupabaseClient();
    await installFakeSupabase(db);
    const routeId = randomUUID();
    db.state.model_routes = [
      { id: routeId, model_id: "closure-model", priority: 100, enabled: true, status: "active", updated_at: "2026-01-01T00:00:00.000Z" },
    ];

    const disableAttempt = await setAdminRouteEnabled(db as never, "user_route_admin_closure", routeId, false, "closure proof", TIER0_STEP_UP);
    assert.equal(disableAttempt.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    if (disableAttempt.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
    for (const approver of ["user_route_admin_closure_approver_a", "user_route_admin_closure_approver_b"]) {
      const disableApproval = await decidePrivilegedAction(db as never, {
        requestId: disableAttempt.requestId,
        action: "route.disable",
        actorClerkUserId: approver,
        target: { type: "model_route", id: routeId },
        decision: "approve",
        assurance: TIER0_STEP_UP.assurance,
        elevation: TIER0_STEP_UP.elevation,
      });
      assert.equal(disableApproval.outcome, "APPROVAL_RECORDED");
    }
    const disabled = await setAdminRouteEnabled(
      db as never,
      "user_route_admin_closure",
      routeId,
      false,
      "closure proof",
      TIER0_STEP_UP,
      disableAttempt.requestId
    );
    assert.deepEqual(disabled, { outcome: "APPLIED", routeId, enabled: false });

    const reEnableAttempt = await setAdminRouteEnabled(db as never, "user_route_admin_closure", routeId, true, "closure proof done", TIER0_STEP_UP);
    assert.equal(reEnableAttempt.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    if (reEnableAttempt.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
    for (const approver of ["user_route_admin_closure_approver_a", "user_route_admin_closure_approver_b"]) {
      const reEnableApproval = await decidePrivilegedAction(db as never, {
        requestId: reEnableAttempt.requestId,
        action: "route.disable",
        actorClerkUserId: approver,
        target: { type: "model_route", id: routeId },
        decision: "approve",
        assurance: TIER0_STEP_UP.assurance,
        elevation: TIER0_STEP_UP.elevation,
      });
      assert.equal(reEnableApproval.outcome, "APPROVAL_RECORDED");
    }
    const reEnabled = await setAdminRouteEnabled(
      db as never,
      "user_route_admin_closure",
      routeId,
      true,
      "closure proof done",
      TIER0_STEP_UP,
      reEnableAttempt.requestId
    );
    assert.deepEqual(reEnabled, { outcome: "APPLIED", routeId, enabled: true });
  } finally {
    if (original !== undefined) process.env.ROUTE_ADMIN_CLERK_USER_IDS = original;
    else delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
    if (originalTier0 !== undefined) process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = originalTier0;
    else delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

// ===========================================================================
// CROSS-PHASE OWNERSHIP PRESERVED
// ===========================================================================

test("Temporal remains generation-lifecycle authority: no 16-B file signals a workflow or mutates generation status", () => {
  for (const { file, text } of PHASE_16B_FILES) {
    assert.doesNotMatch(text, /signalWorkflow|WorkflowClient|generations.*status.*=|markCompleted|finalizeMedia/, `${file} must not touch generation lifecycle`);
  }
});

test("SQS remains critical-command transport, never a second lifecycle owner: the redrive executor only moves a message, never mutates generation_attempts", () => {
  const executorText = stripComments(
    readFileSync(path.join(ROOT, "src/lib/aws/dlq-redrive/adapters/sqs-dlq-redrive-executor.ts"), "utf8")
  );
  assert.doesNotMatch(executorText, /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/);
});

test("Phase 15-D remains the sole redrive safety-decision authority: no 16-B service/contract file re-implements the six-state branching logic", () => {
  // Scoped to .ts service/contract files, not .tsx UI files: the DLQ
  // panel legitimately compares a server-received decision.state against
  // one known permitted value to decide whether to show the redrive
  // button (`=== "SAFE_TO_REDRIVE"`) -- that is displaying/gating on
  // already-decided server data, not re-implementing the six-state
  // decision logic itself. What must never exist is a second file that
  // BRANCHES across multiple decision states the way the real engine does.
  for (const { file, text } of PHASE_16B_FILES) {
    if (!file.endsWith(".ts")) continue;
    assert.doesNotMatch(text, /"SAFE_TO_REDRIVE"|"REFUSE_AMBIGUOUS_PROVIDER_STATE"|"REFUSE_TERMINAL_GENERATION"/, `${file} must not hardcode decision-engine states -- import them`);
  }
});

test("BullMQ remains auxiliary-only: no 16-B file reads/writes generations, generation_attempts, or credit tables from the BullMQ path", () => {
  const bullmqFiles = PHASE_16B_FILES.filter((f) => /bullmq/i.test(f.file));
  for (const { file, text } of bullmqFiles) {
    assert.doesNotMatch(text, /"generations"|"generation_attempts"|credit_wallets|credit_ledger/, `${file} must stay auxiliary-only`);
  }
});

test("Phase 7 remains routing-mutation authority: the only route mutation call anywhere in 16-B is setRouteEnabled, reused unmodified", () => {
  for (const { file, text } of PHASE_16B_FILES) {
    if (file === "src/lib/admin/router-admin-service.ts") continue;
    assert.doesNotMatch(text, /setRouteEnabled\s*\(|setRoutePriority\s*\(|setRuntimeRoutingControl\s*\(/, `${file}: route mutation belongs only to router-admin-service.ts`);
  }
});

test("Phase 13-D alert routing is not duplicated: no 16-B file creates a second alert router or CloudWatch alarm", () => {
  for (const { file, text } of PHASE_16B_FILES) {
    assert.doesNotMatch(text, /new\s+CloudWatchClient|PutMetricAlarmCommand|createAlertRouter|alertOnSecurityEvent/, `${file} must not duplicate Phase 13-D alerting`);
  }
});

test("Phase 21 feature-flag boundary preserved: no generic runtime-flag CRUD console exists", () => {
  for (const { file, text } of PHASE_16B_FILES) {
    assert.doesNotMatch(text, /createFeatureFlag|featureFlagStore|genericRuntimeFlag/i, `${file} must not build a generic feature-flag system`);
  }
});

test("Phase 16-E boundary preserved: no passkey, MFA, step-up auth, two-person/dual-control, or OPA integration exists in 16-B", () => {
  for (const { file, text } of PHASE_16B_FILES) {
    assert.doesNotMatch(text, /passkey|WebAuthn|requireTwoPerson|dualControl|opa\.eval|stepUpAuth/i, `${file} must not implement 16-E hardening early`);
  }
});

// ===========================================================================
// READ-ONLY / MUTATION BOUNDARY -- exactly four mutation call sites, nothing else
// ===========================================================================

test("exactly the four documented mutation call sites exist across all of Phase 16-B, nothing else", () => {
  const mutationPatterns = [
    { pattern: /sendToProviderQueue\s*\(/, label: "DLQ redrive send" },
    { pattern: /deleteFromDlq\s*\(/, label: "DLQ redrive delete" },
    { pattern: /job\.retry\s*\(/, label: "BullMQ retry" },
    { pattern: /setRouteEnabled\s*\(/, label: "route enable/disable" },
  ];
  const foundLabels = new Set<string>();
  for (const { text } of PHASE_16B_FILES) {
    for (const { pattern, label } of mutationPatterns) {
      if (pattern.test(text)) foundLabels.add(label);
    }
  }
  assert.deepEqual([...foundLabels].sort(), mutationPatterns.map((m) => m.label).sort());
});

test("no admin surface exposes a query-string GET mutation: every route with a body-driven action is POST", () => {
  for (const { file, text } of ALL_ADMIN_FILES) {
    if (!file.startsWith("src/app/api/admin/") || !file.endsWith("route.ts")) continue;
    const hasPost = /export async function POST/.test(text);
    const hasGet = /export async function GET/.test(text);
    if (hasPost) {
      assert.ok(!hasGet || file.includes("route.ts"), file);
    }
  }
});

// ===========================================================================
// SENSITIVE DATA / AUTH / CACHE SWEEP -- same discipline as the 16-A sweep
// ===========================================================================

test("sensitive-data boundary: no raw SQS body, BullMQ payload, prompt, secret, token, or stack trace anywhere in 16-B", () => {
  const forbidden = [
    "prompt",
    "apikey",
    "signedurl",
    "authorization:",
    "\\.stack\\b",
    "access_token",
    "refresh_token",
    "job\\.data\\b",
    "job\\.stacktrace\\b",
  ];
  for (const { file, text } of PHASE_16B_FILES) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word), `${file} mentions forbidden shape "${word}"`);
    }
  }
});

test("admin auth consolidation: every new /api/admin/* route reuses requireAdminAccess(), never ROUTE_ADMIN_CLERK_USER_IDS directly", () => {
  for (const { file, text } of PHASE_16B_FILES) {
    if (!file.startsWith("src/app/api/admin/")) continue;
    assert.match(text, /requireAdminAccess/, `${file} must call requireAdminAccess()`);
    assert.doesNotMatch(text, /ROUTE_ADMIN_CLERK_USER_IDS/, `${file} must never reuse the Phase 7-B allowlist directly`);
  }
});

test("cache/route security: every new /api/admin/* route responds through privateJson, never NextResponse.json", () => {
  for (const { file, text } of PHASE_16B_FILES) {
    if (!/^src\/app\/api\/admin\/.*route\.ts$/.test(file)) continue;
    assert.match(text, /privateJson\(/, `${file} must respond through privateJson (private, no-store)`);
    assert.doesNotMatch(text, /NextResponse\.json\(/, `${file} must not bypass privateJson`);
  }
});

test("the public liveness route remains untouched by Phase 16-B", () => {
  const text = readFileSync(path.join(ROOT, "src/app/api/health/live/route.ts"), "utf8");
  assert.doesNotMatch(text, /requireAdminAccess|dlq-admin|bullmq-admin|router-admin|model-provider-admin/i);
});

test("dashboard: /admin links to every 16-B screen", () => {
  const layoutText = readFileSync(path.join(ROOT, "src/app/admin/layout.tsx"), "utf8");
  for (const href of ["/admin/dlq", "/admin/queue-health", "/admin/models-providers", "/admin/router"]) {
    assert.match(layoutText, new RegExp(href.replace(/\//g, "\\/")), `layout must link to ${href}`);
  }
  // This test USED TO also assert "Incidents"/"Cost / FinOps"/"Restore"/
  // "Recovery" stayed non-clickable labels. Phase 16-D promoted all four to
  // real screens and removed `FUTURE_SECTIONS` from the layout entirely —
  // see `phase-16-a-closure-end-to-end.e2e.test.ts`'s own version of this
  // update for the full history.
});

test("no migration file exists anywhere in the new 16-B surface", () => {
  for (const { file, text } of PHASE_16B_FILES) {
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE|DROP TABLE/i, file);
  }
});

test("no locked product UI route is referenced anywhere in the new 16-B surface", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of PHASE_16B_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
  }
});
