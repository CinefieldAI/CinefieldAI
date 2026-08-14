import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  FORBIDDEN_SECRET_NAMES,
  PROVIDER_SECRET_NAMES,
  SECRET_REGISTRY,
  SENSITIVE_CLASSES,
  isSensitive,
  secretEntry,
} from "@/lib/config/secret-registry";
import {
  ConfigurationError,
  assertValidConfiguration,
  configurationReport,
  resolveEnvironment,
  unregisteredNames,
  validateConfiguration,
} from "@/lib/config/environment";
import {
  EnvironmentSecretProvider,
  SecretUnavailableError,
  getServerSecret,
  hasServerSecret,
  resetSecretProvider,
  secretProviderKind,
} from "@/lib/config/secret-access";
import { scanFile, scanText } from "../../../scripts/scan-secrets";

/**
 * Phase 12-D — secret and environment security contracts.
 *
 * Roadmap ¶1645 asks for "Secret manager, environment ayrımı, least privilege,
 * KMS/Secrets rotation/leak runbook". ¶1646 is the criterion: "Prod secret
 * repo/local plaintext'te yok ve rotation testli." ¶1686 makes environment
 * separation and per-provider isolation a Phase 8 PRECONDITION, not later
 * work — "provider sayısı 2–3 iken kolay, 10 iken zahmetlidir" (¶1118).
 *
 * The realistic accident this guards against is not a typo. It is a
 * production deployment that inherits a development resource and WORKS: a
 * staging worker writing into production Redis, a preview environment holding
 * a real provider key and spending real money. Each of those passes a health
 * check, so the checks have to be explicit.
 *
 * NO TEST HERE READS A SECRET VALUE. Several set synthetic values into
 * `process.env` to exercise validation, and every one restores what it found.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => {
  try {
    return statSync(path.join(ROOT, rel)).size > 0;
  } catch {
    return false;
  }
};

/** Sets env vars, runs, and restores exactly — including previously-absent keys. */
function withEnv(patch: Record<string, string | undefined>, run: () => void): void {
  const before = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) before.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Every source file, for the boundary scans. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      sourceFiles(rel, acc);
    } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      acc.push(rel);
    }
  }
  return acc;
}

const SRC_FILES = sourceFiles("src").concat(sourceFiles("worker"));
const CLIENT_FILES = SRC_FILES.filter((f) => /^\s*["']use client["']/m.test(read(f)));

/**
 * Production sources — everything the application actually ships.
 *
 * Test files are excluded from the "what does the code read / call" scans for
 * one reason: a test that FORBIDS a symbol has to name it, so scanning the
 * suite for `client-secrets-manager` finds the assertion banning it. The
 * contract being enforced is about shipped code, and scoping to that is
 * honest where an inline ignore marker would not be.
 */
const PRODUCTION_FILES = SRC_FILES.filter((f) => !f.startsWith("src/test/"));

/**
 * Source with comments removed.
 *
 * Every scan below looks for a token in CODE, and a doc comment explaining a
 * rule contains the token it explains — `secret-registry.ts` says "every
 * `process.env.X` must appear here", and the first run of this suite duly
 * reported an unregistered variable named X. Strip the prose; never loosen
 * the pattern.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// 1–3. Environment separation
// ---------------------------------------------------------------------------

test("1. production cannot be reached by a development environment id", () => {
  withEnv({ CINEFIELD_ENV: "development", VERCEL_ENV: "production", NODE_ENV: "production" }, () => {
    // An explicit declaration wins. That matters in the other direction too:
    // a Vercel "preview" may be a real staging deployment.
    assert.equal(resolveEnvironment(), "development");
  });
  withEnv({ CINEFIELD_ENV: "staging" }, () => assert.equal(resolveEnvironment(), "staging"));
  withEnv({ CINEFIELD_ENV: "production" }, () => assert.equal(resolveEnvironment(), "production"));

  // An unrecognised value resolves DOWN, never up: development has the fewest
  // permissions and the most exemptions, so a typo cannot grant anything.
  withEnv({ CINEFIELD_ENV: "prod", VERCEL_ENV: undefined, NODE_ENV: "test" }, () => {
    assert.equal(resolveEnvironment(), "development");
  });
});

test("2. production refuses a localhost or plaintext critical dependency", () => {
  withEnv(
    {
      CINEFIELD_ENV: "production",
      REDIS_URL: "redis://localhost:6379",
      TEMPORAL_ADDRESS: "127.0.0.1:7233",
    },
    () => {
      const v = validateConfiguration();
      const reasons = v.findings.filter((f) => f.variable === "REDIS_URL").map((f) => f.reason);
      assert.ok(reasons.includes("localhost_in_production"));
      assert.ok(reasons.includes("insecure_scheme_in_production"), "redis:// is not TLS — 6R.25");
      assert.ok(
        v.findings.some((f) => f.variable === "TEMPORAL_ADDRESS" && f.reason === "localhost_in_production")
      );
      assert.equal(v.ok, false);
    }
  );

  // Development is deliberately unconstrained: localhost IS what development
  // is, and a validator developers must disable protects nothing.
  withEnv({ CINEFIELD_ENV: "development", REDIS_URL: "redis://localhost:6379" }, () => {
    assert.equal(validateConfiguration().ok, true);
  });
});

test("3. production refuses a development identity instance and a shared Redis", () => {
  withEnv(
    { CINEFIELD_ENV: "production", CLERK_SECRET_KEY: "sk_test_synthetic_fixture_value" },
    () => {
      assert.ok(
        validateConfiguration().findings.some(
          (f) => f.variable === "CLERK_SECRET_KEY" && f.reason === "development_instance_in_production"
        )
      );
    }
  );

  // Red note ¶244 / 6R.25: Redis A is application state, Redis B is BullMQ
  // queue state only. One instance means a queue flush wipes rate-limit
  // counters, connection leases and idempotency records.
  const shared = "rediss://user:pw@shared.example.com:6379";
  withEnv({ CINEFIELD_ENV: "development", REDIS_URL: shared, BULLMQ_REDIS_URL: shared }, () => {
    const v = validateConfiguration();
    assert.ok(v.findings.some((f) => f.reason === "shared_redis_database"));
    assert.equal(v.ok, false, "and it is refused in EVERY environment, not just production");
  });

  withEnv({ CINEFIELD_ENV: "production", TEMPORAL_NAMESPACE: "cinefield-dev.acct" }, () => {
    assert.ok(
      validateConfiguration().findings.some(
        (f) => f.variable === "TEMPORAL_NAMESPACE" && f.reason === "environment_mismatch"
      )
    );
  });
});

// ---------------------------------------------------------------------------
// 4–5. Fail closed, and say nothing
// ---------------------------------------------------------------------------

test("4. a missing production-required secret fails closed", () => {
  withEnv(
    { CINEFIELD_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: undefined, CLERK_SECRET_KEY: undefined },
    () => {
      const v = validateConfiguration();
      assert.ok(v.findings.some((f) => f.variable === "SUPABASE_SERVICE_ROLE_KEY" && f.reason === "missing_required"));
      assert.throws(() => assertValidConfiguration(), (e: unknown) => e instanceof ConfigurationError);
    }
  );

  // A local-only convenience in production is not harmless — one of these
  // bypasses Temporal entirely.
  withEnv({ CINEFIELD_ENV: "production", GENERATION_DIRECT_DEV_EXECUTION: "true" }, () => {
    assert.ok(
      validateConfiguration().findings.some(
        (f) => f.variable === "GENERATION_DIRECT_DEV_EXECUTION" && f.reason === "local_only_variable_in_production"
      )
    );
  });
});

test("5. no secret value ever appears in a finding, an error, or a report", () => {
  const canary = "CANARY-a1b2c3d4e5f6-VALUE";
  withEnv(
    {
      CINEFIELD_ENV: "production",
      REDIS_URL: `redis://user:${canary}@localhost:6379`,
      CLERK_SECRET_KEY: `sk_test_${canary}`,
      GENERATION_DIRECT_DEV_EXECUTION: canary,
    },
    () => {
      const v = validateConfiguration();
      const report = configurationReport();
      let thrown = "";
      try {
        assertValidConfiguration();
      } catch (e) {
        thrown = `${(e as Error).message}|${(e as Error).stack ?? ""}`;
      }

      for (const [what, text] of [
        ["findings", JSON.stringify(v)],
        ["report", JSON.stringify(report)],
        ["error", thrown],
      ] as const) {
        assert.ok(!text.includes(canary), `the ${what} leaked the value`);
        // Not even a fragment: a prefix or a length is still information.
        assert.ok(!text.includes("a1b2c3d4"), `the ${what} leaked a fragment`);
      }

      // The report says presence, never content. ¶2087.
      assert.equal(typeof report.present.SUPABASE_SERVICE_ROLE_KEY, "boolean");
      assert.ok(Object.values(report.present).every((p) => typeof p === "boolean"));
    }
  );
});

// ---------------------------------------------------------------------------
// 6–8. The server-only boundary
// ---------------------------------------------------------------------------

test("6. no client module imports the secret boundary or reads a sensitive variable", () => {
  assert.ok(CLIENT_FILES.length > 20, "the scan must actually be finding client modules");

  for (const file of CLIENT_FILES) {
    const code = codeOnly(read(file));
    assert.ok(
      !/from "@\/lib\/config\/secret-access"|from "@\/lib\/config\/environment"/.test(code),
      `${file} imports a server-only config module`
    );

    for (const match of code.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const name = match[1];
      assert.ok(
        name.startsWith("NEXT_PUBLIC_") || name === "NODE_ENV",
        `${file} reads ${name} in a client module`
      );
    }
  }
});

test("7. only intentionally public variables carry the NEXT_PUBLIC_ prefix", () => {
  for (const entry of SECRET_REGISTRY) {
    if (entry.name.startsWith("NEXT_PUBLIC_")) {
      assert.equal(entry.class, "PUBLIC", `${entry.name} is NEXT_PUBLIC_ but classed ${entry.class}`);
    }
    if (SENSITIVE_CLASSES.has(entry.class)) {
      assert.ok(!entry.name.startsWith("NEXT_PUBLIC_"), `${entry.name} would ship to the browser`);
    }
  }

  // And the guard holds for anything the code actually reads, registered or
  // not — a new NEXT_PUBLIC_ secret must fail here even before it is added
  // to the registry.
  const publicReads = new Set<string>();
  for (const file of PRODUCTION_FILES) {
    for (const m of codeOnly(read(file)).matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) publicReads.add(m[1]);
  }
  for (const name of publicReads) {
    const entry = secretEntry(name);
    assert.ok(entry, `${name} is read but unregistered`);
    assert.equal(entry.class, "PUBLIC", `${name} is public-prefixed but not classed PUBLIC`);
  }

  assert.equal(isSensitive("SUPABASE_SERVICE_ROLE_KEY"), true);
  assert.equal(isSensitive("NEXT_PUBLIC_SUPABASE_URL"), false);
  // An unknown name is treated as sensitive. Failing the safe way costs a
  // refused read; failing the other way copies a secret somewhere.
  assert.equal(isSensitive("SOMETHING_NOBODY_REGISTERED"), true);
});

test("8. the secret boundary and the config modules are server-only", () => {
  for (const rel of [
    "src/lib/config/secret-access.ts",
    "src/lib/config/environment.ts",
  ]) {
    assert.match(read(rel), /^import "server-only";/m, `${rel} is not server-only`);
  }
  // The registry deliberately is NOT server-only: it holds no values, and
  // tests plus tooling need to read it.
  assert.ok(!/import "server-only"/.test(read("src/lib/config/secret-registry.ts")));
  assert.ok(
    !/process\.env/.test(codeOnly(read("src/lib/config/secret-registry.ts"))),
    "the registry must read nothing"
  );
});

// ---------------------------------------------------------------------------
// 9–11. Provider isolation
// ---------------------------------------------------------------------------

test("9. every provider has its own credential name", () => {
  const names = Object.values(PROVIDER_SECRET_NAMES);
  assert.equal(new Set(names).size, names.length, "two providers share a credential");
  assert.ok(names.length >= 10, "the contract must cover the deferred Phase 8 network");

  for (const [provider, name] of Object.entries(PROVIDER_SECRET_NAMES)) {
    const entry = secretEntry(name);
    assert.ok(entry, `${provider}: ${name} is unregistered`);
    assert.ok(
      entry.class === "PROVIDER_SECRET" || entry.class === "IDENTIFIER_NON_SECRET",
      `${provider}: ${name} is classed ${entry.class}`
    );
    assert.equal(entry.group, "provider");
  }
});

test("10. no generic shared provider credential exists anywhere", () => {
  // ¶1686: one compromised CI log must not expose the whole provider network.
  for (const forbidden of FORBIDDEN_SECRET_NAMES) {
    assert.equal(secretEntry(forbidden), undefined, `${forbidden} is registered`);
    for (const file of PRODUCTION_FILES) {
      assert.ok(
        !new RegExp(`process\\.env\\.${forbidden}\\b`).test(codeOnly(read(file))),
        `${file} reads ${forbidden}`
      );
    }
    assert.ok(!new RegExp(`^${forbidden}=`, "m").test(read(".env.example")), `${forbidden} is documented`);
  }

  // And validation refuses one at runtime, in every environment.
  withEnv({ CINEFIELD_ENV: "development", PROVIDER_API_KEY: "x" }, () => {
    assert.ok(validateConfiguration().findings.some((f) => f.reason === "forbidden_variable_name"));
  });
});

test("11. every variable the code reads is registered and documented", () => {
  const read_names = new Set<string>();
  for (const file of PRODUCTION_FILES.concat(["scripts/generate-public-catalog.ts", "trigger.config.ts"])) {
    for (const m of codeOnly(read(file)).matchAll(/process\.env\.([A-Z0-9_]+)/g)) read_names.add(m[1]);
  }
  // PATH and platform-injected names are not Cinefield's contract.
  read_names.delete("PATH");

  const missing = unregisteredNames([...read_names]);
  assert.deepEqual(missing, [], `unregistered variables are read: ${missing.join(", ")}`);

  const example = read(".env.example");
  for (const entry of SECRET_REGISTRY) {
    assert.ok(new RegExp(`^${entry.name}=`, "m").test(example), `${entry.name} is not in .env.example`);
  }
});

// ---------------------------------------------------------------------------
// 12–14. The secret access boundary
// ---------------------------------------------------------------------------

test("12. an unregistered or non-sensitive name cannot be read through the boundary", async () => {
  resetSecretProvider();
  await assert.rejects(
    () => getServerSecret("NOT_IN_THE_REGISTRY"),
    (e: unknown) => e instanceof SecretUnavailableError && e.reason === "not_registered"
  );
  // Not a general process.env wrapper: a bucket name is read directly, so
  // "was this a secret?" stays answerable by reading the call site.
  await assert.rejects(
    () => getServerSecret("AWS_REGION"),
    (e: unknown) => e instanceof SecretUnavailableError && e.reason === "not_sensitive"
  );
  assert.equal(await hasServerSecret("NOT_IN_THE_REGISTRY"), false);
});

test("13. the boundary returns a registered secret and never logs it", async () => {
  resetSecretProvider();
  const canary = "CANARY-boundary-9f8e7d";
  await withEnvAsync({ FAL_KEY: canary }, async () => {
    assert.equal(await getServerSecret("FAL_KEY"), canary);
    assert.equal(await hasServerSecret("FAL_KEY"), true);
  });

  await withEnvAsync({ FAL_KEY: undefined }, async () => {
    let message = "";
    try {
      await getServerSecret("FAL_KEY");
    } catch (e) {
      message = `${(e as Error).message}|${JSON.stringify(e)}`;
    }
    assert.match(message, /secret_unavailable_not_present/);
    assert.ok(message.includes("FAL_KEY"), "the NAME is what an operator needs");
  });

  const code = read("src/lib/config/secret-access.ts");
  assert.ok(!/console\.(log|warn|error|info|debug)/.test(code), "the boundary must not log");
});

test("14. the secret provider interface is ready and makes NO cloud call", () => {
  assert.equal(secretProviderKind(), "environment");
  assert.ok(new EnvironmentSecretProvider().kind === "environment");

  const code = read("src/lib/config/secret-access.ts");
  // CODE_READY, not implemented: writing an AWS provider nobody can run would
  // be the built-but-unwired defect this repo has closed three times.
  assert.ok(!/SecretsManagerClient|GetSecretValueCommand|@aws-sdk\/client-secrets-manager/.test(code));
  assert.ok(!/fetch\(|https:\/\//.test(code), "no network call in the secret boundary");
  assert.match(code, /export interface SecretProvider/);
  assert.match(code, /"aws-secrets-manager"/, "the kind is declared so Phase 25 has one wiring point");

  // No live AWS Secrets Manager or KMS call anywhere in the repository.
  for (const file of PRODUCTION_FILES) {
    const c = codeOnly(read(file));
    assert.ok(!/client-secrets-manager|CreateSecretCommand/.test(c), `${file} calls Secrets Manager`);
    assert.ok(!/client-kms|CreateKeyCommand|GenerateDataKeyCommand/.test(c), `${file} calls KMS`);
  }
});

// ---------------------------------------------------------------------------
// 15–18. Least privilege
// ---------------------------------------------------------------------------

test("15. no IAM policy grants a wildcard action or resource", () => {
  const tf = sourceTerraform();
  assert.ok(tf.length >= 5, "the IAM module must actually be present");
  for (const [file, code] of tf) {
    const bare = code.replace(/^\s*#.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/actions\s*=\s*\[\s*"\*"/.test(bare), `${file} grants Action = *`);
    assert.ok(!/resources\s*=\s*\[\s*"\*"\s*\]/.test(bare), `${file} grants Resource = *`);
    assert.ok(!/"iam:\*"|"s3:\*"|"sqs:\*"|"kms:\*"/.test(bare), `${file} grants a service wildcard`);
  }
});

test("16. each runtime has its own role, and the dispatcher has no AWS grant", () => {
  const iam = read("infra/modules/iam/main.tf");
  for (const role of [
    "execution",
    "provider_worker",
    "temporal_worker",
    "realtime_dispatcher",
    "dr_backup",
    "media_worker",
  ]) {
    assert.match(iam, new RegExp(`resource "aws_iam_role" "${role}"`), `no role for ${role}`);
  }

  // The dispatcher uses PostgreSQL and Redis — neither is an AWS service — so
  // it gets a role with no inline policy at all.
  assert.ok(
    !/aws_iam_role_policy" "realtime_dispatcher"/.test(iam),
    "the realtime dispatcher must not be granted AWS permissions"
  );
});

test("17. the DR worker cannot delete, and the media worker holds no secrets", () => {
  const iam = read("infra/modules/iam/main.tf");
  const dr = iam.slice(iam.indexOf('data "aws_iam_policy_document" "dr_backup"'), iam.indexOf('resource "aws_iam_role" "media_worker"'));
  assert.ok(!/s3:DeleteObject|s3:DeleteBucket/.test(dr), "DR backup must not be able to delete");
  assert.match(dr, /s3:PutObject/);
  assert.ok(!/sqs:|kafka-cluster:/.test(dr), "a backup job must not be able to enqueue work");

  const media = iam.slice(iam.indexOf('data "aws_iam_policy_document" "media_worker"'));
  assert.ok(!/sqs:/.test(media), "6R.22: the media worker gets no queue rights");
  assert.ok(!/s3:ListBucket/.test(media), "a compromised parser must not enumerate objects");

  // Red notes ¶327 / ¶1458: the sandbox's secret half, written as a matrix.
  const matrix = read("docs/security/least-privilege.md");
  assert.match(matrix, /Secret injection matrix/);
  assert.match(matrix, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(matrix, /Provider keys/);
  // The two refusals the red notes demand are marked, not implied.
  const mediaColumn = matrix.split("\n").filter((l) => l.includes("SUPABASE_SERVICE_ROLE_KEY") || l.includes("Provider keys"));
  assert.equal(mediaColumn.length, 2);
  for (const row of mediaColumn) assert.match(row, /\*\*✗\*\*/, `no explicit refusal in: ${row}`);
});

test("18. no long-lived AWS access key is expected in a deployment", () => {
  // Production uses task roles, which rotate themselves. A stored key would
  // be a finding, so neither the registry nor .env.example offers one.
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) {
    assert.equal(secretEntry(name), undefined, `${name} is registered as expected configuration`);
  }
  assert.match(read("docs/runbooks/secret-rotation.md"), /Should not exist/i);
});

// ---------------------------------------------------------------------------
// 19–21. Runbooks and scanning
// ---------------------------------------------------------------------------

test("19. a rotation procedure exists for every rotatable credential class", () => {
  const runbook = read("docs/runbooks/secret-rotation.md");
  for (const step of ["Create", "Deploy", "Validate", "Revoke", "Verify", "Record"]) {
    assert.match(runbook, new RegExp(`\\*\\*${step}\\*\\*`), `the runbook has no ${step} step`);
  }
  // Every secret that can be rotated is named in it.
  for (const entry of SECRET_REGISTRY) {
    if (entry.rotation === "NOT_A_SECRET") continue;
    if (entry.class === "PUBLIC" || entry.class === "LOCAL_ONLY") continue;
    if (entry.group === "provider") continue; // covered as a class, deliberately
    assert.ok(runbook.includes(entry.name), `${entry.name} has no rotation entry`);
  }
  // Overlap is claimed only where the issuer supports it, and the honest
  // default is a cut-over window.
  assert.match(runbook, /cut-over/i);
  assert.match(runbook, /conservative on\s*\n?\*\*|conservative/i);
});

test("20. a leak runbook exists and names every phase and leak type", () => {
  const runbook = read("docs/runbooks/secret-leak.md");
  for (const phase of ["CONTAIN", "ROTATE", "REVOKE", "AUDIT", "REDEPLOY", "VERIFY"]) {
    assert.ok(runbook.includes(phase), `the runbook has no ${phase} phase`);
  }
  for (const kind of [
    "Provider API key",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CLERK_SECRET_KEY",
    "REDIS_URL",
    "TEMPORAL_API_KEY",
    "Accidental Git commit",
    "Vercel environment variable",
  ]) {
    assert.ok(runbook.includes(kind), `no procedure for: ${kind}`);
  }
  // Removing a commit is not a fix, and the runbook has to say so.
  assert.match(runbook, /does not undo the exposure/i);
});

test("21. the secret scanner detects real shapes and clears a synthetic control", () => {
  const dir = "src/test/fixtures/secret-scan";
  for (const [fixture, rule] of [
    ["leaky-aws.txt", "aws_access_key_id"],
    ["leaky-jwt.txt", "jwt"],
    ["leaky-redis.txt", "redis_url_with_credentials"],
    ["leaky-pem.txt", "private_key_pem"],
  ] as const) {
    const findings = scanFile(path.join(ROOT, dir, fixture));
    assert.ok(findings.length > 0, `${fixture} was not detected`);
    assert.ok(findings.some((f) => f.rule === rule), `${fixture}: expected rule ${rule}`);
  }
  assert.deepEqual(scanFile(path.join(ROOT, dir, "clean.txt")), []);

  // RFC 2606 reserved names cannot be real hosts, so a credential aimed at
  // one is a fixture by definition. Narrowing the rule this way keeps real
  // leaks in test files visible — a path exemption would not.
  assert.equal(scanText("t", "redis://u:pw@shared.example.com:6379").length, 0);
  assert.equal(scanText("t", "redis://u:pw@prod-cache.internal:6379").length, 1);

  // And the whole tracked tree is clean today.
  const repo = execFileSync("npx", ["tsx", "scripts/scan-secrets.ts"], {
    cwd: ROOT, encoding: "utf8", shell: true,
  });
  assert.match(repo, /no matches in tracked files/);
  // It must not oversell itself.
  assert.match(repo, /not proof of absence/);
});

// ---------------------------------------------------------------------------
// 22–25. Local development, and the blast radius of this batch
// ---------------------------------------------------------------------------

test("22. .env.local is ignored, untracked, and never copied into docs", () => {
  assert.match(read(".gitignore"), /^\.env\*$/m);
  assert.match(read(".gitignore"), /^!\.env\.example$/m);

  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/);
  assert.ok(!tracked.includes(".env.local"), ".env.local is TRACKED");
  assert.ok(tracked.includes(".env.example"), ".env.example must be tracked");

  const ignored = execFileSync("git", ["check-ignore", "-q", ".env.local"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(ignored, "", "git check-ignore should exit 0 with no output");

  // .env.example documents names and nothing else — no value, no placeholder
  // that looks like a credential.
  for (const line of read(".env.example").split(/\r?\n/)) {
    if (line.startsWith("#") || line.trim() === "") continue;
    assert.match(line, /^[A-Z0-9_]+=$/, `.env.example carries a value: ${line}`);
  }
});

test("23. local development still works without any production-only secret", () => {
  withEnv(
    {
      CINEFIELD_ENV: "development",
      REDIS_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      CLERK_SECRET_KEY: undefined,
      TEMPORAL_API_KEY: undefined,
    },
    () => {
      const v = validateConfiguration();
      assert.equal(v.ok, true, "development must not require production secrets");
      assert.doesNotThrow(() => assertValidConfiguration());
    }
  );
});

test("24. the production contract is documented and claims nothing live", () => {
  const gates = read("docs/security-gates.md");
  assert.match(gates, /Phase 12-D/);
  assert.match(gates, /DEFERRED_EXTERNAL_INFRA/);
  // Live infrastructure must not be claimed complete.
  assert.ok(!/LIVE_SECRET_MANAGER:\s*(PASS|COMPLETE|ACTIVE)/.test(gates));
  assert.ok(exists("docs/runbooks/secret-rotation.md"));
  assert.ok(exists("docs/runbooks/secret-leak.md"));
  assert.ok(exists("docs/security/least-privilege.md"));
});

test("25. 12-D touched no other phase's boundary", () => {
  for (const rel of [
    "src/lib/config/environment.ts",
    "src/lib/config/secret-access.ts",
    "src/lib/config/secret-registry.ts",
  ]) {
    const bare = read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/reserve_credits|settle|refund|credit_ledger|stripe\./i.test(bare), `${rel} touches Phase 10`);
    assert.ok(!/submitAttempt|getResult|adapter\./i.test(bare), `${rel} touches provider execution`);
    assert.ok(!/emit_outbox_event|publishNotification/i.test(bare), `${rel} touches the event path`);
  }
  // Phase 10 has no live variables: the two Stripe names are DEFERRED and
  // nothing reads them.
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SIGNING_SECRET"]) {
    assert.equal(secretEntry(name)?.requirement, "DEFERRED");
    for (const file of PRODUCTION_FILES) {
      assert.ok(!new RegExp(`process\\.env\\.${name}`).test(codeOnly(read(file))), `${file} reads ${name}`);
    }
  }
});

/** Async twin of withEnv. */
async function withEnvAsync(patch: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const before = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) before.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function sourceTerraform(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".tf")) out.push([rel, read(rel)]);
    }
  };
  walk("infra");
  return out;
}
