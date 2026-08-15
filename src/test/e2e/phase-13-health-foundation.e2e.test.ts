import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  DEPENDENCY_MATRIX,
  PROBE_TIMEOUT_MS,
  READINESS_BUDGET_MS,
  RUNTIME_NAMES,
  bucketLatency,
  dependencyRule,
  rollUp,
  type DependencyName,
  type DependencyReport,
  type RuntimeName,
} from "@/lib/health/health-contract";
import { DEBT_THRESHOLDS, probeSqs, probeTemporal } from "@/lib/health/dependency-probes";
import { dependencyHealth, isReady, liveness, readiness } from "@/lib/health/health-service";
import { ROUTE_POLICIES } from "@/lib/security/route-rate-limit";
import {
  clearTelemetrySinks,
  registerTelemetrySink,
  setConsoleOutput,
} from "@/lib/observability/logger";
import type { TelemetryEnvelope } from "@/lib/observability/telemetry-contract";

/**
 * Phase 13 health foundation — liveness, readiness, dependency health.
 *
 * These three answer different questions, and conflating them produces the two
 * worst operational failures, one in each direction: a liveness probe that
 * touches a dependency turns a cache blip into a cluster-wide restart storm,
 * and a readiness probe that ignores one routes traffic to a container that
 * accepts work and loses it. Most of this file defends that separation.
 *
 * Roadmap ¶649 / ¶1698 give Better Stack the external uptime role in 13-C.
 * Nothing here contacts it, and no account exists.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CONTRACT = read("src/lib/health/health-contract.ts");
const PROBES = read("src/lib/health/dependency-probes.ts");
const SERVICE = read("src/lib/health/health-service.ts");
const LIVE_ROUTE = read("src/app/api/health/live/route.ts");

function dep(runtime: RuntimeName, name: DependencyName, status: DependencyReport["status"]): DependencyReport {
  return {
    dependency: name,
    status,
    reason: status === "HEALTHY" ? "ok" : "unreachable",
    criticality: dependencyRule(runtime, name)?.criticality ?? "OPTIONAL",
  };
}

// ---------------------------------------------------------------------------
// 1–2. Liveness
// ---------------------------------------------------------------------------

test("1. liveness makes zero external calls — structurally, not by inspection", () => {
  const service = stripComments(SERVICE);
  const body = service.slice(service.indexOf("export function liveness()"), service.indexOf("async function probe("));

  // It is synchronous. A function that cannot await cannot wait on Redis.
  assert.match(body, /export function liveness\(\): LivenessReport \{/);
  assert.ok(!/await|async|probe|redis|supabase|fetch|process\.env/i.test(body), `liveness touches something: ${body}`);

  // And the route neither imports nor reaches a probe.
  const route = stripComments(LIVE_ROUTE);
  assert.ok(!/dependency-probes|readiness|dependencyHealth/.test(route), "the liveness route reaches readiness");
});

test("2. liveness is healthy whenever the process can execute", () => {
  const report = liveness();
  assert.equal(report.status, "HEALTHY");
  assert.deepEqual(Object.keys(report).sort(), ["status", "timestamp"]);
  // No version, no build id, no region, no runtime name — nothing to fingerprint.
  assert.ok(!/version|build|region|runtime|host/i.test(JSON.stringify(report)));
});

// ---------------------------------------------------------------------------
// 3–5. Readiness is per runtime
// ---------------------------------------------------------------------------

test("3. readiness includes configuration, reusing 12-D rather than revalidating", () => {
  for (const runtime of RUNTIME_NAMES) {
    assert.equal(dependencyRule(runtime, "config")?.criticality, "CRITICAL", `${runtime}`);
  }
  // One validator, not two. A second would eventually disagree with the first.
  assert.match(stripComments(PROBES), /configurationHealth\(\)/);
  assert.ok(
    !/validateConfiguration|assertValidConfiguration/.test(stripComments(PROBES)),
    "the probes must not build a second configuration validator"
  );
});

test("4. the web dependency policy is correct, and is not a global rule", () => {
  const web = DEPENDENCY_MATRIX.web;
  assert.equal(web.supabase?.criticality, "CRITICAL");
  assert.equal(web.clerk?.criticality, "CRITICAL");
  // Redis A is an accelerator here, not the job: rate limiting already fails
  // CLOSED on paid paths, which is a degraded product rather than a dead one.
  assert.equal(web["redis-a"]?.criticality, "DEGRADED_ALLOWED");
  assert.equal(web.temporal?.criticality, "DEGRADED_ALLOWED");
  assert.equal(web.sqs?.criticality, "OPTIONAL");

  // The same dependency means different things elsewhere — that is the point.
  assert.equal(DEPENDENCY_MATRIX["realtime-dispatcher"]["redis-a"]?.criticality, "CRITICAL");
  assert.equal(DEPENDENCY_MATRIX["provider-worker"].sqs?.criticality, "CRITICAL");
});

test("5. the realtime dispatcher requires Supabase AND Redis A", () => {
  const d = DEPENDENCY_MATRIX["realtime-dispatcher"];
  assert.equal(d.supabase?.criticality, "CRITICAL");
  assert.equal(d["redis-a"]?.criticality, "CRITICAL", "Redis Streams IS the delivery destination here");

  // A backlog means behind, not broken — reporting UNREADY would stop the only
  // process that can drain it.
  assert.equal(d["realtime-debt"]?.criticality, "DEGRADED_ALLOWED");
  const report = rollUp("realtime-dispatcher", [
    dep("realtime-dispatcher", "config", "HEALTHY"),
    dep("realtime-dispatcher", "supabase", "HEALTHY"),
    dep("realtime-dispatcher", "redis-a", "HEALTHY"),
    dep("realtime-dispatcher", "realtime-debt", "DEGRADED"),
  ]);
  assert.equal(report.status, "DEGRADED");
});

// ---------------------------------------------------------------------------
// 6–11. What a probe must never do
// ---------------------------------------------------------------------------

test("6. no probe makes a paid provider call", () => {
  const probes = stripComments(PROBES);
  assert.ok(!/submitAttempt|getResult|generate|fal\.|openai|replicate/i.test(probes), "a probe reaches a provider");
  // Provider health is READ from the Redis A signal Phase 7/8 already maintain.
  assert.match(probes, /provider-health/);
  assert.ok(!/fetch\(/.test(probes), "no probe performs an outbound HTTP call");
});

test("7. Temporal health starts no workflow", () => {
  const probes = stripComments(PROBES);
  assert.ok(!/workflow\.start|startGenerationWorkflow|client\.workflow/.test(probes));
  // Configuration presence only, and the module says so rather than implying
  // it has proven reachability.
  const report = probeTemporal("web");
  assert.ok(["HEALTHY", "UNKNOWN"].includes(report.status));
  assert.match(PROBES, /reports configuration, and the WORKER answers the polling question/);
});

test("8. SQS health enqueues nothing", () => {
  const probes = stripComments(PROBES);
  assert.ok(!/SendMessage|enqueue\(|SendMessageCommand/.test(probes), "a probe enqueues a command");
  const report = probeSqs("web");
  assert.ok(["HEALTHY", "UNKNOWN"].includes(report.status));
});

test("9. no probe writes a real object to R2 or the DR bucket", () => {
  const probes = stripComments(PROBES);
  assert.ok(!/PutObject|Upload|putObject|createPresigned/.test(probes), "a probe writes an object");
  assert.ok(!/DeleteObject/.test(probes));
});

test("10. a DR failure does not block a runtime that does not own backup", () => {
  for (const runtime of ["web", "temporal-worker", "provider-worker", "realtime-dispatcher", "media-worker"] as const) {
    assert.equal(
      DEPENDENCY_MATRIX[runtime]["s3-dr"]?.criticality,
      "OPTIONAL",
      `${runtime} treats the asynchronous backup lane as blocking`
    );
  }
  // And it IS critical for the one runtime whose job it is.
  assert.equal(DEPENDENCY_MATRIX["dr-worker"]["s3-dr"]?.criticality, "CRITICAL");

  const web = rollUp("web", [dep("web", "config", "HEALTHY"), dep("web", "s3-dr", "UNREADY")]);
  assert.equal(web.status, "HEALTHY", "a DR outage made the web tier unready");
});

test("11. deferred Redis B blocks nothing", () => {
  for (const runtime of RUNTIME_NAMES) {
    assert.equal(DEPENDENCY_MATRIX[runtime]["redis-b"]?.criticality, "DEFERRED", runtime);
  }
  const report = rollUp("provider-worker", [
    dep("provider-worker", "config", "HEALTHY"),
    dep("provider-worker", "sqs", "HEALTHY"),
    dep("provider-worker", "supabase", "HEALTHY"),
    dep("provider-worker", "redis-b", "UNKNOWN"),
  ]);
  assert.equal(report.status, "HEALTHY", "a deferred subsystem affected readiness");
});

// ---------------------------------------------------------------------------
// 12–15. UNKNOWN is not healthy, and nothing sensitive leaves
// ---------------------------------------------------------------------------

test("12. an UNKNOWN critical dependency makes a runtime UNREADY", () => {
  const report = rollUp("web", [
    dep("web", "config", "HEALTHY"),
    dep("web", "supabase", "UNKNOWN"),
    dep("web", "clerk", "HEALTHY"),
  ]);
  assert.equal(report.status, "UNREADY", "'we could not tell' was treated as fine");

  // The same status on a non-critical dependency is only DEGRADED.
  assert.equal(
    rollUp("web", [dep("web", "config", "HEALTHY"), dep("web", "redis-a", "UNKNOWN")]).status,
    "DEGRADED"
  );
});

test("13. a raw error can never reach a health report", () => {
  const probes = stripComments(PROBES);
  // Every catch swallows to a code. No message, no stack, no cause.
  assert.ok(!/\.message|\.stack|String\(error\)|error\)/.test(probes.replace(/catch \{/g, "")),
    "a probe surfaces an error value");
  // The report shape has no field one could travel in.
  const shape = CONTRACT.slice(CONTRACT.indexOf("export interface DependencyReport"), CONTRACT.indexOf("export type LatencyBucket"));
  assert.ok(!/message|error|detail|stack|host|url/i.test(stripComments(shape)), `unsafe field: ${shape}`);
});

test("14. no URL, host or secret can appear in health output", async () => {
  const reports = await dependencyHealth("web");
  const text = JSON.stringify(reports);
  assert.ok(!/https?:\/\/|redis:|rediss:|postgres:|@|sk_|eyJ/.test(text), `health leaked: ${text}`);
  // Latency is a BUCKET, never a precise figure — a precise timing is a side
  // channel and nothing operational needs the resolution.
  for (const r of reports) {
    if (r.latency !== undefined) assert.ok(["fast", "normal", "slow", "timeout"].includes(r.latency));
  }
  assert.equal(bucketLatency(10, 1000), "fast");
  assert.equal(bucketLatency(1000, 1000), "timeout");
});

test("15. only bounded reason codes are reported", async () => {
  const reports = await dependencyHealth("web");
  for (const r of reports) {
    assert.match(r.reason, /^[a-z][a-z0-9_]{1,32}$/, `${r.dependency}: ${r.reason}`);
    assert.ok(["HEALTHY", "DEGRADED", "UNREADY", "UNKNOWN"].includes(r.status));
  }
  // The status vocabulary is closed in the type, not by convention.
  assert.match(CONTRACT, /export type HealthStatus = "HEALTHY" \| "DEGRADED" \| "UNREADY" \| "UNKNOWN";/);
});

// ---------------------------------------------------------------------------
// 16–19. Timeouts, caching, exposure
// ---------------------------------------------------------------------------

test("16. every probe has a timeout and the whole evaluation is bounded", () => {
  const names = new Set<string>();
  for (const runtime of RUNTIME_NAMES) {
    for (const name of Object.keys(DEPENDENCY_MATRIX[runtime])) names.add(name);
  }
  for (const name of names) {
    const budget = PROBE_TIMEOUT_MS[name as DependencyName];
    assert.ok(typeof budget === "number" && budget > 0 && budget <= 2_000, `${name}: ${budget}`);
  }
  assert.ok(READINESS_BUDGET_MS > 0 && READINESS_BUDGET_MS <= 10_000);
  assert.match(stripComments(PROBES), /withTimeout/);
  // No unbounded retry inside a health request.
  assert.ok(!/for \(let attempt|while \(true\)|retry/i.test(stripComments(PROBES)));
});

test("17. the liveness response is never shared-cached", () => {
  const route = stripComments(LIVE_ROUTE);
  assert.match(route, /export const dynamic = "force-dynamic";/);
  assert.match(route, /export const revalidate = 0;/);
  assert.match(route, /privateJson\(/, "must use the private/no-store helper like every other route");
});

test("18. public liveness is minimal and obeys the same route rules", () => {
  const route = stripComments(LIVE_ROUTE);
  assert.match(route, /guardRoute\(\{ routeClass: "public_health"/);
  // The class is anonymous, generous and fails open — a 429 would be read by
  // an uptime monitor as an outage, and Redis must not be able to fail
  // liveness into a restart storm.
  const policy = ROUTE_POLICIES.public_health;
  assert.equal(policy.onUnavailable, "open");
  assert.ok(policy.limit >= 120, "too tight for a scheduled monitor");

  // It exposes nothing about the architecture.
  assert.ok(!/dependency|supabase|redis|temporal|provider|version/i.test(route.replace(/import[^\n]*\n/g, "")));
});

test("19. internal health is richer but has no HTTP route", () => {
  // readiness/dependencyHealth are server-only functions. An unauthenticated
  // readiness endpoint enumerates which subsystem is weakest right now — a map
  // of the architecture plus a list of what to attack. 12-D reached the same
  // conclusion for configurationHealth().
  // Checked as an IMPORT, not as a word. A word search matched
  // `src/app/api/models/route.ts`, whose comment happens to use "readiness" to
  // explain something unrelated — and an assertion that reads prose reports
  // defects that do not exist. What actually matters is whether any route
  // pulls the health service in.
  const routeFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name === "route.ts") routeFiles.push(rel);
    }
  };
  walk("src/app/api");
  assert.ok(routeFiles.length >= 14, "the route scan found nothing");

  for (const file of routeFiles) {
    const code = stripComments(read(file));
    assert.ok(
      !/\breadiness\b|\bdependencyHealth\b|health\/dependency-probes/.test(code),
      `${file} exposes readiness or dependency health over HTTP`
    );
  }
  // The one health route imports liveness and nothing else from the package.
  const liveImports = [...stripComments(LIVE_ROUTE).matchAll(/from "([^"]*health[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(liveImports, ["@/lib/health/health-service"]);
  assert.match(stripComments(LIVE_ROUTE), /import \{ liveness \} from/);

  assert.match(SERVICE, /^import "server-only";/m);
  assert.match(PROBES, /^import "server-only";/m);
  // The pure contract is not server-only: it holds no state and tests read it.
  assert.ok(!/server-only/.test(stripComments(CONTRACT)));
});

// ---------------------------------------------------------------------------
// 20–24. Debt, telemetry, and observational-only
// ---------------------------------------------------------------------------

test("20. debt thresholds are defined centrally and carry no counts outward", async () => {
  assert.ok(DEBT_THRESHOLDS.pendingWarn > 0);
  assert.ok(DEBT_THRESHOLDS.oldestPendingSecondsWarn > 0);
  assert.ok(DEBT_THRESHOLDS.attemptsWarn > 0);

  // A backlog SIZE is operational detail for a metric, not for a health
  // response anyone reachable can read.
  const reports = await dependencyHealth("realtime-dispatcher");
  const debt = reports.find((r) => r.dependency === "realtime-debt");
  assert.ok(debt);
  assert.deepEqual(
    Object.keys(debt).sort().filter((k) => !["latency"].includes(k)),
    ["criticality", "dependency", "reason", "status"]
  );
});

test("21. no worker heartbeat table was invented", () => {
  // A heartbeat would need durable storage, and the roadmap gives Trigger.dev
  // the health/reconciliation role (¶239, ¶669, ¶1136) — a second liveness
  // owner writing rows would be a lifecycle owner nobody asked for. Deferred
  // deliberately, and no migration was created.
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).sort();
  assert.equal(migrations[migrations.length - 1], "20260827000000_policy_decision_evidence.sql");
  // Comments stripped: the contract header QUOTES the roadmap line that gives
  // Better Stack the heartbeat role, and matching prose would report the
  // opposite of the truth.
  assert.ok(
    !/heartbeat/i.test(stripComments(CONTRACT + PROBES + SERVICE)),
    "a heartbeat store was added"
  );
});

test("22. health telemetry is sanitized and carries no dependency detail", async () => {
  const seen: TelemetryEnvelope[] = [];
  setConsoleOutput(false);
  clearTelemetrySinks();
  registerTelemetrySink({ name: "t", emit: (e) => seen.push(e) });
  try {
    await readiness("web");
  } finally {
    clearTelemetrySinks();
    setConsoleOutput(true);
  }
  assert.ok(seen.length >= 1, "readiness emitted no telemetry");
  const text = JSON.stringify(seen);
  assert.ok(!/https?:\/\/|redis:|postgres:|@|sk_/.test(text));
  for (const envelope of seen) {
    assert.equal(envelope.subsystem, "health");
    assert.ok(!("dependencies" in envelope.fields));
  }
});

test("23. a trace id is preserved in health telemetry when a request has one", async () => {
  const { runInTraceScope } = await import("@/lib/observability/trace-scope");
  const { mintTraceContext } = await import("@/lib/observability/trace-context");
  const ctx = mintTraceContext();

  const seen: TelemetryEnvelope[] = [];
  setConsoleOutput(false);
  clearTelemetrySinks();
  registerTelemetrySink({ name: "t", emit: (e) => seen.push(e) });
  try {
    await runInTraceScope(ctx, async () => readiness("media-worker"));
  } finally {
    clearTelemetrySinks();
    setConsoleOutput(true);
  }
  assert.ok(seen.some((e) => e.fields.traceId === ctx.traceId), "the 13-A trace was lost");
});

test("24. a health failure mutates no business state", () => {
  const all = stripComments(CONTRACT + PROBES + SERVICE);
  for (const forbidden of [
    // `settle_` / `settlement`, not a bare `settle` — the service has a local
    // `settled` from Promise.all, and a rule that flags a variable name is a
    // rule people learn to ignore.
    /reserve_credits|settle_|settlement|settleCredits|refund|credit_ledger/i,
    /submitAttempt|startGenerationWorkflow|workflow\.start/i,
    /approve_media_release|reject_media_asset|quarantine/i,
    /requirePolicy|recordSecurityEvent/i,
    /\.insert\(|\.update\(|\.delete\(/,
  ]) {
    assert.ok(!forbidden.test(all), `health reaches business state: ${forbidden}`);
  }
  // The only RPC any probe calls is a read-only aggregate.
  const rpcs = [...PROBES.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(rpcs)], ["realtime_outbox_debt"]);
});

// ---------------------------------------------------------------------------
// 25–30. No external service, and no regression
// ---------------------------------------------------------------------------

test("25–26. no external monitoring service and no paid dependency", () => {
  const all = CONTRACT + PROBES + SERVICE + LIVE_ROUTE;
  assert.ok(!/betterstack|better-stack|datadog|sentry|pingdom|uptimerobot|newrelic/i.test(all));
  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
  assert.ok(
    !Object.keys(pkg.dependencies ?? {}).some((d) => /betterstack|datadog|sentry|otel|opentelemetry/i.test(d))
  );
  assert.ok(!/BETTER_STACK|DATADOG|SENTRY_DSN/.test(read(".env.example")));
});

test("27. no migration was created", () => {
  const status = execFileSync("git", ["status", "--short", "--", "supabase/"], {
    cwd: ROOT, encoding: "utf8", shell: true,
  }).trim();
  assert.equal(status, "", `supabase/ was modified: ${status}`);
});

test("28. readiness answers for every runtime without throwing", async () => {
  for (const runtime of RUNTIME_NAMES) {
    const report = await readiness(runtime);
    assert.equal(report.runtime, runtime);
    assert.ok(["HEALTHY", "DEGRADED", "UNREADY", "UNKNOWN"].includes(report.status));
    assert.ok(Array.isArray(report.dependencies));
    // DEGRADED counts as ready: refusing traffic because a fallback-covered
    // dependency is unwell takes the product down to protect it.
    assert.equal(isReady({ ...report, status: "DEGRADED" }), true);
    assert.equal(isReady({ ...report, status: "UNREADY" }), false);
  }
});

test("29. every runtime and dependency carries a written justification", () => {
  for (const runtime of RUNTIME_NAMES) {
    const rules = DEPENDENCY_MATRIX[runtime];
    assert.ok(Object.keys(rules).length >= 6, `${runtime} declares too few dependencies`);
    for (const [name, rule] of Object.entries(rules)) {
      assert.ok(rule && rule.why.length > 25, `${runtime}/${name} has no real justification`);
    }
  }
  // Exactly one runtime treats the DR bucket as its job.
  const drCritical = RUNTIME_NAMES.filter((r) => DEPENDENCY_MATRIX[r]["s3-dr"]?.criticality === "CRITICAL");
  assert.deepEqual(drCritical, ["dr-worker"]);
});

test("30. the media worker sandbox contract is respected", () => {
  // Red notes ¶327 / ¶1458: no provider secret, no DB credential. A readiness
  // rule demanding either would contradict the security contract the sandbox
  // exists to satisfy.
  const media = DEPENDENCY_MATRIX["media-worker"];
  assert.equal(media.supabase?.criticality, "OPTIONAL");
  assert.equal(media.providers?.criticality, "OPTIONAL");
  assert.equal(media.sqs?.criticality, "OPTIONAL");
  assert.equal(media.r2?.criticality, "CRITICAL", "its one write path");
});
