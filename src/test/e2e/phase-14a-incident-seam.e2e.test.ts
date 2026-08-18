import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import type { AlertEnvelope, AlertType } from "@/lib/alerts/alert-contract";
import { ALERT_CATALOGUE, channelsFor, dedupeKeyFor } from "@/lib/alerts/alert-contract";
import {
  LocalDeterministicRootCauseProvider,
  analyzeIncident,
  eligibilityRuleFor,
  safeCandidatePaths,
  type RootCauseProvider,
} from "@/lib/deployment/incident-diagnosis";
import { bridgeIncidentToProposal, proposeFixForIncident } from "@/lib/deployment/incident-to-proposal";
import { CHANGE_PATH_PATTERN, classifyChangeRisk } from "@/lib/deployment/change-risk";
import { REQUIRED_CHECK_REGISTRY } from "@/lib/deployment/required-checks";
import { registeredActions } from "@/lib/policy/policy-engine";
import { scanMigrationText, stripSqlComments } from "../../../scripts/scan-migration-safety";

/**
 * PHASE 14-A — INCIDENT → DIAGNOSIS → FIX PROPOSAL SEAM (code-only)
 *
 * Roadmap 14-A: "Sentry Seer root-cause → AI fix branch → GitHub PR akışını
 * kur." Done-criterion: "Test hata için PR hazırlanıyor; production'a direkt
 * push yok."
 *
 * This suite proves the first arrow only, plus the CI-registry honesty repair
 * the Phase 14 post-14B audit asked for. Sentry Seer and GitHub remain
 * external and unbuilt — several tests below exist specifically to prove that.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DEPLOYMENT_DIR = path.join(ROOT, "src", "lib", "deployment");
function deploymentSourceFiles(): { path: string; body: string }[] {
  return readdirSync(DEPLOYMENT_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ path: f, body: readFileSync(path.join(DEPLOYMENT_DIR, f), "utf8") }));
}

const AGENT = "agent_seer";

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
    firstSeen: "2026-08-15T00:00:00.000Z",
    lastSeen: "2026-08-15T00:05:00.000Z",
    occurrenceCount: 3,
    channels: channelsFor(rule?.severity ?? "ERROR", rule?.userVisible ?? false),
    correlation: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1–2. migration_safety registry honesty
// ---------------------------------------------------------------------------

test("S14A-1  migration_safety is honest — it names a real, executable command", () => {
  const def = REQUIRED_CHECK_REGISTRY.migration_safety;
  assert.equal(def.status, "available");
  assert.match(def.command, /^npx tsx scripts\/scan-migration-safety\.ts$/);
  assert.equal(def.blocking, true);
  assert.equal(def.failureBehavior, "block_pr");

  // The script it names actually exists and is runnable.
  const out = execFileSync("npx", ["tsx", "scripts/scan-migration-safety.ts"], {
    cwd: ROOT, encoding: "utf8", shell: true,
  });
  assert.match(out, /no destructive statements in migrations/);
});

test("S14A-2  no registry entry claims 'available' while describing manual review", () => {
  for (const def of Object.values(REQUIRED_CHECK_REGISTRY)) {
    if (def.status !== "available") continue;
    assert.ok(
      !/^\(/.test(def.command),
      `${def.id} is marked available but its command is a description: ${def.command}`
    );
    assert.ok(
      /^(npx|npm|bash|node)\s/.test(def.command),
      `${def.id} is marked available but names no executable: ${def.command}`
    );
  }
  // dependency_review stays honestly deferred — it has no tool yet.
  assert.equal(REQUIRED_CHECK_REGISTRY.dependency_review.status, "deferred");
});

test("S14A-2b  the migration scanner catches destruction and ignores legitimate SQL", () => {
  // Legitimate shapes that exist in this repository today must stay green.
  const benign = `
    -- a comment mentioning DROP TABLE and TRUNCATE
    GRANT SELECT,TRUNCATE ON TABLE public.x TO anon;
    revoke truncate on all tables in schema public from anon, authenticated;
    DROP POLICY IF EXISTS p ON public.x;
    DROP TRIGGER IF EXISTS t ON public.x;
    DROP FUNCTION IF EXISTS public.f(uuid);
    ALTER TABLE public.x DROP CONSTRAINT IF EXISTS c;
    DELETE FROM public.x WHERE id = 1;
  `;
  assert.deepEqual(scanMigrationText("benign.sql", benign), []);

  // Real destruction must fire.
  for (const [sql, rule] of [
    ["DROP TABLE public.victim;", "drop_table"],
    ["TRUNCATE public.victim;", "truncate_statement"],
    ["DELETE FROM public.victim;", "delete_without_where"],
    ["ALTER TABLE x ALTER COLUMN c TYPE bigint;", "alter_column_type"],
    ["ALTER TABLE x DROP COLUMN c;", "drop_column"],
    ["DROP SCHEMA public CASCADE;", "drop_schema"],
  ] as const) {
    const found = scanMigrationText("bad.sql", sql).map((f) => f.rule);
    assert.ok(found.includes(rule), `${rule} not detected in: ${sql}`);
  }

  // Comment stripping preserves line numbers.
  assert.equal(stripSqlComments("a\n-- x\nb").split("\n").length, 3);
});

// ---------------------------------------------------------------------------
// 3. Incident input authority
// ---------------------------------------------------------------------------

test("S14A-3  the 13-D AlertEnvelope is the canonical incident input — no competing format", () => {
  const diagnosis = analyzeIncident(envelope());
  assert.equal(diagnosis.alertId, "alert-1-abc");
  assert.equal(diagnosis.dedupeKey, "dispatcher:dispatcher_pass_failing:realtime-dispatcher");

  // The seam imports the alert contract; it does not define its own incident type.
  const src = read("src/lib/deployment/incident-diagnosis.ts");
  assert.match(src, /from "@\/lib\/alerts\/alert-contract"/);
  assert.ok(!/interface\s+\w*Incident(Envelope|Alert)\b/.test(stripComments(src)),
    "a competing incident envelope type was defined");
});

// ---------------------------------------------------------------------------
// 4–8. Sensitive data absent from diagnosis
// ---------------------------------------------------------------------------

test("S14A-4..8  no prompt, secret, signed URL, raw error or stack can reach a diagnosis", () => {
  const hostile = envelope({
    // Fields that do not exist on AlertEnvelope, smuggled in at runtime.
    ...({
      prompt: "a cinematic shot of a lighthouse",
      apiKey: "sk_live_deadbeef",
      url: "https://r2.example.com/x.mp4?X-Amz-Signature=abc",
      error: new Error("connect ECONNREFUSED 10.0.0.5:6379"),
      stack: "at Object.<anonymous> (/app/x.ts:1:1)",
    } as unknown as Partial<AlertEnvelope>),
  });

  const serialized = JSON.stringify(analyzeIncident(hostile));
  assert.ok(!/lighthouse/.test(serialized), "prompt survived");
  assert.ok(!/sk_live/.test(serialized), "secret survived");
  assert.ok(!/X-Amz-Signature/i.test(serialized), "signed URL survived");
  assert.ok(!/https?:\/\//.test(serialized), "a URL of any kind survived");
  assert.ok(!/ECONNREFUSED|10\.0\.0\.5/.test(serialized), "raw error survived");
  assert.ok(!/at Object\.<anonymous>/.test(serialized), "stack frame survived");

  // The diagnosis shape itself is closed — explicit projection, no envelope spread.
  const code = stripComments(read("src/lib/deployment/incident-diagnosis.ts"));
  assert.ok(!/\.\.\.envelope[,\s}]/.test(code), "the envelope is spread wholesale somewhere");
});

// ---------------------------------------------------------------------------
// 9–12. Diagnosis is evidence, not authority
// ---------------------------------------------------------------------------

test("S14A-9..12  a diagnosis cannot set risk, checks, approval or deploy eligibility", () => {
  const d = analyzeIncident(envelope());
  for (const forbidden of ["riskClass", "requiredCheckIds", "requiredChecks", "humanApproved", "deployEligible", "mergeApproved"]) {
    assert.ok(!(forbidden in (d as object)), `IncidentDiagnosis carries ${forbidden}`);
  }

  // Nor can the bridge's output: PrProposalInput has no field for any of them.
  const bridged = bridgeIncidentToProposal(envelope());
  assert.ok(bridged.proposal);
  for (const forbidden of ["riskClass", "requiredCheckIds", "humanApproved", "deployEligible"]) {
    assert.ok(!(forbidden in (bridged.proposal as object)), `PrProposalInput carries ${forbidden}`);
  }

  // And the seam never writes those names at all.
  const seam = stripComments(read("src/lib/deployment/incident-to-proposal.ts"));
  assert.ok(!/riskClass\s*:/.test(seam), "the bridge assigns a risk class");
  assert.ok(!/humanApproved\s*:\s*true/.test(seam), "the bridge invents an approval");
});

// ---------------------------------------------------------------------------
// 13–16. Candidate path safety
// ---------------------------------------------------------------------------

test("S14A-13..16  candidate paths are normalized; traversal, absolute, env and credential paths are dropped", () => {
  assert.deepEqual(safeCandidatePaths(["./src/lib/a.ts", "src/lib/a.ts"]), ["src/lib/a.ts"]);
  assert.deepEqual(safeCandidatePaths(["worker\\x.ts"]), ["worker/x.ts"]);

  for (const bad of [
    "../../etc/passwd",
    "src/../../../etc/passwd",
    "/etc/passwd",
    "C:/Windows/system32",
    ".env.local",
    "src/.env",
    "node_modules/@clerk/x.js",
    ".git/config",
    ".next/build.js",
    "CinefieldAI/x.ts",
    "secrets/prod.key",
    "deploy/id_rsa",
    "certs/server.pem",
  ]) {
    assert.deepEqual(safeCandidatePaths([bad]), [], `unsafe path admitted: ${bad}`);
  }

  // 14-B's CHANGE_PATH_PATTERN alone permits traversal (every char of "../"
  // is in its allowed set) — this layer is what actually rejects it.
  assert.equal(CHANGE_PATH_PATTERN.test("../../etc/passwd"), true, "premise check");
  assert.deepEqual(safeCandidatePaths(["../../etc/passwd"]), []);
});

// ---------------------------------------------------------------------------
// 17–18. Risk stays independently derived
// ---------------------------------------------------------------------------

test("S14A-17  candidate files pass through the existing 14-B classifier, unchanged", () => {
  const bridged = bridgeIncidentToProposal(envelope());
  assert.ok(bridged.proposal);
  const paths = bridged.proposal!.changedFilePaths;
  // worker/ is HIGH_RISK in the taxonomy; the diagnosis said nothing about risk.
  assert.equal(classifyChangeRisk(paths).riskClass, "HIGH_RISK");
});

test("S14A-18  a high-risk file elevates independently of what the diagnosis claims", () => {
  const forged: RootCauseProvider = {
    name: "forged",
    external: false,
    analyze: () => ({
      ...analyzeIncident(envelope()),
      // A hostile provider asserting a cheap change over a forbidden path.
      candidateFilePaths: ["policies/data/actions.json"],
      confidence: "high",
    }),
  };
  const bridged = bridgeIncidentToProposal(envelope(), forged);
  assert.ok(bridged.proposal);
  assert.equal(
    classifyChangeRisk(bridged.proposal!.changedFilePaths).riskClass,
    "FORBIDDEN_AUTOMATION",
    "the classifier must ignore the provider's confidence"
  );
});

// ---------------------------------------------------------------------------
// 19–23. Eligibility boundary
// ---------------------------------------------------------------------------

test("S14A-19  an unknown/uncatalogued alert cannot auto-remediate", () => {
  const d = analyzeIncident(envelope({ type: "totally_unknown" as AlertType }));
  assert.equal(d.outcome, "ANALYSIS_UNAVAILABLE");
  assert.equal(d.category, "unknown");
  assert.equal(d.confidence, "none");
  assert.equal(d.requiresHumanInvestigation, true);
  assert.equal(bridgeIncidentToProposal(envelope({ type: "totally_unknown" as AlertType })).proposal, null);
});

test("S14A-20  a security-sensitive alert escalates to a human, never a proposal", () => {
  for (const type of ["security_high_severity", "security_action_recommended"] as const) {
    const result = bridgeIncidentToProposal(envelope({ type }));
    assert.equal(result.diagnosis.category, "security_incident");
    assert.equal(result.diagnosis.outcome, "HUMAN_INVESTIGATION_REQUIRED");
    assert.equal(result.proposal, null, `${type} produced a proposal`);
    assert.equal(result.refusal, "human_investigation_required");
  }
});

test("S14A-21..22  infrastructure and provider/backlog alerts do not become autonomous proposals", () => {
  for (const type of [
    "dependency_unavailable",
    "runtime_unready",
    "dependency_degraded",
    "provider_degraded",
    "provider_unhealthy",
    "realtime_outbox_backlog",
    "realtime_outbox_stalled",
    "realtime_outbox_retry_exhaustion",
  ] as const) {
    const result = bridgeIncidentToProposal(envelope({ type }));
    assert.equal(result.proposal, null, `${type} produced an autonomous proposal`);
    assert.equal(result.diagnosis.requiresHumanInvestigation, true);
  }
});

test("S14A-23  a code-eligible operational incident produces a bounded PrProposalInput", () => {
  const result = bridgeIncidentToProposal(envelope({ type: "dispatcher_pass_failing" }));
  assert.equal(result.refusal, null);
  assert.ok(result.proposal);
  const p = result.proposal!;
  assert.deepEqual(Object.keys(p).sort(), ["changedFilePaths", "rollbackExpectation", "summary", "title"]);
  assert.ok(p.title.length <= 120 && p.summary.length <= 500);
  assert.deepEqual([...p.changedFilePaths].sort(), [
    "src/lib/realtime/outbox-dispatcher.ts",
    "worker/realtime-dispatcher-worker.ts",
  ]);

  // Exactly one alert type is remediation-eligible today.
  const eligible = (Object.keys(ALERT_CATALOGUE) as AlertType[]).filter(
    (t) => eligibilityRuleFor(t)?.remediationEligible
  );
  assert.deepEqual(eligible, ["dispatcher_pass_failing"]);
});

// ---------------------------------------------------------------------------
// 24–25. Existing authorities remain canonical
// ---------------------------------------------------------------------------

test("S14A-24  Phase 12-E remains the sole policy engine; the seam defines no evaluator", () => {
  for (const { path: file, body } of deploymentSourceFiles()) {
    const bare = stripComments(body);
    assert.ok(!/function evaluatePolicy|class \w*PolicyEngine/.test(bare), `${file} defines an evaluator`);
  }
  const seam = read("src/lib/deployment/incident-to-proposal.ts");
  assert.match(seam, /evaluateAiPrProposal/, "the seam must go through 14-B, which goes through 12-E");
});

test("S14A-25  code.pr.create remains the only AI-allowlisted write action", () => {
  const registry = JSON.parse(read("policies/data/actions.json")) as { aiWriteAllowlist: string[] };
  assert.deepEqual(registry.aiWriteAllowlist, ["code.pr.create"]);
  // PHASE 19 CORRECTION: this test used to assert no deploy/push/merge-
  // shaped action existed in the registry AT ALL — correct for 14-A's own
  // batch, which was not authorized to register one. Phase 19 IS
  // authorized (the roadmap names "deployment gate" as an official wiring
  // point) and added `deployment.production.apply` — human-approval-gated,
  // requiredRoles route_admin/service, never AI. The invariant this test
  // actually protects — no deploy-shaped action is AI-ALLOWLISTED — is
  // already covered, more precisely, by the `aiWriteAllowlist` assertion
  // above; this narrows to exactly that, rather than banning the concept
  // outright.
  for (const a of registeredActions()) {
    if (!/deploy|main\.push|merge/i.test(a)) continue;
    assert.ok(!registry.aiWriteAllowlist.includes(a), `${a} must never be AI-allowlisted`);
  }
});

// ---------------------------------------------------------------------------
// 26–29. External boundaries and production safety
// ---------------------------------------------------------------------------

test("S14A-26..28  no GitHub API, no Sentry API, no network, no paid service in the seam", () => {
  for (const { path: file, body } of deploymentSourceFiles()) {
    const bare = stripComments(body);
    for (const pattern of [
      /@octokit/i, /api\.github\.com/i, /\bgh\s+pr\b/i, /GITHUB_TOKEN/,
      /@sentry/i, /sentry\.io/i, /SENTRY_DSN/i, /\bSeer\w*\(/,
      /\bfetch\s*\(/, /axios/i, /WebSocket/,
    ]) {
      assert.ok(!pattern.test(bare), `${file} contains an external/network primitive (${pattern})`);
    }
  }
  // No new dependency was added.
  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
  for (const dep of ["@octokit", "octokit", "@sentry", "svix"]) {
    assert.equal(Object.keys(pkg.dependencies ?? {}).find((d) => d.includes(dep)), undefined);
  }
  // The only provider that exists declares itself non-external.
  assert.equal(new LocalDeterministicRootCauseProvider().external, false);
});

test("S14A-29  the seam mutates no production state and cannot reach the money path", () => {
  for (const { path: file, body } of deploymentSourceFiles()) {
    const bare = stripComments(body);
    assert.ok(!/stripe|reserve\(|settle\(|refund|wallet|credit_ledger/i.test(bare), `${file} reaches Phase 10`);

    // NO DATABASE CLIENT IS IMPORTED — a stronger claim than method-name
    // matching, because a mutation is impossible without a client at all.
    //
    // The previous form also matched `.delete(`, which caught 14-F's
    // `incidents.delete(...)` — an in-memory Map eviction, not a database
    // write. Matching method names alone cannot tell a Map from a table;
    // matching the import can.
    assert.ok(
      !/supabaseAdmin|getSupabaseAdminClient|createClient|@supabase/.test(bare),
      `${file} imports a database client`
    );
    // The Supabase mutation verbs that have no in-memory namesake still stand.
    assert.ok(!/\.rpc\(|\.upsert\(|\.insert\(/.test(bare), `${file} performs a database mutation`);
  }
});

// ---------------------------------------------------------------------------
// 30–32. Neighbouring phases stay green
// ---------------------------------------------------------------------------

test("S14A-30..31  14-B and 13-D contracts are untouched", () => {
  const registry = JSON.parse(read("policies/data/actions.json")) as { actions: Record<string, { owner: string }> };
  assert.equal(registry.actions["code.pr.create"].owner, "phase-14");

  // 13-D's dedupe identity is what the seam keys on — it must still exist.
  assert.equal(dedupeKeyFor("dispatcher_pass_failing", "realtime-dispatcher"),
    "dispatcher:dispatcher_pass_failing:realtime-dispatcher");
});

test("S14A-32  the 13-E telemetry scan is still green", () => {
  const out = execFileSync("npx", ["tsx", "scripts/scan-telemetry.ts"], {
    cwd: ROOT, encoding: "utf8", shell: true,
  });
  assert.match(out, /no risky log call sites/);
});

// ---------------------------------------------------------------------------
// Loop-safety preparation and failure semantics
// ---------------------------------------------------------------------------

test("S14A-33  stable incident identity is carried for future 14-F dedupe/cooldown", () => {
  const a = analyzeIncident(envelope({ alertId: "alert-1-x", occurrenceCount: 2 }));
  const b = analyzeIncident(envelope({ alertId: "alert-2-y", occurrenceCount: 9 }));
  // Different emissions of the SAME problem share one dedupe key.
  assert.equal(a.dedupeKey, b.dedupeKey);
  assert.notEqual(a.alertId, b.alertId);
  // Occurrence count survives, so a future limiter can key off escalation.
  assert.equal(b.occurrenceCount, 9);
});

test("S14A-34  a throwing provider yields analysis_unavailable, never an exception", () => {
  const exploding: RootCauseProvider = {
    name: "exploding",
    external: false,
    analyze() {
      throw new Error("provider is down");
    },
  };
  const d = analyzeIncident(envelope(), exploding);
  assert.equal(d.outcome, "ANALYSIS_UNAVAILABLE");
  assert.equal(d.reasonCode, "analysis_failed");
  assert.equal(bridgeIncidentToProposal(envelope(), exploding).refusal, "analysis_unavailable");
});

// ---------------------------------------------------------------------------
// Local safe proof — A / B / C
// ---------------------------------------------------------------------------

test("S14A-PROOF-A  code alert → diagnosis → proposal → risk → policy → still review-bounded", async () => {
  const { bridge, record } = await proposeFixForIncident(envelope({ type: "dispatcher_pass_failing" }), {
    agentId: AGENT,
  });
  assert.ok(bridge.proposal);
  assert.ok(record);
  assert.equal(record!.riskClass, "HIGH_RISK");
  assert.equal(record!.state, "REVIEW_REQUIRED");
  assert.equal(record!.policyDecision?.decision, "REQUIRE_APPROVAL");
  assert.ok(record!.requiredCheckIds.includes("typecheck"));
  // PR-eligible is never deploy-eligible.
  assert.ok(!("deployEligible" in (record as object)));
});

test("S14A-PROOF-B  security/secret alert → human investigation, no proposal, no execution", async () => {
  const { bridge, record } = await proposeFixForIncident(envelope({ type: "security_high_severity" }), {
    agentId: AGENT,
    approvalEvidence: { humanApproved: true },
  });
  assert.equal(bridge.proposal, null);
  assert.equal(record, null, "no policy evaluation should even be attempted");
  assert.equal(bridge.diagnosis.outcome, "HUMAN_INVESTIGATION_REQUIRED");
});

test("S14A-PROOF-C  unknown alert → no autonomous fix, and running the seam mutates nothing", async () => {
  // Compare the working tree BEFORE and AFTER exercising the pipeline. An
  // absolute "tree is clean" assertion would be wrong — this batch edits
  // source files, so it would only ever pass on an already-committed tree.
  // The real claim is narrower and is what actually matters: executing the
  // seam changes no file on disk.
  const gitStatus = () =>
    execFileSync("git", ["status", "--short"], { cwd: ROOT, encoding: "utf8", shell: true });

  const before = gitStatus();

  const { bridge, record } = await proposeFixForIncident(envelope({ type: "mystery" as AlertType }), {
    agentId: AGENT,
  });
  assert.equal(bridge.proposal, null);
  assert.equal(record, null);

  // And the eligible path too — a proposal being BUILT must still write nothing.
  await proposeFixForIncident(envelope({ type: "dispatcher_pass_failing" }), { agentId: AGENT });

  assert.equal(gitStatus(), before, "running the seam changed the working tree");
});
