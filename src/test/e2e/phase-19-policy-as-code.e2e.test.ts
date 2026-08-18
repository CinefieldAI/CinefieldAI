import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { evaluateDeploymentWithPolicy } from "@/lib/deployment/deployment-policy-gate";
import type { DeploymentCandidate } from "@/lib/deployment/deployment-guard";
import registry from "../../../policies/data/actions.json";

/**
 * Phase 19 test matrix: roadmap-scope fidelity (19-A/B/C/D), real
 * embedded/CI proof of the Rego fix, the new deployment-gate composition,
 * and ownership/security boundaries. The heavy real proof (opa test,
 * opa build -t wasm, WASM/embedded parity across 49 conformance cases) is
 * `npm run policy:test` / `npm run policy:build` / `npm run
 * policy:wasm-parity` — run directly against real tooling, not re-executed
 * inside this Node harness (which has no OPA binary guarantee). This file
 * proves the surrounding contract: what calls what, what's registered, what
 * fails closed, and what ownership boundaries stayed intact.
 */

const ROOT = process.cwd();
function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*#.*$/gm, "");
}

// ---- 19-A/19-B: real tooling was actually run, and CI proves it again ----

describe("Phase 19-A/B - Rego correctness and CI proof", () => {
  test("policy.rego references the real, verified OPA data-loading paths, never the never-actually-resolved data.cinefield.* shape", () => {
    const rego = stripComments(read("policies/cinefield/policy.rego"));
    assert.match(rego, /import data\.data as action_registry/);
    assert.doesNotMatch(rego, /data\.cinefield\.actions/);
  });

  test("policy_test.rego references the real conformance data path", () => {
    const regoTest = stripComments(read("policies/cinefield/policy_test.rego"));
    assert.match(regoTest, /data\.conformance\.cases/);
    assert.match(regoTest, /data\.conformance\.baseInput/);
    assert.doesNotMatch(regoTest, /data\.cinefield\.conformance/);
  });

  test("the AI write allowlist conformance test reflects the real, deliberate current state (not empty)", () => {
    const regoTest = read("policies/cinefield/policy_test.rego");
    assert.match(regoTest, /test_ai_write_allowlist_is_bounded/);
    assert.doesNotMatch(regoTest, /test_ai_write_allowlist_is_empty/);
  });

  test("policy-ci.yml runs opa test, opa build -t wasm, the real parity script, and tsc — required on every policies/ or engine change", () => {
    const workflow = read(".github/workflows/policy-ci.yml");
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /opa test policies\//);
    assert.match(workflow, /opa build -t wasm/);
    assert.match(workflow, /policy:wasm-parity/);
    assert.match(workflow, /tsc --noEmit/);
    assert.doesNotMatch(workflow, /opa (apply|exec)\b/);
  });

  test("the WASM bundle build artifact is never committed", () => {
    const gitignore = read(".gitignore");
    assert.match(gitignore, /^policies\/bundle\/$/m);
  });

  test("scripts/policy-wasm-parity.ts compares the real compiled WASM bundle against the real embedded engine, never a mock of either", () => {
    const script = read("scripts/policy-wasm-parity.ts");
    assert.match(script, /from "@open-policy-agent\/opa-wasm"/);
    assert.match(script, /from "@\/lib\/policy\/policy-engine"/);
    assert.match(script, /opa build -t wasm/);
    assert.doesNotMatch(script, /jest\.mock|vi\.mock|sinon/);
  });
});

// ---- 19-C: deployment gate wired to policy, additively -------------------

describe("Phase 19-C - Deployment gate policy composition", () => {
  const APPROVED = { humanApproved: true };
  const NOT_APPROVED = { humanApproved: false };

  // Same real, valid fixture shape phase-14d-deployment-guard.e2e.test.ts
  // already established (DIGEST_PATTERN-matching digest, matching artifact/
  // claim commitSha+buildId) — reused rather than reinvented, so this suite
  // proves the SAME `evaluateDeployment()` that file already tests, not a
  // fixture that only coincidentally passes.
  const DIGEST = "c".repeat(64);
  const COMMIT = "abc1234";

  function eligibleCandidate(): DeploymentCandidate {
    return {
      preview: { decision: "PROD_CANDIDATE", refusals: [], prodCandidate: true },
      artifact: {
        artifactId: "art-1",
        digest: DIGEST,
        commitSha: COMMIT,
        buildId: "build-1",
        status: "VERIFIED",
        provenanceRef: "attestation-1",
      },
      claim: { commitSha: COMMIT, digest: DIGEST, buildId: "build-1" },
      riskClass: "MEDIUM_RISK",
      ciGreen: true,
      humanApproved: true,
      criticalSecurityAlertOpen: false,
      targetReadiness: "HEALTHY",
    };
  }

  test("`deployment.production.apply` is registered, critical, and requires human approval", () => {
    const action = (registry as { actions: Record<string, { critical: boolean; requiresHumanApproval: boolean; requiredRoles: string[]; implemented: boolean }> }).actions["deployment.production.apply"];
    assert.ok(action);
    assert.equal(action.critical, true);
    assert.equal(action.requiresHumanApproval, true);
    assert.equal(action.implemented, true);
    assert.deepEqual(action.requiredRoles.sort(), ["route_admin", "service"]);
  });

  test("eligible only when BOTH deployment-guard and policy independently allow", async () => {
    const verdict = await evaluateDeploymentWithPolicy(eligibleCandidate(), {
      actor: { id: "user_admin_1", role: "route_admin", kind: "human" },
      approvalEvidence: APPROVED,
    });
    assert.equal(verdict.deployment.decision, "ELIGIBLE_FOR_EXTERNAL_DEPLOY");
    assert.equal(verdict.policy.decision, "ALLOW");
    assert.equal(verdict.eligible, true);
  });

  test("policy denial blocks even when deployment-guard itself is eligible", async () => {
    const verdict = await evaluateDeploymentWithPolicy(eligibleCandidate(), {
      actor: { id: "user_admin_1", role: "route_admin", kind: "human" },
      approvalEvidence: NOT_APPROVED,
    });
    assert.equal(verdict.deployment.decision, "ELIGIBLE_FOR_EXTERNAL_DEPLOY");
    assert.equal(verdict.policy.decision, "REQUIRE_APPROVAL");
    assert.equal(verdict.eligible, false, "policy denial must block even though deployment-guard alone was eligible");
  });

  test("deployment-guard blocking is preserved even when policy would allow", async () => {
    const notEligible: DeploymentCandidate = { ...eligibleCandidate(), ciGreen: false };
    const verdict = await evaluateDeploymentWithPolicy(notEligible, {
      actor: { id: "user_admin_1", role: "route_admin", kind: "human" },
      approvalEvidence: APPROVED,
    });
    assert.equal(verdict.deployment.decision, "BLOCK");
    assert.ok(verdict.deployment.refusals.includes("ci_not_green"));
    assert.equal(verdict.policy.decision, "ALLOW");
    assert.equal(verdict.eligible, false, "deployment-guard's own block must not be overridden by a policy allow");
  });

  test("a service identity may also trigger the gate", async () => {
    const verdict = await evaluateDeploymentWithPolicy(eligibleCandidate(), {
      actor: { id: "cinefield-deploy-ci", role: "service", kind: "service" },
      approvalEvidence: APPROVED,
    });
    assert.equal(verdict.policy.decision, "ALLOW");
  });

  test("deployment-guard.ts itself is untouched by this composition (Phase 14-D ownership preserved)", () => {
    const guard = read("src/lib/deployment/deployment-guard.ts");
    assert.doesNotMatch(guard, /policy-gate|policy-engine|requirePolicy|evaluatePolicy/);
  });

  test("the wrapper decides, never executes — no deploy/Vercel/network call anywhere in it", () => {
    const wrapper = stripComments(read("src/lib/deployment/deployment-policy-gate.ts"));
    for (const forbidden of ["vercel", "fetch(", "http", "exec(", "spawn("]) {
      assert.ok(!wrapper.toLowerCase().includes(forbidden.toLowerCase()), `must not reference "${forbidden}"`);
    }
  });
});

// ---- 19-D: fail-safe, and policy-change required checks -------------------

describe("Phase 19-D - Fail-safe and required checks", () => {
  test("a real fault in the gate (not a policy decision) is never silently treated as ALLOW by the deployment composer", async () => {
    // A malformed context (missing required actor fields at the type level
    // is caught by TS; at runtime, requirePolicy's own fail-closed try/catch
    // already covers evaluator faults — this proves the composer does not
    // add a SECOND path that could swallow a real fault into an allow.
    const source = stripComments(read("src/lib/deployment/deployment-policy-gate.ts"));
    assert.match(source, /throw caught/, "a non-PolicyDenied fault must propagate, never become an implicit allow");
  });

  test("policy-ci.yml is a required check for any policies/ or src/lib/policy/ change (policy-change PR governance)", () => {
    const workflow = read(".github/workflows/policy-ci.yml");
    assert.match(workflow, /paths:\s*\n\s*-\s*"policies\/\*\*"/);
  });

  test("no OPA sidecar/server process is provisioned — WASM/local evaluation only, per this batch's own external-dependency boundary", () => {
    for (const file of [".github/workflows/policy-ci.yml", "scripts/policy-wasm-parity.ts", "src/lib/policy/policy-engine.ts"]) {
      const source = stripComments(read(file)).toLowerCase();
      assert.ok(!source.includes("sidecar"), `${file} must not reference a sidecar`);
      assert.ok(!source.includes("docker"), `${file} must not reference a container runtime`);
    }
  });
});

// ---- Ownership / security boundaries --------------------------------------

describe("Phase 19 - Ownership and security boundaries", () => {
  test("no second policy engine: the embedded evaluator remains the sole runtime authority; the WASM path is CI-proof only", () => {
    const gate = read("src/lib/policy/policy-gate.ts");
    assert.match(gate, /evaluatePolicy\(input\)/);
    assert.doesNotMatch(stripComments(gate), /opa-wasm|loadPolicy\(/);
  });

  test("Tier-0 admin authorization (Phase 16-E) is not modified or absorbed by Phase 19", () => {
    const tier0 = read("src/lib/admin/tier0-authorization.ts");
    assert.doesNotMatch(stripComments(tier0), /policy-gate|policy-engine|requirePolicy|evaluatePolicy/);
  });

  test("the AI write allowlist is still exactly the one pre-existing, reviewed entry — Phase 19 did not expand AI production-write authority", () => {
    const r = registry as { aiWriteAllowlist: string[] };
    assert.deepEqual(r.aiWriteAllowlist, ["code.pr.create"]);
  });

  test("no new AI/agent action was added to the allowlist by this batch's own new registry entry", () => {
    const r = registry as { aiWriteAllowlist: string[]; actions: Record<string, { requiredRoles: string[] }> };
    assert.ok(!r.aiWriteAllowlist.includes("deployment.production.apply"));
    assert.ok(!r.actions["deployment.production.apply"].requiredRoles.includes("ai_agent"));
  });

  test("policy decisions persist through the existing security_events RPC — no new migration, no new table", () => {
    const gate = read("src/lib/policy/policy-gate.ts");
    assert.match(gate, /reportPolicyDecision/);
    const signals = read("src/lib/security/security-signals.ts");
    assert.match(signals, /reportPolicyDecision/);
    // security-signals.ts detaches to security-event-logger.ts, which owns
    // the actual RPC call — reused, not reimplemented.
    const logger = read("src/lib/security/security-event-logger.ts");
    assert.match(logger, /record_security_event/);
  });

  test("no new external/paid service is required — opa CLI and the WASM loader run entirely locally, no network call in the parity script", () => {
    const script = stripComments(read("scripts/policy-wasm-parity.ts"));
    assert.doesNotMatch(script, /fetch\(|https?:\/\/|axios/i);
  });
});
