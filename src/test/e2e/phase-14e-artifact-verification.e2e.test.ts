import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  verifyArtifact,
  type ArtifactIdentity,
  type CandidateClaim,
} from "@/lib/deployment/artifact-verification";
import { registeredActions } from "@/lib/policy/policy-engine";

/**
 * PHASE 14-E — ARTIFACT VERIFICATION GATE (code-only)
 *
 * Roadmap 14-E done-criterion: "Doğrulanmamış artifact prod'a çıkamıyor."
 * ¶432: AI fix PRs pass the SAME gates with no bypass. Deep signing/SBOM
 * issuance remains Phase 24 and is deliberately not duplicated here.
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

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const COMMIT_A = "abc1234def5678";
const COMMIT_B = "999888777666";

function artifact(overrides: Partial<ArtifactIdentity> = {}): ArtifactIdentity {
  return {
    artifactId: "art-1",
    digest: DIGEST_A,
    commitSha: COMMIT_A,
    buildId: "build-1",
    status: "VERIFIED",
    provenanceRef: "attestation-1",
    ...overrides,
  };
}

function claim(overrides: Partial<CandidateClaim> = {}): CandidateClaim {
  return { commitSha: COMMIT_A, digest: DIGEST_A, buildId: "build-1", ...overrides };
}

// ---------------------------------------------------------------------------
// 1–5. Everything that must block
// ---------------------------------------------------------------------------

test("S14E-1  an unverified artifact blocks", () => {
  const r = verifyArtifact(artifact({ status: "UNVERIFIED" }), claim());
  assert.equal(r.verified, false);
  assert.ok(r.refusals.includes("artifact_unverified"));
});

test("S14E-2  an unknown status blocks, and is distinguishable from unverified", () => {
  const unknown = verifyArtifact(artifact({ status: "UNKNOWN" }), claim());
  assert.equal(unknown.verified, false);
  assert.ok(unknown.refusals.includes("artifact_status_unknown"));

  // "we could not find out" must not be reported as "we asked and it was no".
  assert.ok(!unknown.refusals.includes("artifact_unverified"));

  // A rejected artifact is its own case too.
  const rejected = verifyArtifact(artifact({ status: "REJECTED" }), claim());
  assert.ok(rejected.refusals.includes("artifact_rejected"));

  // And a missing artifact entirely.
  for (const missing of [null, undefined]) {
    const r = verifyArtifact(missing, claim());
    assert.equal(r.verified, false);
    assert.deepEqual(r.refusals, ["artifact_missing"]);
  }
});

test("S14E-3  a digest mismatch blocks — and a missing/malformed digest is not a mismatch", () => {
  const mismatch = verifyArtifact(artifact({ digest: DIGEST_A }), claim({ digest: DIGEST_B }));
  assert.equal(mismatch.verified, false);
  assert.ok(mismatch.refusals.includes("digest_mismatch"));

  for (const bad of ["", "not-a-digest", "sha256:xyz", "abc123"]) {
    const r = verifyArtifact(artifact({ digest: bad }), claim());
    assert.equal(r.verified, false, `malformed digest "${bad}" was accepted`);
    assert.ok(r.refusals.includes("digest_missing"));
    assert.ok(!r.refusals.includes("digest_mismatch"), "unusable is not the same as mismatched");
  }

  // The sha256: prefix is normalized, not treated as a different digest.
  assert.equal(
    verifyArtifact(artifact({ digest: `sha256:${DIGEST_A}` }), claim({ digest: DIGEST_A })).verified,
    true
  );
});

test("S14E-4  a verified artifact from commit A cannot authorize commit B", () => {
  const r = verifyArtifact(artifact({ commitSha: COMMIT_A }), claim({ commitSha: COMMIT_B }));
  assert.equal(r.verified, false);
  assert.ok(r.refusals.includes("commit_mismatch"));
});

test("S14E-5  a stale artifact from a different build lineage blocks", () => {
  // Same commit, same digest, VERIFIED — but produced by an earlier build.
  // Without the lineage check this would ride along with a newer candidate.
  const r = verifyArtifact(artifact({ buildId: "build-OLD" }), claim({ buildId: "build-NEW" }));
  assert.equal(r.verified, false);
  assert.ok(r.refusals.includes("lineage_mismatch"));
});

// ---------------------------------------------------------------------------
// 6–7. The one path that passes, and what is not an identity
// ---------------------------------------------------------------------------

test("S14E-6  a correct, verified, in-lineage artifact verifies", () => {
  const r = verifyArtifact(artifact(), claim());
  assert.equal(r.verified, true);
  assert.deepEqual(r.refusals, []);
});

test("S14E-7  a PR number alone is insufficient — identity is the digest", () => {
  const src = stripComments(read("src/lib/deployment/artifact-verification.ts"));
  const shape = src.slice(src.indexOf("export interface ArtifactIdentity"), src.indexOf("export interface CandidateClaim"));
  // Neither a PR number nor a filename is part of artifact identity.
  for (const forbidden of ["prNumber", "pullRequest", "filename", "fileName", "name"]) {
    assert.ok(!new RegExp(`readonly ${forbidden}\\b`, "i").test(shape),
      `artifact identity includes "${forbidden}"`);
  }
  assert.match(shape, /readonly digest: string/);

  // Provenance must exist for a VERIFIED artifact: a verified claim with no
  // backing reference is a claim with nothing behind it.
  const noProv = verifyArtifact(artifact({ provenanceRef: undefined }), claim());
  assert.equal(noProv.verified, false);
  assert.ok(noProv.refusals.includes("provenance_missing"));
});

// ---------------------------------------------------------------------------
// 8–10. Authority, deploy actions, Phase 24 boundary
// ---------------------------------------------------------------------------

test("S14E-8  AI cannot forge verified=true — the function derives it, never accepts it", () => {
  const src = stripComments(read("src/lib/deployment/artifact-verification.ts"));
  // `verified` is returned, never read from an input.
  assert.ok(!/input\.verified|claim\.verified|\.verified\s*\?\?/.test(src),
    "verification status is read from an input somewhere");
  // Exactly one place returns a positive verdict, and it is guarded by the
  // refusal list being empty.
  assert.match(src, /verified:\s*refusals\.length === 0/);

  // A forged status on the claim side changes nothing — the claim shape has
  // no status field at all.
  const forged = { ...claim(), status: "VERIFIED", verified: true } as CandidateClaim;
  assert.equal(verifyArtifact(artifact({ status: "UNVERIFIED" }), forged).verified, false);
});

test("S14E-9  no production deploy action was AI-allowlisted by 14-E (Phase 19 registered one, human-approval-gated, never AI)", () => {
  const registry = JSON.parse(read("policies/data/actions.json")) as {
    aiWriteAllowlist: string[];
    actions: Record<string, unknown>;
  };
  assert.deepEqual(registry.aiWriteAllowlist, ["code.pr.create"]);
  for (const a of registeredActions()) {
    if (!/deploy/i.test(a)) continue;
    assert.ok(!registry.aiWriteAllowlist.includes(a), `${a} must never be AI-allowlisted`);
  }
});

test("S14E-10  Phase 24 signing/SBOM is not duplicated here", () => {
  const src = stripComments(read("src/lib/deployment/artifact-verification.ts"));
  for (const pattern of [
    /\bsign\s*\(/i, /privateKey/i, /KMS/i, /cosign/i, /sigstore/i,
    /generateSbom/i, /createAttestation/i, /transparencyLog/i,
  ]) {
    assert.ok(!pattern.test(src), `Phase 24 responsibility duplicated (${pattern})`);
  }
  // It CONSUMES a provenance reference; it does not issue one.
  assert.match(src, /provenanceRef/);
});

// ---------------------------------------------------------------------------
// 11. Neighbouring stages
// ---------------------------------------------------------------------------

test("S14E-11  Phase 14-C and 14-F remain green", async () => {
  const { evaluatePreviewGate } = await import("@/lib/deployment/preview-gate");
  // The C gate still refuses a non-PASSED preview.
  const blocked = evaluatePreviewGate({
    riskClass: "LOW_RISK",
    requiredCheckIds: [],
    checkOutcomes: {},
    previewState: "FAILED",
    previewReadiness: "HEALTHY",
    criticalSecurityAlertOpen: false,
    touchesMigration: false,
    humanApproved: true,
  });
  assert.equal(blocked.prodCandidate, false);

  const { AUTO_REMEDIATION_ALLOWLIST } = await import("@/lib/deployment/remediation-guardrail");
  assert.deepEqual([...AUTO_REMEDIATION_ALLOWLIST], ["dispatcher_pass_failing"]);

  // And no network primitive crept into the module during this stage.
  for (const { path: file, body } of deploymentFiles()) {
    assert.ok(!/\bfetch\s*\(/.test(stripComments(body)), `${file} gained a network call`);
  }
});
