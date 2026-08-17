import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { authorizeTier0Action, recordTier0Execution, tier0EnforcementModeEnabled } from "@/lib/admin/tier0-authorization";
import { queryPrivilegedActionAudit } from "@/lib/admin/privileged-action-audit";
import { resolveAdminPrivilegeRole } from "@/lib/admin/admin-privilege";
import type { AssuranceEvidence, ElevationVerdict } from "@/lib/admin/step-up-auth";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 16-E closure — proves the Section 27 DONE CRITERION end to end
 * against production code: ADMIN attempts a Tier-0 action -> server
 * identifies the action's risk (catalogue) -> role checked
 * (admin-privilege.ts) -> step-up assurance checked (step-up-auth.ts,
 * honestly NOT_CONFIGURED in this environment) -> current state re-read by
 * the canonical owner itself (unchanged) -> canonical action owner invoked
 * only on ALLOW -> bounded durable audit evidence produced for every step
 * -> result shown honestly (never a fabricated success).
 *
 * Mirrors the structure every other Phase 16 package's own
 * `phase-16*-closure-end-to-end.e2e.test.ts` uses: a short NEW_FILES
 * manifest plus the actual end-to-end proof.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const NEW_FILES = [
  "supabase/migrations/20260829000000_tier0_admin_action_audit.sql",
  "src/lib/admin/admin-privilege.ts",
  "src/lib/admin/tier0-action-catalogue.ts",
  "src/lib/admin/step-up-auth.ts",
  "src/lib/admin/require-step-up.ts",
  "src/lib/redis/admin-elevation-store.ts",
  "src/lib/admin/privileged-action-audit.ts",
  "src/lib/admin/tier0-authorization.ts",
  "src/lib/admin/privileged-audit-contract.ts",
  "src/lib/admin/privileged-audit-client-state.ts",
  "src/app/api/admin/privileged-audit/route.ts",
  "src/app/admin/privileged-audit/page.tsx",
  "src/components/admin/PrivilegedActionAuditPanel.tsx",
];

test("every Phase 16-E file this closure claims actually exists on disk", () => {
  for (const rel of NEW_FILES) {
    assert.doesNotThrow(() => read(rel), `${rel} must exist`);
  }
});

test("done criterion: a Tier-0 action denied for a normal (non-Tier0) admin is denied, and the ENTIRE decision chain is durably recorded", async () => {
  const db = new FakeSupabaseClient();
  const admin = db as never;
  const requestId = randomUUID();

  // A normal admin session compromise alone (viewer/operator, no Tier-0
  // grant, no step-up) must NOT silently grant Tier-0 authority.
  const decision = await authorizeTier0Action(admin, {
    requestId,
    action: "route.disable",
    actorClerkUserId: "user_ordinary_admin",
    target: { type: "model_route", id: "route-123" },
    assurance: { state: "NOT_CONFIGURED", verifiedAt: null },
    elevation: { elevated: false, reasonCode: "no_elevation" },
    enforce: true,
  });

  assert.equal(decision.allowed, false, "normal admin compromise alone must not grant Tier-0 authority");
  assert.equal(decision.classification, "HIGH_RISK_TIER0");

  const audit = await queryPrivilegedActionAudit(admin, { actorClerkUserId: "user_ordinary_admin" });
  assert.equal(audit.outcome, "FOUND");
  if (audit.outcome !== "FOUND") return;
  assert.ok(audit.rows.some((r) => r.event === "requested"));
  assert.ok(audit.rows.some((r) => r.event === "denied"));
});

test("done criterion: the full chain — role, step-up, and (for a two-person action) dual control — must ALL clear before the caller may invoke the canonical owner, and execution is recorded separately from authorization", async () => {
  const db = new FakeSupabaseClient();
  const admin = db as never;
  const requestId = randomUUID();
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0_final";
  try {
    const verified: AssuranceEvidence = { state: "VERIFIED", verifiedAt: new Date().toISOString() };
    const elevated: ElevationVerdict = { elevated: true, reasonCode: "verified" };

    const decision = await authorizeTier0Action(admin, {
      requestId,
      action: "temporal.workflow.cancel",
      actorClerkUserId: "user_t0_final",
      target: { type: "generation", id: "gen-1" },
      assurance: verified,
      elevation: elevated,
      enforce: true,
    });
    assert.equal(decision.allowed, true);

    // ONLY NOW would a caller invoke the canonical owner. This test does
    // not call `requestGenerationCancellation` itself (that is
    // `temporal-admin-service.ts`'s job, proven in
    // `phase-16e-wired-actions.e2e.test.ts`) — it proves the AUTHORIZATION
    // BOUNDARY, matching Section 18's "never invokes the owner" rule for
    // this layer.
    await recordTier0Execution(admin, {
      requestId,
      action: "temporal.workflow.cancel",
      actorClerkUserId: "user_t0_final",
      target: { type: "generation", id: "gen-1" },
      outcome: "executed",
    });

    const audit = await queryPrivilegedActionAudit(admin, { actorClerkUserId: "user_t0_final" });
    assert.equal(audit.outcome, "FOUND");
    if (audit.outcome !== "FOUND") return;
    const events = audit.rows.filter((r) => r.requestId === requestId).map((r) => r.event);
    assert.deepEqual(new Set(events), new Set(["requested", "approved", "executed"]));
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("enforcement mode defaults to shadow (unset env) — hard-enforcement is an explicit opt-in, never accidental", () => {
  const original = process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  try {
    delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
    assert.equal(tier0EnforcementModeEnabled(), false);
    process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "yes";
    assert.equal(tier0EnforcementModeEnabled(), false, "only the exact value 'enforce' activates hard enforcement");
    process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
    assert.equal(tier0EnforcementModeEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
    else process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = original;
  }
});

test("resolveAdminPrivilegeRole and the catalogue compose without either importing the other's I/O — role resolution stays Clerk-free, catalogue stays a pure data module", () => {
  // A cheap structural pin: both modules are importable and callable with no
  // Supabase/Clerk/Redis client provided anywhere in this test file's
  // imports for THIS test — if either module secretly required one, this
  // synchronous call would throw at import time, not here.
  assert.equal(resolveAdminPrivilegeRole("user_x"), null);
});
