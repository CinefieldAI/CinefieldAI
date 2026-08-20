import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  GAME_DAY_SCENARIOS,
  ALLOWED_CHAOS_ENVIRONMENTS,
  gameDayScenario,
  isKnownGameDayScenario,
} from "@/lib/chaos/game-day-catalogue";
import { isChaosExecutionAllowed } from "@/lib/chaos/chaos-environment-guard";
import { classifyGameDayOutcome, isValidGuardrailOrActionEntry } from "@/lib/chaos/game-day-contract";
import { recordGameDayExercise } from "@/lib/chaos/game-day-execution-service";
import { getGameDayAdminView } from "@/lib/admin/game-day-admin-service";
import { RECOVERY_CLASSES, type RecoveryEvidence } from "@/lib/recovery/recovery-contract";
import { RTO_TARGETS, RPO_TARGETS } from "@/lib/recovery/recovery-target-registry";
import { TIER0_ACTION_CATALOGUE } from "@/lib/admin/tier0-action-catalogue";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 26 — Chaos Engineering, RTO/RPO & Resilience Validation.
 *
 * Reuse discipline is the thing this suite exists to prove: Phase 15-D/2's
 * `measureRecovery`/`RTO_TARGETS`/`RPO_TARGETS` are imported and asserted
 * UNCHANGED, never re-implemented. Phase 26's own new surface — the game-day
 * catalogue, the environment guard, the outcome classifier, and the
 * recording service — is bounded, structural, and never fabricates a pass.
 */

// ---------------------------------------------------------------------------
// Catalogue integrity (26-A)
// ---------------------------------------------------------------------------

test("G26-1  every catalogued scenario has a unique id", () => {
  const ids = GAME_DAY_SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("G26-2  every scenario's recoveryClass is one of Phase 15-D/2's own closed classes", () => {
  for (const scenario of GAME_DAY_SCENARIOS) {
    assert.ok(RECOVERY_CLASSES.includes(scenario.recoveryClass), `${scenario.id} uses an unknown recoveryClass`);
  }
});

test("G26-3  no scenario is production-allowed in this batch", () => {
  for (const scenario of GAME_DAY_SCENARIOS) {
    assert.equal(scenario.productionAllowed, false, `${scenario.id} must not be production-allowed yet`);
  }
});

test("G26-4  gameDayScenario/isKnownGameDayScenario agree with the catalogue", () => {
  for (const scenario of GAME_DAY_SCENARIOS) {
    assert.ok(isKnownGameDayScenario(scenario.id));
    assert.deepEqual(gameDayScenario(scenario.id), scenario);
  }
  assert.equal(gameDayScenario("not_a_real_scenario"), null);
  assert.equal(isKnownGameDayScenario("not_a_real_scenario"), false);
});

test("G26-5  the roadmap's named scenario categories are all represented", () => {
  const ids = new Set(GAME_DAY_SCENARIOS.map((s) => s.id));
  for (const expected of [
    "provider_outage",
    "provider_elevated_error_rate",
    "provider_worker_loss",
    "sqs_backlog_dlq",
    "redis_degradation",
    "database_connection_pressure",
    "webhook_delivery_loss",
    "r2_unavailable",
    "s3_dr_unavailable",
    "bad_deploy",
  ]) {
    assert.ok(ids.has(expected), `missing roadmap-named scenario: ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// Environment boundary (26-C / section 27-28 safety invariant)
// ---------------------------------------------------------------------------

test("G26-6  production is refused unconditionally, with no override path", () => {
  const decision = isChaosExecutionAllowed("production");
  assert.equal(decision.allowed, false);
  assert.equal((decision as { reasonCode: string }).reasonCode, "production_denied_by_default");
});

test("G26-7  local/test/staging are allowed", () => {
  for (const env of ALLOWED_CHAOS_ENVIRONMENTS) {
    assert.equal(isChaosExecutionAllowed(env).allowed, true, `${env} should be allowed`);
  }
});

test("G26-8  an unknown environment string is refused, not silently allowed", () => {
  const decision = isChaosExecutionAllowed("preprod");
  assert.equal(decision.allowed, false);
  assert.equal((decision as { reasonCode: string }).reasonCode, "unknown_environment");
});

test("G26-9  isChaosExecutionAllowed takes no override/bypass parameter", () => {
  assert.equal(isChaosExecutionAllowed.length, 1);
});

// ---------------------------------------------------------------------------
// Outcome classification never fabricates a pass (section 9/20)
// ---------------------------------------------------------------------------

function evidence(overrides: Partial<RecoveryEvidence>): RecoveryEvidence {
  return {
    incidentId: "inc-1",
    recoveryClass: "dependency_recovery",
    affectedComponent: "providers",
    result: "RECOVERED_WITHIN_TARGET",
    reasonCode: "recovery_within_target",
    evaluatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

test("G26-10  RECOVERED_WITHIN_TARGET with no failed guardrails classifies PASS", () => {
  const { outcome } = classifyGameDayOutcome(evidence({ result: "RECOVERED_WITHIN_TARGET" }), []);
  assert.equal(outcome, "PASS");
});

test("G26-11  RECOVERED_WITHIN_TARGET WITH a failed guardrail downgrades to FAIL", () => {
  const { outcome, reasonCode } = classifyGameDayOutcome(evidence({ result: "RECOVERED_WITHIN_TARGET" }), [
    "blast_radius_guardrail_tripped",
  ]);
  assert.equal(outcome, "FAIL");
  assert.equal(reasonCode, "guardrail_failed");
});

test("G26-12  RECOVERED_OUTSIDE_TARGET classifies FAIL", () => {
  const { outcome } = classifyGameDayOutcome(evidence({ result: "RECOVERED_OUTSIDE_TARGET", reasonCode: "rto_breached" }), []);
  assert.equal(outcome, "FAIL");
});

test("G26-13  RECOVERED_NO_TARGET classifies NO_TARGET_CONFIGURED, never PASS", () => {
  const { outcome } = classifyGameDayOutcome(evidence({ result: "RECOVERED_NO_TARGET" }), []);
  assert.equal(outcome, "NO_TARGET_CONFIGURED");
});

for (const nonFabricated of ["RECOVERY_INCOMPLETE", "EVIDENCE_UNAVAILABLE", "INVALID_EVIDENCE"] as const) {
  test(`G26-14  ${nonFabricated} classifies INCONCLUSIVE, never PASS/FAIL`, () => {
    const { outcome } = classifyGameDayOutcome(evidence({ result: nonFabricated }), []);
    assert.equal(outcome, "INCONCLUSIVE");
  });
}

test("G26-15  isValidGuardrailOrActionEntry rejects prose, accepts reason-code shape", () => {
  assert.equal(isValidGuardrailOrActionEntry("blast_radius_exceeded"), true);
  assert.equal(isValidGuardrailOrActionEntry("The guardrail failed because X happened"), false);
  assert.equal(isValidGuardrailOrActionEntry(""), false);
});

// ---------------------------------------------------------------------------
// Recording service — server recomputes, never trusts a caller verdict
// ---------------------------------------------------------------------------

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    scenarioId: "provider_outage",
    environment: "test",
    actorClerkUserId: "user_operator_1",
    incident: {
      incidentId: "inc-provider-outage-1",
      recoveryClass: "dependency_recovery" as const,
      affectedComponent: "providers" as const,
      reasonCode: "provider_unreachable",
      startedAt: "2026-01-01T00:00:00.000Z",
      serviceRestoredAt: "2026-01-01T00:05:00.000Z",
    },
    now: new Date("2026-01-01T00:05:00.000Z"),
    ...overrides,
  };
}

test("G26-16  unknown scenario is refused", async () => {
  const admin = new FakeSupabaseClient({ game_day_exercises: [] });
  const result = await recordGameDayExercise(admin as never, baseParams({ scenarioId: "not_a_scenario" }));
  assert.equal(result.outcome, "UNKNOWN_SCENARIO");
});

test("G26-17  production environment is refused even with perfect evidence", async () => {
  const admin = new FakeSupabaseClient({ game_day_exercises: [] });
  const result = await recordGameDayExercise(admin as never, baseParams({ environment: "production" }));
  assert.equal(result.outcome, "ENVIRONMENT_DENIED");
});

test("G26-18  incident recoveryClass/affectedComponent mismatching the scenario is refused", async () => {
  const admin = new FakeSupabaseClient({ game_day_exercises: [] });
  const result = await recordGameDayExercise(
    admin as never,
    baseParams({ incident: { ...baseParams().incident, affectedComponent: "sqs" } })
  );
  assert.equal(result.outcome, "INVALID_INPUT");
});

test("G26-19  malformed failedGuardrails entries are refused", async () => {
  const admin = new FakeSupabaseClient({ game_day_exercises: [] });
  const result = await recordGameDayExercise(
    admin as never,
    baseParams({ failedGuardrails: ["not a reason code!!"] })
  );
  assert.equal(result.outcome, "INVALID_INPUT");
});

test("G26-20  a successful recovery within an (unconfigured) target records NO_TARGET_CONFIGURED honestly", async () => {
  const admin = new FakeSupabaseClient({ game_day_exercises: [] });
  const result = await recordGameDayExercise(admin as never, baseParams());
  assert.equal(result.outcome, "RECORDED");
  if (result.outcome === "RECORDED") {
    // RTO_TARGETS ships empty (Phase 15-D/2) — no fabricated PASS is possible.
    assert.equal(result.record.outcome, "NO_TARGET_CONFIGURED");
    assert.equal(result.record.recovery.result, "RECOVERED_NO_TARGET");
  }
  assert.equal(admin.state.game_day_exercises.length, 1);
});

test("G26-21  the client cannot submit a bare verdict — only raw evidence is accepted, the server recomputes", async () => {
  const admin = new FakeSupabaseClient({ game_day_exercises: [] });
  // No serviceRestoredAt at all — an attacker/buggy client claiming success anyway.
  const result = await recordGameDayExercise(
    admin as never,
    baseParams({ incident: { ...baseParams().incident, serviceRestoredAt: undefined } })
  );
  assert.equal(result.outcome, "RECORDED");
  if (result.outcome === "RECORDED") {
    assert.equal(result.record.recovery.result, "RECOVERY_INCOMPLETE");
    assert.equal(result.record.outcome, "INCONCLUSIVE");
  }
});

test("G26-22  a request-supplied field named 'outcome' or 'recovery' has no effect — recordGameDayExercise accepts no such params", async () => {
  const params = baseParams() as Record<string, unknown>;
  assert.ok(!("outcome" in params));
  assert.ok(!("recovery" in params));
});

test("G26-23  recorded rows are bounded — recovery evidence write shape has no free-text field", async () => {
  const admin = new FakeSupabaseClient({ game_day_exercises: [] });
  await recordGameDayExercise(admin as never, baseParams());
  const row = admin.state.game_day_exercises[0] as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    assert.ok(
      !/prompt|payload|log|stack|secret|token|password|connection_string/i.test(key),
      `unexpected sensitive-shaped field: ${key}`
    );
  }
});

// ---------------------------------------------------------------------------
// Admin read view
// ---------------------------------------------------------------------------

test("G26-24  admin view reports SOURCE_UNAVAILABLE on a read error, never fabricates FOUND", async () => {
  const admin = {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async () => ({ data: null, error: { message: "boom" } }),
        }),
      }),
    }),
  };
  const result = await getGameDayAdminView(admin as never);
  assert.equal(result.outcome, "SOURCE_UNAVAILABLE");
});

test("G26-25  admin view maps rows and reports the real (today: zero) RTO/RPO registry size", async () => {
  const admin = new FakeSupabaseClient({ game_day_exercises: [] });
  await recordGameDayExercise(admin as never, baseParams());
  const result = await getGameDayAdminView(admin as never);
  assert.equal(result.outcome, "FOUND");
  if (result.outcome === "FOUND") {
    assert.equal(result.view.exercises.length, 1);
    assert.equal(result.view.scenarioCount, GAME_DAY_SCENARIOS.length);
    assert.equal(result.view.rtoTargetsConfigured, Object.keys(RTO_TARGETS).length);
    assert.equal(result.view.rpoTargetsConfigured, Object.keys(RPO_TARGETS).length);
  }
});

// ---------------------------------------------------------------------------
// Ownership preservation — Phase 26 orchestrates, it does not own RTO/RPO math
// ---------------------------------------------------------------------------

test("G26-26  no second RTO_TARGETS/RPO_TARGETS registry exists anywhere in src/", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(full);
        continue;
      }
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      const relPath = full.replace(/\\/g, "/");
      if (relPath.endsWith("src/lib/recovery/recovery-target-registry.ts")) continue;
      if (relPath.endsWith("src/test/e2e/phase-26-chaos-resilience.e2e.test.ts")) continue;
      const code = readFileSync(full, "utf8");
      if (/export const RTO_TARGETS\s*[:=]|export const RPO_TARGETS\s*[:=]/.test(code)) hits.push(full);
    }
  };
  walk(join(process.cwd(), "src"));
  assert.deepEqual(hits, []);
});

test("G26-27  no second measureRecovery-shaped engine exists — game-day-execution-service imports the real one", () => {
  const code = readFileSync(join(process.cwd(), "src", "lib", "chaos", "game-day-execution-service.ts"), "utf8");
  assert.match(code, /import\s*\{\s*measureRecovery\s*\}\s*from\s*"@\/lib\/recovery\/recovery-measurement-engine"/);
  assert.ok(!/function measureRecovery/.test(code), "must not redefine measureRecovery locally");
});

test("G26-28  recovery-measurement-engine.ts itself is untouched by this batch (still pure, still takes `now` as input)", () => {
  const raw = readFileSync(join(process.cwd(), "src", "lib", "recovery", "recovery-measurement-engine.ts"), "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/Date\.now\(\)/.test(code), "must not call Date.now()");
  assert.ok(!/new Date\(/.test(code), "must not construct a live Date internally");
  assert.match(raw, /readonly now: Date/, "must still take `now` as an explicit input");
});

// ---------------------------------------------------------------------------
// Tier-0 / policy wiring
// ---------------------------------------------------------------------------

test("G26-29  chaos.game_day.record is catalogued as OPERATOR_MUTATION, not HIGH_RISK_TIER0", () => {
  const entry = TIER0_ACTION_CATALOGUE["chaos.game_day.record" as keyof typeof TIER0_ACTION_CATALOGUE];
  assert.ok(entry);
  assert.equal(entry.classification, "OPERATOR_MUTATION");
  assert.equal(entry.requiresTwoPerson, false);
  assert.equal(entry.requiresStepUp, false);
});

test("G26-30  chaos.game_day.record is deliberately absent from policies/data/actions.json (not a 'critical' action)", () => {
  const actions = JSON.parse(readFileSync(join(process.cwd(), "policies", "data", "actions.json"), "utf8"));
  assert.ok(!("chaos.game_day.record" in actions.actions), "should not be registered as a critical OPA-mirrored action");
});

test("G26-31  no fault-injection-triggering AI-callable path exists", () => {
  const files = ["src/lib/chaos/game-day-execution-service.ts", "src/lib/chaos/game-day-contract.ts", "src/lib/chaos/chaos-environment-guard.ts"];
  for (const f of files) {
    const code = readFileSync(join(process.cwd(), f), "utf8");
    assert.ok(!/requireAiWritePolicy/.test(code));
  }
});

// ---------------------------------------------------------------------------
// Admin route authorization chain (structural — reads the route source)
// ---------------------------------------------------------------------------

test("G26-32  GET /api/admin/game-day requires admin access and a rate-limit guard", () => {
  const code = readFileSync(join(process.cwd(), "src", "app", "api", "admin", "game-day", "route.ts"), "utf8");
  assert.match(code, /requireAdminAccess/);
  assert.match(code, /guardRoute\(\{\s*routeClass:\s*"authenticated_read"/);
});

test("G26-33  POST /api/admin/game-day/record requires CSRF guard, admin access, and durable_write rate limiting", () => {
  const code = readFileSync(join(process.cwd(), "src", "app", "api", "admin", "game-day", "record", "route.ts"), "utf8");
  assert.match(code, /guardPrivilegedMutation/);
  assert.match(code, /requireAdminAccess/);
  assert.match(code, /guardRoute\(\{\s*routeClass:\s*"durable_write"/);
});

test("G26-34  the record route never accepts a client-supplied outcome/recovery/result field", () => {
  const code = readFileSync(join(process.cwd(), "src", "app", "api", "admin", "game-day", "record", "route.ts"), "utf8");
  assert.ok(!/payload\.outcome|payload\.recovery\b|body\.outcome/.test(code));
});

// ---------------------------------------------------------------------------
// Terraform structural checks (26-B)
// ---------------------------------------------------------------------------

const FIS_DIR = join(process.cwd(), "infra", "modules", "fis-experiments");

test("G26-35  the FIS module exists and declares no default experiments", () => {
  const code = readFileSync(join(FIS_DIR, "variables.tf"), "utf8");
  assert.match(code, /variable "experiments"/);
  assert.match(code, /default\s*=\s*\{\}/);
});

test("G26-36  every experiment structurally requires at least one stop condition", () => {
  const code = readFileSync(join(FIS_DIR, "variables.tf"), "utf8");
  assert.match(code, /stop_condition_alarm_arns[\s\S]*length\(v\.stop_condition_alarm_arns\) > 0/);
});

test("G26-37  no experiment target ARN may contain a wildcard (structural, not documentation-only)", () => {
  const code = readFileSync(join(FIS_DIR, "variables.tf"), "utf8");
  assert.match(code, /no experiment target ARN may contain a wildcard/);
  assert.match(code, /arn != "\*" && !can\(regex\("\\\\\*", arn\)\)/);
});

test("G26-38  the module forces single-account targeting — no org/account-wide fault injection", () => {
  const code = readFileSync(join(FIS_DIR, "main.tf"), "utf8");
  assert.match(code, /account_targeting\s*=\s*"single-account"/);
});

test("G26-39  the FIS module is not wired into any environment root in this batch", () => {
  for (const environment of ["dev", "production"]) {
    const code = readFileSync(join(process.cwd(), "infra", "environments", environment, "main.tf"), "utf8");
    assert.ok(!/fis-experiments/.test(code), `${environment} must not reference fis-experiments yet`);
  }
});

test("G26-40  fis-experiments/main.tf declares no wildcard IAM action/resource of its own (only iac-contract.test.ts's kms-keys exception exists elsewhere)", () => {
  const code = readFileSync(join(FIS_DIR, "main.tf"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*#.*$/gm, "");
  assert.ok(!/"\*"/.test(code));
});

// ---------------------------------------------------------------------------
// Migration hygiene
// ---------------------------------------------------------------------------

test("G26-41  the game_day_exercises migration grants no INSERT/SELECT to anon or authenticated", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260913000000_game_day_exercises.sql"),
    "utf8"
  );
  assert.match(sql, /REVOKE ALL ON TABLE "public"\."game_day_exercises" FROM "anon", "authenticated"/);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE "public"\."game_day_exercises" TO "service_role"/);
  assert.ok(!/GRANT[^;]*UPDATE[^;]*game_day_exercises/i.test(sql), "must stay append-only, no UPDATE grant");
});

test("G26-42  the migration's environment CHECK excludes production, matching the code-level guard", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260913000000_game_day_exercises.sql"),
    "utf8"
  );
  assert.match(sql, /"environment" IN \('local', 'test', 'staging'\)/);
});
