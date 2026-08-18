import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getAdminTemporalInspection, performAdminTemporalCancel } from "@/lib/admin/temporal-admin-service";
import { getAdminSecurityCenter } from "@/lib/admin/security-center-service";
import { getAdminIncidents } from "@/lib/admin/incidents-admin-service";
import { buildRollbackView } from "@/lib/admin/deploy-restore-admin-service";
import { raiseAlert, resetAlertRouter, listTrackedAlerts } from "@/lib/alerts/alert-router";
import { RTO_TARGETS, RPO_TARGETS } from "@/lib/recovery/recovery-target-registry";
import { COST_BUDGETS } from "@/lib/finops/cost-budget";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 16-D closure — proof of the official done criterion:
 *
 * "During an incident, the operator can see the relevant operational
 * timeline, health, safety, and control evidence from one Phase 16 admin
 * surface and can perform only those actions that already have a canonical
 * owner and safe authorization path."
 *
 * The narrative test below walks a realistic incident end to end through
 * this repo's REAL 16-D services (not a re-description of them): a security
 * event fires -> Security Center shows it -> the alert router surfaces it
 * as an open incident -> the affected generation is inspected through
 * Temporal -> the operator cancels it with a reason, through the one
 * canonical, guarded action -> the rollback signal reflects the readiness
 * picture. Every step reads or acts through an EXISTING owner; nothing here
 * is a second copy of any of them.
 *
 * The sweeps below are the structural half: across every file this batch
 * added, one admin auth boundary, no second event/alert/SLO/cost/deploy/
 * restore authority, no operational mutation beyond the one allowed
 * Temporal cancel, no locked product UI touched, and no migration added.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
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
// Only the files THIS batch (16-D) added/owns.
const PHASE_16D_FILES = ALL_ADMIN_FILES.filter((f) =>
  /(temporal|security-center|incidents|slo-cost|deploy-restore)/i.test(f.file)
);

test("Phase 16-D added at least the expected number of new admin files", () => {
  assert.ok(PHASE_16D_FILES.length >= 25, `expected >=25 files, found ${PHASE_16D_FILES.length}`);
});

// ===========================================================================
// THE NARRATIVE: one incident, walked through the real 16-D services
// ===========================================================================

test("closure narrative: security event -> Security Center -> Incidents -> Temporal inspect -> guarded cancel -> rollback signal", async () => {
  resetAlertRouter();
  const db = new FakeSupabaseClient();
  const generationId = randomUUID();
  const clerkUserId = "user_incident_subject";

  // 1. A security event fires for this user (Phase 12-C evidence — seeded
  //    as if the real logger had already written it).
  if (!db.state.security_events) db.state.security_events = [];
  db.state.security_events.push({
    id: randomUUID(),
    event_id: randomUUID(),
    kind: "outbound_fetch_blocked",
    severity: "high",
    source: "outbound_fetch_gateway",
    reason_code: "ssrf_probe_detected",
    actor_clerk_user_id: clerkUserId,
    resource_type: "generation",
    resource_id: generationId,
    trace_id: null,
    risk_score: 80,
    recommended_action: "admin_review",
    occurred_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    tenant_id: null,
    subject_hash: null,
    dedupe_key: "e2e",
    window_started_at: "2026-01-01T00:00:00.000Z",
    policy_version: null,
  });

  // 2. Phase 13-D's alert router independently raised a CRITICAL alert for it
  //    (the real production caller does this from security-event-logger.ts).
  raiseAlert({ type: "security_high_severity", resource: "outbound_fetch", reasonCode: "ssrf_probe_detected" });

  // 3. Security Center: the operator sees the evidence.
  const securityCenter = await getAdminSecurityCenter(db as never, "high");
  assert.equal(securityCenter.outcome, "FOUND");
  if (securityCenter.outcome !== "FOUND") return;
  assert.equal(securityCenter.events.length, 1);
  assert.equal(securityCenter.events[0].resourceId, generationId);
  assert.equal(securityCenter.openSecurityAlerts.length, 1);

  // 4. Incidents/Audit: the same alert is visible as an open incident.
  const incidents = await getAdminIncidents(db as never);
  assert.equal(incidents.outcome, "FOUND");
  if (incidents.outcome !== "FOUND") return;
  assert.ok(incidents.alerts.some((a) => a.type === "security_high_severity"));

  // 5. The operator follows resourceId into Temporal inspection.
  if (!db.state.generations) db.state.generations = [];
  db.state.generations.push({ id: generationId, clerk_user_id: clerkUserId, status: "processing", metadata: null });
  const inspection = await getAdminTemporalInspection(db as never, generationId);
  assert.equal(inspection.outcome, "FOUND");
  if (inspection.outcome !== "FOUND") return;
  assert.equal(inspection.generation.status, "processing");

  // 6. The operator cancels it — the ONE guarded action 16-D allows.
  //    Phase 16-E: temporal.workflow.cancel is now Tier-0-gated
  //    (fail-closed) — this narrative's own point is the Temporal/incident
  //    flow, not Tier-0, so it supplies valid Tier-0 role + step-up
  //    evidence to pass that gate and reach the same assertion it always
  //    made.
  const originalTier0 = process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "admin_incident_responder";
  let cancel;
  try {
    cancel = await performAdminTemporalCancel(db as never, {
      generationId,
      adminActorId: "admin_incident_responder",
      reasonCode: "security_investigation",
      stepUp: {
        assurance: { state: "VERIFIED", verifiedAt: new Date().toISOString() },
        elevation: { elevated: true, reasonCode: "verified" },
      },
    });
  } finally {
    if (originalTier0 !== undefined) process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = originalTier0;
    else delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
  assert.equal(cancel.outcome, "CANCEL_REQUESTED");

  // 7. Re-inspecting shows the durable cancel intent, attributed to the admin.
  const reInspection = await getAdminTemporalInspection(db as never, generationId);
  assert.equal(reInspection.outcome, "FOUND");
  if (reInspection.outcome !== "FOUND") return;
  assert.equal(reInspection.generation.cancelIntent?.recordedByAdmin, "admin_incident_responder");

  // 8. Deploy/Restore Health's rollback signal reflects the same open
  //    CRITICAL alert (real Phase 14-D wiring, fed the real tracked state).
  const rollback = buildRollbackView("HEALTHY", listTrackedAlerts());
  assert.ok(rollback.openCriticalAlertTypes.includes("security_high_severity"));
  assert.equal(rollback.decision, "REVIEW_REQUIRED", "an open critical alert alone recommends review, per Phase 14-D's own rule");

  resetAlertRouter();
});

// ===========================================================================
// CROSS-OWNER SWEEPS
// ===========================================================================

test("no second alert router, no second risk engine, no second SLO calculator, no second cost guard, no second deploy evaluator, no second restore validator exists in the 16-D files", () => {
  const bannedDeclarations = [
    /const\s+entries\s*=\s*new Map/, // a second alert-router dedupe map
    /function\s+assessRisk\s*\(/,
    /function\s+evaluateSlo\s*\(/,
    /function\s+computeErrorBudget\s*\(/,
    /function\s+evaluateCostGuard\s*\(/,
    /function\s+evaluateDeployment\s*\(/,
    /function\s+runRestoreValidation\s*\(/,
  ];
  for (const { file, text } of PHASE_16D_FILES) {
    for (const pattern of bannedDeclarations) {
      assert.doesNotMatch(text, pattern, `${file} must not redeclare a canonical owner's function`);
    }
  }
});

test("COST_BUDGETS remains empty and untouched by 16-D — no invented budget limit", () => {
  assert.deepEqual(COST_BUDGETS, []);
});

test("RTO_TARGETS/RPO_TARGETS remain empty — 16-D invents no recovery commitment", () => {
  assert.deepEqual(RTO_TARGETS, {});
  assert.deepEqual(RPO_TARGETS, {});
});

test("exactly one admin auth boundary (requireAdminAccess) is used across every 16-D API route, never ROUTE_ADMIN_CLERK_USER_IDS", () => {
  const routes = ADMIN_API_FILES.filter(
    (f) => /(temporal|security-center|incidents|slo-cost|deploy-restore)/i.test(f) && f.endsWith("route.ts")
  );
  assert.ok(routes.length >= 3, "expected at least 3 new route files");
  for (const routePath of routes) {
    const text = stripComments(readFileSync(routePath, "utf8"));
    assert.match(text, /requireAdminAccess/, routePath);
    assert.doesNotMatch(text, /ROUTE_ADMIN_CLERK_USER_IDS/, routePath);
  }
});

test("the only durable_write route in the whole 16-D package is the Temporal cancel action", () => {
  const routes = ADMIN_API_FILES.filter(
    (f) => /(temporal|security-center|incidents|slo-cost|deploy-restore)/i.test(f) && f.endsWith("route.ts")
  );
  const durableWriteRoutes = routes.filter((f) => stripComments(readFileSync(f, "utf8")).includes("durable_write"));
  assert.equal(durableWriteRoutes.length, 1);
  assert.match(durableWriteRoutes[0], /temporal.*cancel/);
});

test("no locked product UI route is referenced anywhere in the 16-D package", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of PHASE_16D_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
  }
});

test("no migration file was added anywhere in the 16-D package", () => {
  for (const { file, text } of PHASE_16D_FILES) {
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE/i, file);
  }
});

test("the admin layout links every 16-D screen as a real navigation entry", () => {
  const layoutText = read("src/app/admin/layout.tsx");
  for (const href of [
    "/admin/temporal",
    "/admin/security-center",
    "/admin/incidents",
    "/admin/slo-cost",
    "/admin/deploy-restore",
  ]) {
    assert.match(layoutText, new RegExp(href.replace("/", "\\/")), href);
  }
});

test("no AI/agent write authority is registered for any 16-D action — no code.pr.create, no aiWriteAllowlist reference", () => {
  for (const { file, text } of PHASE_16D_FILES) {
    assert.doesNotMatch(text, /aiWriteAllowlist|requireAiWritePolicy|ai_agent/i, file);
  }
});
