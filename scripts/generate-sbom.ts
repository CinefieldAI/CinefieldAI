/**
 * SBOM generation + dependency vulnerability scan (Phase 24-A).
 *
 * Roadmap 24-A done-criterion: "Build çıktısının dependency risk raporu
 * var" — the build output has a dependency-risk report.
 *
 * ---------------------------------------------------------------------------
 * TWO REAL, OPEN-SOURCE, ZERO-COST TOOLS — NOTHING REINVENTED
 * ---------------------------------------------------------------------------
 * SBOM: `@cyclonedx/cyclonedx-npm` (CycloneDX, the format GitHub Artifact
 * Attestations' own SBOM-attestation predicate expects), reading
 * package-lock.json deterministically — the same lockfile every `npm ci`
 * in this repository's CI already installs from. Dependency scan: `npm
 * audit`, built into npm itself. Neither requires a paid service, an
 * account, or a GitHub Advanced Security tier (unlike GitHub's own
 * Dependency Review feature — see `required-checks.ts`'s
 * `dependency_review` entry for why that one stays deferred instead).
 *
 * Container scanning against Dockerfile.provider-worker is a SEPARATE,
 * CI-only step in supply-chain-ci.yml (needs a Docker daemon this script
 * cannot assume) — not duplicated here.
 *
 * ---------------------------------------------------------------------------
 * REPORTS RISK, DOES NOT GATE ON PRE-EXISTING DEBT
 * ---------------------------------------------------------------------------
 * Roadmap 24-A's own done-criterion is "a dependency-risk report EXISTS",
 * not "zero vulnerabilities". This script exits non-zero only when the
 * SCAN ITSELF fails to run (a real infrastructure/tooling failure) — never
 * because of the vulnerability COUNT it found. A first real run against
 * this repository's current lockfile found pre-existing, unrelated
 * production-dependency vulnerabilities (unconnected to Phase 24 and out
 * of this batch's scope to remediate); hard-blocking every future PR on
 * that count would turn a reporting requirement into an unrelated, breaking
 * migration project nobody asked this batch to do. The count is always
 * printed and always written to audit.json so a human can act on it —
 * silence would be the actual failure mode here, not a non-blocking report.
 *
 * Usage:
 *   npx tsx scripts/generate-sbom.ts               generate + scan, exit
 *                                                   nonzero only if a tool
 *                                                   itself fails
 *   npx tsx scripts/generate-sbom.ts --out <dir>    write sbom.json /
 *                                                   audit.json there
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export interface SbomResult {
  readonly sbomPath: string;
  readonly digest: string;
}

export interface AuditSummary {
  readonly info: number;
  readonly low: number;
  readonly moderate: number;
  readonly high: number;
  readonly critical: number;
  readonly total: number;
}

/**
 * Runs the real CycloneDX generator and writes its JSON output. The digest
 * is computed here, over the bytes actually written — never trusted from
 * the tool's own stdout, so a truncated/corrupted write cannot report a
 * digest for bytes that were never on disk.
 */
export function generateSbom(root: string, outDir: string): SbomResult {
  mkdirSync(outDir, { recursive: true });
  const sbomPath = path.join(outDir, "sbom.json");
  execFileSync(
    "npx",
    ["@cyclonedx/cyclonedx-npm", "--output-format", "json", "--output-file", sbomPath, "--spec-version", "1.5"],
    { cwd: root, stdio: "pipe", shell: true }
  );
  const bytes = readFileSync(sbomPath);
  const digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  return { sbomPath, digest };
}

/**
 * `npm audit --json` exits non-zero the moment any vulnerability exists —
 * that is npm's normal behavior, not a failure of this function, so the
 * non-zero exit is caught and its stdout parsed regardless. Production
 * dependencies only (`--omit=dev`): a dev-only tool's vulnerability does
 * not ship to users, and mixing the two would make every future devDependency
 * addition capable of blocking an unrelated PR's supply-chain check.
 */
export function runDependencyAudit(root: string): AuditSummary {
  let stdout: string;
  try {
    stdout = execFileSync("npm", ["audit", "--omit=dev", "--json"], { cwd: root, encoding: "utf8", shell: true });
  } catch (error) {
    const withStdout = error as { stdout?: string };
    if (typeof withStdout.stdout !== "string") throw error;
    stdout = withStdout.stdout;
  }
  const parsed = JSON.parse(stdout) as { metadata?: { vulnerabilities?: Partial<AuditSummary> } };
  const v = parsed.metadata?.vulnerabilities ?? {};
  return {
    info: v.info ?? 0,
    low: v.low ?? 0,
    moderate: v.moderate ?? 0,
    high: v.high ?? 0,
    critical: v.critical ?? 0,
    total: v.total ?? 0,
  };
}

if (process.argv[1] && process.argv[1].endsWith("generate-sbom.ts")) {
  const outFlagIndex = process.argv.indexOf("--out");
  const outDir = outFlagIndex >= 0 ? process.argv[outFlagIndex + 1] : path.join(process.cwd(), "sbom-out");
  const root = process.cwd();

  try {
    const sbom = generateSbom(root, outDir);
    console.log(`SBOM written: ${sbom.sbomPath}`);
    console.log(`SBOM digest: ${sbom.digest}`);

    const audit = runDependencyAudit(root);
    writeFileSync(path.join(outDir, "audit.json"), JSON.stringify(audit, null, 2));
    console.log(
      `dependency audit (production deps): critical=${audit.critical} high=${audit.high} moderate=${audit.moderate} low=${audit.low} info=${audit.info}`
    );
    if (audit.critical > 0 || audit.high > 0) {
      console.warn(
        `supply chain scan: ${audit.critical} critical / ${audit.high} high production vulnerabilities present — reported, not blocking (see this script's own header for why)`
      );
    } else {
      console.log("supply chain scan: no critical/high production vulnerabilities");
    }
  } catch (error) {
    // The SCAN failing to run is the one thing this reports as a hard
    // failure — a report that silently didn't happen is worse than one
    // that ran and found problems.
    console.error(`supply chain scan: tooling failure — ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
