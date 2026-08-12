import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SQS_QUEUES, DEFAULT_AWS_REGION } from "./sqs-topology";

/**
 * Static guards over the Terraform tree (Phase 6R.16).
 *
 * WHY THESE EXIST
 * Neither `terraform` nor `tofu` is installed in the environment this tree
 * was authored in, so `fmt -check` and `validate` never ran. That leaves the
 * IaC unverified by any tool at all — which is exactly the situation in which
 * a security property quietly rots. These tests are not a substitute for
 * `validate` (they parse nothing and check no HCL semantics); they cover the
 * specific properties whose violation would be expensive and silent:
 *
 *   - the Terraform SQS topology drifting from the TypeScript contract the
 *     application actually reads, so a worker long-polls a queue that does
 *     not exist
 *   - a wildcard creeping into an IAM policy
 *   - a credential, account id, or Redis URL landing in a committed file
 *   - the Redis module growing an AWS resource for an instance Redis Cloud
 *     actually owns
 *   - a KMS key becoming Terraform-destroyable
 *
 * Pure filesystem reads. No AWS, no network, no Terraform.
 */

const INFRA = join(process.cwd(), "infra");

function hclFiles(dir = INFRA): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return hclFiles(full);
    return entry.endsWith(".tf") || entry.endsWith(".tfvars.example") ? [full] : [];
  });
}

/** Strips /* *​/ block comments and # / // line comments. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*(#|\/\/).*$/gm, "");
}

const ALL_FILES = hclFiles();
const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => file.slice(INFRA.length + 1).replace(/\\/g, "/");

test("the IaC tree exists and every module in the roadmap scope is present", () => {
  for (const module of ["sqs", "msk", "redis", "ecs", "iam", "kms"]) {
    const main = join(INFRA, "modules", module, "main.tf");
    assert.doesNotThrow(() => statSync(main), `infra/modules/${module}/main.tf is missing`);
  }
  for (const environment of ["dev", "production"]) {
    assert.doesNotThrow(
      () => statSync(join(INFRA, "environments", environment, "main.tf")),
      `infra/environments/${environment}/main.tf is missing`
    );
  }
});

// ---------------------------------------------------------------------------
// 16.4 The queue topology must not drift from the contract the app reads
// ---------------------------------------------------------------------------

test("the Terraform SQS defaults match src/lib/aws/sqs-topology.ts exactly", () => {
  const source = read(join(INFRA, "modules", "sqs", "variables.tf"));

  for (const spec of Object.values(SQS_QUEUES)) {
    assert.ok(
      source.includes(`"${spec.name}"`),
      `${spec.name} is contracted in TypeScript but absent from the Terraform default`
    );
    assert.ok(source.includes(`"${spec.dlqName}"`), `${spec.dlqName} is missing its DLQ declaration`);
    // Drift in these numbers is the silent kind: a visibility timeout shorter
    // than the handler's real runtime produces duplicate deliveries.
    assert.ok(
      new RegExp(`visibility_timeout_seconds\\s*=\\s*${spec.visibilityTimeoutSeconds}\\b`).test(source),
      `${spec.name}: visibility timeout drifted from the TypeScript contract`
    );
  }

  // And nothing extra: an unqueued name here would be a resource nobody reads.
  const declaredNames = [...source.matchAll(/name\s*=\s*"(cinefield-[a-z-]+(?:\.fifo)?)"/g)].map((m) => m[1]);
  // Widened to string: SQS_QUEUES is `as const`, so the inferred Set would be
  // a literal union that rejects the scraped names at compile time.
  const contracted = new Set<string>(
    Object.values(SQS_QUEUES).flatMap((q) => [q.name as string, q.dlqName as string])
  );
  for (const name of declaredNames) {
    assert.ok(contracted.has(name), `${name} is declared in Terraform but not contracted in TypeScript`);
  }
});

test("production pins the same region the application defaults to", () => {
  const source = read(join(INFRA, "environments", "production", "variables.tf"));
  assert.ok(
    source.includes(`default     = "${DEFAULT_AWS_REGION}"`),
    "the production region must match DEFAULT_AWS_REGION"
  );
});

// ---------------------------------------------------------------------------
// 16.8 / 16.13 IAM and secrets
// ---------------------------------------------------------------------------

test("no IAM policy grants a wildcard action or a wildcard resource", () => {
  for (const file of ALL_FILES) {
    const code = stripComments(read(file));
    // `actions = ["*"]` / `resources = ["*"]` in any form.
    assert.ok(
      !/(actions|resources)\s*=\s*\[[^\]]*"\*"[^\]]*\]/.test(code),
      `${rel(file)} grants a wildcard action or resource`
    );
    assert.ok(!/"Action"\s*:\s*"\*"/.test(code), `${rel(file)} grants Action: *`);
    assert.ok(!/"Resource"\s*:\s*"\*"/.test(code), `${rel(file)} grants Resource: *`);
  }
});

test("no committed IaC file contains a credential, a Redis URL, or a real account id", () => {
  for (const file of ALL_FILES) {
    const code = stripComments(read(file));
    assert.ok(!/redis(s)?:\/\//.test(code), `${rel(file)} contains a Redis URL`);
    assert.ok(!/AKIA[0-9A-Z]{16}/.test(code), `${rel(file)} contains an AWS access key id`);
    assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY/.test(code), `${rel(file)} contains a private key`);
    // A bare 12-digit run is an AWS account id. Placeholders spell ACCOUNT.
    assert.ok(!/\b\d{12}\b/.test(code), `${rel(file)} contains what looks like a real AWS account id`);
    assert.ok(
      !/aws_(access|secret)_key\s*=/.test(code),
      `${rel(file)} sets a static AWS credential — the provider chain supplies them`
    );
  }
});

test("only *.tfvars.example is committed, and the examples carry no real values", () => {
  const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
  assert.ok(gitignore.includes("*.tfvars"), "tfvars must be git-ignored");
  assert.ok(gitignore.includes("!*.tfvars.example"), "the example files must stay committed");
  assert.ok(gitignore.includes("*.tfstate"), "state must never be committed");

  for (const file of ALL_FILES.filter((f) => f.endsWith(".tfvars.example"))) {
    const code = stripComments(read(file));
    // Every non-empty placeholder must be visibly a placeholder.
    for (const match of code.matchAll(/=\s*"([^"]+)"/g)) {
      const value = match[1];
      if (value.length === 0) continue;
      assert.ok(
        /REPLACE|ACCOUNT|undecided|eu-central-1/.test(value),
        `${rel(file)} contains a concrete-looking value: ${value.slice(0, 24)}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 16.6 Redis A / B — the property most expensive to get wrong
// ---------------------------------------------------------------------------

test("the Redis module models NO AWS resource - Redis Cloud is not ElastiCache", () => {
  const code = stripComments(read(join(INFRA, "modules", "redis", "main.tf")));
  assert.ok(
    !/resource\s+"aws_elasticache/.test(code),
    "declaring ElastiCache here would claim Terraform owns an instance Redis Cloud actually owns"
  );
  assert.ok(!/resource\s+"aws_/.test(code), "the Redis module must create no AWS resource at all");
});

test("Redis A and Redis B isolation is enforced at plan time, not merely documented", () => {
  const code = stripComments(read(join(INFRA, "modules", "redis", "main.tf")));
  assert.ok(/precondition/.test(code), "the isolation rule is a precondition");
  assert.ok(
    /normalized_a\s*!=\s*local\.normalized_b/.test(code),
    "the precondition must compare the two endpoints"
  );

  // And both environments must actually declare the boundary.
  for (const environment of ["dev", "production"]) {
    const root = read(join(INFRA, "environments", environment, "main.tf"));
    assert.ok(/module\s+"redis"/.test(root), `${environment} must declare the Redis boundary`);
    assert.ok(/redis_b_provider/.test(root), `${environment} must state Redis B's owner explicitly`);
  }
});

test("the Redis endpoint variables refuse a URL or a credential", () => {
  const code = read(join(INFRA, "modules", "redis", "variables.tf"));
  const guards = [...code.matchAll(/redis(?:s)?\(s\)\?:\\\/\\\//g)];
  assert.ok(
    guards.length >= 2 || /can\(regex\(/.test(code),
    "both endpoint variables must validate against URL/credential input"
  );
  assert.equal(
    (code.match(/validation\s*{/g) ?? []).length,
    4,
    "two provider variables and two endpoint variables each carry a validation block"
  );
});

// ---------------------------------------------------------------------------
// 16.9 / 16.11 KMS and remote state
// ---------------------------------------------------------------------------

test("no KMS key is creatable from this tree", () => {
  for (const file of ALL_FILES) {
    const code = stripComments(read(file));
    assert.ok(!/resource\s+"aws_kms_key"/.test(code), `${rel(file)} creates a KMS key`);
    assert.ok(!/resource\s+"aws_kms_alias"/.test(code), `${rel(file)} creates a KMS alias`);
  }
});

test("no backend points at a bucket that does not exist", () => {
  for (const environment of ["dev", "production"]) {
    const code = stripComments(read(join(INFRA, "environments", environment, "versions.tf")));
    assert.ok(
      !/backend\s+"s3"/.test(code),
      `${environment} must not hard-code a remote backend before state ownership is decided`
    );
  }
});

test("the README states plainly that nothing was applied and validation did not run", () => {
  const readme = read(join(INFRA, "README.md"));
  assert.ok(/[Nn]othing here has been applied/.test(readme));
  assert.ok(/were NOT run|not installed/.test(readme), "the unverified-HCL limitation must be stated");
});
