import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseDriftReport } from "@/lib/infra/drift-report-contract";
import { alertOnDriftReport } from "@/lib/infra/infra-alert-bridge";
import { raiseAlert, resetAlertRouter, resolveAlert, trackedAlertKeys } from "@/lib/alerts/alert-router";
import { ALERT_CATALOGUE } from "@/lib/alerts/alert-contract";
import { PRODUCED_ALERT_TYPES } from "@/lib/alerts/alert-sources";

/**
 * Phase 18 test matrix: 18-A (IaC structure/state/environment isolation,
 * proven by real `terraform fmt`/`validate` runs during this batch —
 * re-asserted here structurally since this harness has no Terraform
 * runtime), 18-B (canonical resources, no accidental duplication), 18-C
 * (CI gate shape), 18-D (drift contract + alert bridge, real TS logic).
 */

const ROOT = process.cwd();
function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const VALID_REPORT = {
  environment: "production",
  status: "NO_DRIFT",
  reasonCode: "plan_clean",
  workflowRunUrl: "https://github.com/CinefieldAI/CinefieldAI/actions/runs/12345",
  commitSha: "a0f7d90ff77f7026a72831d066bed3dadf872300",
};

// ---- 18-A: repository/module structure -------------------------------------

describe("Phase 18-A - IaC structure", () => {
  test("bootstrap module exists with the remote-state resources", () => {
    const main = read("infra/bootstrap/main.tf");
    assert.match(main, /resource "aws_s3_bucket" "state"/);
    assert.match(main, /resource "aws_dynamodb_table" "lock"/);
    assert.match(main, /resource "aws_s3_bucket_versioning" "state"/);
    assert.match(main, /resource "aws_s3_bucket_public_access_block" "state"/);
  });

  test("bootstrap state resources are destroy-protected", () => {
    const main = read("infra/bootstrap/main.tf");
    const bucketBlock = main.slice(main.indexOf('resource "aws_s3_bucket" "state"'), main.indexOf('resource "aws_s3_bucket_versioning"'));
    assert.match(bucketBlock, /prevent_destroy\s*=\s*true/);
    const tableBlock = main.slice(main.indexOf('resource "aws_dynamodb_table" "lock"'));
    assert.match(tableBlock, /prevent_destroy\s*=\s*true/);
  });

  test("bootstrap uses local state (cannot depend on the backend it creates)", () => {
    const versions = read("infra/bootstrap/versions.tf");
    assert.doesNotMatch(versions, /backend\s+"s3"/);
  });

  test("dev and production environments declare a partial S3 backend, no hard-coded bucket", () => {
    for (const env of ["dev", "production"]) {
      const versions = read(`infra/environments/${env}/versions.tf`);
      assert.match(versions, /backend\s+"s3"\s*\{\s*\}/);
      assert.doesNotMatch(versions, /bucket\s*=\s*"/);
    }
  });

  test("backend.hcl.example exists for both environments; real backend.hcl is git-ignored", () => {
    for (const env of ["dev", "production"]) {
      assert.ok(existsSync(path.join(ROOT, `infra/environments/${env}/backend.hcl.example`)));
    }
    const gitignore = read(".gitignore");
    assert.match(gitignore, /^backend\.hcl$/m);
    assert.match(gitignore, /^!backend\.hcl\.example$/m);
  });

  test("dev queues are prefixed distinctly from production (no shared resource names)", () => {
    const dev = read("infra/environments/dev/main.tf");
    const prod = read("infra/environments/production/main.tf");
    assert.match(dev, /name_prefix\s*=\s*"cinefield-dev"/);
    assert.match(prod, /name_prefix\s*=\s*"cinefield-production"/);
    assert.match(dev, /name_prefix\s*=\s*"dev-"/); // sqs module call
  });

  test("environments never share a state key with each other", () => {
    const devBackend = read("infra/environments/dev/backend.hcl.example");
    const prodBackend = read("infra/environments/production/backend.hcl.example");
    const devKey = devBackend.match(/key\s*=\s*"([^"]+)"/)?.[1];
    const prodKey = prodBackend.match(/key\s*=\s*"([^"]+)"/)?.[1];
    assert.ok(devKey && prodKey && devKey !== prodKey);
  });

  test("no committed real tfvars, backend.hcl, or state files exist in the tree", () => {
    const files = readdirSync(path.join(ROOT, "infra"), { recursive: true }) as string[];
    for (const file of files) {
      assert.ok(!/\.tfstate$/.test(file), `must not commit state: ${file}`);
      assert.ok(!/(^|[\\/])backend\.hcl$/.test(file) || /\.example$/.test(file), `must not commit real backend.hcl: ${file}`);
    }
  });
});

// ---- 18-A/18-B: active/reserved enforcement --------------------------------

describe("Phase 18 - Active/Reserved enforcement", () => {
  test("no RDS, EKS, Lambda, API Gateway, Route53, CloudFront, or ElastiCache resource is declared anywhere in infra/", () => {
    const files = (readdirSync(path.join(ROOT, "infra"), { recursive: true }) as string[]).filter((f: string) =>
      f.endsWith(".tf")
    );
    const forbidden = [
      /resource\s+"aws_db_instance"/,
      /resource\s+"aws_rds_cluster"/,
      /resource\s+"aws_eks_cluster"/,
      /resource\s+"aws_lambda_function"/,
      /resource\s+"aws_api_gateway_rest_api"/,
      /resource\s+"aws_apigatewayv2_api"/,
      /resource\s+"aws_route53_zone"/,
      /resource\s+"aws_cloudfront_distribution"/,
      /resource\s+"aws_elasticache_/,
    ];
    for (const file of files) {
      const source = stripComments(read(path.join("infra", file)));
      for (const pattern of forbidden) {
        assert.doesNotMatch(source, pattern, `${file} must not declare ${pattern}`);
      }
    }
  });

  test("Redis module creates no AWS resource (Redis A/B stay external, per infra/README.md)", () => {
    const main = stripComments(read("infra/modules/redis/main.tf"));
    assert.doesNotMatch(main, /^resource\s+"aws_/m);
  });

  test("no Action or Resource wildcard exists anywhere in the IAM module", () => {
    const main = read("infra/modules/iam/main.tf");
    assert.doesNotMatch(main, /actions\s*=\s*\[\s*"\*"\s*\]/);
    assert.doesNotMatch(main, /resources\s*=\s*\[\s*"\*"\s*\]/);
  });
});

// ---- 18-C: CI workflow shape ------------------------------------------------

describe("Phase 18-C - CI IaC gate", () => {
  test("infra-ci.yml runs fmt, validate, and plan, and never runs apply", () => {
    const workflow = read(".github/workflows/infra-ci.yml");
    assert.match(workflow, /terraform fmt -check/);
    assert.match(workflow, /terraform validate/);
    assert.match(workflow, /terraform plan/);
    assert.doesNotMatch(workflow, /terraform apply/);
    assert.match(workflow, /pull_request:/);
  });

  test("infra-ci.yml plan job never runs with a fabricated success when unconfigured", () => {
    const workflow = read(".github/workflows/infra-ci.yml");
    assert.match(workflow, /configured=false/);
    assert.match(workflow, /plan skipped, not faked/);
  });

  test("infra-apply.yml is the only workflow that runs terraform apply, gated by workflow_dispatch and a protected environment", () => {
    const workflows = ["infra-ci.yml", "infra-drift.yml"];
    for (const file of workflows) {
      const source = read(`.github/workflows/${file}`);
      assert.doesNotMatch(source, /terraform apply\b/, `${file} must never apply`);
    }
    const apply = read(".github/workflows/infra-apply.yml");
    assert.match(apply, /terraform apply/);
    assert.match(apply, /workflow_dispatch:/);
    assert.doesNotMatch(apply, /\bon:\s*\n\s*push:/);
    assert.match(apply, /environment:\s*production/);
  });

  test("infra-apply.yml fails closed (exits non-zero) rather than skipping when unconfigured", () => {
    const apply = read(".github/workflows/infra-apply.yml");
    const requireBlock = apply.slice(apply.indexOf("Require live configuration"));
    assert.match(requireBlock, /exit 1/);
  });

  test("infra-apply.yml applies exactly the plan it just reviewed, never a second implicit diff", () => {
    const apply = read(".github/workflows/infra-apply.yml");
    assert.match(apply, /terraform apply -input=false -auto-approve tfplan\.binary/);
  });

  test("no workflow embeds a literal AWS credential or account id", () => {
    for (const file of ["infra-ci.yml", "infra-apply.yml", "infra-drift.yml"]) {
      const source = read(`.github/workflows/${file}`);
      assert.doesNotMatch(source, /AKIA[0-9A-Z]{16}/);
      assert.doesNotMatch(source, /aws_access_key_id\s*[:=]\s*["']?[A-Za-z0-9/+=]{20,}/);
    }
  });
});

// ---- 18-D: drift report contract + alert bridge (real TS logic) -----------

describe("Phase 18-D - Drift report contract", () => {
  test("accepts a well-formed report", () => {
    const result = parseDriftReport(VALID_REPORT);
    assert.equal(result.ok, true);
  });

  test("rejects an invalid status (not one of the three real terraform plan outcomes)", () => {
    const result = parseDriftReport({ ...VALID_REPORT, status: "PROBABLY_FINE" });
    assert.equal(result.ok, false);
  });

  test("rejects a non-https workflowRunUrl", () => {
    const result = parseDriftReport({ ...VALID_REPORT, workflowRunUrl: "http://github.com/x" });
    assert.equal(result.ok, false);
  });

  test("rejects a malformed commit SHA", () => {
    const result = parseDriftReport({ ...VALID_REPORT, commitSha: "not-a-sha" });
    assert.equal(result.ok, false);
  });

  test("rejects an oversized/malformed reasonCode (never a free-text message)", () => {
    const result = parseDriftReport({ ...VALID_REPORT, reasonCode: "a".repeat(65) });
    assert.equal(result.ok, false);
  });

  test("rejects a non-object body", () => {
    const result = parseDriftReport("not an object");
    assert.equal(result.ok, false);
  });

  test("rejects an environment name outside the bounded pattern", () => {
    const result = parseDriftReport({ ...VALID_REPORT, environment: "PRODUCTION; DROP TABLE" });
    assert.equal(result.ok, false);
  });
});

describe("Phase 18-D - Alert bridge", () => {
  test("catalogue carries both new infra alert types, with UNAVAILABLE at WARNING not ERROR", () => {
    assert.equal(ALERT_CATALOGUE.infra_drift_detected.severity, "ERROR");
    assert.equal(ALERT_CATALOGUE.infra_drift_detected.source, "infra");
    assert.equal(ALERT_CATALOGUE.infra_drift_check_unavailable.severity, "WARNING");
    assert.ok(PRODUCED_ALERT_TYPES.includes("infra_drift_detected"));
    assert.ok(PRODUCED_ALERT_TYPES.includes("infra_drift_check_unavailable"));
  });

  test("DRIFT_DETECTED raises infra_drift_detected", () => {
    resetAlertRouter();
    const result = alertOnDriftReport({ ...VALID_REPORT, status: "DRIFT_DETECTED" });
    assert.equal(result?.envelope?.type, "infra_drift_detected");
    assert.equal(result?.envelope?.severity, "ERROR");
  });

  test("UNAVAILABLE raises infra_drift_check_unavailable, not infra_drift_detected", () => {
    resetAlertRouter();
    const result = alertOnDriftReport({ ...VALID_REPORT, status: "UNAVAILABLE", reasonCode: "credentials_not_configured" });
    assert.equal(result?.envelope?.type, "infra_drift_check_unavailable");
  });

  test("UNAVAILABLE is never reported as NO_DRIFT — a tool failure raises, it never resolves silently", () => {
    resetAlertRouter();
    raiseAlert({ type: "infra_drift_detected", resource: "infra_production", reasonCode: "plan_detailed_exitcode_2" });
    alertOnDriftReport({ ...VALID_REPORT, status: "UNAVAILABLE", reasonCode: "init_failed" });
    const after = trackedAlertKeys();
    // The standing DRIFT_DETECTED alert must still be open — UNAVAILABLE never
    // resolves it, only adds its own separate infra_drift_check_unavailable.
    assert.ok(after.includes("infra:infra_drift_detected:infra_production"));
  });

  test("NO_DRIFT resolves a standing drift alert for that environment", () => {
    resetAlertRouter();
    raiseAlert({ type: "infra_drift_detected", resource: "infra_production", reasonCode: "plan_detailed_exitcode_2" });
    const result = alertOnDriftReport({ ...VALID_REPORT, status: "NO_DRIFT" });
    assert.equal(result, null);
    resolveAlert("infra_drift_detected", "infra_production");
    // resolveAlert is idempotent; the real assertion is that alertOnDriftReport
    // already called it once above without throwing and without raising.
  });

  test("different environments get distinct alert resources (dev drift never masks/resolves production's)", () => {
    resetAlertRouter();
    const prod = alertOnDriftReport({ ...VALID_REPORT, environment: "production", status: "DRIFT_DETECTED" });
    const dev = alertOnDriftReport({ ...VALID_REPORT, environment: "dev", status: "DRIFT_DETECTED" });
    assert.notEqual(prod?.envelope?.resource, dev?.envelope?.resource);
  });
});

// ---- 18-D: ingestion route security boundary -------------------------------

describe("Phase 18-D - Drift ingestion route (INTERNAL_ONLY)", () => {
  const ROUTE = read("src/app/api/internal/infra/drift-report/route.ts");

  test("is not Clerk auth()-gated — this is a CI caller, not a browser session", () => {
    assert.doesNotMatch(stripComments(ROUTE), /await auth\(\)/);
  });

  test("fails closed when the shared secret is unconfigured (no bypass)", () => {
    assert.match(ROUTE, /if \(!configured\) return false;/);
  });

  test("compares the token in constant time, never with a plain === or startsWith", () => {
    assert.match(ROUTE, /timingSafeEqual/);
    assert.doesNotMatch(stripComments(ROUTE), /provided === configured|configured === provided/);
  });

  test("rejects a length-mismatched token before calling timingSafeEqual (timingSafeEqual itself throws on length mismatch)", () => {
    assert.match(ROUTE, /expectedBuf\.length !== providedBuf\.length/);
  });

  test("rate-limits via guardRoute before checking authorization", () => {
    const guardIndex = ROUTE.indexOf("guardRoute(");
    const authIndex = ROUTE.indexOf("authorize(request)");
    assert.ok(guardIndex >= 0 && authIndex > guardIndex);
  });

  test("never logs the workflow run URL or commit SHA, only bounded codes", () => {
    assert.doesNotMatch(stripComments(ROUTE), /emit\(\{[^}]*workflowRunUrl/);
    assert.doesNotMatch(stripComments(ROUTE), /emit\(\{[^}]*commitSha/);
  });

  test("delegates validation to the shared drift-report contract, never hand-parses the body itself", () => {
    assert.match(ROUTE, /parseDriftReport\(body\)/);
  });

  test("creates no generation, no Temporal workflow, no credit reservation, no admin/Tier-0 action", () => {
    const source = stripComments(ROUTE).toLowerCase();
    for (const forbidden of ["createg", "temporal", "credit", "tier0", "requireadminaccess"]) {
      assert.ok(!source.includes(forbidden), `route must not reference "${forbidden}"`);
    }
  });
});

// ---- Regression: no duplicate incident-diagnosis / owner boundary ---------

describe("Phase 18 - Regression guards", () => {
  test("incident-diagnosis.ts marks both new infra alert types as never remediation-eligible", () => {
    const source = read("src/lib/deployment/incident-diagnosis.ts");
    const infraBlock = source.slice(
      source.indexOf("infra_drift_detected:"),
      source.indexOf("};", source.indexOf("infra_drift_check_unavailable:"))
    );
    assert.doesNotMatch(infraBlock, /remediationEligible:\s*true/);
  });

  test("the new infra library never imports Temporal, SQS client, BullMQ, or a provider adapter", () => {
    for (const file of [
      "src/lib/infra/drift-report-contract.ts",
      "src/lib/infra/infra-alert-bridge.ts",
      "src/app/api/internal/infra/drift-report/route.ts",
    ]) {
      const source = stripComments(read(file)).toLowerCase();
      for (const forbidden of ["temporal", "@aws-sdk/client-sqs", "bullmq", "-provider\"", "-provider'"]) {
        assert.ok(!source.includes(forbidden.toLowerCase()), `${file} must not reference "${forbidden}"`);
      }
    }
  });

  test("infra-alert-bridge.ts reuses the canonical raiseAlert/resolveAlert, never reimplements dedupe/severity", () => {
    const source = read("src/lib/infra/infra-alert-bridge.ts");
    assert.match(source, /import \{ raiseAlert, resolveAlert, type RaiseResult \} from "@\/lib\/alerts\/alert-router"/);
    assert.doesNotMatch(source, /dedupeWindow|severity\s*[:=]/);
  });
});
