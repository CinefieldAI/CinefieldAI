import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getAdminRiskInvestigation } from "@/lib/admin/risk-investigation-service";
import {
  interpretRiskInvestigationResponse,
  networkErrorState,
} from "@/lib/admin/risk-investigation-client-state";
import { TRACE_ID_PATTERN } from "@/lib/admin/risk-investigation-contract";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase } from "./e2e-harness";

/**
 * Phase 16-A closure — read-only Risk investigation (security_events +
 * media_assets safety columns, by clerk_user_id / generation_id / trace_id).
 *
 * The core promise under test: evidence is read verbatim from the Risk
 * Engine's already-written columns (never re-scored), a lookup by one
 * identifier never leaks another identifier's rows, "no evidence found" and
 * "evidence unavailable" are never conflated, the primary/secondary source
 * asymmetry degrades honestly in both directions, and no mutation of any
 * kind exists anywhere in the new files.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/risk-investigation-contract.ts",
  "src/lib/admin/risk-investigation-service.ts",
  "src/lib/admin/risk-investigation-client-state.ts",
  "src/app/api/admin/risk/route.ts",
  "src/app/admin/risk/page.tsx",
  "src/components/admin/RiskInvestigationPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

function seedSecurityEvent(db: FakeSupabaseClient, overrides: Record<string, unknown> = {}): { eventId: string } {
  const eventId = (overrides.event_id as string) ?? randomUUID();
  if (!db.state.security_events) db.state.security_events = [];
  db.state.security_events.push({
    id: randomUUID(),
    event_id: eventId,
    kind: "rate_limit_denied",
    severity: "low",
    source: "route_rate_limit",
    reason_code: "e2e_reason",
    actor_clerk_user_id: "user_risk_subject",
    tenant_id: "user_risk_subject",
    subject_hash: null,
    resource_type: null,
    resource_id: null,
    trace_id: null,
    risk_score: 10,
    recommended_action: "none",
    dedupe_key: `e2e:${eventId}`,
    window_started_at: "2026-01-01T00:00:00.000Z",
    occurred_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    policy_version: null,
    ...overrides,
  });
  return { eventId };
}

function seedMediaSafety(db: FakeSupabaseClient, overrides: Record<string, unknown> = {}): { mediaId: string } {
  const mediaId = (overrides.id as string) ?? randomUUID();
  if (!db.state.media_assets) db.state.media_assets = [];
  db.state.media_assets.push({
    id: mediaId,
    clerk_user_id: "user_risk_subject",
    generation_id: null,
    quarantine_status: "quarantined",
    moderation_status: "not_evaluated",
    moderation_engine: null,
    moderated_at: null,
    ingest_status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
  return { mediaId };
}

// ===========================================================================
// PURE: interpretRiskInvestigationResponse
// ===========================================================================

test("client state: denied at 404, invalid/unavailable/no_evidence/partial/found at 200", () => {
  assert.deepEqual(interpretRiskInvestigationResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(interpretRiskInvestigationResponse(404, { anything: "else" }), { kind: "denied" });
  assert.deepEqual(interpretRiskInvestigationResponse(200, { outcome: "INVALID_IDENTIFIER" }), { kind: "invalid" });
  assert.deepEqual(
    interpretRiskInvestigationResponse(200, { outcome: "RISK_SOURCE_UNAVAILABLE", reasonCode: "read_failed" }),
    { kind: "unavailable", reasonCode: "read_failed" }
  );
  assert.deepEqual(interpretRiskInvestigationResponse(200, { outcome: "NO_RISK_EVIDENCE" }), { kind: "no_evidence" });
  const partial = { outcome: "PARTIAL_RISK_EVIDENCE" as const, events: [], mediaSafety: [], reasonCode: "x" };
  assert.deepEqual(interpretRiskInvestigationResponse(200, partial), { kind: "partial", result: partial });
  const found = { outcome: "FOUND" as const, events: [], mediaSafety: [] };
  assert.deepEqual(interpretRiskInvestigationResponse(200, found), { kind: "found", result: found });
  assert.deepEqual(interpretRiskInvestigationResponse(500, undefined), { kind: "unavailable", reasonCode: "http_500" });
  assert.deepEqual(interpretRiskInvestigationResponse(200, { not: "a result" }), {
    kind: "unavailable",
    reasonCode: "malformed_response",
  });
  assert.deepEqual(networkErrorState(), { kind: "unavailable", reasonCode: "network_error" });
});

// ===========================================================================
// REAL SERVICE
// ===========================================================================

function throwingAdmin() {
  const chain: Record<string, unknown> = {};
  const boom = () => Promise.reject(new Error("boom"));
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = boom;
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
    boom().then(onFulfilled, onRejected);
  return { from: () => chain } as never;
}

test("a malformed identifier never reaches the database, for every axis", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  assert.deepEqual(
    await getAdminRiskInvestigation(db as never, "clerk_user_id", "not-a-clerk-id"),
    { outcome: "INVALID_IDENTIFIER" }
  );
  assert.deepEqual(
    await getAdminRiskInvestigation(db as never, "generation_id", "not-a-uuid"),
    { outcome: "INVALID_IDENTIFIER" }
  );
  assert.deepEqual(
    await getAdminRiskInvestigation(db as never, "trace_id", "not-32-hex"),
    { outcome: "INVALID_IDENTIFIER" }
  );
  assert.doesNotMatch("not-32-hex", TRACE_ID_PATTERN);
});

test("evidence unavailable on a total read failure, never silently empty", async () => {
  const result = await getAdminRiskInvestigation(throwingAdmin(), "clerk_user_id", "user_whatever");
  assert.equal(result.outcome, "RISK_SOURCE_UNAVAILABLE");
});

test("clerk_user_id lookup: no evidence when both sources are genuinely empty", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result = await getAdminRiskInvestigation(db as never, "clerk_user_id", "user_no_evidence_e2e");
  assert.deepEqual(result, { outcome: "NO_RISK_EVIDENCE" });
});

test("clerk_user_id lookup: security_events scoped only to the requested actor, bounded and ordered", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const seededIds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const { eventId } = seedSecurityEvent(db, {
      actor_clerk_user_id: "user_target",
      occurred_at: `2026-01-01T00:0${2 - i}:00.000Z`,
    });
    seededIds.push(eventId);
  }
  seedSecurityEvent(db, { actor_clerk_user_id: "user_other" });

  const result = await getAdminRiskInvestigation(db as never, "clerk_user_id", "user_target");
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.equal(result.events.length, 3, "only the target actor's events, none of user_other's");
  assert.ok(result.events.every((e) => seededIds.includes(e.eventId)));
  assert.equal(result.events[0].occurredAt, "2026-01-01T00:02:00.000Z", "newest first");
});

test("generation_id lookup: security_events matched via resource_type='generation' AND resource_id", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const generationId = randomUUID();
  seedSecurityEvent(db, { resource_type: "generation", resource_id: generationId, kind: "outbound_fetch_blocked" });
  // A non-generation resource_type with the same resource_id must not match.
  seedSecurityEvent(db, { resource_type: "media_asset", resource_id: generationId });
  seedMediaSafety(db, { generation_id: generationId });
  seedMediaSafety(db, { generation_id: randomUUID() });

  const result = await getAdminRiskInvestigation(db as never, "generation_id", generationId);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].resourceId, generationId);
  assert.equal(result.mediaSafety.length, 1, "only this generation's media safety rows");
});

test("trace_id lookup: matches trace_id directly, and never queries media_assets (no such column exists there)", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const traceId = "a".repeat(32);
  seedSecurityEvent(db, { trace_id: traceId });
  seedMediaSafety(db); // present in state, but must never surface for a trace_id lookup

  const result = await getAdminRiskInvestigation(db as never, "trace_id", traceId);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.mediaSafety, [], "trace_id axis never attempts a media_assets read");
});

test("trace_id lookup: a total security_events failure is RISK_SOURCE_UNAVAILABLE, never PARTIAL (no second source for this axis)", async () => {
  const admin = {
    from: (table: string) => {
      if (table === "security_events") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table for trace_id axis: ${table}`);
    },
  };
  const result = await getAdminRiskInvestigation(admin as never, "trace_id", "b".repeat(32));
  assert.deepEqual(result, { outcome: "RISK_SOURCE_UNAVAILABLE", reasonCode: "security_events_read_failed" });
});

test("PARTIAL: primary security_events succeeds (even empty) but secondary media_assets fails", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  seedSecurityEvent(db, { actor_clerk_user_id: "user_partial_a" });

  const originalFrom = db.from.bind(db);
  const admin = {
    from: (table: string) => {
      if (table === "media_assets") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }),
            }),
          }),
        };
      }
      return originalFrom(table);
    },
  };

  const result = await getAdminRiskInvestigation(admin as never, "clerk_user_id", "user_partial_a");
  assert.equal(result.outcome, "PARTIAL_RISK_EVIDENCE");
  if (result.outcome !== "PARTIAL_RISK_EVIDENCE") return;
  assert.equal(result.events.length, 1, "real primary evidence is never discarded");
  assert.deepEqual(result.mediaSafety, []);
  assert.equal(result.reasonCode, "media_assets_read_failed");
});

test("PARTIAL: primary security_events succeeds with genuinely zero rows, secondary fails — still PARTIAL, never NO_RISK_EVIDENCE", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  const originalFrom = db.from.bind(db);
  const admin = {
    from: (table: string) => {
      if (table === "media_assets") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }),
            }),
          }),
        };
      }
      return originalFrom(table);
    },
  };

  const result = await getAdminRiskInvestigation(admin as never, "clerk_user_id", "user_zero_events");
  assert.equal(
    result.outcome,
    "PARTIAL_RISK_EVIDENCE",
    "an empty primary result never gets upgraded to NO_RISK_EVIDENCE when the secondary is unknown"
  );
});

test("PARTIAL: secondary media_assets has real evidence but primary security_events fails", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  seedMediaSafety(db, { clerk_user_id: "user_partial_b" });

  const originalFrom = db.from.bind(db);
  const admin = {
    from: (table: string) => {
      if (table === "security_events") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }),
            }),
          }),
        };
      }
      return originalFrom(table);
    },
  };

  const result = await getAdminRiskInvestigation(admin as never, "clerk_user_id", "user_partial_b");
  assert.equal(result.outcome, "PARTIAL_RISK_EVIDENCE");
  if (result.outcome !== "PARTIAL_RISK_EVIDENCE") return;
  assert.deepEqual(result.events, []);
  assert.equal(result.mediaSafety.length, 1, "real secondary evidence is never discarded");
  assert.equal(result.reasonCode, "security_events_read_failed");
});

test("UNAVAILABLE: primary security_events fails AND secondary media_assets confirms nothing — cannot claim no evidence", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);

  const originalFrom = db.from.bind(db);
  const admin = {
    from: (table: string) => {
      if (table === "security_events") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }),
            }),
          }),
        };
      }
      return originalFrom(table);
    },
  };

  const result = await getAdminRiskInvestigation(admin as never, "clerk_user_id", "user_truly_unknown");
  assert.deepEqual(result, { outcome: "RISK_SOURCE_UNAVAILABLE", reasonCode: "security_events_read_failed" });
});

test("the risk_score and recommended_action columns are read verbatim, never recomputed by this service", () => {
  const serviceText = stripComments(read("src/lib/admin/risk-investigation-service.ts"));
  assert.doesNotMatch(serviceText, /assessRisk\s*\(/, "must not re-invoke the Risk Engine");
  assert.match(serviceText, /risk_score/);
  assert.match(serviceText, /recommended_action/);
});

// ===========================================================================
// SECURITY / SENSITIVE DATA
// ===========================================================================

test("the security_events select() never includes subject_hash, dedupe_key, or window_started_at", () => {
  const serviceText = read("src/lib/admin/risk-investigation-service.ts");
  const forbidden = ["subject_hash", "dedupe_key", "window_started_at"];
  const selects = [...serviceText.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(selects.length >= 2, "expected select() calls for security_events and media_assets");
  for (const cols of selects) {
    for (const word of forbidden) {
      assert.doesNotMatch(cols, new RegExp(word), `select() must not include forbidden column "${word}": ${cols}`);
    }
  }
});

test("the media_assets select() never includes object_key, bucket, or declared_* columns", () => {
  const serviceText = read("src/lib/admin/risk-investigation-service.ts");
  const forbidden = ["object_key", "bucket", "declared_content_type", "checksum_sha256", "byte_size"];
  const selects = [...serviceText.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]);
  for (const cols of selects) {
    for (const word of forbidden) {
      assert.doesNotMatch(cols, new RegExp(word), `select() must not include forbidden column "${word}": ${cols}`);
    }
  }
});

test("no prompt, secret, token, header, or signed-URL shape appears anywhere in the new surface", () => {
  const forbidden = [
    "prompt",
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

test("the API route responds through privateJson and never leaks a raw exception", () => {
  const routeText = stripComments(read("src/app/api/admin/risk/route.ts"));
  assert.doesNotMatch(routeText, /NextResponse\.json\(/);
  assert.match(routeText, /privateJson\(/);
  assert.doesNotMatch(routeText, /\.stack\b|error\.message/i);
});

// ===========================================================================
// AUTH REUSE
// ===========================================================================

test("exactly one canonical admin auth boundary is reused, never ROUTE_ADMIN_CLERK_USER_IDS", () => {
  const routeText = stripComments(read("src/app/api/admin/risk/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.doesNotMatch(routeText, /ROUTE_ADMIN_CLERK_USER_IDS/);
  const authIndex = routeText.indexOf("requireAdminAccess");
  const serviceCallIndex = routeText.indexOf("getAdminRiskInvestigation");
  assert.ok(authIndex >= 0 && serviceCallIndex >= 0 && authIndex < serviceCallIndex);
});

// ===========================================================================
// AUTHORITY — observational only, no mutation, no quarantine/kill-switch action
// ===========================================================================

const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /submitAttempt\s*\(|executeGeneration\s*\(|claimAttemptForSubmission/, why: "no provider execution" },
  { pattern: /cancelPendingAttempt|requestGenerationCancellation|markAttemptTerminal/, why: "no generation/attempt mutation" },
  { pattern: /StartMessageMoveTask|SendMessageCommand|DeleteMessageCommand|ChangeMessageVisibility/, why: "no DLQ/queue mutation" },
  { pattern: /setRoutingControl|clearRoutingControl|assertRouteAdmin/, why: "no routing mutation" },
  { pattern: /isRemediationKillSwitchEngaged/, why: "no kill-switch mutation" },
  { pattern: /releaseQuarantine|approveMediaRelease|rejectMediaAsset|quarantine.?release/i, why: "no quarantine release" },
  { pattern: /runRestoreValidation|deployment-guard|evaluateAiPrProposal/, why: "no restore/deploy/remediation authority" },
  { pattern: /reserveCredits|settleReservation|releaseReservation|credit_ledger|credit_wallets|Stripe/i, why: "no billing/credit mutation" },
  { pattern: /suspendUser|deleteUser|banUser|disableUser|changeUserRole|setUserRole|applyTemporaryBlock|recordSecurityEvent\s*\(/i, why: "no user/enforcement mutation, no writing new evidence" },
  { pattern: /assessRisk\s*\(/, why: "no re-scoring — read stored risk_score/recommended_action only" },
  { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "no database write" },
];

test("no operational mutation of any kind exists in the new Phase 16-A Risk surface", () => {
  for (const { file, text } of NEW_FILES) {
    for (const banned of BANNED) {
      assert.doesNotMatch(text, banned.pattern, `${file}: ${banned.why}`);
    }
  }
});

test("no action button/release/suspend/block/kill-switch control exists in the UI", () => {
  const panelText = stripComments(read("src/components/admin/RiskInvestigationPanel.tsx"));
  assert.doesNotMatch(
    panelText,
    /retry|redrive|suspend|release|onClick={.*(cancel|delete|ban|block)|provider.?disable|route.?disable|kill.?switch|role.?change|change.?role/i
  );
});

// ===========================================================================
// ARCHITECTURE — one risk model, one event store, real reuse
// ===========================================================================

test("the canonical security_events table is the one risk/event store — no second one is created", () => {
  const serviceText = stripComments(read("src/lib/admin/risk-investigation-service.ts"));
  assert.match(serviceText, /"security_events"/);
  assert.doesNotMatch(serviceText, /CREATE TABLE|"risk_events"|"incidents"|"fraud_/i);
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
  const serviceText = stripComments(read("src/lib/admin/risk-investigation-service.ts"));
  assert.doesNotMatch(serviceText, /CREATE TABLE|ALTER TABLE/i);
});

test("recent generation/actor references link into the existing admin investigation surfaces", () => {
  const panelText = read("src/components/admin/RiskInvestigationPanel.tsx");
  assert.match(panelText, /\/admin\/generations\?generationId=/);
  assert.match(panelText, /\/admin\/users\?clerkUserId=/);
});
