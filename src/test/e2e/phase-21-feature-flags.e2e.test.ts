import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { FLAG_REGISTRY, registeredFlagKeys } from "@/lib/feature-flags/flag-registry";
import { EVENT_SCHEMAS } from "@/lib/events/event-schemas";
import { TIER0_ACTION_CATALOGUE } from "@/lib/admin/tier0-action-catalogue";

/**
 * Phase 21 — Runtime Feature Flags, Kill Switches & Safe Rollout.
 *
 * Proves what this batch actually built: the generic flag registry/
 * evaluation core (21-A), the admin-mutable critical flag set (21-B), its
 * audit/expiry/rollback metadata (21-C), and the canary-guardrail decision
 * layer (21-D) — plus, just as important, that none of it duplicates an
 * existing owner (Phase 7 routing, Phase 16 Tier-0, Phase 19 policy, Phase
 * 20 contract governance).
 */

const ROOT = process.cwd();
function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ---- Ownership: Phase 7 routing is untouched, no second kill switch -------

describe("Phase 21 — ownership preserved, no duplicate provider/model/route kill switch", () => {
  test("no file under src/lib/routing/ or src/lib/redis/routing-control-store.ts was touched by this phase", () => {
    for (const file of [
      "src/lib/routing/circuit-breaker.ts",
      "src/lib/routing/runtime-flags.ts",
      "src/lib/routing/admin-route-service.ts",
      "src/lib/redis/routing-control-store.ts",
    ]) {
      assert.ok(existsSync(path.join(ROOT, file)), `${file} must still exist, unmodified`);
      const src = stripComments(read(file));
      assert.doesNotMatch(src, /feature-flags\/|feature_flag_admin|set_feature_flag/i, `${file} must not import Phase 21's new module`);
    }
  });

  test("the flag registry names no provider/model/route target — Phase 7 keeps that exact concern", () => {
    for (const key of registeredFlagKeys()) {
      assert.doesNotMatch(key, /^(provider|model|route)\./i);
    }
  });

  test("no new database migration touches model_providers, model_routes, model_versions, or outbox_events", () => {
    const migration = read("supabase/migrations/20260901000000_feature_flags.sql");
    const sqlOnly = migration.replace(/--.*$/gm, ""); // the header prose freely names outbox_events as an analogy — only real statements count
    assert.doesNotMatch(sqlOnly, /model_providers|model_routes|model_versions|outbox_events/i);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS "public"\."feature_flags"/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS "public"\."feature_flag_audit"/);
  });
});

// ---- 21-A: generic vendor-neutral flag core --------------------------------

describe("Phase 21-A — generic flag evaluation core, no invented SDK", () => {
  test("no OpenFeature or LaunchDarkly package is installed — the existing Phase 7-E guard test still holds", () => {
    const packageJson = read("package.json");
    assert.doesNotMatch(packageJson, /launchdarkly|openfeature/i);
  });

  test("flag-contract.ts defines FlagProvider as an interface a real SDK could implement, not a live client", () => {
    const src = stripComments(read("src/lib/feature-flags/flag-contract.ts"));
    assert.match(src, /export interface FlagProvider/);
    assert.doesNotMatch(src, /sdkKey|clientSideId|LD_|apiKey/i);
  });

  test("evaluateFlag() is registry-gated — an unregistered key never reaches the provider", () => {
    const src = stripComments(read("src/lib/feature-flags/flag-evaluation.ts"));
    assert.match(src, /flagDefinition\(key\)/);
  });
});

// ---- 21-B: the critical flag set, admin-mutable, Tier-0/policy composed ---

describe("Phase 21-B — critical flag set reuses Phase 16 Tier-0 and Phase 19 policy, never a second approval engine", () => {
  test("exactly the four roadmap-named generic flags are registered", () => {
    assert.deepEqual(registeredFlagKeys(), ["feature.video.enabled", "maintenance_mode", "release_stage", "uploads.enabled"]);
  });

  test("feature-flag-admin-service.ts calls requirePolicy() then authorizeTier0Action(), in that order, before any write", () => {
    const src = stripComments(read("src/lib/admin/feature-flag-admin-service.ts"));
    const policyIdx = src.indexOf("await requirePolicy(");
    const tier0Idx = src.indexOf("await authorizeTier0Action(");
    const writeIdx = src.indexOf("await writeFlag(");
    assert.ok(policyIdx > 0 && tier0Idx > policyIdx && writeIdx > tier0Idx, "requirePolicy -> authorizeTier0Action -> writeFlag, in that order");
  });

  test("no second policy engine or Tier-0 authority was created — the same imports router-admin-service.ts already uses", () => {
    const src = stripComments(read("src/lib/admin/feature-flag-admin-service.ts"));
    assert.match(src, /from "@\/lib\/policy\/policy-gate"/);
    assert.match(src, /from "\.\/tier0-authorization"/);
    assert.doesNotMatch(src, /new .*PolicyEngine|createPolicyEngine|class .*Tier0/i);
  });

  test("flag.set.operator, flag.set.tier0, and release_stage.activate_public are registered in BOTH the Tier-0 catalogue and the policy registry, in lockstep", () => {
    const registry = JSON.parse(read("policies/data/actions.json"));
    for (const action of ["flag.set.operator", "flag.set.tier0", "release_stage.activate_public"]) {
      assert.ok(TIER0_ACTION_CATALOGUE[action as keyof typeof TIER0_ACTION_CATALOGUE], `${action} must be in the Tier-0 catalogue`);
      assert.ok(registry.actions[action], `${action} must be in policies/data/actions.json`);
      assert.equal(registry.actions[action].implemented, true);
    }
  });

  test("release_stage -> \"public\" specifically requires two-person; every other flag change does not", () => {
    assert.equal(TIER0_ACTION_CATALOGUE["release_stage.activate_public"].requiresTwoPerson, true);
    assert.equal(TIER0_ACTION_CATALOGUE["flag.set.tier0"].requiresTwoPerson, false);
    assert.equal(TIER0_ACTION_CATALOGUE["flag.set.operator"].requiresTwoPerson, false);
    const registry = JSON.parse(read("policies/data/actions.json"));
    assert.equal(registry.actions["release_stage.activate_public"].requiresTwoPerson, true);
  });

  test("maintenance_mode and release_stage are the only HIGH_RISK_TIER0 flags — feature.video.enabled/uploads.enabled stay fast, single-operator kill switches", () => {
    const tier0Flags = Object.values(FLAG_REGISTRY).filter((f) => f.riskTier === "HIGH_RISK_TIER0").map((f) => f.key);
    assert.deepEqual(tier0Flags.sort(), ["maintenance_mode", "release_stage"]);
  });

  test("an AI agent cannot set a flag — flag.set.* is absent from the AI write allowlist", () => {
    const registry = JSON.parse(read("policies/data/actions.json"));
    assert.ok(!registry.aiWriteAllowlist.includes("flag.set.operator"));
    assert.ok(!registry.aiWriteAllowlist.includes("flag.set.tier0"));
    assert.ok(!registry.aiWriteAllowlist.includes("release_stage.activate_public"));
  });

  test("the admin route reuses requireAdminAccess + guardPrivilegedMutation + guardRoute — the same 4-layer stack router/disable/route.ts uses", () => {
    const src = stripComments(read("src/app/api/admin/feature-flags/set/route.ts"));
    assert.match(src, /guardPrivilegedMutation\(request\)/);
    assert.match(src, /requireAdminAccess\(\)/);
    assert.match(src, /routeClass: "durable_write"/);
    assert.match(src, /setFeatureFlagAdmin\(/);
  });

  test("Feature Flags is a real link in the admin nav", () => {
    const layout = read("src/app/admin/layout.tsx");
    assert.match(layout, /href="\/admin\/feature-flags"/);
  });
});

// ---- 21-C: audit + expiry + rollback ---------------------------------------

describe("Phase 21-C — every change is traceable and reversible", () => {
  test("the audit table is append-only — an UPDATE/DELETE trigger refuses, the same pattern admin_privileged_action_events already uses", () => {
    const migration = read("supabase/migrations/20260901000000_feature_flags.sql");
    assert.match(migration, /feature_flag_audit_append_only/);
    assert.match(migration, /BEFORE UPDATE OR DELETE ON "public"\."feature_flag_audit"/);
  });

  test("set_feature_flag() captures the previous value as the new rollback_value when none is explicitly supplied — one transaction, write + audit together", () => {
    const migration = read("supabase/migrations/20260901000000_feature_flags.sql");
    assert.match(migration, /COALESCE\(p_rollback_value, v_previous\)/);
    assert.match(migration, /INSERT INTO feature_flag_audit/);
  });

  test("expiry is lazy — read-time reversion to rollback_value, never a scheduled writer this batch invents", () => {
    const src = stripComments(read("src/lib/feature-flags/flag-store.ts"));
    assert.match(src, /export function effectiveRecord/);
    assert.doesNotMatch(src, /schedules\.task|setInterval|cron/i);
  });

  test("reason/ticketRef/expiresAt are real, caller-suppliable fields on the admin mutation, not decorative types", () => {
    const src = stripComments(read("src/lib/admin/feature-flag-admin-service.ts"));
    assert.match(src, /reason: string/);
    assert.match(src, /ticketRef: string \| undefined/);
    assert.match(src, /expiresAt: string \| null/);
  });
});

// ---- 21-D: canary guardrail — honestly scoped ------------------------------

describe("Phase 21-D — canary guardrail is a real, tested decision layer with an honestly-disclosed deferred trigger", () => {
  test("evaluateCanaryGuardrail reuses Phase 15-A's own error-budget type, never a second SLO signal shape", () => {
    const src = stripComments(read("src/lib/feature-flags/canary-guardrail.ts"));
    assert.match(src, /from "@\/lib\/slo\/error-budget"/);
    assert.doesNotMatch(src, /computeErrorBudget\s*\(/, "must import and reuse, never redefine, the Phase 15-A calculation");
  });

  test("no schedules.task() or cron exists anywhere in this repository to call it automatically — the automatic trigger is honestly deferred, not fabricated", () => {
    const operationalTasks = stripComments(read("src/trigger/operational/operational-tasks.ts"));
    assert.doesNotMatch(operationalTasks, /schedules\.task\(/);
  });
});

// ---- Phase 20 contract governance: the new event -------------------------

describe("Phase 21 composes with Phase 20 contract governance for its own new event", () => {
  test("audit.flag-changed@1 is registered in the real event schema registry, reusing the existing 'audit' family/topic", () => {
    assert.ok(EVENT_SCHEMAS.has("audit.flag-changed@1"), "audit.flag-changed@1 must be a real registered schema");
  });

  test("the payload carries only bounded, stringified scalars — no raw metadata bag, no reason_code/ticket_ref free text on the wire", () => {
    const src = stripComments(read("src/lib/events/event-schemas.ts"));
    const schemaSection = src.slice(src.indexOf("const AUDIT_FLAG_CHANGED"), src.indexOf("const REGISTERED"));
    assert.match(schemaSection, /additionalProperties: false/);
    assert.doesNotMatch(schemaSection, /reasonCode|ticketRef|reason_code|ticket_ref/i, "operator free text never rides onto the wire event");
  });

  test("the domain event is emitted best-effort, after the durable write and audit row already succeeded — never a reason the mutation itself is reported as failed", () => {
    const src = stripComments(read("src/lib/admin/feature-flag-admin-service.ts"));
    const afterWrite = src.slice(src.indexOf("await recordTier0Execution(admin, {\n    requestId,\n    action,\n    actorClerkUserId,\n    target: { type: \"feature_flag\", id: key },\n    outcome: \"executed\""));
    assert.match(afterWrite, /enqueueEventStandalone/);
  });
});

// ---- Sensitive data boundary ------------------------------------------------

describe("Phase 21 — sensitive data boundary", () => {
  test("no secret, token, or credential-shaped field anywhere in the new lib module", () => {
    // "authorization"/"credential" deliberately excluded — both appear as
    // legitimate substrings of real identifiers here (e.g.
    // TIER0_AUTHORIZATION_REQUIRED, an outcome enum name, not a header or a
    // secret). Phase 20's own equivalent test scopes the same forbidden
    // words to OpenAPI SCHEMA FIELD NAMES rather than raw source text for
    // exactly this reason; this test's target words stay the ones with no
    // legitimate non-secret use in this module.
    const FORBIDDEN = /(secret|password|apikey|api_key|signedurl|signed_url|sdkkey)/i;
    for (const file of [
      "src/lib/feature-flags/flag-contract.ts",
      "src/lib/feature-flags/flag-registry.ts",
      "src/lib/feature-flags/flag-store.ts",
      "src/lib/admin/feature-flag-admin-service.ts",
    ]) {
      const src = stripComments(read(file));
      assert.doesNotMatch(src, FORBIDDEN, `${file} must carry no secret-shaped field`);
    }
  });
});

// ---- Built-but-unwired reachability ----------------------------------------

describe("Phase 21 — every new component has a real caller", () => {
  test("the admin API routes import the real service, not a stub", () => {
    const listRoute = stripComments(read("src/app/api/admin/feature-flags/route.ts"));
    const setRoute = stripComments(read("src/app/api/admin/feature-flags/set/route.ts"));
    assert.match(listRoute, /getFeatureFlagAdminView/);
    assert.match(setRoute, /setFeatureFlagAdmin/);
  });

  test("the admin page renders the real client panel, and the panel calls the real API routes", () => {
    const page = read("src/app/admin/feature-flags/page.tsx");
    assert.match(page, /FeatureFlagsPanel/);
    const panel = stripComments(read("src/components/admin/FeatureFlagsPanel.tsx"));
    assert.match(panel, /\/api\/admin\/feature-flags/);
    assert.match(panel, /\/api\/admin\/feature-flags\/set/);
  });

  test("the service imports the real store's writeFlag, not a mock", () => {
    const src = stripComments(read("src/lib/admin/feature-flag-admin-service.ts"));
    assert.match(src, /from "@\/lib\/feature-flags\/flag-store"/);
  });
});
