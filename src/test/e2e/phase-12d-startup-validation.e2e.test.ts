import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertStartupConfiguration,
  configurationHealth,
  summarizeRefusal,
} from "@/lib/config/startup-validation";
import { ConfigurationError, validateConfiguration } from "@/lib/config/environment";

/**
 * Phase 12-D defect closure — D12-D2, startup configuration validation.
 *
 * The final gap audit found `assertValidConfiguration()` shipped complete,
 * tested, and called by nothing. Environment separation — the whole of
 * roadmap ¶1645's "environment ayrımı" — was enforced by no code that runs.
 *
 * These tests exist so that cannot happen again quietly. Two kinds:
 *
 *   STRUCTURAL — the guard is present, and it is the FIRST thing each
 *   worker's main() does. A refactor that moves a connection above it fails
 *   here, which is the point: "it is at the top" is exactly the property a
 *   refactor breaks without anyone noticing.
 *
 *   RUNTIME — the workers are actually SPAWNED with an invalid production
 *   configuration, and their exit code, stderr and absence of side-effect log
 *   lines are asserted. A structural test can only prove the call is written;
 *   spawning proves it fires before anything connects.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const WORKERS = [
  {
    file: "worker/temporal-worker.ts",
    runtime: "temporal-worker",
    /** Operations that must not happen before the guard. */
    sideEffects: ["NativeConnection.connect(", "Worker.create(", "readConfig("],
    /** A log line that only appears if the worker got past startup. */
    livenessMarker: "not_configured",
  },
  {
    file: "worker/provider-worker.ts",
    runtime: "provider-worker",
    sideEffects: ["new SQSClient(", "ReceiveMessageCommand(", "readConfig("],
    livenessMarker: "not_configured",
  },
  {
    file: "worker/realtime-dispatcher-worker.ts",
    runtime: "realtime-dispatcher",
    sideEffects: ["getSupabaseAdminClient(", "dispatchRealtimeOnce(", "isSupabaseAdminConfigured("],
    // NOT "refusing to start" — that is the GUARD's own message, and using it
    // as a liveness marker made this test assert that the guard had not run.
    // The dispatcher's own configuration check is the right marker: it sits
    // immediately after the guard, so its absence proves the guard fired
    // first and nothing downstream of it executed.
    livenessMarker: "Supabase admin is not configured",
  },
] as const;

/**
 * An invalid PRODUCTION environment, built from synthetic values.
 *
 * Every one is wrong in a different way, so a worker that starts anyway has
 * ignored more than one rule. The canary appears inside a credential-shaped
 * value; no test asserts on it except to prove it never appears in output.
 */
const CANARY = "CANARY-startup-7c4d9e";
const INVALID_PRODUCTION: Record<string, string> = {
  CINEFIELD_ENV: "production",
  // localhost + plaintext scheme, with a secret embedded.
  REDIS_URL: `redis://default:${CANARY}@localhost:6379`,
  // a development Clerk instance in production
  CLERK_SECRET_KEY: `sk_test_${CANARY}`,
  // a local-only execution bypass present in production
  GENERATION_DIRECT_DEV_EXECUTION: "true",
  // a namespace naming the wrong environment
  TEMPORAL_NAMESPACE: "cinefield-dev.acct",
};

function spawnWorker(file: string, env: Record<string, string>) {
  return spawnSync(
    "npx",
    ["tsx", "--conditions=react-server", file],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: true,
      timeout: 90_000,
      env: { ...process.env, ...env },
    }
  );
}

// ---------------------------------------------------------------------------
// 1–3. Structural: the guard exists, and it is first
// ---------------------------------------------------------------------------

test("1. every long-lived worker calls the startup guard", () => {
  for (const w of WORKERS) {
    const code = stripComments(read(w.file));
    assert.match(
      code,
      /import \{ assertStartupConfiguration \} from "\.\.\/src\/lib\/config\/startup-validation";/,
      `${w.file} does not import the guard`
    );
    assert.match(
      code,
      new RegExp(`assertStartupConfiguration\\("${w.runtime}"\\)`),
      `${w.file} does not call the guard for its own runtime`
    );
  }
});

test("2. the guard runs BEFORE any connection, client or claim", () => {
  for (const w of WORKERS) {
    const code = stripComments(read(w.file));
    const mainAt = code.indexOf("async function main()");
    assert.ok(mainAt > 0, `${w.file}: no main()`);

    const body = code.slice(mainAt);
    const guardAt = body.indexOf("assertStartupConfiguration(");
    assert.ok(guardAt > 0, `${w.file}: the guard is not inside main()`);

    for (const effect of w.sideEffects) {
      const at = body.indexOf(effect);
      if (at < 0) continue;
      assert.ok(at > guardAt, `${w.file}: ${effect} runs BEFORE the startup guard`);
    }
  }
});

test("3. a worker cannot start without the guard — the wiring is not optional", () => {
  // The complement of test 1: if a future refactor deletes the call, test 1
  // fails. If it deletes the MODULE, this fails. Both directions are covered
  // so the control cannot become inert the way it did the first time.
  const guard = stripComments(read("src/lib/config/startup-validation.ts"));
  assert.match(guard, /^import "server-only";/m);
  assert.match(guard, /export function assertStartupConfiguration/);
  assert.match(guard, /assertValidConfiguration\(\)/);

  // No bypass: no flag, no env var, no "warn and continue".
  assert.ok(
    !/SKIP_|DISABLE_|BYPASS|IGNORE_CONFIG|process\.env\.[A-Z_]*VALIDAT/i.test(guard),
    "the guard must have no escape hatch"
  );
  // And it never downgrades the environment to make itself pass.
  //
  // The first version of this assertion matched `environment = ` and so
  // flagged `const environment = resolveEnvironment()` — reading the
  // environment, which is the guard's job. The hazard is ASSIGNING a literal
  // one, or writing back into process.env; that is what is checked now.
  assert.ok(
    !/(environment|CINEFIELD_ENV)\s*=\s*"(development|staging|production)"/.test(guard),
    "the guard must never assign an environment literal"
  );
  assert.ok(!/process\.env\.[A-Z_]+\s*=/.test(guard), "the guard must never write to process.env");
});

// ---------------------------------------------------------------------------
// 4–6. Runtime: the process actually refuses
// ---------------------------------------------------------------------------

for (const w of WORKERS) {
  test(`4.${w.runtime} — refuses startup on an invalid production configuration`, () => {
    const result = spawnWorker(w.file, INVALID_PRODUCTION);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    assert.notEqual(result.status, 0, `${w.file} started with an invalid production config`);
    assert.match(output, /refusing to start/, `${w.file}: no sanitized refusal was printed`);
    assert.match(output, new RegExp(`"runtime":"${w.runtime}"`));
    assert.match(output, /"environment":"production"/);

    // It refused for the RIGHT reasons — the codes, never the values.
    for (const reason of [
      "localhost_in_production",
      "insecure_scheme_in_production",
      "development_instance_in_production",
      "local_only_variable_in_production",
      "environment_mismatch",
    ]) {
      assert.ok(output.includes(reason), `${w.file}: did not report ${reason}`);
    }

    // It never reached its own startup path.
    assert.ok(
      !output.includes("configuration\":\"valid"),
      `${w.file}: reported a valid configuration`
    );
  });
}

test("5. a refused start performs no side effect at all", () => {
  for (const w of WORKERS) {
    const result = spawnWorker(w.file, INVALID_PRODUCTION);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    // No provider call, no Redis publish, no outbox claim, no Temporal poll.
    // Each worker's own post-startup log lines are absent, which is the
    // observable form of "nothing happened".
    for (const marker of [
      "polling",
      "claimed",
      "published",
      "dispatched",
      "submitted",
      "connected",
      "task queue",
      w.livenessMarker,
    ]) {
      assert.ok(
        !output.toLowerCase().includes(marker.toLowerCase()),
        `${w.file}: reached "${marker}" despite an invalid configuration`
      );
    }

    // And no generation, credit or provider mutation is even reachable: the
    // worker exited before constructing a client.
    assert.notEqual(result.status, 0);
  }
});

test("6. nothing about a secret survives into worker output", () => {
  for (const w of WORKERS) {
    const result = spawnWorker(w.file, INVALID_PRODUCTION);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    assert.ok(!output.includes(CANARY), `${w.file}: leaked a secret value`);
    // Not even a fragment — a prefix or a length is still information.
    assert.ok(!output.includes("7c4d9e"), `${w.file}: leaked a secret fragment`);
    assert.ok(!output.includes("sk_test_"), `${w.file}: leaked a credential prefix`);
    assert.ok(!output.includes("redis://"), `${w.file}: leaked a connection URL`);
    assert.ok(!/@localhost:6379/.test(output), `${w.file}: leaked a host from a credential URL`);
  }
});

// ---------------------------------------------------------------------------
// 7–9. Development still works, and the health report says only safe things
// ---------------------------------------------------------------------------

test("7. development and staging start normally", () => {
  // The guard must not be something developers have to disable — a guard with
  // a bypass is a guard that gets bypassed during the incident it exists for,
  // so it has none, which only works if it stays out of the way locally.
  const before = process.env.CINEFIELD_ENV;
  try {
    for (const env of ["development", "staging"]) {
      process.env.CINEFIELD_ENV = env;
      assert.doesNotThrow(() => assertStartupConfiguration("provider-worker"));
    }
  } finally {
    if (before === undefined) delete process.env.CINEFIELD_ENV;
    else process.env.CINEFIELD_ENV = before;
  }
});

test("8. the refusal summary carries codes and counts, never a value", () => {
  const before = { ...process.env };
  try {
    Object.assign(process.env, INVALID_PRODUCTION);
    const validation = validateConfiguration();
    const refusal = summarizeRefusal("temporal-worker", validation.findings);

    assert.equal(refusal.environment, "production");
    assert.ok(refusal.findingCount > 0);
    assert.deepEqual(Object.keys(refusal).sort(), ["environment", "findingCount", "reasons", "runtime"]);

    const text = JSON.stringify(refusal);
    assert.ok(!text.includes(CANARY) && !text.includes("7c4d9e"));
    // Reasons are codes, and there is no variable-value pair anywhere.
    for (const reason of refusal.reasons) assert.match(reason, /^[a-z][a-z0-9_]+$/);

    assert.throws(() => assertStartupConfiguration("temporal-worker"), (e: unknown) => e instanceof ConfigurationError);
  } finally {
    for (const key of Object.keys(INVALID_PRODUCTION)) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test("9. the health report is presence-only and exposes no endpoint", () => {
  const health = configurationHealth();
  assert.deepEqual(
    Object.keys(health).sort(),
    ["configuration", "deferred", "environment", "missingRequiredCount", "reasons"]
  );
  assert.ok(["valid", "invalid"].includes(health.configuration));
  assert.equal(typeof health.missingRequiredCount, "number");
  assert.ok(Array.isArray(health.deferred));

  // Deferred subsystems are named so "missing" is never read as "broken".
  for (const subsystem of ["live-secret-manager", "live-kms"]) {
    assert.ok(health.deferred.includes(subsystem), `${subsystem} must be declared deferred`);
  }

  // Nothing in the shape can hold a value, a URL or a per-variable map.
  const text = JSON.stringify(health);
  assert.ok(!/redis:|rediss:|postgres:|https?:\/\/|sk_|eyJ/.test(text), `health leaked: ${text}`);
  assert.ok(!("present" in (health as unknown as Record<string, unknown>)), "no per-variable map here");

  // No HTTP route exposes it. The roadmap asks for none, and an
  // unauthenticated endpoint enumerating which secrets are missing tells an
  // attacker which subsystem is half-configured.
  const routes = readFileSync(path.join(ROOT, "src/lib/config/startup-validation.ts"), "utf8");
  assert.ok(!/NextResponse|export async function GET|route\.ts/.test(routes));
  const apiUsage = spawnSync("git", ["grep", "-l", "configurationHealth", "--", "src/app"], {
    cwd: ROOT, encoding: "utf8", shell: true,
  });
  assert.equal((apiUsage.stdout ?? "").trim(), "", "configurationHealth must not be wired to a route");
});
