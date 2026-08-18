import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { executeAdminDlqRedrive } from "@/lib/admin/dlq-admin-service";
import { setAdminRouteEnabled } from "@/lib/admin/router-admin-service";
import { performAdminTemporalCancel } from "@/lib/admin/temporal-admin-service";
import type { AssuranceEvidence, ElevationVerdict } from "@/lib/admin/step-up-auth";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 16-E — proves the four wired call sites (DLQ redrive, route
 * disable, Temporal cancel) refuse without Tier-0 role/step-up, in EVERY
 * enforcement-mode configuration, through the exact production code path
 * (not just `tier0-authorization.ts` in isolation).
 *
 * ---------------------------------------------------------------------------
 * SECURITY FIX BATCH — WHY THIS FILE CHANGED SHAPE
 * ---------------------------------------------------------------------------
 * The pre-fix version of this file asserted that SHADOW mode (the default,
 * `CINEFIELD_TIER0_ENFORCEMENT_MODE` unset) let these three calls through
 * to their real canonical owners with NO step-up evidence at all — "byte-
 * identical to the pre-16-E call." That was the exact fail-open defect the
 * 16-E closure audit proved: a normal admin session, with no Tier-0 role
 * and no step-up, could execute a `HIGH_RISK_TIER0` action simply because
 * enforcement defaulted to shadow. `authorizeTier0Action` no longer has an
 * enforcement-mode lever on `allowed` (see `tier0-authorization.ts`'s
 * header) — every deny is a deny, in every mode. These tests now prove
 * that through the full production chain: SHADOW MODE and ENFORCE MODE
 * produce the IDENTICAL refusal for an unauthorized actor.
 */

function withEnforcement<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
  process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = "enforce";
  return fn().finally(() => {
    if (original === undefined) delete process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE;
    else process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE = original;
  });
}

const VERIFIED: AssuranceEvidence = { state: "VERIFIED", verifiedAt: new Date().toISOString() };
const ELEVATED: ElevationVerdict = { elevated: true, reasonCode: "verified" };

// ===========================================================================
// DLQ redrive
// ===========================================================================

test("executeAdminDlqRedrive: SHADOW mode (no stepUp arg, the default) refuses an unauthorized actor exactly like enforce mode — the pre-fix version of this test asserted the OPPOSITE, which was the fail-open defect", async () => {
  const db = new FakeSupabaseClient();
  const result = await executeAdminDlqRedrive(db as never, "user_admin_test", "investigating incident #42");
  assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED", "shadow mode must refuse an actor with no Tier-0 role/step-up, same as enforce mode");
  if (result.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
  assert.equal(result.reasonCode, "role_not_permitted");
});

test("executeAdminDlqRedrive: enforce mode, no admin role on any allowlist -> TIER0_AUTHORIZATION_REQUIRED, real redrive never attempted", async () => {
  await withEnforcement(async () => {
    const db = new FakeSupabaseClient();
    const result = await executeAdminDlqRedrive(db as never, "user_totally_unlisted", "incident");
    assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    if (result.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
    assert.equal(result.reasonCode, "role_not_permitted");
  });
});

test("executeAdminDlqRedrive: enforce mode, tier0 role but no step-up evidence -> TIER0_AUTHORIZATION_REQUIRED / step_up_not_configured", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0";
  try {
    await withEnforcement(async () => {
      const db = new FakeSupabaseClient();
      const result = await executeAdminDlqRedrive(db as never, "user_t0", "incident");
      assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
      if (result.outcome !== "TIER0_AUTHORIZATION_REQUIRED") return;
      assert.equal(result.reasonCode, "step_up_not_configured");
    });
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("executeAdminDlqRedrive: enforce mode with full step-up evidence proceeds to the real redrive path", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0";
  try {
    await withEnforcement(async () => {
      const db = new FakeSupabaseClient();
      const result = await executeAdminDlqRedrive(db as never, "user_t0", "incident", {
        assurance: VERIFIED,
        elevation: ELEVATED,
      });
      // Still NOT_CONFIGURED — no AWS in this test process — but critically
      // NOT TIER0_AUTHORIZATION_REQUIRED: the Tier-0 gate let it through and
      // the real (unmodified) Phase 15-D/16-B path was reached.
      assert.equal(result.outcome, "NOT_CONFIGURED");
    });
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

// ===========================================================================
// Route disable/enable
// ===========================================================================

test("setAdminRouteEnabled: SHADOW mode (no stepUp arg, the default) refuses an actor who is only on the legacy ROUTE_ADMIN_CLERK_USER_IDS allowlist and has no Tier-0 role — that older authority is a DIFFERENT boundary and is not a step-up substitute", async () => {
  const db = new FakeSupabaseClient();
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = "user_route_admin_test";
  try {
    db.state.model_routes = [{ id: "11111111-1111-4111-8111-111111111111", enabled: true }];
    const result = await setAdminRouteEnabled(
      db as never,
      "user_route_admin_test",
      "11111111-1111-4111-8111-111111111111",
      false,
      "incident #1"
    );
    assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED", "ROUTE_ADMIN_CLERK_USER_IDS membership alone is not a Tier-0 role and must not bypass step-up");
    // The route row is untouched — proof the canonical owner was never reached.
    assert.equal((db.state.model_routes[0] as { enabled: boolean }).enabled, true);
  } finally {
    delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  }
});

test("setAdminRouteEnabled: a tier0_admin WITH full step-up evidence, and ALSO on ROUTE_ADMIN_CLERK_USER_IDS, may proceed — both boundaries satisfied, neither replaced", async () => {
  const db = new FakeSupabaseClient();
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = "user_full_authority";
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_full_authority";
  try {
    db.state.model_routes = [{ id: "33333333-3333-4333-8333-333333333333", enabled: true }];
    const result = await setAdminRouteEnabled(
      db as never,
      "user_full_authority",
      "33333333-3333-4333-8333-333333333333",
      false,
      "incident #2",
      { assurance: VERIFIED, elevation: ELEVATED }
    );
    assert.deepEqual(result, { outcome: "APPLIED", routeId: "33333333-3333-4333-8333-333333333333", enabled: false });
  } finally {
    delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});

test("setAdminRouteEnabled: enforce mode without step-up refuses before ever touching setRouteEnabled/ROUTE_ADMIN_CLERK_USER_IDS", async () => {
  await withEnforcement(async () => {
    const db = new FakeSupabaseClient();
    db.state.model_routes = [{ id: "22222222-2222-4222-8222-222222222222", enabled: true }];
    const result = await setAdminRouteEnabled(
      db as never,
      "user_totally_unlisted",
      "22222222-2222-4222-8222-222222222222",
      false,
      "incident"
    );
    assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    // The route row is untouched — proof the canonical owner was never reached.
    assert.equal((db.state.model_routes[0] as { enabled: boolean }).enabled, true);
  });
});

// ===========================================================================
// Temporal cancel
// ===========================================================================

function seedGeneration(db: FakeSupabaseClient) {
  const id = randomUUID();
  db.state.generations = [{ id, clerk_user_id: "user_owner", status: "queued", metadata: null }];
  return id;
}

test("performAdminTemporalCancel: SHADOW mode (no stepUp arg, the default) refuses an unauthorized actor — the pre-fix version of this test asserted CANCEL_REQUESTED here, which was the fail-open defect", async () => {
  const db = new FakeSupabaseClient();
  const id = seedGeneration(db);
  const result = await performAdminTemporalCancel(db as never, {
    generationId: id,
    adminActorId: "admin_1",
    reasonCode: "operator_investigation",
  });
  assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED", "shadow mode must refuse an actor with no Tier-0 role/step-up, same as enforce mode");
  assert.equal((db.state.generations[0] as { status: string }).status, "queued", "no cancel intent may be recorded before authorization");
});

test("performAdminTemporalCancel: enforce mode without step-up refuses before the cancel-intent write — the generation status is untouched", async () => {
  await withEnforcement(async () => {
    const db = new FakeSupabaseClient();
    const id = seedGeneration(db);
    const result = await performAdminTemporalCancel(db as never, {
      generationId: id,
      adminActorId: "user_totally_unlisted",
      reasonCode: "operator_investigation",
    });
    assert.equal(result.outcome, "TIER0_AUTHORIZATION_REQUIRED");
    assert.equal((db.state.generations[0] as { status: string }).status, "queued");
  });
});

test("performAdminTemporalCancel: enforce mode with full step-up evidence proceeds to the real cancel-intent write", async () => {
  process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS = "user_t0";
  try {
    await withEnforcement(async () => {
      const db = new FakeSupabaseClient();
      const id = seedGeneration(db);
      const result = await performAdminTemporalCancel(db as never, {
        generationId: id,
        adminActorId: "user_t0",
        reasonCode: "operator_investigation",
        stepUp: { assurance: VERIFIED, elevation: ELEVATED },
      });
      assert.equal(result.outcome, "CANCEL_REQUESTED");
      // recordCancelIntent (Phase 6R-H, unchanged) records INTENT metadata on
      // the row — the actual status transition happens later, asynchronously,
      // when the workflow itself observes the intent. This is the same
      // "recorded, not yet applied" distinction phase-16d-temporal.e2e.test.ts
      // itself relies on. What matters for this test is that the Tier-0 gate
      // let a fully-authorized attempt reach the real, unmodified owner at all.
      const row = db.state.generations[0] as { status: string; metadata: Record<string, unknown> | null };
      assert.equal(row.status, "queued", "recordCancelIntent does not itself flip status — matches Phase 6R-H's own contract");
      assert.ok(row.metadata, "the cancel intent was durably recorded on the row");
    });
  } finally {
    delete process.env.CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS;
  }
});
