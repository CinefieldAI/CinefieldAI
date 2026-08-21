import { readFileSync } from "node:fs";
import path from "node:path";

interface SeverityCounts {
  critical: number;
  high: number;
}

interface Baseline {
  schemaVersion: number;
  npmProduction: SeverityCounts;
  providerWorkerImage: SeverityCounts;
}

interface TrivyVulnerability {
  Severity?: string;
}

interface TrivyResult {
  Vulnerabilities?: TrivyVulnerability[] | null;
}

interface TrivyReport {
  Results?: TrivyResult[];
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function countTrivy(report: TrivyReport): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0 };
  for (const result of report.Results ?? []) {
    for (const vulnerability of result.Vulnerabilities ?? []) {
      const severity = vulnerability.Severity?.toUpperCase();
      if (severity === "CRITICAL") counts.critical += 1;
      if (severity === "HIGH") counts.high += 1;
    }
  }
  return counts;
}

function assertNotWorse(
  label: string,
  current: SeverityCounts,
  baseline: SeverityCounts
): boolean {
  const criticalDelta = current.critical - baseline.critical;
  const highDelta = current.high - baseline.high;

  console.log(
    `${label}: current critical=${current.critical} high=${current.high}; ` +
      `baseline critical=${baseline.critical} high=${baseline.high}`
  );

  if (criticalDelta > 0 || highDelta > 0) {
    console.error(
      `::error::${label} vulnerability debt increased: ` +
        `critical delta=${criticalDelta}, high delta=${highDelta}. ` +
        `Do not raise the baseline to make this pass; remediate or explicitly review the new findings.`
    );
    return false;
  }

  if (criticalDelta < 0 || highDelta < 0) {
    console.log(
      `::notice::${label} improved. Lower security/supply-chain-baseline.json in a reviewed follow-up ` +
        `so the improvement becomes the new floor.`
    );
  }

  return true;
}

const root = process.cwd();
const baselinePath = path.join(root, "security", "supply-chain-baseline.json");
const auditPath = path.join(root, "sbom-out", "audit.json");
const trivyPath = path.join(root, "trivy-results.json");

const baseline = readJson<Baseline>(baselinePath);
if (baseline.schemaVersion !== 1) {
  throw new Error(`Unsupported supply-chain baseline schema: ${baseline.schemaVersion}`);
}

const npmAudit = readJson<SeverityCounts & Record<string, number>>(auditPath);
const trivy = readJson<TrivyReport>(trivyPath);
const trivyCounts = countTrivy(trivy);

const npmOk = assertNotWorse(
  "npm production dependencies",
  { critical: npmAudit.critical ?? 0, high: npmAudit.high ?? 0 },
  baseline.npmProduction
);
const imageOk = assertNotWorse(
  "provider-worker image",
  trivyCounts,
  baseline.providerWorkerImage
);

if (!npmOk || !imageOk) {
  process.exitCode = 1;
} else {
  console.log("Supply-chain regression gate passed: CRITICAL/HIGH debt did not increase.");
}
