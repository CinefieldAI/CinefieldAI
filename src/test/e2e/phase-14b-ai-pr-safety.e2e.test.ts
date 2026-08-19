import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { PolicyDenied } from "@/lib/policy/policy-contract";
import { evaluatePolicy, registeredActions, actionRule } from "@/lib/policy/policy-engine";
import { classifyChangeRisk, RISK_ORDER } from "@/lib/deployment/change-risk";
import {
  REQUIRED_CHECK_REGISTRY,
  resolveRequiredChecks,
  touchesMigration,
  type RequiredCheckId,
} from "@/lib/deployment/required-checks";
import {
  isPrProposalInputShape,
  MAX_CHANGED_FILES,
  type PrProposalInput,
} from "@/lib/deployment/pr-proposal-contract";
import { advanceAfterChecks, evaluateAiPrProposal } from "@/lib/deployment/ai-pr-authority";

/**
 * PHASE 14-B — CODE-ONLY SAFETY FOUNDATION
 *
 * Roadmap 14-B: "Code Scanning + Secret Scanning + Dependency Review/
 * Dependabot + branch protection/required checks'i tek GitHub gate paketi
 * olarak kur." Done-criterion: "Riskli PR merge olamıyor."
 *
 * This is the code-only slice: PR-creation-scoped AI write authority,
 * the change-risk taxonomy, the required-check registry, and their
 * composition over the EXISTING Phase 12-E policy gate. No GitHub API, no
 * Sentry Seer, no production deploy — see the structural guards (section 20)
 * for tests that specifically prove those absences.
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

function proposal(overrides: Partial<PrProposalInput> = {}): PrProposalInput {
  return {
    title: "Fix flaky dispatcher retry",
    summary: "Backoff jitter was computed before the streak reset, causing an early retry.",
    changedFilePaths: ["worker/realtime-dispatcher-worker.ts"],
    rollbackExpectation: "guard_reverts_release",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1–8. AI write action model, direct-write/self-approval denials
// ---------------------------------------------------------------------------

test("S14B-1  an unknown AI write action is denied", () => {
  const d = evaluatePolicy({
    action: "code.repo.anything",
    actor: { id: AGENT, role: "ai_agent", kind: "ai_agent" },
    tenantId: null,
    resource: { type: "unspecified", id: null },
    risk: { temporarilyBlocked: false, adminReviewRequired: false, challengeRequired: false },
    approvalEvidence: { humanApproved: false },
    environment: "production",
    originClass: "server",
    correlationId: null,
  });
  assert.equal(d.decision, "DENY");
  assert.equal(d.reason, "unknown_action");
});

test("S14B-2  code.pr.create is narrowly represented - exactly one allowlist entry, no wildcard", () => {
  const registry = JSON.parse(read("policies/data/actions.json")) as { aiWriteAllowlist: string[] };
  assert.deepEqual(registry.aiWriteAllowlist, ["code.pr.create"]);
  for (const entry of registry.aiWriteAllowlist) {
    assert.ok(!entry.includes("*"), `wildcard entry: ${entry}`);
  }
  const rule = actionRule("code.pr.create");
  assert.ok(rule);
  assert.deepEqual(rule?.requiredRoles, ["ai_agent"]);
  assert.equal(rule?.requiresHumanApproval, true);
  assert.equal(rule?.critical, true);
  assert.equal(rule?.implemented, true);
  assert.equal(rule?.owner, "phase-14");
});

test("S14B-3  code.main.push is not, and never becomes, an allowed AI action", () => {
  for (const forbidden of ["code.main.push", "repository.push", "code.*", "repository.*"]) {
    const registry = JSON.parse(read("policies/data/actions.json")) as { aiWriteAllowlist: string[] };
    assert.ok(!registry.aiWriteAllowlist.includes(forbidden), `${forbidden} must never be allowlisted`);
    assert.equal(actionRule(forbidden), null, `${forbidden} must not even be a registered action`);
  }
});

test("S14B-4  production.deploy is not an allowed AI action", () => {
  const registry = JSON.parse(read("policies/data/actions.json")) as { aiWriteAllowlist: string[] };
  for (const forbidden of ["production.deploy", "deploy.production.apply", "secret.rotate", "iam.modify", "database.apply", "billing.modify", "quarantine.release", "media.quarantine.release"]) {
    assert.ok(!registry.aiWriteAllowlist.includes(forbidden), `${forbidden} must never be AI-allowlisted`);
  }
  // media.quarantine.release exists, is IMPLEMENTED, and is human-only; an AI
  // actor attempting it must still be denied by the AI-write gate specifically
  // (not merely by role), proving the two prohibitions are independent. Using
  // secret.rotate here would instead trip the earlier "not_implemented"
  // structural refusal (Phase 12-D has not built it yet), which would prove a
  // different thing.
  const d = evaluatePolicy({
    action: "media.quarantine.release",
    actor: { id: AGENT, role: "ai_agent", kind: "ai_agent" },
    tenantId: null,
    resource: { type: "unspecified", id: null },
    risk: { temporarilyBlocked: false, adminReviewRequired: false, challengeRequired: false },
    approvalEvidence: { humanApproved: true },
    environment: "production",
    originClass: "server",
    correlationId: null,
  });
  assert.equal(d.decision, "DENY");
  assert.equal(d.reason, "ai_write_authority_off");
});

test("S14B-5  AI cannot approve its own PR - no approval-granting code exists anywhere in this batch", () => {
  for (const { path: file, body } of deploymentSourceFiles()) {
    const bare = stripComments(body);
    assert.ok(!/approve\(|setApproved|grantApproval|humanApproved:\s*true/i.test(bare),
      `${file} invents or grants an approval`);
  }
});

test("S14B-6  AI cannot merge - no merge-capable code exists anywhere in this batch", () => {
  for (const { path: file, body } of deploymentSourceFiles()) {
    const bare = stripComments(body);
    assert.ok(!/merge\(|\.merge\b|mergePullRequest/i.test(bare), `${file} contains merge logic`);
  }
});

test("S14B-7  AI cannot skip CI - resolveRequiredChecks accepts no preference parameter", () => {
  assert.equal(resolveRequiredChecks.length, 2, "the function takes exactly (riskClass, changedFilePaths)");
  const src = stripComments(read("src/lib/deployment/required-checks.ts"));
  const sig = src.slice(src.indexOf("export function resolveRequiredChecks"), src.indexOf("export function resolveRequiredChecks") + 300);
  assert.ok(!/skip|only|exclude|preference|requested/i.test(sig), `signature admits a preference field: ${sig}`);
});

test("S14B-8  AI cannot choose required checks - identical inputs always resolve identically, extra fields ignored", () => {
  const a = resolveRequiredChecks("LOW_RISK", ["docs/readme.md"]);
  const b = resolveRequiredChecks("LOW_RISK", ["docs/readme.md"]);
  assert.deepEqual(a, b);
  // A structurally impossible "preference" cannot even be constructed: the
  // PrProposalInput shape has no field that could carry one.
  const contract = stripComments(read("src/lib/deployment/pr-proposal-contract.ts"));
  const shape = contract.slice(
    contract.indexOf("export interface PrProposalInput"),
    contract.indexOf("export type PrProposalState")
  );
  assert.ok(!/skip|only|exclude|riskClass|requiredCheck/i.test(shape), `PrProposalInput admits a check-selection field: ${shape}`);
});

// ---------------------------------------------------------------------------
// 9–11. Risk → authority resolution
// ---------------------------------------------------------------------------

test("S14B-9  LOW_RISK resolves the baseline checks only", () => {
  const result = classifyChangeRisk(["docs/architecture/CINEFIELD_ARCHITECTURE_CONTRACT.md"]);
  assert.equal(result.riskClass, "LOW_RISK");
  const checks = resolveRequiredChecks(result.riskClass, ["docs/architecture/CINEFIELD_ARCHITECTURE_CONTRACT.md"]);
  // Pinned baseline membership — bump this list (with a comment) whenever a
  // real check joins BASELINE. 8 entries as of Phase 24-A/24-D's
  // `supply_chain_scan` (SBOM + dependency + container scan, real and
  // enforced for every risk class, including AI-authored PRs via this same
  // resolution function).
  assert.deepEqual(checks, [
    "build",
    "changed_file_lint",
    "policy_conformance",
    "secret_scan",
    "supply_chain_scan",
    "telemetry_scan",
    "test_suite",
    "typecheck",
  ]);
  assert.ok(!checks.includes("migration_safety"));
  assert.ok(!checks.includes("postgres_proofs"));
});

test("S14B-10  MEDIUM_RISK still resolves at least the full baseline (stronger review, not fewer checks)", () => {
  const result = classifyChangeRisk(["src/lib/orchestration/providers/fal-provider.ts"]);
  assert.equal(result.riskClass, "MEDIUM_RISK");
  const checks = resolveRequiredChecks(result.riskClass, ["src/lib/orchestration/providers/fal-provider.ts"]);
  for (const id of ["typecheck", "test_suite", "build", "changed_file_lint", "secret_scan", "telemetry_scan", "policy_conformance"]) {
    assert.ok(checks.includes(id as RequiredCheckId), `MEDIUM_RISK dropped ${id}`);
  }
});

test("S14B-11  HIGH_RISK requires human review - the policy layer never returns ALLOW without approval evidence", async () => {
  const result = classifyChangeRisk(["worker/workflows/generation-workflow.ts"]);
  assert.equal(result.riskClass, "HIGH_RISK");

  const record = await evaluateAiPrProposal(
    proposal({ changedFilePaths: ["worker/workflows/generation-workflow.ts"] }),
    { agentId: AGENT }
  );
  assert.equal(record.riskClass, "HIGH_RISK");
  assert.equal(record.state, "REVIEW_REQUIRED");
  assert.equal(record.policyDecision?.decision, "REQUIRE_APPROVAL");
  assert.equal(record.policyDecision?.reason, "ai_write_needs_human_approval");
});

// ---------------------------------------------------------------------------
// 12. FORBIDDEN_AUTOMATION cannot become executable
// ---------------------------------------------------------------------------

test("S14B-12  FORBIDDEN_AUTOMATION never reaches ALLOW, with or without approval evidence", async () => {
  for (const approvalEvidence of [undefined, { humanApproved: true }]) {
    const record = await evaluateAiPrProposal(
      proposal({ changedFilePaths: ["policies/data/actions.json"] }),
      { agentId: AGENT, approvalEvidence }
    );
    assert.equal(record.riskClass, "FORBIDDEN_AUTOMATION");
    assert.equal(record.state, "REVIEW_REQUIRED");
    assert.equal(record.policyDecision, null, "the policy gate was never consulted");
  }
});

// ---------------------------------------------------------------------------
// 13–14. SQL / migration rule
// ---------------------------------------------------------------------------

test("S14B-13  a SQL/migration change elevates risk and cannot be marked low", () => {
  const result = classifyChangeRisk(["supabase/migrations/20260901000000_add_index.sql"]);
  assert.equal(result.riskClass, "HIGH_RISK");
  assert.ok(result.drivingDomains.includes("database_migration"));
  // No override path exists - the classifier takes only paths, and a
  // migration path always resolves at least HIGH_RISK.
  assert.equal(RISK_ORDER[result.riskClass] >= RISK_ORDER.HIGH_RISK, true);
});

test("S14B-14  a migration change adds migration_safety and postgres_proofs to the required checks", () => {
  assert.equal(touchesMigration(["supabase/migrations/20260901000000_add_index.sql"]), true);
  const checks = resolveRequiredChecks("HIGH_RISK", ["supabase/migrations/20260901000000_add_index.sql"]);
  assert.ok(checks.includes("migration_safety"));
  assert.ok(checks.includes("postgres_proofs"));
  assert.equal(REQUIRED_CHECK_REGISTRY.postgres_proofs.command, "bash supabase/tests/run_pg_tests.sh");
  assert.equal(REQUIRED_CHECK_REGISTRY.postgres_proofs.blocking, true);
});

// ---------------------------------------------------------------------------
// 15–17. Security-sensitive elevation
// ---------------------------------------------------------------------------

test("S14B-15  an auth/RLS-adjacent change elevates risk automatically", () => {
  assert.equal(classifyChangeRisk(["src/proxy.ts"]).riskClass, "HIGH_RISK");
  assert.equal(classifyChangeRisk(["src/lib/security/risk-engine.ts"]).riskClass, "HIGH_RISK");
  assert.equal(classifyChangeRisk(["supabase/migrations/20260901000000_rls_policy.sql"]).riskClass, "HIGH_RISK");
});

test("S14B-16  a billing/credit change elevates risk automatically", () => {
  assert.equal(classifyChangeRisk(["src/lib/credits.ts"]).riskClass, "HIGH_RISK");
});

test("S14B-17  a secret/IAM/KMS/policy-engine change is FORBIDDEN_AUTOMATION, never a lower tier", () => {
  for (const p of [
    "src/lib/config/environment.ts",
    "src/lib/policy/policy-engine.ts",
    "policies/cinefield/policy.rego",
    "policies/data/actions.json",
    "src/lib/media/quarantine-release.ts",
  ]) {
    assert.equal(classifyChangeRisk([p]).riskClass, "FORBIDDEN_AUTOMATION", `${p} must be FORBIDDEN_AUTOMATION`);
  }
});

// ---------------------------------------------------------------------------
// 18. UI risk rule
// ---------------------------------------------------------------------------

test("S14B-18  a UI change touching auth/billing/upload/admin is not low risk", () => {
  assert.equal(classifyChangeRisk(["src/app/api/media/upload-url/route.ts"]).riskClass, "HIGH_RISK");
  assert.equal(classifyChangeRisk(["src/app/admin/settings/page.tsx"]).riskClass, "HIGH_RISK");
  assert.equal(classifyChangeRisk(["src/app/api/generate/route.ts"]).riskClass, "HIGH_RISK");
});

// ---------------------------------------------------------------------------
// 19. Docs-only may remain low risk
// ---------------------------------------------------------------------------

test("S14B-19  a docs-only change remains LOW_RISK, and a mixed change takes the maximum", () => {
  assert.equal(classifyChangeRisk(["docs/security-gates.md", "README.md"]).riskClass, "LOW_RISK");
  const mixed = classifyChangeRisk(["docs/security-gates.md", "policies/data/actions.json"]);
  assert.equal(mixed.riskClass, "FORBIDDEN_AUTOMATION", "one sensitive file makes the whole change forbidden");
});

// ---------------------------------------------------------------------------
// 20. Risk cannot be browser/AI supplied
// ---------------------------------------------------------------------------

test("S14B-20  risk cannot be browser/AI supplied - the input shape has no risk field, and one is ignored if smuggled in", () => {
  const contract = stripComments(read("src/lib/deployment/pr-proposal-contract.ts"));
  const inputShape = contract.slice(
    contract.indexOf("export interface PrProposalInput"),
    contract.indexOf("export type PrProposalState")
  );
  assert.ok(!/riskClass|risk:/i.test(inputShape), `PrProposalInput carries a risk field: ${inputShape}`);

  const smuggled = { ...proposal(), riskClass: "LOW_RISK" } as unknown as PrProposalInput;
  const result = classifyChangeRisk(smuggled.changedFilePaths);
  // classifyChangeRisk takes only paths - it has no parameter a smuggled
  // field on the object could even reach.
  assert.equal(classifyChangeRisk.length, 1);
  assert.notEqual(result.riskClass, "LOW_RISK", "the smuggled claim was not what actually resolved");
});

// ---------------------------------------------------------------------------
// 21–22. PR proposal contract
// ---------------------------------------------------------------------------

test("S14B-21  the PR proposal contract has no field a secret could arrive in", () => {
  const contract = stripComments(read("src/lib/deployment/pr-proposal-contract.ts"));
  assert.ok(!/secret|token|apiKey|api_key|credential|signedUrl|password/i.test(contract),
    "a secret-shaped field exists in the PR proposal contract");
});

test("S14B-22  raw logs and prompts are forbidden - no free-form or content field exists", () => {
  const contract = stripComments(read("src/lib/deployment/pr-proposal-contract.ts"));
  const inputShape = contract.slice(
    contract.indexOf("export interface PrProposalInput"),
    contract.indexOf("export type PrProposalState")
  );
  assert.ok(!/prompt|rawLog|stackTrace|payload|content|fileContents?|diff:|shell|command:/i.test(inputShape),
    `an unbounded or content-carrying field exists: ${inputShape}`);
  // changedFilePaths is paths only, never contents.
  assert.match(inputShape, /changedFilePaths: readonly string\[\]/);

  // And the shape validator actually enforces the bound at runtime.
  assert.equal(isPrProposalInputShape({ ...proposal(), summary: "x".repeat(10_000) }), false);
  assert.equal(isPrProposalInputShape({ ...proposal(), changedFilePaths: [] }), false);
  const tooMany = Array.from({ length: MAX_CHANGED_FILES + 1 }, (_, i) => `src/file${i}.ts`);
  assert.equal(isPrProposalInputShape({ ...proposal(), changedFilePaths: tooMany }), false);
});

// ---------------------------------------------------------------------------
// 23. Trace id cannot authorize write
// ---------------------------------------------------------------------------

test("S14B-23  a trace/correlation id is observational only - it cannot change the risk or policy outcome", async () => {
  const withoutTrace = await evaluateAiPrProposal(proposal(), { agentId: AGENT });
  const withTrace = await evaluateAiPrProposal(
    proposal({ correlationId: "4bf92f3577b34da6a3ce929d0e0e4736" }),
    { agentId: AGENT }
  );
  assert.equal(withoutTrace.riskClass, withTrace.riskClass);
  assert.equal(withoutTrace.state, withTrace.state);
  assert.equal(withoutTrace.policyDecision?.decision, withTrace.policyDecision?.decision);

  // Even a forged, unrelated-looking correlation id changes nothing about
  // whether the change is FORBIDDEN_AUTOMATION.
  const forbidden = await evaluateAiPrProposal(
    proposal({ changedFilePaths: ["src/lib/policy/policy-engine.ts"], correlationId: "not-a-real-trace" }),
    { agentId: AGENT }
  );
  assert.equal(forbidden.riskClass, "FORBIDDEN_AUTOMATION");
});

// ---------------------------------------------------------------------------
// 24–25. Existing gates remain authority
// ---------------------------------------------------------------------------

test("S14B-24  Phase 12-E's policy gate remains sole authority - no second evaluator exists", async () => {
  for (const { path: file, body } of deploymentSourceFiles()) {
    const bare = stripComments(body);
    assert.ok(!/function evaluatePolicy|class.*PolicyEngine|new.*Engine\(/i.test(bare),
      `${file} defines a competing policy evaluator`);
  }
  // ai-pr-authority.ts imports and calls the real gate rather than
  // reimplementing any part of it.
  const authority = read("src/lib/deployment/ai-pr-authority.ts");
  assert.match(authority, /from "@\/lib\/policy\/policy-gate"/);
  assert.match(authority, /requireAiWritePolicy\(/);
  assert.ok(!/evaluatePolicy\(/.test(stripComments(authority)),
    "ai-pr-authority.ts must go through the gate, not call the raw evaluator directly");
});

test("S14B-25  Phase 13-E's Sensitive Data Guard remains green", () => {
  const out = execFileSync("npx", ["tsx", "scripts/scan-telemetry.ts"], { cwd: ROOT, encoding: "utf8", shell: true });
  assert.match(out, /no risky log call sites/);
});

// ---------------------------------------------------------------------------
// 26–30. No GitHub, no external account, no deploy, no migration, Phase 10 untouched
// ---------------------------------------------------------------------------

test("S14B-26  no GitHub API, SDK, CLI, or token exists anywhere in this batch", () => {
  for (const { path: file, body } of deploymentSourceFiles()) {
    const bare = stripComments(body);
    for (const pattern of [
      /@octokit/i,
      /github\.com\/api/i,
      /api\.github\.com/i,
      /\bgh\s+pr\b/i,
      /GITHUB_TOKEN/,
      /createPullRequest|octokit\.rest/i,
      /\bfetch\(/,
      /require\(['"]https?['"]\)/,
    ]) {
      assert.ok(!pattern.test(bare), `${file} contains a GitHub/network primitive (${pattern})`);
    }
  }
});

test("S14B-27  no external account is required by this batch - package.json gained no new dependency", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
  for (const forbidden of ["@octokit", "octokit", "@sentry", "@vercel/client", "datadog"]) {
    const hit = Object.keys(pkg.dependencies ?? {}).find((d) => d.includes(forbidden));
    assert.equal(hit, undefined, `unexpected dependency matching ${forbidden}: ${hit}`);
  }
});

test("S14B-28  no production deploy path exists - Deploy Guard/Rollback Guard execution is not implemented", () => {
  for (const { path: file, body } of deploymentSourceFiles()) {
    const bare = stripComments(body);
    // Targets EXECUTION, not the word "rollback". Phase 14-D legitimately
    // added `evaluateRollback()` — a pure decision function that returns a
    // verdict and touches nothing. The bare `rollback(` pattern was a fair
    // proxy while no rollback code existed at all; it now conflates deciding
    // with executing, which is the distinction 14-D is built around.
    assert.ok(
      !/vercel\.deploy|promoteToProduction|triggerDeploy|createDeployment/i.test(bare),
      `${file} contains a deploy execution path`
    );
    assert.ok(
      !/\b(perform|execute|apply|do)Rollback\s*\(|\brollbackTo\s*\(|\brollbackDeployment\s*\(/i.test(bare),
      `${file} contains a rollback execution path`
    );
    // The strongest remaining guarantee: no network primitive at all, so
    // nothing in this module can reach a deployment platform regardless of
    // what any function is named.
    assert.ok(!/\bfetch\s*\(|axios|@vercel\//i.test(bare), `${file} can reach the network`);
  }
  // PR_ELIGIBLE is explicitly documented as distinct from deploy eligibility.
  const contract = read("src/lib/deployment/pr-proposal-contract.ts");
  assert.match(contract, /PR_ELIGIBLE IS NOT DEPLOY_ELIGIBLE/);
});

test("S14B-29  no migration was created by this batch", () => {
  const out = execFileSync("git", ["status", "--short", "--", "supabase/"], { cwd: ROOT, encoding: "utf8", shell: true });
  assert.equal(out.trim(), "", "supabase/ must be unmodified by this batch");
});

test("S14B-30  Phase 10 billing/credits is untouched - the deployment module only classifies risk, it never reads or mutates credits", () => {
  for (const { path: file, body } of deploymentSourceFiles()) {
    const bare = stripComments(body);
    assert.ok(!/stripe|reserve|settle|refund|wallet|creditBalance/i.test(bare),
      `${file} reaches into Phase 10`);
  }
});

// ---------------------------------------------------------------------------
// Structural guards (section 20 of the batch)
// ---------------------------------------------------------------------------

test("S14B-31  no AI action grants main push, structurally - the registry has no such action to grant", () => {
  const actions = registeredActions();
  for (const a of actions) {
    assert.ok(!/main.?push|repo.?push|branch.?force/i.test(a), `registered action looks like a main-push grant: ${a}`);
  }
});

test("S14B-32  no production deploy action is AI-allowlisted (Phase 19 registered deployment.production.apply, human-approval-gated, never AI)", () => {
  const registry = JSON.parse(read("policies/data/actions.json")) as { aiWriteAllowlist: string[] };
  const actions = registeredActions();
  for (const a of actions) {
    if (!/deploy/i.test(a)) continue;
    assert.ok(!registry.aiWriteAllowlist.includes(a), `${a} must never be AI-allowlisted`);
  }
});

test("S14B-33  no wildcard write authority - every allowlist entry is a concrete, registered action", () => {
  const registry = JSON.parse(read("policies/data/actions.json")) as {
    aiWriteAllowlist: string[];
    actions: Record<string, unknown>;
  };
  for (const entry of registry.aiWriteAllowlist) {
    assert.ok(!entry.includes("*"), `${entry} is a wildcard`);
    assert.ok(Object.prototype.hasOwnProperty.call(registry.actions, entry), `${entry} is not a registered action`);
  }
});

test("S14B-34  the required-check registry has no empty applicability for a high-risk-eligible check", () => {
  for (const id of Object.keys(REQUIRED_CHECK_REGISTRY) as RequiredCheckId[]) {
    const def = REQUIRED_CHECK_REGISTRY[id];
    if (def.status === "deferred") continue;
    assert.ok(def.applicableRiskClasses.length > 0, `${id} applies to no risk class`);
  }
  const highRiskChecks = resolveRequiredChecks("HIGH_RISK", ["worker/workflows/generation-workflow.ts"]);
  assert.ok(highRiskChecks.length >= 7, "HIGH_RISK must resolve at least the full baseline");
});

test("S14B-35  FORBIDDEN_AUTOMATION has no executable path - the source proves the branch returns before the policy gate", () => {
  const authority = stripComments(read("src/lib/deployment/ai-pr-authority.ts"));
  const forbiddenBranch = authority.indexOf('riskClass === "FORBIDDEN_AUTOMATION"');
  const policyCall = authority.indexOf("requireAiWritePolicy(");
  assert.ok(forbiddenBranch > 0 && policyCall > 0);
  assert.ok(forbiddenBranch < policyCall, "the FORBIDDEN_AUTOMATION check must come before the policy call");
  // And the branch itself returns - it does not fall through.
  const branchBody = authority.slice(forbiddenBranch, policyCall);
  assert.match(branchBody, /return \{/);
});

test("S14B-36  no GitHub SDK/network integration exists in this batch (directory-level sweep)", () => {
  for (const { path: file, body } of deploymentSourceFiles()) {
    const bare = stripComments(body);
    assert.ok(!/^import .* from ["']@octokit/im.test(bare), `${file} imports a GitHub SDK`);
  }
  const imports = deploymentSourceFiles()
    .flatMap(({ body }) => [...stripComments(body).matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1]))
    .sort();
  for (const imp of imports) {
    assert.ok(
      imp.startsWith("@/") || imp.startsWith("./") || imp.startsWith("node:"),
      `unexpected external import in the deployment module: ${imp}`
    );
  }
});

// ---------------------------------------------------------------------------
// Local safe proof (section 21) — synthetic proposals A–D
// ---------------------------------------------------------------------------

test("S14B-PROOF-A  docs-only change -> LOW_RISK -> baseline checks -> PR eligible only after approval", async () => {
  const record = await evaluateAiPrProposal(
    proposal({ title: "Fix a typo in the architecture doc", changedFilePaths: ["docs/security-gates.md"] }),
    { agentId: AGENT }
  );
  assert.equal(record.riskClass, "LOW_RISK");
  // Includes supply_chain_scan (Phase 24-A/24-D) — an AI-authored proposal
  // resolves the exact same baseline as a human PR would, through this same
  // function. That equality IS the 24-D "AI Fix PR'lerine aynı checks'i
  // zorunlu yap" requirement, proven directly.
  assert.deepEqual(
    [...record.requiredCheckIds].sort(),
    ["build", "changed_file_lint", "policy_conformance", "secret_scan", "supply_chain_scan", "telemetry_scan", "test_suite", "typecheck"]
  );
  assert.equal(record.state, "REVIEW_REQUIRED", "no approval evidence supplied yet");

  const approved = await evaluateAiPrProposal(
    proposal({ title: "Fix a typo in the architecture doc", changedFilePaths: ["docs/security-gates.md"] }),
    { agentId: AGENT, approvalEvidence: { humanApproved: true } }
  );
  assert.equal(approved.state, "PR_ELIGIBLE", "PR-eligible, never deploy-eligible - see S14B-28");
});

test("S14B-PROOF-B  service logic change -> MEDIUM/HIGH per policy -> stronger checks -> review required", async () => {
  const record = await evaluateAiPrProposal(
    proposal({ changedFilePaths: ["src/lib/orchestration/providers/fal-provider.ts"] }),
    { agentId: AGENT }
  );
  assert.equal(record.riskClass, "MEDIUM_RISK");
  assert.equal(record.state, "REVIEW_REQUIRED");
});

test("S14B-PROOF-C  RLS migration -> HIGH_RISK -> PG/security checks -> human review -> no execution", async () => {
  const record = await evaluateAiPrProposal(
    proposal({
      title: "Tighten workspace RLS on generations",
      changedFilePaths: ["supabase/migrations/20260901000000_generations_rls.sql"],
    }),
    { agentId: AGENT }
  );
  assert.equal(record.riskClass, "HIGH_RISK");
  assert.ok(record.requiredCheckIds.includes("postgres_proofs"));
  assert.ok(record.requiredCheckIds.includes("migration_safety"));
  assert.equal(record.state, "REVIEW_REQUIRED");
  // Nothing executed: no PG connection, no SQL run, by this module.
  const authority = stripComments(read("src/lib/deployment/ai-pr-authority.ts"));
  assert.ok(!/psql|pg\.Client|createClient\(.*postgres/i.test(authority));
});

test("S14B-PROOF-D  secret/IAM change -> FORBIDDEN_AUTOMATION -> recommendation only, no repository mutation", async () => {
  const record = await evaluateAiPrProposal(
    proposal({ changedFilePaths: ["src/lib/config/environment.ts"] }),
    { agentId: AGENT, approvalEvidence: { humanApproved: true } }
  );
  assert.equal(record.riskClass, "FORBIDDEN_AUTOMATION");
  assert.equal(record.state, "REVIEW_REQUIRED");
  assert.equal(record.policyDecision, null);

  const status = execFileSync("git", ["status", "--short"], { cwd: ROOT, encoding: "utf8", shell: true });
  assert.ok(!status.includes("src/lib/config/environment.ts"), "no repository mutation occurred");
});

// ---------------------------------------------------------------------------
// CI_BLOCKED transition (deployment separation, section 17)
// ---------------------------------------------------------------------------

test("S14B-37  a PR_ELIGIBLE proposal moves to CI_BLOCKED when a required check fails, and stays put otherwise", async () => {
  const eligible = await evaluateAiPrProposal(proposal(), {
    agentId: AGENT,
    approvalEvidence: { humanApproved: true },
  });
  assert.equal(eligible.state, "PR_ELIGIBLE");

  const blocked = advanceAfterChecks(eligible, { typecheck: "fail" });
  assert.equal(blocked.state, "CI_BLOCKED");

  const stillEligible = advanceAfterChecks(eligible, { typecheck: "pass", test_suite: "pending" });
  assert.equal(stillEligible.state, "PR_ELIGIBLE");

  // A REVIEW_REQUIRED proposal cannot be advanced by check results - it needs a human.
  const reviewRequired = await evaluateAiPrProposal(proposal(), { agentId: AGENT });
  assert.equal(reviewRequired.state, "REVIEW_REQUIRED");
  const unchanged = advanceAfterChecks(reviewRequired, { typecheck: "fail" });
  assert.equal(unchanged.state, "REVIEW_REQUIRED");
});

test("S14B-38  a REQUIRE_APPROVAL PolicyDenied is converted into a record, never left to propagate", async () => {
  // requireAiWritePolicy throws PolicyDenied for every non-ALLOW decision,
  // including the REQUIRE_APPROVAL this call produces (no approval evidence
  // supplied). evaluateAiPrProposal must catch that by kind (`instanceof
  // PolicyDenied`) and return a normal record - a caller checking a proposal
  // must never need a try/catch just to read its state.
  const record = await evaluateAiPrProposal(proposal(), { agentId: AGENT });
  assert.equal(record.state, "REVIEW_REQUIRED");
  assert.equal(record.policyDecision?.decision, "REQUIRE_APPROVAL");
  assert.ok(!(record.policyDecision instanceof PolicyDenied), "the decision is plain data, not the thrown error");

  // The catch is scoped to PolicyDenied specifically, by source inspection -
  // a bare catch-all would risk reinterpreting a real bug as a proposal state.
  const authority = stripComments(read("src/lib/deployment/ai-pr-authority.ts"));
  assert.match(authority, /error instanceof PolicyDenied/);
});
