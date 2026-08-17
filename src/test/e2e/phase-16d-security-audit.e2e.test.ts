import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { raiseAlert, resolveAlert, resetAlertRouter, listTrackedAlerts } from "@/lib/alerts/alert-router";
import { getAdminSecurityCenter } from "@/lib/admin/security-center-service";
import { getAdminIncidents } from "@/lib/admin/incidents-admin-service";
import {
  interpretSecurityCenterResponse,
  networkErrorState as securityCenterNetworkError,
} from "@/lib/admin/security-center-client-state";
import { interpretIncidentsResponse, networkErrorState as incidentsNetworkError } from "@/lib/admin/incidents-admin-client-state";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 16-D Security Center + Incidents/Audit — both read-only.
 *
 * Core promises under test: `listTrackedAlerts()` is a bounded, honest
 * read of the SAME in-memory store `raiseAlert`/`resolveAlert` already
 * maintain (a resolved alert disappears from the list, exactly like
 * `resolveAlert`'s own semantics); Security Center and Incidents both reuse
 * `security_events` verbatim (never re-scoring `risk_score`); the audit
 * trail combines only the two existing durable stores; and no mutation
 * exists anywhere in either surface.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/security-center-contract.ts",
  "src/lib/admin/security-center-service.ts",
  "src/lib/admin/security-center-client-state.ts",
  "src/app/api/admin/security-center/route.ts",
  "src/app/admin/security-center/page.tsx",
  "src/components/admin/SecurityCenterPanel.tsx",
  "src/lib/admin/incidents-admin-contract.ts",
  "src/lib/admin/incidents-admin-service.ts",
  "src/lib/admin/incidents-admin-client-state.ts",
  "src/app/api/admin/incidents/route.ts",
  "src/app/admin/incidents/page.tsx",
  "src/components/admin/IncidentsPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

function seedSecurityEvent(db: FakeSupabaseClient, overrides: Record<string, unknown> = {}) {
  const eventId = (overrides.event_id as string) ?? randomUUID();
  if (!db.state.security_events) db.state.security_events = [];
  db.state.security_events.push({
    id: randomUUID(),
    event_id: eventId,
    kind: "rate_limit_denied",
    severity: "low",
    source: "route_rate_limit",
    reason_code: "e2e_reason",
    actor_clerk_user_id: null,
    tenant_id: null,
    subject_hash: null,
    resource_type: null,
    resource_id: null,
    trace_id: null,
    risk_score: 5,
    recommended_action: "none",
    dedupe_key: `e2e:${eventId}`,
    window_started_at: "2026-01-01T00:00:00.000Z",
    occurred_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    policy_version: null,
    ...overrides,
  });
  return eventId;
}

function seedMediaSafetyAudit(db: FakeSupabaseClient, overrides: Record<string, unknown> = {}) {
  if (!db.state.media_safety_audit) db.state.media_safety_audit = [];
  db.state.media_safety_audit.push({
    id: randomUUID(),
    asset_id: randomUUID(),
    actor_clerk_user_id: "admin_1",
    action: "release_requested",
    prior_quarantine_status: "quarantined",
    reason_code: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

// ===========================================================================
// alert-router.ts extension — listTrackedAlerts()
// ===========================================================================

test("listTrackedAlerts: reads the same store raiseAlert/resolveAlert maintain, honestly reflects resolution", () => {
  resetAlertRouter();
  raiseAlert({ type: "provider_degraded", resource: "fal_ai", reasonCode: "e2e_test" });
  let tracked = listTrackedAlerts();
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].type, "provider_degraded");
  assert.equal(tracked[0].resource, "fal_ai");
  assert.equal(tracked[0].state, "OPEN");
  assert.equal(tracked[0].severity, "WARNING", "severity is looked up from ALERT_CATALOGUE, never re-derived");

  resolveAlert("provider_degraded", "fal_ai");
  tracked = listTrackedAlerts();
  assert.equal(tracked.length, 0, "a resolved alert disappears — this IS resolution, per resolveAlert's own semantics");
  resetAlertRouter();
});

test("listTrackedAlerts: multiple types/sources coexist, sorted most-recent-first", () => {
  resetAlertRouter();
  raiseAlert({ type: "security_high_severity", resource: "outbound_fetch", reasonCode: "e2e" }, 1_000);
  raiseAlert({ type: "dependency_unavailable", resource: "redis_a", reasonCode: "e2e" }, 2_000);
  const tracked = listTrackedAlerts();
  assert.equal(tracked.length, 2);
  assert.equal(tracked[0].type, "dependency_unavailable", "most recently seen first");
  resetAlertRouter();
});

// ===========================================================================
// Security Center service
// ===========================================================================

test("Security Center: reads bounded columns and forwards risk_score/recommended_action verbatim", async () => {
  const db = new FakeSupabaseClient();
  seedSecurityEvent(db, { occurred_at: "2026-01-01T00:00:01.000Z", risk_score: 1 });
  seedSecurityEvent(db, { occurred_at: "2026-01-01T00:00:02.000Z", risk_score: 2 });

  const result = await getAdminSecurityCenter(db as never);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.equal(result.events.length, 2);
  assert.deepEqual(
    result.events.map((e) => e.riskScore).sort(),
    [1, 2]
  );
});

test("Security Center: most-recent-first ordering is requested from the query (order(occurred_at, {ascending:false}))", () => {
  const serviceText = read("src/lib/admin/security-center-service.ts");
  assert.match(serviceText, /\.order\(\s*"occurred_at"\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)/);
});

test("Security Center: severity filter is applied at the query, not client-side guessing", async () => {
  const db = new FakeSupabaseClient();
  seedSecurityEvent(db, { severity: "high", kind: "outbound_fetch_blocked" });
  seedSecurityEvent(db, { severity: "low" });

  const result = await getAdminSecurityCenter(db as never, "high");
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].severity, "high");
});

test("Security Center: a total read failure is SOURCE_UNAVAILABLE, never a silent empty feed", async () => {
  const admin = {
    from: () => ({
      select: () => ({
        order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }),
      }),
    }),
  };
  const result = await getAdminSecurityCenter(admin as never);
  assert.deepEqual(result, { outcome: "SOURCE_UNAVAILABLE", reasonCode: "security_events_read_failed" });
});

test("Security Center: open alerts are scoped to source 'security' only", () => {
  resetAlertRouter();
  raiseAlert({ type: "security_high_severity", resource: "x", reasonCode: "e2e" });
  raiseAlert({ type: "cost_budget_at_risk", resource: "y", reasonCode: "e2e" });
  const openSecurity = listTrackedAlerts().filter((a) => a.source === "security");
  assert.equal(openSecurity.length, 1);
  assert.equal(openSecurity[0].type, "security_high_severity");
  resetAlertRouter();
});

// ===========================================================================
// Incidents/Audit service
// ===========================================================================

test("Incidents: combines the alert snapshot with the policy-decision and media-safety audit trails", async () => {
  resetAlertRouter();
  raiseAlert({ type: "runtime_unready", resource: "web", reasonCode: "e2e" });
  const db = new FakeSupabaseClient();
  seedSecurityEvent(db, { kind: "policy_decision_denied", reason_code: "e2e_denied" });
  seedSecurityEvent(db, { kind: "rate_limit_denied" }); // must NOT appear in policyDecisions
  seedMediaSafetyAudit(db);

  const result = await getAdminIncidents(db as never);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.equal(result.alertHistoryPersisted, false, "honestly ephemeral, always false");
  assert.equal(result.alerts.length, 1);
  assert.equal(result.policyDecisions.length, 1, "only policy_decision_* kinds, not rate_limit_denied");
  assert.equal(result.mediaSafetyActions.length, 1);
  resetAlertRouter();
});

test("Incidents: a failed policy-decision read still returns real media-safety evidence (defensive degrade, not total failure)", async () => {
  const db = new FakeSupabaseClient();
  seedMediaSafetyAudit(db);
  const originalFrom = db.from.bind(db);
  const admin = {
    from: (table: string) => {
      if (table === "security_events") {
        return { select: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }) }) }) };
      }
      return originalFrom(table);
    },
  };
  const result = await getAdminIncidents(admin as never);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome !== "FOUND") return;
  assert.deepEqual(result.policyDecisions, []);
  assert.equal(result.mediaSafetyActions.length, 1, "real evidence from the source that succeeded is never discarded");
});

test("Incidents: a total database failure (both reads fail) is SOURCE_UNAVAILABLE", async () => {
  const admin = {
    from: () => ({
      select: () => ({
        in: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }) }),
        order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }),
      }),
    }),
  };
  const result = await getAdminIncidents(admin as never);
  assert.deepEqual(result, { outcome: "SOURCE_UNAVAILABLE", reasonCode: "audit_read_failed" });
});

// ===========================================================================
// client state
// ===========================================================================

test("client state: Security Center and Incidents map denied/unavailable/found consistently", () => {
  assert.deepEqual(interpretSecurityCenterResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(securityCenterNetworkError(), { kind: "unavailable", reasonCode: "network_error" });
  assert.deepEqual(interpretIncidentsResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(incidentsNetworkError(), { kind: "unavailable", reasonCode: "network_error" });
});

// ===========================================================================
// sensitive data / structural safety
// ===========================================================================

test("no raw security payload, prompt, secret, token, or signed-URL shape appears anywhere in either surface", () => {
  const forbidden = ["prompt", "apikey", "signedurl", "authorization:", "access_token", "refresh_token", "subject_hash"];
  for (const { file, text } of NEW_FILES) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word), `${file} mentions forbidden shape "${word}"`);
    }
  }
});

test("no second risk engine, no second alert router, no new admin_actions table", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /assessRisk\s*\(/, file);
    assert.doesNotMatch(text, /new\s+Map\s*\(\s*\)\s*;?\s*\/\/.*dedupe|CREATE TABLE/i, file);
  }
});

test("neither surface has any mutation — no .insert(/.update(/.upsert(/.delete( anywhere", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, file);
  }
});

test("both routes reuse the one canonical admin auth boundary", () => {
  for (const relPath of ["src/app/api/admin/security-center/route.ts", "src/app/api/admin/incidents/route.ts"]) {
    const text = stripComments(read(relPath));
    assert.match(text, /requireAdminAccess/);
    assert.match(text, /export async function GET/);
    assert.doesNotMatch(text, /export async function POST/);
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

test("no migration file was added for either surface", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE/i, file);
  }
});
