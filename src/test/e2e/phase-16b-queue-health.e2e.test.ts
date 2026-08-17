import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getAdminQueueHealth } from "@/lib/admin/queue-health-service";
import { getAdminBullmqHealth, listAdminBullmqFailedJobs, retryAdminBullmqJob } from "@/lib/admin/bullmq-admin-service";
import { isValidBullmqActionReason, BULLMQ_JOB_ID_PATTERN } from "@/lib/admin/bullmq-admin-contract";
import { getAdminModelProviderView } from "@/lib/admin/model-provider-admin-service";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase } from "./e2e-harness";

/**
 * Phase 16-B — Queue Health (SQS + BullMQ, combined), BullMQ auxiliary
 * health/retry, and Models/Providers read.
 *
 * BullMQ (Redis B) is unprovisioned in every environment, including this
 * test process — no `BULLMQ_REDIS_URL` is set. Every BullMQ-touching test
 * here therefore exercises the REAL, unmocked code path at zero cost, and
 * asserts the honest `NOT_CONFIGURED` outcome — never a fabricated queue
 * count.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ===========================================================================
// BULLMQ — honest NOT_CONFIGURED in this environment
// ===========================================================================

test("getAdminBullmqHealth reports NOT_CONFIGURED honestly when Redis B is unprovisioned, never a fabricated queue count", async () => {
  const result = await getAdminBullmqHealth();
  assert.deepEqual(result, { outcome: "NOT_CONFIGURED" });
});

test("listAdminBullmqFailedJobs reports NOT_CONFIGURED honestly, never an empty-but-implied-checked list", async () => {
  const result = await listAdminBullmqFailedJobs();
  assert.deepEqual(result, { outcome: "NOT_CONFIGURED" });
});

test("retryAdminBullmqJob validates target shape before ever touching BullMQ, and reports NOT_CONFIGURED for a well-formed one", async () => {
  const invalid = await retryAdminBullmqJob("user_admin", "not-a-real-queue", "job-1", "reason");
  assert.deepEqual(invalid, { outcome: "INVALID_TARGET" });

  const noReason = await retryAdminBullmqJob("user_admin", "media-short", "job-1", "");
  assert.deepEqual(noReason, { outcome: "INVALID_TARGET" });

  const wellFormed = await retryAdminBullmqJob("user_admin", "media-short", "job-1", "investigating");
  assert.deepEqual(wellFormed, { outcome: "NOT_CONFIGURED" });
});

test("isValidBullmqActionReason and BULLMQ_JOB_ID_PATTERN reject malformed input", () => {
  assert.equal(isValidBullmqActionReason(""), false);
  assert.equal(isValidBullmqActionReason("a".repeat(501)), false);
  assert.equal(isValidBullmqActionReason("retrying after fix"), true);
  assert.doesNotMatch("../../etc/passwd", BULLMQ_JOB_ID_PATTERN);
  assert.match("job-12345", BULLMQ_JOB_ID_PATTERN);
});

// ===========================================================================
// QUEUE HEALTH — combines readiness() (SQS) + DLQ presence + BullMQ, no duplication
// ===========================================================================

test("getAdminQueueHealth reuses readiness() for SQS status and never re-evaluates health itself", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result = await getAdminQueueHealth(db as never);
  assert.ok(["HEALTHY", "DEGRADED", "UNREADY", "UNKNOWN"].includes(result.sqs.status));
  assert.equal(result.bullmq.configured, false, "Redis B is unprovisioned in this test process");
  assert.deepEqual(result.bullmq.queues, []);
});

test("getAdminQueueHealth's own code never re-implements dependency health evaluation", () => {
  const serviceText = stripComments(read("src/lib/admin/queue-health-service.ts"));
  assert.match(serviceText, /readiness\(/);
  assert.doesNotMatch(serviceText, /function\s+probeSqs|function\s+probeRedisB/, "must reuse Phase 13's probes, never redeclare them");
});

// ===========================================================================
// MODELS / PROVIDERS
// ===========================================================================

test("getAdminModelProviderView reads models/providers/provider_models only, bounded and explicit-column", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  db.state.models = [{ id: "m1", label: "Model One", generation_type: "image", lifecycle: "active" }];
  db.state.providers = [{ id: "fal", label: "fal.ai", enabled: true }];
  db.state.provider_models = [{ provider_id: "fal", provider_model_id: "flux/schnell", enabled: true }];

  const result = await getAdminModelProviderView(db as never);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.deepEqual(result.models, [{ modelId: "m1", label: "Model One", generationType: "image", lifecycle: "active" }]);
  assert.deepEqual(result.providers, [{ providerId: "fal", label: "fal.ai", enabled: true }]);
  assert.deepEqual(result.providerModels, [{ providerId: "fal", providerModelId: "flux/schnell", enabled: true }]);
});

test("getAdminModelProviderView is unavailable, not silently empty, on a real read failure", async () => {
  const admin = {
    from: () => {
      throw new Error("boom");
    },
  };
  const result = await getAdminModelProviderView(admin as never);
  assert.equal(result.outcome, "SOURCE_UNAVAILABLE");
});

// ===========================================================================
// STRUCTURAL
// ===========================================================================

const NEW_FILES = [
  "src/lib/admin/queue-health-contract.ts",
  "src/lib/admin/queue-health-service.ts",
  "src/lib/admin/queue-health-client-state.ts",
  "src/lib/admin/bullmq-admin-contract.ts",
  "src/lib/admin/bullmq-admin-service.ts",
  "src/lib/admin/model-provider-admin-contract.ts",
  "src/lib/admin/model-provider-admin-service.ts",
  "src/lib/admin/model-provider-admin-client-state.ts",
  "src/app/api/admin/queue-health/route.ts",
  "src/app/api/admin/queue-health/bullmq-failed/route.ts",
  "src/app/api/admin/queue-health/bullmq-retry/route.ts",
  "src/app/api/admin/models-providers/route.ts",
  "src/app/admin/queue-health/page.tsx",
  "src/app/admin/models-providers/page.tsx",
  "src/components/admin/QueueHealthPanel.tsx",
  "src/components/admin/ModelsProvidersPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

test("no BullMQ job.data or job.stacktrace is ever read or returned anywhere in the new files", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /job\.data\b/, `${file} must never read job.data`);
    assert.doesNotMatch(text, /job\.stacktrace\b/, `${file} must never read job.stacktrace`);
  }
});

test("no operational mutation outside the BullMQ retry action exists anywhere in the new files", () => {
  const banned = [
    { pattern: /reserveCredits|settleReservation|releaseReservation|credit_ledger|credit_wallets|Stripe/i, why: "no billing mutation" },
    { pattern: /suspendUser|deleteUser|banUser|disableUser/i, why: "no user mutation" },
    { pattern: /setRouteEnabled|setRuntimeRoutingControl/, why: "no routing mutation from the queue-health surface" },
    { pattern: /redriveOneProviderDlqMessage|StartMessageMoveTask/, why: "no DLQ mutation from the queue-health surface" },
    { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "no direct database write (Supabase)" },
  ];
  for (const { file, text } of NEW_FILES) {
    for (const rule of banned) {
      assert.doesNotMatch(text, rule.pattern, `${file}: ${rule.why}`);
    }
  }
});

test("the retry route is POST-only durable_write; the health/failed-jobs/models-providers routes are GET-only authenticated_read", () => {
  const retryText = stripComments(read("src/app/api/admin/queue-health/bullmq-retry/route.ts"));
  assert.match(retryText, /export async function POST/);
  assert.doesNotMatch(retryText, /export async function GET/);
  assert.match(retryText, /routeClass:\s*"durable_write"/);

  for (const rel of [
    "src/app/api/admin/queue-health/route.ts",
    "src/app/api/admin/queue-health/bullmq-failed/route.ts",
    "src/app/api/admin/models-providers/route.ts",
  ]) {
    const text = stripComments(read(rel));
    assert.match(text, /export async function GET/);
    assert.doesNotMatch(text, /export async function POST/);
    assert.match(text, /routeClass:\s*"authenticated_read"/);
  }
});

test("every route responds through privateJson, never NextResponse.json, and requires requireAdminAccess before its service call", () => {
  for (const rel of [
    "src/app/api/admin/queue-health/route.ts",
    "src/app/api/admin/queue-health/bullmq-failed/route.ts",
    "src/app/api/admin/queue-health/bullmq-retry/route.ts",
    "src/app/api/admin/models-providers/route.ts",
  ]) {
    const text = stripComments(read(rel));
    assert.match(text, /privateJson\(/);
    assert.doesNotMatch(text, /NextResponse\.json\(/);
    assert.match(text, /requireAdminAccess/);
    assert.doesNotMatch(text, /ROUTE_ADMIN_CLERK_USER_IDS/);
  }
});

test("no locked product UI route is referenced, and no migration was added, anywhere in the new files", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of NEW_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE|DROP TABLE/i, file);
  }
});

test("the BullMQ retry UI requires a typed reason and explicit confirmation before submitting", () => {
  const panelText = stripComments(read("src/components/admin/QueueHealthPanel.tsx"));
  assert.match(panelText, /reason\.trim\(\)\.length === 0/);
  assert.match(panelText, /Confirm/i);
});
