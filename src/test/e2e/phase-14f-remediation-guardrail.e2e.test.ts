import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { ALERT_CATALOGUE, channelsFor, type AlertEnvelope, type AlertType } from "@/lib/alerts/alert-contract";
import {
  AUTO_REMEDIATION_ALLOWLIST,
  REMEDIATION_ENABLED_VAR,
  REMEDIATION_LIMITS,
  evaluateRemediationAttempt,
  isRemediationKillSwitchEngaged,
  remediationStateFor,
  resetRemediationGuardrail,
} from "@/lib/deployment/remediation-guardrail";
import { considerIncidentForRemediation } from "@/lib/deployment/remediation-runner";
import { eligibilityRuleFor } from "@/lib/deployment/incident-diagnosis";
import { fieldRule } from "@/lib/observability/telemetry-contract";

/**
 * PHASE 14-F — AI REMEDIATION LOOP SAFETY
 *
 * Roadmap 14-F: "Global auto-remediation kill-switch + Seer/agent PR-storm
 * rate limit/suppression + AI-action provenance." Done-criterion: "Tek flag
 * ile remediation duruyor; PR storm sınırlı; her AI action model/agent/policy
 * sürümüyle audit'te."
 *
 * ¶253 gives the design brief: these controls protect the system "AI ops'un
 * kendisi sapıttığında". Most of this suite is therefore about what CANNOT
 * happen.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DEPLOYMENT_DIR = path.join(ROOT, "src", "lib", "deployment");
const deploymentFiles = () =>
  readdirSync(DEPLOYMENT_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ path: f, body: readFileSync(path.join(DEPLOYMENT_DIR, f), "utf8") }));

const AGENT = "local-deterministic";

function envelope(overrides: Partial<AlertEnvelope> = {}): AlertEnvelope {
  const type: AlertType = overrides.type ?? "dispatcher_pass_failing";
  const rule = ALERT_CATALOGUE[type];
  return {
    alertId: "alert-1-abc",
    type,
    source: rule?.source ?? "dispatcher",
    severity: rule?.severity ?? "ERROR",
    resource: "realtime-dispatcher",
    reasonCode: "consecutive_pass_failures",
    dedupeKey: `${rule?.source ?? "dispatcher"}:${type}:realtime-dispatcher`,
    state: "OPEN",
    firstSeen: "2026-08-16T00:00:00.000Z",
    lastSeen: "2026-08-16T00:05:00.000Z",
    occurrenceCount: 3,
    channels: channelsFor(rule?.severity ?? "ERROR", rule?.userVisible ?? false),
    correlation: {},
    ...overrides,
  };
}

/**
 * Runs fn with remediation enabled, always restoring the previous value.
 *
 * AWAITS the result before restoring. A synchronous `finally` around an async
 * callback restores the variable while the body is still suspended, so the
 * kill switch re-engages mid-test and every later assertion sees a frozen
 * system — which is exactly what it did before this was fixed.
 */
async function withRemediationEnabled<T>(fn: () => T | Promise<T>): Promise<T> {
  const prev = process.env[REMEDIATION_ENABLED_VAR];
  process.env[REMEDIATION_ENABLED_VAR] = "true";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[REMEDIATION_ENABLED_VAR];
    else process.env[REMEDIATION_ENABLED_VAR] = prev;
  }
}

// ---------------------------------------------------------------------------
// 1–3. Kill switch
// ---------------------------------------------------------------------------

test("S14F-1  the kill switch stops proposals, and it is engaged by default", () => {
  resetRemediationGuardrail();
  const prev = process.env[REMEDIATION_ENABLED_VAR];
  delete process.env[REMEDIATION_ENABLED_VAR];
  try {
    // Default state: no variable at all means FROZEN. A fresh deployment does
    // not quietly begin remediating.
    assert.equal(isRemediationKillSwitchEngaged(), true);
    const v = evaluateRemediationAttempt({
      dedupeKey: "dispatcher:dispatcher_pass_failing:realtime-dispatcher",
      alertType: "dispatcher_pass_failing",
      commit: true,
    });
    assert.equal(v.decision, "REFUSE");
    assert.equal(v.refusal, "kill_switch_engaged");
    // And a refused attempt consumes no budget.
    assert.equal(remediationStateFor("dispatcher:dispatcher_pass_failing:realtime-dispatcher"), null);
  } finally {
    if (prev !== undefined) process.env[REMEDIATION_ENABLED_VAR] = prev;
  }
});

test("S14F-2  the AI cannot re-enable it — no setter, no override, exists anywhere in the module", () => {
  for (const { path: file, body } of deploymentFiles()) {
    const bare = stripComments(body);
    for (const pattern of [
      // Only a MUTATOR is forbidden. The read-only predicate
      // `isRemediationKillSwitchEngaged` legitimately contains "Engaged".
      /(export\s+)?function\s+(set|enable|disable|engage|disengage)\w*\s*\(/i,
      /killSwitch\s*=\s*(false|true)/i,
      /process\.env\[[^\]]*\]\s*=/,
      /process\.env\.\w+\s*=/,
    ]) {
      assert.ok(!pattern.test(bare), `${file} can mutate the kill switch (${pattern})`);
    }
  }
  // The switch is read-only by construction: exactly one read, no write.
  const guard = stripComments(read("src/lib/deployment/remediation-guardrail.ts"));
  assert.equal((guard.match(/process\.env\[REMEDIATION_ENABLED_VAR\]/g) ?? []).length, 1);
  assert.ok(!/export function (set|enable|disable)/.test(guard));
});

test("S14F-3  no browser/query/HTTP surface can reach the kill switch", () => {
  for (const { path: file, body } of deploymentFiles()) {
    const bare = stripComments(body);
    for (const pattern of [/searchParams/, /req\.query/, /request\.url/, /headers\.get/, /NEXT_PUBLIC_/]) {
      assert.ok(!pattern.test(bare), `${file} reads a client-controllable input (${pattern})`);
    }
  }
  // It is server-only: the variable has no NEXT_PUBLIC_ prefix, so it is
  // never inlined into a browser bundle.
  assert.ok(!REMEDIATION_ENABLED_VAR.startsWith("NEXT_PUBLIC_"));
  // And no API route exposes remediation control.
  const apiDir = path.join(ROOT, "src", "app", "api");
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
    );
  for (const f of walk(apiDir)) {
    const body = readFileSync(f, "utf8");
    assert.ok(!/remediation/i.test(body), `${f} exposes a remediation surface`);
  }
});

// ---------------------------------------------------------------------------
// 4–6. Dedupe, cooldown, occurrence aggregation
// ---------------------------------------------------------------------------

test("S14F-4  the same incident dedupes on 13-D identity — no new logical incident per repeat", async () => {
  await withRemediationEnabled(() => {
    resetRemediationGuardrail();
    const key = "dispatcher:dispatcher_pass_failing:realtime-dispatcher";
    const t0 = 1_000_000;

    const first = evaluateRemediationAttempt({ dedupeKey: key, alertType: "dispatcher_pass_failing", nowMs: t0, commit: true });
    assert.equal(first.decision, "ALLOW_ATTEMPT");
    assert.equal(first.attemptNumber, 1);

    // Same key, immediately again: one incident, not two.
    const second = evaluateRemediationAttempt({ dedupeKey: key, alertType: "dispatcher_pass_failing", nowMs: t0 + 1_000, commit: true });
    assert.equal(second.decision, "REFUSE");
    assert.equal(remediationStateFor(key)?.attempts, 1, "a refused repeat must not count as an attempt");
  });
});

test("S14F-5  cooldown blocks a duplicate proposal, and expires deterministically", async () => {
  await withRemediationEnabled(() => {
    resetRemediationGuardrail();
    const key = "dispatcher:dispatcher_pass_failing:realtime-dispatcher";
    const t0 = 2_000_000;
    evaluateRemediationAttempt({ dedupeKey: key, alertType: "dispatcher_pass_failing", nowMs: t0, commit: true });

    const during = evaluateRemediationAttempt({
      dedupeKey: key, alertType: "dispatcher_pass_failing",
      nowMs: t0 + REMEDIATION_LIMITS.cooldownSeconds * 1_000 - 1, commit: true,
    });
    assert.equal(during.refusal, "cooldown_active");

    const after = evaluateRemediationAttempt({
      dedupeKey: key, alertType: "dispatcher_pass_failing",
      nowMs: t0 + REMEDIATION_LIMITS.cooldownSeconds * 1_000, commit: true,
    });
    assert.equal(after.decision, "ALLOW_ATTEMPT");
    assert.equal(after.attemptNumber, 2);
  });
});

test("S14F-6  occurrenceCount may rise without producing a new proposal", async () => {
  await withRemediationEnabled(async () => {
    resetRemediationGuardrail();
    const t0 = 3_000_000;
    const first = await considerIncidentForRemediation(envelope({ occurrenceCount: 1 }), { agentId: AGENT, nowMs: t0 });
    assert.equal(first.attempted, true);

    // The same incident, seen 500 more times inside the cooldown.
    for (const n of [50, 200, 500]) {
      const again = await considerIncidentForRemediation(envelope({ occurrenceCount: n }), { agentId: AGENT, nowMs: t0 + 1_000 });
      assert.equal(again.attempted, false, `occurrenceCount ${n} produced a new proposal`);
      assert.equal(again.record, null);
    }
  });
});

// ---------------------------------------------------------------------------
// 7–9. Attempt ceiling and storm protection
// ---------------------------------------------------------------------------

test("S14F-7..8  max attempts is enforced, then the incident becomes a human's", async () => {
  await withRemediationEnabled(() => {
    resetRemediationGuardrail();
    const key = "dispatcher:dispatcher_pass_failing:realtime-dispatcher";
    const cd = REMEDIATION_LIMITS.cooldownSeconds * 1_000;
    let t = 4_000_000;

    for (let i = 1; i <= REMEDIATION_LIMITS.maxAttemptsPerIncident; i += 1) {
      const v = evaluateRemediationAttempt({ dedupeKey: key, alertType: "dispatcher_pass_failing", nowMs: t, commit: true });
      assert.equal(v.decision, "ALLOW_ATTEMPT", `attempt ${i} should be allowed`);
      assert.equal(v.attemptNumber, i);
      t += cd;
    }

    // One past the ceiling, cooldown fully elapsed: still refused, forever.
    const over = evaluateRemediationAttempt({ dedupeKey: key, alertType: "dispatcher_pass_failing", nowMs: t, commit: true });
    assert.equal(over.refusal, "max_attempts_exhausted");
    const muchLater = evaluateRemediationAttempt({ dedupeKey: key, alertType: "dispatcher_pass_failing", nowMs: t + cd * 100, commit: true });
    assert.equal(muchLater.refusal, "max_attempts_exhausted", "exhaustion must not expire with time");
  });
});

test("S14F-9  global storm protection bounds fan-out across DISTINCT incidents", async () => {
  await withRemediationEnabled(() => {
    resetRemediationGuardrail();
    const t0 = 5_000_000;
    let allowed = 0;
    // Twenty different resources failing at once — per-incident limits alone
    // would permit twenty proposals. The global window is what stops it.
    for (let i = 0; i < 20; i += 1) {
      const v = evaluateRemediationAttempt({
        dedupeKey: `dispatcher:dispatcher_pass_failing:worker-${i}`,
        alertType: "dispatcher_pass_failing",
        nowMs: t0 + i,
        commit: true,
      });
      if (v.decision === "ALLOW_ATTEMPT") allowed += 1;
      else assert.equal(v.refusal, "global_budget_exhausted");
    }
    assert.equal(allowed, REMEDIATION_LIMITS.maxGlobalAttemptsPerWindow);

    // The window rolls: after it elapses, capacity returns.
    const later = evaluateRemediationAttempt({
      dedupeKey: "dispatcher:dispatcher_pass_failing:worker-99",
      alertType: "dispatcher_pass_failing",
      nowMs: t0 + REMEDIATION_LIMITS.globalWindowSeconds * 1_000 + 1,
      commit: true,
    });
    assert.equal(later.decision, "ALLOW_ATTEMPT");
  });
});

// ---------------------------------------------------------------------------
// 10–13. Eligibility boundary
// ---------------------------------------------------------------------------

test("S14F-10..12  security, IAM/secret and billing incidents never auto-remediate", async () => {
  await withRemediationEnabled(async () => {
    for (const type of [
      "security_high_severity",
      "security_action_recommended",
      "dependency_unavailable",
      "runtime_unready",
      "provider_degraded",
      "provider_unhealthy",
      "realtime_outbox_backlog",
    ] as const) {
      resetRemediationGuardrail();
      const out = await considerIncidentForRemediation(envelope({ type }), { agentId: AGENT, nowMs: 6_000_000 });
      assert.equal(out.attempted, false, `${type} was attempted`);
      assert.equal(out.refusal, "not_remediation_eligible");
      assert.equal(out.record, null);
    }
  });
});

test("S14F-13  dispatcher_pass_failing may enter the bounded seam and stops at review", async () => {
  await withRemediationEnabled(async () => {
    resetRemediationGuardrail();
    const out = await considerIncidentForRemediation(envelope(), { agentId: AGENT, nowMs: 7_000_000 });
    assert.equal(out.attempted, true);
    assert.equal(out.attemptNumber, 1);
    assert.ok(out.record);
    assert.equal(out.record!.riskClass, "HIGH_RISK");
    assert.equal(out.record!.state, "REVIEW_REQUIRED");
    assert.equal(out.record!.policyDecision?.decision, "REQUIRE_APPROVAL");
  });
});

test("S14F-13b  the auto-remediation allowlist can never exceed 14-A's diagnosis eligibility", () => {
  assert.deepEqual([...AUTO_REMEDIATION_ALLOWLIST], ["dispatcher_pass_failing"]);
  for (const type of AUTO_REMEDIATION_ALLOWLIST) {
    assert.equal(eligibilityRuleFor(type)?.remediationEligible, true,
      `${type} is auto-allowed but 14-A does not consider it remediable`);
  }
});

// ---------------------------------------------------------------------------
// 14–18. Authority, boundaries, sensitive data
// ---------------------------------------------------------------------------

test("S14F-14  a trace id is observational — it cannot change any guardrail outcome", async () => {
  await withRemediationEnabled(async () => {
    resetRemediationGuardrail();
    const withTrace = await considerIncidentForRemediation(
      envelope({ correlation: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736" } }),
      { agentId: AGENT, nowMs: 8_000_000 }
    );
    resetRemediationGuardrail();
    const without = await considerIncidentForRemediation(envelope(), { agentId: AGENT, nowMs: 8_000_000 });
    assert.equal(withTrace.attempted, without.attempted);
    assert.equal(withTrace.record?.state, without.record?.state);
    assert.equal(withTrace.record?.riskClass, without.record?.riskClass);
  });
});

test("S14F-15..17  no main push, no deploy, no GitHub API anywhere in the module", () => {
  for (const { path: file, body } of deploymentFiles()) {
    const bare = stripComments(body);
    for (const pattern of [
      /@octokit/i, /api\.github\.com/i, /\bgh\s+pr\b/i, /GITHUB_TOKEN/,
      /\bgit\s+push\b/, /\bmain\b\s*push/i,
      /vercel\.deploy|promoteToProduction|triggerDeploy/i,
      /\bfetch\s*\(/, /axios/i,
    ]) {
      assert.ok(!pattern.test(bare), `${file} contains a forbidden primitive (${pattern})`);
    }
  }
});

test("S14F-18  provenance respects the Sensitive Data Guard — every field is allow-listed", () => {
  const src = stripComments(read("src/lib/deployment/remediation-provenance.ts"));
  // No spread inside the log call: 13-E rejects it because a spread defeats
  // literal-key verification.
  assert.ok(!/\.\.\./.test(src.slice(src.indexOf("log.warn"))), "provenance spreads into a log call");

  for (const field of [
    "subsystem", "kind", "resource", "result", "reasonCode",
    "count", "policyVersion", "classification", "traceId", "dedupeKey",
  ]) {
    assert.ok(fieldRule(field), `provenance field "${field}" is not in the 13-E allow-list`);
  }
  // And nothing raw can travel: the interface has no such field.
  for (const forbidden of ["prompt", "stack", "rawLog", "payload", "secret", "body"]) {
    assert.ok(!new RegExp(`readonly ${forbidden}`, "i").test(src), `provenance carries ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 19–20. Real caller and neighbouring phases
// ---------------------------------------------------------------------------

test("S14F-19  the router now has a legitimate BOUNDED production caller", () => {
  const worker = stripComments(read("worker/realtime-dispatcher-worker.ts"));
  assert.match(worker, /considerIncidentForRemediation/, "the worker does not call the bounded entry point");

  // It goes through the guardrail runner, never the raw 14-A seam.
  assert.ok(!/proposeFixForIncident|bridgeIncidentToProposal/.test(worker),
    "the worker bypasses 14-F by calling the seam directly");

  // The runner checks the brake BEFORE doing any seam work.
  // Compare positions inside the FUNCTION BODY. Measuring across the whole
  // file finds the import statements first, which are always above both
  // calls and prove nothing about execution order.
  const runnerFull = stripComments(read("src/lib/deployment/remediation-runner.ts"));
  const runner = runnerFull.slice(runnerFull.indexOf("export async function considerIncidentForRemediation"));
  const guardAt = runner.indexOf("evaluateRemediationAttempt(");
  const seamAt = runner.indexOf("proposeFixForIncident(");
  assert.ok(guardAt > 0 && seamAt > 0 && guardAt < seamAt,
    "the guardrail must be consulted before the seam runs");
});

test("S14F-20  failure is safe: a broken guardrail refuses rather than permitting", async () => {
  await withRemediationEnabled(async () => {
    resetRemediationGuardrail();
    // A malformed envelope must not produce a proposal.
    const out = await considerIncidentForRemediation(
      { ...envelope(), dedupeKey: undefined as unknown as string, type: undefined as unknown as AlertType },
      { agentId: AGENT, nowMs: 9_000_000 }
    );
    assert.equal(out.attempted, false);
    assert.equal(out.record, null);
  });

  // And the runner's own catch returns a refusal, never a throw.
  const runner = stripComments(read("src/lib/deployment/remediation-runner.ts"));
  assert.match(runner, /catch\s*\{[\s\S]*?attempted:\s*false/);
});
