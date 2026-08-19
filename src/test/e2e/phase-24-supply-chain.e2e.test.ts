import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  verifyReleaseProvenance,
  type ReleaseProvenanceRecord,
} from "@/lib/deployment/release-provenance";
import { DIGEST_PATTERN } from "@/lib/deployment/artifact-verification";
import { REQUIRED_CHECK_REGISTRY, resolveRequiredChecks } from "@/lib/deployment/required-checks";
import { generateSbom, runDependencyAudit } from "../../../scripts/generate-sbom";

/**
 * PHASE 24 — SOFTWARE SUPPLY CHAIN SECURITY & BUILD PROVENANCE (code-only)
 *
 * Roadmap Phase 24 done-criterion: "Production artifact için commit SHA,
 * digest, provenance ve SBOM görülebiliyor; doğrulanmamış artifact
 * deployment gate'i geçemiyor." 24-A/B/C/D package criteria are asserted
 * individually below. Real signing/attestation issuance lives in
 * `.github/workflows/supply-chain-ci.yml` (a GitHub Actions run, not
 * something `node:test` executes) — this suite proves the CODE-OWNED half:
 * the SBOM/audit script really runs, the provenance verifier fails closed,
 * and the required-check wiring reaches AI-authored PRs identically to
 * human ones.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const COMMIT_A = "abc1234def5678";
const COMMIT_B = "999888777666";

function record(overrides: Partial<ReleaseProvenanceRecord> = {}): ReleaseProvenanceRecord {
  return {
    artifactId: "sbom.json",
    digest: DIGEST_A,
    commitSha: COMMIT_A,
    workflowRunId: "12345",
    workflowRunUrl: "https://github.com/example/example/actions/runs/12345",
    environment: "production_candidate",
    buildTimestamp: "2026-08-19T00:00:00.000Z",
    attestationSubjectDigest: DIGEST_A,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 24-C — verifyReleaseProvenance: fails closed in every direction
// ---------------------------------------------------------------------------

test("S24-1  a fully-formed, matching record verifies", () => {
  const r = verifyReleaseProvenance(record(), COMMIT_A);
  assert.deepEqual(r, { state: "VERIFIED", refusals: [] });
});

test("S24-2  a missing record is MISSING_EVIDENCE, never VERIFIED or a crash", () => {
  const r = verifyReleaseProvenance(null, COMMIT_A);
  assert.equal(r.state, "MISSING_EVIDENCE");
  assert.deepEqual(r.refusals, ["record_missing"]);
});

test("S24-3  a missing digest is MISSING_EVIDENCE", () => {
  const r = verifyReleaseProvenance(record({ digest: "" }), COMMIT_A);
  assert.equal(r.state, "MISSING_EVIDENCE");
  assert.ok(r.refusals.includes("digest_missing"));
});

test("S24-4  a malformed digest is INVALID, distinct from missing", () => {
  const r = verifyReleaseProvenance(record({ digest: "not-a-digest" }), COMMIT_A);
  assert.equal(r.state, "INVALID");
  assert.ok(r.refusals.includes("digest_malformed"));
});

test("S24-5  a commit mismatch is INVALID — a verified artifact from commit A cannot authorize commit B", () => {
  const r = verifyReleaseProvenance(record({ commitSha: COMMIT_A }), COMMIT_B);
  assert.equal(r.state, "INVALID");
  assert.ok(r.refusals.includes("commit_mismatch"));
});

test("S24-6  a missing workflow run reference is MISSING_EVIDENCE", () => {
  const r = verifyReleaseProvenance(record({ workflowRunId: "", workflowRunUrl: "" }), COMMIT_A);
  assert.equal(r.state, "MISSING_EVIDENCE");
  assert.ok(r.refusals.includes("workflow_run_missing"));
});

test("S24-7  no attestation subject at all is MISSING_EVIDENCE — an unattested record is not silently accepted", () => {
  const r = verifyReleaseProvenance(record({ attestationSubjectDigest: undefined }), COMMIT_A);
  assert.equal(r.state, "MISSING_EVIDENCE");
  assert.ok(r.refusals.includes("attestation_subject_missing"));
});

test("S24-8  an attestation subject that does not match the record's own digest is INVALID", () => {
  const r = verifyReleaseProvenance(record({ attestationSubjectDigest: DIGEST_B }), COMMIT_A);
  assert.equal(r.state, "INVALID");
  assert.ok(r.refusals.includes("attestation_subject_mismatch"));
});

test("S24-9  digest comparison is case/prefix insensitive, same normalization as artifact-verification.ts", () => {
  const r = verifyReleaseProvenance(
    record({ digest: DIGEST_A.toUpperCase(), attestationSubjectDigest: `sha256:${DIGEST_A}` }),
    COMMIT_A
  );
  assert.equal(r.state, "VERIFIED");
});

test("S24-10  reuses artifact-verification.ts's own DIGEST_PATTERN/COMMIT_SHA_PATTERN — no second, drift-prone copy", () => {
  const src = read("src/lib/deployment/release-provenance.ts");
  assert.match(src, /import\s*\{\s*DIGEST_PATTERN,\s*COMMIT_SHA_PATTERN\s*\}\s*from\s*["']\.\/artifact-verification["']/);
  assert.doesNotMatch(stripComments(src), /const\s+DIGEST_PATTERN\s*=/);
  assert.doesNotMatch(stripComments(src), /const\s+COMMIT_SHA_PATTERN\s*=/);
});

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// 24-A — real SBOM + dependency scan (executes the real script)
// ---------------------------------------------------------------------------

test("S24-11  generate-sbom.ts really produces a valid CycloneDX SBOM against this repository's own lockfile", { timeout: 60_000 }, () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "phase24-sbom-"));
  try {
    const result = generateSbom(ROOT, outDir);
    const bytes = readFileSync(result.sbomPath, "utf8");
    const parsed = JSON.parse(bytes);
    assert.equal(parsed.bomFormat, "CycloneDX");
    assert.ok(Array.isArray(parsed.components) && parsed.components.length > 0, "SBOM must list real components");
    assert.match(result.digest, DIGEST_PATTERN, "digest must be shaped like the one artifact-verification.ts already validates");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("S24-12  runDependencyAudit really runs npm audit and returns a consistent, honest summary", { timeout: 60_000 }, () => {
  const summary = runDependencyAudit(ROOT);
  for (const key of ["info", "low", "moderate", "high", "critical", "total"] as const) {
    assert.ok(Number.isInteger(summary[key]) && summary[key] >= 0, `${key} must be a non-negative integer`);
  }
  assert.equal(
    summary.total,
    summary.info + summary.low + summary.moderate + summary.high + summary.critical,
    "total must equal the sum of the severities — no silent double-count or drop"
  );
});

test("S24-13  the SBOM/audit script blocks only on tooling failure, never on the vulnerability count it reports", () => {
  const src = stripComments(read("scripts/generate-sbom.ts"));

  // The specific if-block gating on the vulnerability COUNT — bounded to
  // its own braces, not a loose scan of the whole file (which would also
  // see the unrelated catch-block's exitCode assignment further down).
  const countCheckMatch = src.match(/if\s*\(audit\.critical > 0 \|\| audit\.high > 0\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(countCheckMatch, "expected the vulnerability-count branch to exist");
  assert.doesNotMatch(countCheckMatch![1], /process\.exitCode\s*=\s*1/, "the vulnerability-count branch must not set a failing exit code");
  assert.match(countCheckMatch![1], /console\.warn/, "the vulnerability-count branch must still report what it found");

  // The catch block IS where the real fail-closed behavior lives — the
  // scan tool itself throwing, not the numbers it returns.
  assert.match(src, /catch\s*\(error\)[\s\S]*process\.exitCode\s*=\s*1/, "must still fail closed when the scan itself throws");
});

// ---------------------------------------------------------------------------
// 24-D — AI Fix PR gate: same registry, same resolution function, no special-casing
// ---------------------------------------------------------------------------

test("S24-14  supply_chain_scan is real (available, not deferred), blocking, and applies to every risk class", () => {
  const def = REQUIRED_CHECK_REGISTRY.supply_chain_scan;
  assert.equal(def.status, "available");
  assert.equal(def.blocking, true);
  assert.equal(def.failureBehavior, "block_pr");
  assert.deepEqual([...def.applicableRiskClasses].sort(), ["FORBIDDEN_AUTOMATION", "HIGH_RISK", "LOW_RISK", "MEDIUM_RISK"]);
});

test("S24-15  supply_chain_scan is resolved for every risk class via the SAME resolveRequiredChecks() ai-pr-authority.ts calls — no AI-specific carve-out exists", () => {
  for (const paths of [
    ["docs/security-gates.md"],
    ["src/lib/orchestration/providers/fal-provider.ts"],
    ["supabase/migrations/20260901000000_x.sql"],
  ]) {
    const checks = resolveRequiredChecks("LOW_RISK", paths);
    assert.ok(checks.includes("supply_chain_scan"), `missing for paths ${paths.join(",")}`);
  }
  const aiPrAuthoritySrc = stripComments(read("src/lib/deployment/ai-pr-authority.ts"));
  assert.match(aiPrAuthoritySrc, /resolveRequiredChecks\(riskClass,\s*input\.changedFilePaths\)/, "AI PR path must call the shared resolver unmodified");
  assert.doesNotMatch(aiPrAuthoritySrc, /supply_chain_scan/, "no AI-specific special-casing of this check exists — it flows through the shared registry only");
});

test("S24-16  no registry entry named 'available' describes something unrunnable (S14A-2's own rule, holds for the new entry too)", () => {
  const def = REQUIRED_CHECK_REGISTRY.supply_chain_scan;
  assert.ok(!/^\(/.test(def.command));
  assert.match(def.command, /^(npx|npm|bash|node)\s/);
});

// ---------------------------------------------------------------------------
// AI authority — no code path in THIS application can sign, attest, or mark verification PASS
// ---------------------------------------------------------------------------

test("S24-17  no application code (outside the CI workflow) calls an attestation-issuing or signing tool", () => {
  const DEPLOYMENT_DIR = path.join(ROOT, "src", "lib", "deployment");
  const files = readdirSync(DEPLOYMENT_DIR).filter((f) => f.endsWith(".ts"));
  for (const f of files) {
    const body = stripComments(readFileSync(path.join(DEPLOYMENT_DIR, f), "utf8"));
    assert.doesNotMatch(body, /attest-build-provenance|gh attestation|cosign|sigstore/i, `${f} must not issue or verify signatures directly`);
  }
});

test("S24-18  verifyReleaseProvenance is a pure function — no fetch/exec/fs/network primitive, cannot itself mark anything VERIFIED without real evidence supplied by the caller", () => {
  const src = stripComments(read("src/lib/deployment/release-provenance.ts"));
  assert.doesNotMatch(src, /\bfetch\(|execFileSync|execSync|readFileSync|writeFileSync|require\(/);
});

test("S24-19  release-provenance.ts imports nothing that could reach the network, a shell, or a database", () => {
  const src = stripComments(read("src/lib/deployment/release-provenance.ts"));
  const imports = [...src.matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1]);
  for (const imp of imports) {
    assert.ok(imp.startsWith("./") || imp.startsWith("@/") || imp.startsWith("node:"), `unexpected import: ${imp}`);
  }
});

// ---------------------------------------------------------------------------
// Sensitive data boundary
// ---------------------------------------------------------------------------

test("S24-20  the release-provenance record shape carries no prompt/payload/secret/signed-URL/credential field", () => {
  const src = read("src/lib/deployment/release-provenance.ts");
  const shape = src.slice(src.indexOf("export interface ReleaseProvenanceRecord"), src.indexOf("export interface ReleaseProvenanceVerificationResult"));
  // Field declarations only — the shape's own explanatory comments
  // legitimately discuss "not a secret path" / "never a signed URL" as
  // design assurances, which a substring scan over the whole block would
  // otherwise misflag.
  const fieldLines = stripComments(shape)
    .split("\n")
    .filter((l) => /readonly\s+\w+\s*\??:/.test(l));
  assert.ok(fieldLines.length >= 6, "expected the real field list, not an empty/stripped block");
  for (const line of fieldLines) {
    assert.doesNotMatch(line, /prompt|payload|apiKey|api_key|secret|token|signedUrl|signed_url|password|credential/i, line);
  }
});

test("S24-21  the CI workflow never echoes a secret into logs or a workflow artifact", () => {
  const wf = read(".github/workflows/supply-chain-ci.yml");
  assert.doesNotMatch(wf, /secrets\.(?!GITHUB_TOKEN)/, "no repository secret other than the built-in GITHUB_TOKEN is referenced");
  assert.doesNotMatch(wf, /echo.*secrets\./i);
});

// ---------------------------------------------------------------------------
// Ownership preserved — Phase 9/17/19/20/21/22 untouched, no second registry
// ---------------------------------------------------------------------------

test("S24-22  no new Kafka/domain event schema was registered for release provenance — this is CI/build metadata, not a runtime domain event", () => {
  const eventSchemasPath = path.join(ROOT, "src", "lib", "events");
  const files = readdirSync(eventSchemasPath).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const f of files) {
    const body = readFileSync(path.join(eventSchemasPath, f), "utf8");
    assert.doesNotMatch(body, /release[_.]?provenance|supply[_.]?chain/i, `${f} must not register a Phase 24 event type`);
  }
});

test("S24-23  no second release-status/maturity field was created — release_stage (Phase 21) remains the only one", () => {
  const contract = read("src/lib/admin/deploy-restore-admin-contract.ts");
  assert.doesNotMatch(contract, /release[_-]?stage|releaseStage/i, "must not redefine or shadow Phase 21's release_stage");
});

test("S24-24  the deploy-restore admin route stays GET-only and behind the one canonical admin auth boundary after this batch's changes", () => {
  const routeText = stripComments(read("src/app/api/admin/deploy-restore/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.match(routeText, /export async function GET/);
  assert.doesNotMatch(routeText, /export async function POST|PUT|PATCH|DELETE/);
});

test("S24-25  no migration file was added for this batch", () => {
  const out = execFileSync("git", ["status", "--porcelain", "--", "supabase/migrations/"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(out.trim(), "", "no migration changes expected — Phase 24 is pure application/CI logic over existing evidence");
});
