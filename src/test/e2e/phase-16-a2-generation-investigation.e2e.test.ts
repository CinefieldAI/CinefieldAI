import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  buildTraceChain,
  type AttemptView,
  type MediaLinkView,
  type TraceEventView,
} from "@/lib/admin/generation-investigation-contract";
import { getGenerationInvestigation } from "@/lib/admin/generation-investigation-service";
import { interpretInvestigationResponse, networkErrorState } from "@/lib/admin/generation-investigation-client-state";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase, seedGeneration } from "./e2e-harness";

/**
 * Phase 16-A/2 — read-only generation investigation (Generation -> Attempts
 * -> Trace correlation).
 *
 * The core promise under test: every trace-chain link's status is derived
 * from what was actually persisted for THIS generation — never guessed, and
 * a missing link never renders as a complete chain. No mutation of any kind
 * exists anywhere in the new files.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/generation-investigation-contract.ts",
  "src/lib/admin/generation-investigation-service.ts",
  "src/lib/admin/generation-investigation-client-state.ts",
  "src/app/api/admin/generations/[generationId]/route.ts",
  "src/app/admin/generations/page.tsx",
  "src/components/admin/GenerationInvestigationPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

// ===========================================================================
// PURE: buildTraceChain
// ===========================================================================

function attempt(over: Partial<AttemptView> = {}): AttemptView {
  return {
    attemptId: randomUUID(),
    attemptNo: 1,
    status: "succeeded",
    provider: "mock",
    providerModel: "mock-image-v1",
    submissionEvidence: "job",
    providerJobId: null,
    errorCode: null,
    submissionErrorCode: null,
    latencyMs: null,
    startedAt: null,
    submittedAt: null,
    completedAt: null,
    workflowId: null,
    workflowRunId: null,
    ...over,
  };
}

test("29/30/31/32: buildTraceChain never fabricates a link and reuses only real evidence", () => {
  const generationId = randomUUID();
  const chain = buildTraceChain({ generationId, attempts: [], traceEvents: [], mediaLinks: [] });
  const byName = Object.fromEntries(chain.map((l) => [l.name, l]));

  assert.equal(byName.generation_id.status, "AVAILABLE");
  assert.equal(byName.generation_id.value, generationId);
  assert.equal(byName.trace_id.status, "NOT_PERSISTED");
  assert.equal(byName.trace_id.value, null);
  assert.equal(byName.attempt_id.status, "NOT_PERSISTED");
  assert.equal(byName.provider_request_id.status, "NOT_PERSISTED");
  assert.equal(byName.media_id.status, "NOT_PERSISTED");
  assert.equal(byName.artifact_id.status, "NOT_APPLICABLE");
  assert.equal(byName.artifact_id.value, null, "no fabricated second id for a concept this schema does not have");
});

test("13/16/17/18: a fully-evidenced generation shows every real link, a partial one shows the honest gap", () => {
  const generationId = randomUUID();
  const withEvidence = attempt({ providerJobId: "job-123" });
  const trace: TraceEventView = { eventType: "generation.completed", traceId: "trace-abc", occurredAt: "t" };
  const media: MediaLinkView = { mediaId: "media-1", attemptId: withEvidence.attemptId, role: "original", mediaType: "image", createdAt: "t" };

  const complete = buildTraceChain({ generationId, attempts: [withEvidence], traceEvents: [trace], mediaLinks: [media] });
  const completeByName = Object.fromEntries(complete.map((l) => [l.name, l]));
  assert.equal(completeByName.trace_id.value, "trace-abc");
  assert.equal(completeByName.provider_request_id.value, "job-123");
  assert.equal(completeByName.media_id.value, "media-1");

  // Partial: an attempt exists but never got a provider job id, and no trace
  // event was ever recorded — a real, common shape (e.g. a still-pending or
  // permanently-poison attempt).
  const partial = buildTraceChain({ generationId, attempts: [attempt()], traceEvents: [], mediaLinks: [] });
  const partialByName = Object.fromEntries(partial.map((l) => [l.name, l]));
  assert.equal(partialByName.attempt_id.status, "AVAILABLE");
  assert.equal(partialByName.trace_id.status, "NOT_PERSISTED");
  assert.equal(partialByName.provider_request_id.status, "NOT_PERSISTED");
  assert.notDeepEqual(partial, complete, "a partial chain must never render identically to a complete one");
});

test("17: trace events with a null trace_id (claim_generation_tx's own p_trace_id: null) do not count as AVAILABLE", () => {
  const generationId = randomUUID();
  const chain = buildTraceChain({
    generationId,
    attempts: [],
    traceEvents: [{ eventType: "generation.claimed", traceId: null, occurredAt: "t" }],
    mediaLinks: [],
  });
  const traceLink = chain.find((l) => l.name === "trace_id");
  assert.equal(traceLink?.status, "NOT_PERSISTED");
});

// ===========================================================================
// PURE: interpretInvestigationResponse
// ===========================================================================

test("client state: denied vs not_found are distinguished by body shape, both at 404", () => {
  assert.deepEqual(interpretInvestigationResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(interpretInvestigationResponse(404, { outcome: "GENERATION_NOT_FOUND" }), { kind: "not_found" });
  assert.deepEqual(interpretInvestigationResponse(404, { anything: "else" }), { kind: "denied" });
});

test("client state: server error, malformed body, and EVIDENCE_UNAVAILABLE all map to unavailable, never found", () => {
  assert.deepEqual(interpretInvestigationResponse(500, undefined), { kind: "unavailable", reasonCode: "http_500" });
  assert.deepEqual(interpretInvestigationResponse(200, { not: "a result" }), {
    kind: "unavailable",
    reasonCode: "malformed_response",
  });
  assert.deepEqual(interpretInvestigationResponse(200, { outcome: "EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" }), {
    kind: "unavailable",
    reasonCode: "read_failed",
  });
  assert.deepEqual(networkErrorState(), { kind: "unavailable", reasonCode: "network_error" });
});

test("client state: a genuine FOUND result passes through unchanged", () => {
  const result = {
    outcome: "FOUND" as const,
    generation: {} as never,
    attempts: [],
    traceEvents: [],
    mediaLinks: [],
    chain: [],
  };
  assert.deepEqual(interpretInvestigationResponse(200, result), { kind: "found", result });
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

test("5/6: a missing generation returns bounded not-found, never a raw exception", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result = await getGenerationInvestigation(db as never, randomUUID());
  assert.deepEqual(result, { outcome: "GENERATION_NOT_FOUND" });
});

test("a malformed generation id never reaches the database", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result = await getGenerationInvestigation(db as never, "not-a-uuid; DROP TABLE generations;--");
  assert.deepEqual(result, { outcome: "GENERATION_NOT_FOUND" });
});

test("evidence unavailable on a real read failure, never silently empty", async () => {
  const result = await getGenerationInvestigation(throwingAdmin(), randomUUID());
  assert.equal(result.outcome, "EVIDENCE_UNAVAILABLE");
});

test("4/6/7/8/9/10/11: an existing generation with attempts, trace events, and media loads with no raw prompt/payload", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId } = seedGeneration(db, { prompt: "a secret prompt that must never leak", status: "completed" });

  const attemptId1 = randomUUID();
  const attemptId2 = randomUUID();
  db.state.generation_attempts = [
    {
      id: attemptId1,
      generation_id: generationId,
      attempt_no: 1,
      status: "failed",
      provider: "mock",
      provider_model: "mock-image-v1",
      provider_job_id: null,
      submission_evidence: "ambiguous",
      submission_error_code: "PROVIDER_TIMEOUT",
      error_code: "PROVIDER_TIMEOUT",
      latency_ms: 4200,
      started_at: "2026-01-01T00:00:00.000Z",
      submitted_at: "2026-01-01T00:00:01.000Z",
      completed_at: "2026-01-01T00:00:05.000Z",
      workflow_id: "wf-1",
      workflow_run_id: "run-1",
    },
    {
      id: attemptId2,
      generation_id: generationId,
      attempt_no: 2,
      status: "succeeded",
      provider: "mock",
      provider_model: "mock-image-v1",
      provider_job_id: "job-real-999",
      submission_evidence: "job",
      submission_error_code: null,
      error_code: null,
      latency_ms: 1800,
      started_at: "2026-01-01T00:01:00.000Z",
      submitted_at: "2026-01-01T00:01:01.000Z",
      completed_at: "2026-01-01T00:01:03.000Z",
      workflow_id: "wf-2",
      workflow_run_id: "run-2",
    },
  ];
  db.state.outbox_events = [
    { aggregate_type: "generation", aggregate_id: generationId, event_type: "generation.claimed", trace_id: null, occurred_at: "2026-01-01T00:00:00.000Z" },
    { aggregate_type: "generation", aggregate_id: generationId, event_type: "generation.completed", trace_id: "trace-xyz", occurred_at: "2026-01-01T00:01:04.000Z" },
    // A different generation's event must never leak into this one's chain.
    { aggregate_type: "generation", aggregate_id: randomUUID(), event_type: "generation.completed", trace_id: "unrelated", occurred_at: "2026-01-01T00:00:00.000Z" },
  ];
  db.state.media_assets = [
    { id: "media-real-1", generation_id: generationId, generation_attempt_id: attemptId2, role: "original", media_type: "image", created_at: "2026-01-01T00:01:03.500Z" },
  ];

  const result = await getGenerationInvestigation(db as never, generationId);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;

  assert.equal(result.generation.generationId, generationId);
  assert.equal(result.generation.status, "completed");
  assert.equal(result.attempts.length, 2, "9: multiple attempts render");
  // Fake harness's order() is a no-op, so these assertions rely on the
  // seed order already matching attempt_no ascending — documented rather
  // than silently relied upon.
  assert.equal(result.attempts[0].attemptNo, 1);
  assert.equal(result.attempts[1].attemptNo, 2);
  assert.equal(result.attempts[0].submissionEvidence, "ambiguous", "10: ambiguous evidence stays visible, honestly");
  assert.equal(result.attempts[1].status, "succeeded", "11: terminal state preserved");
  assert.equal(result.traceEvents.length, 2, "only this generation's events, the unrelated one is excluded");
  assert.ok(result.traceEvents.every((e) => e.eventType.startsWith("generation.")));
  assert.equal(result.mediaLinks.length, 1);
  assert.equal(result.mediaLinks[0].mediaId, "media-real-1");

  const asJson = JSON.stringify(result);
  assert.doesNotMatch(asJson, /secret prompt/i, "6/7: no raw prompt reaches the projection");
  assert.doesNotMatch(asJson, /object_key|bucket|declared_/i, "no storage location leaks");
});

// ===========================================================================
// SECURITY / SENSITIVE DATA
// ===========================================================================

test("14: the service's own select() strings never name a forbidden column", () => {
  const serviceText = read("src/lib/admin/generation-investigation-service.ts");
  const forbidden = ["prompt", "negative_prompt", "input_url", "output_url", "thumbnail_url", "error_message", "metadata", "cost_amount", "cost_currency", "payload", "object_key", "bucket", "declared_"];
  const selects = [...serviceText.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(selects.length >= 4, "expected at least four .select() calls (generations, attempts, outbox_events, media_assets)");
  for (const cols of selects) {
    for (const word of forbidden) {
      assert.doesNotMatch(cols, new RegExp(word), `select() must not include forbidden column "${word}": ${cols}`);
    }
  }
});

test("19/20/21: the API route responds through privateJson and never leaks a raw exception", () => {
  const routeText = stripComments(read("src/app/api/admin/generations/[generationId]/route.ts"));
  assert.doesNotMatch(routeText, /NextResponse\.json\(/);
  assert.match(routeText, /privateJson\(/);
  assert.doesNotMatch(routeText, /\.stack\b|error\.message/i);
});

test("no sensitive field name or token/header shape appears anywhere in the new surface", () => {
  const forbidden = ["apikey", "signedurl", "authorization:", "\\.stack\\b", "access_token", "refresh_token"];
  for (const { file, text } of NEW_FILES) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word), `${file} mentions forbidden shape "${word}"`);
    }
  }
});

// ===========================================================================
// AUTH REUSE
// ===========================================================================

test("22: exactly one canonical admin auth boundary is reused, never ROUTE_ADMIN_CLERK_USER_IDS", () => {
  const routeText = stripComments(read("src/app/api/admin/generations/[generationId]/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.doesNotMatch(routeText, /ROUTE_ADMIN_CLERK_USER_IDS/);
  const authIndex = routeText.indexOf("requireAdminAccess");
  const serviceCallIndex = routeText.indexOf("getGenerationInvestigation");
  assert.ok(authIndex >= 0 && serviceCallIndex >= 0 && authIndex < serviceCallIndex, "auth must be checked before the service is ever called");
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
  { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "no database write" },
];

test("23-28: no operational mutation of any kind exists in the new Phase 16-A/2 surface", () => {
  for (const { file, text } of NEW_FILES) {
    for (const banned of BANNED) {
      assert.doesNotMatch(text, banned.pattern, `${file}: ${banned.why}`);
    }
  }
});

test("no action button/retry/redrive control exists in the UI", () => {
  const panelText = stripComments(read("src/components/admin/GenerationInvestigationPanel.tsx"));
  // Deliberately excludes the bare word "disable" — the submit button's own
  // standard HTML `disabled` attribute/Tailwind `disabled:` variant is
  // legitimate form UX, not an operational control. What must never appear
  // is an action that disables/kills a PROVIDER or ROUTE.
  assert.doesNotMatch(panelText, /retry|redrive|onClick={.*cancel|provider.?disable|route.?disable|kill.?switch/i);
});

// ===========================================================================
// ARCHITECTURE
// ===========================================================================

test("29/32: no second trace store — outbox_events is queried, never a new table", () => {
  const serviceText = stripComments(read("src/lib/admin/generation-investigation-service.ts"));
  assert.match(serviceText, /"outbox_events"/);
  assert.doesNotMatch(serviceText, /CREATE TABLE|admin_trace|admin_generation_history/i);
});

test("30/31: canonical generations/generation_attempts tables are reused, no second lifecycle model", () => {
  const serviceText = stripComments(read("src/lib/admin/generation-investigation-service.ts"));
  assert.match(serviceText, /"generations"/);
  assert.match(serviceText, /"generation_attempts"/);
  assert.doesNotMatch(serviceText, /function\s+rollUp\s*\(|GenerationStatus\s*=\s*"queued"/);
});

test("no locked product UI route is referenced by the new files", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of NEW_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
  }
});
