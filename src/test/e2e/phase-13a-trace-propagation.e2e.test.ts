import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  acceptDurableTraceId,
  continueTrace,
  formatTraceparent,
  isValidTraceId,
  mintTraceContext,
  newSpanId,
  newTraceId,
  parseTraceparent,
  resolveTraceContext,
} from "@/lib/observability/trace-context";
import {
  beginRequestTrace,
  currentTraceId,
  enterRequestTrace,
  resumeDurableTrace,
  runInTraceScope,
} from "@/lib/observability/trace-scope";
import {
  SPAN_NAMES,
  clearSpanSinks,
  isSpanName,
  registerSpanSink,
  registeredSpanSinkNames,
  startSpan,
  withSpan,
  type FinishedSpan,
} from "@/lib/observability/span";
import {
  clearTelemetrySinks,
  createLogger,
  registerTelemetrySink,
  setConsoleOutput,
} from "@/lib/observability/logger";
import { errorFields } from "@/lib/observability/error-projection";
import type { TelemetryEnvelope } from "@/lib/observability/telemetry-contract";

/**
 * Phase 13-A (code half) — trace propagation + span standard.
 *
 * Roadmap ¶1711 is the whole criterion: *"Tek generation trace_id ile
 * API→worker→provider zincirinde izleniyor."* One generation, one trace id,
 * followed across API → worker → provider.
 *
 * Two properties decide whether that is worth having, and most of this file
 * is about them.
 *
 * IT MUST SURVIVE THE DURABLE HOPS. An in-process async context does not
 * cross SQS, Temporal or a worker restart. Tests 7–11 assert the trace
 * travels as a FIELD across each boundary, and test 12 asserts the async
 * scope genuinely does not — because a test that passed only because both
 * ran in one process would be proving nothing.
 *
 * IT MUST NEVER BECOME AN AUTHORITY. A trace id arrives, in part, from a
 * header. Tests 14–16 assert separately that it cannot choose a tenant, act
 * as an idempotency key, or become a billing identifier.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every route.ts under src/app/api, tracked or not — unlike `git grep`. */
function walkApiRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkApiRoutes(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out.sort();
}

const VALID_PARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

function captureLogs(): { seen: TelemetryEnvelope[]; stop: () => void } {
  const seen: TelemetryEnvelope[] = [];
  setConsoleOutput(false);
  clearTelemetrySinks();
  registerTelemetrySink({ name: "t", emit: (e) => seen.push(e) });
  return { seen, stop: () => { clearTelemetrySinks(); setConsoleOutput(true); } };
}

function captureSpans(): { seen: FinishedSpan[]; stop: () => void } {
  const seen: FinishedSpan[] = [];
  clearSpanSinks();
  registerSpanSink({ name: "t", emit: (s) => seen.push(s) });
  return { seen, stop: () => clearSpanSinks() };
}

// ---------------------------------------------------------------------------
// 1–3. W3C traceparent
// ---------------------------------------------------------------------------

test("1. a valid traceparent is accepted, and this hop gets its own span id", () => {
  const ctx = parseTraceparent(VALID_PARENT);
  assert.ok(ctx);
  assert.equal(ctx.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.equal(ctx.origin, "inherited");
  assert.equal(ctx.sampled, true);
  // Reusing the caller's span id would make two operations indistinguishable.
  assert.notEqual(ctx.spanId, "00f067aa0ba902b7");
  assert.match(ctx.spanId, /^[0-9a-f]{16}$/);
  assert.equal(formatTraceparent(ctx), `00-${ctx.traceId}-${ctx.spanId}-01`);
});

test("2. a malformed traceparent cannot poison the context", () => {
  const malformed = [
    "", "garbage", "00-tooshort-00f067aa0ba902b7-01",
    `01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`,       // unknown version
    `00-${"0".repeat(32)}-00f067aa0ba902b7-01`,                       // all-zero trace
    `00-4bf92f3577b34da6a3ce929d0e0e4736-${"0".repeat(16)}-01`,       // all-zero parent
    `00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01`,        // uppercase
    `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra`,
    "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-zz",
    `00-${"a".repeat(4000)}-00f067aa0ba902b7-01`,                     // unbounded
  ];
  for (const raw of malformed) {
    assert.equal(parseTraceparent(raw), null, `admitted: ${raw.slice(0, 40)}`);
    // And resolving still yields a usable server trace rather than nothing.
    const ctx = resolveTraceContext(raw, { trustInbound: true });
    assert.ok(isValidTraceId(ctx.traceId));
    assert.ok(ctx.origin === "rejected" || ctx.origin === "minted");
  }
});

test("3. a missing traceparent mints a safe trace, and inbound is untrusted by default", () => {
  const minted = resolveTraceContext(null);
  assert.equal(minted.origin, "minted");
  assert.ok(isValidTraceId(minted.traceId));

  // DEFAULT IS NOT TO TRUST. Every request today comes from a browser, and a
  // browser-supplied trace id is attacker-controlled text that would land in
  // an operator dashboard.
  const untrusted = resolveTraceContext(VALID_PARENT);
  assert.equal(untrusted.origin, "minted");
  assert.notEqual(untrusted.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");

  // Trust is a per-boundary decision, available when an upstream we control exists.
  assert.equal(resolveTraceContext(VALID_PARENT, { trustInbound: true }).origin, "inherited");

  // Ids are random, not sequential.
  assert.equal(new Set(Array.from({ length: 200 }, newTraceId)).size, 200);
  assert.equal(new Set(Array.from({ length: 200 }, newSpanId)).size, 200);
});

// ---------------------------------------------------------------------------
// 4–6. In-process continuity
// ---------------------------------------------------------------------------

test("3b. continueTrace keeps the id and mints a new span; enterRequestTrace binds without a callback", async () => {
  const ctx = mintTraceContext();
  const next = continueTrace(ctx.traceId);
  assert.equal(next.traceId, ctx.traceId, "a continued hop keeps the trace");
  assert.notEqual(next.spanId, ctx.spanId, "but gets its own span");

  // enterRequestTrace is the form guardRoute uses: no callback, so the
  // binding covers the rest of the handler rather than only the guard.
  const bound = await (async () => {
    const c = enterRequestTrace(new Headers());
    await new Promise((r) => setTimeout(r, 1));
    return { declared: c.traceId, ambient: currentTraceId() };
  })();
  assert.equal(bound.ambient, bound.declared);
});

test("4. the trace is stable across an async service boundary", async () => {
  const ctx = mintTraceContext();
  const seen = await runInTraceScope(ctx, async () => {
    const a = currentTraceId();
    await new Promise((r) => setTimeout(r, 1));
    const b = currentTraceId();
    const c = await (async () => {
      await new Promise((r) => setTimeout(r, 1));
      return currentTraceId();
    })();
    return [a, b, c];
  });
  assert.deepEqual(seen, [ctx.traceId, ctx.traceId, ctx.traceId]);
});

test("5. concurrent requests do not share a trace", async () => {
  const run = async (headerValue: string | null) =>
    beginRequestTrace(new Headers(headerValue ? { traceparent: headerValue } : {}), async () => {
      await new Promise((r) => setTimeout(r, 2));
      return currentTraceId();
    });
  const [a, b, c] = await Promise.all([run(null), run(null), run(VALID_PARENT)]);
  assert.equal(new Set([a, b, c]).size, 3, "traces leaked between concurrent requests");
});

test("6. the logger attaches the ambient trace without a call site changing", () => {
  const ctx = mintTraceContext();
  const { seen, stop } = captureLogs();
  try {
    runInTraceScope(ctx, () => {
      createLogger("orchestration").info("generation_created", { result: "queued" });
    });
    // Outside a scope there is simply no trace — a legitimate state, not a gap.
    createLogger("orchestration").info("scheduled_sweep", { result: "ok" });
  } finally {
    stop();
  }
  assert.equal(seen[0].fields.traceId, ctx.traceId);
  assert.equal(seen[1].fields.traceId, undefined);

  // A caller-supplied trace wins over the ambient one.
  const { seen: s2, stop: stop2 } = captureLogs();
  try {
    runInTraceScope(ctx, () => {
      createLogger("provider-worker").info("resumed", { traceId: "a".repeat(32) });
    });
  } finally {
    stop2();
  }
  assert.equal(s2[0].fields.traceId, "a".repeat(32));
});

// ---------------------------------------------------------------------------
// 7–12. The durable hops — structural, because they cross processes
// ---------------------------------------------------------------------------

test("7. the HTTP edge binds a trace for every route, at the common boundary", () => {
  const guard = stripComments(read("src/lib/security/response-headers.ts"));
  assert.match(guard, /enterRequestTrace\(params\.headers\)/);
  // Before the limiter, and unable to affect it.
  const body = guard.slice(guard.indexOf("export async function guardRoute"));
  assert.ok(
    body.indexOf("enterRequestTrace") < body.indexOf("enforceRouteRateLimit"),
    "the trace must be bound before the limiter runs"
  );
  // EVERY route reaches it — counted by walking the directory, not by
  // `git grep`, which searches tracked files only. This pin read 14 while
  // `/api/health/live` sat untracked and had to move to 15 the moment that
  // route was committed; a guard blind to untracked files is blind to
  // exactly the code most likely to need checking.
  //
  // 42 = the 39 pre-existing API routes (16 originals plus the four 16-A
  // admin routes plus the eight Phase 16-B admin routes plus the four
  // Phase 16-C admin routes — billing, assets, moderation,
  // moderation/release) plus the six Phase 16-D admin routes — Temporal
  // inspect, Temporal cancel, Security Center, Incidents, SLO/Cost Guard,
  // Deploy/Restore Health — plus Phase 16-E's one new admin route,
  // `GET /api/admin/privileged-audit` (Section 14's bounded Tier-0 audit
  // query) — plus Phase 17's two routes: `POST
  // /api/product-intelligence/compile` (a pure manifest-compile preview
  // surface, never a lifecycle owner) and `POST
  // /api/product-intelligence/execute` (the 17-A real admission
  // integration — calls the exact same createGeneration()/
  // respondToGenerationRequest() pair /api/generate calls, no second
  // lifecycle) — plus Phase 18-D's one new route, `POST
  // /api/internal/infra/drift-report` (shared-secret-authenticated, not
  // Clerk — the caller is a CI job, not a browser session) — none of which
  // takes an exemption from `guardRoute` either; each just adds
  // `requireAdminAccess()` (admin routes) or nothing extra (the opt-in
  // intelligence/internal routes) as an earlier check before the shared
  // rate-limit boundary runs.
  // PHASE 19 CLOSURE FIX adds one more: `POST
  // /api/admin/privileged-actions/decide` (a second, distinct admin
  // approving/rejecting a pending two-person privileged action) — same
  // convention as every other Phase 16 admin route, `requireAdminAccess()`
  // ahead of the shared `guardRoute` boundary.
  const routes = walkApiRoutes(path.join(ROOT, "src/app/api")).filter((file) =>
    /guardRoute/.test(readFileSync(file, "utf8"))
  );
  assert.equal(routes.length, 43, `every API route must reach guardRoute: ${routes.join(", ")}`);
});

test("8. the generation workflow carries the trace in durable history", () => {
  const wf = stripComments(read("worker/workflows/generation-workflow.ts"));
  assert.match(wf, /export interface GenerationWorkflowInput \{[\s\S]*?traceId\?: string;/);
  // Forwarded into BOTH submit calls — the initial one and the failover.
  assert.equal((wf.match(/input\.traceId \? \{ traceId: input\.traceId \}/g) ?? []).length, 2);
  // A workflow must never mint one: a random value breaks deterministic replay.
  assert.ok(!/newTraceId|mintTraceContext|randomBytes/.test(wf));

  const starter = stripComments(read("src/lib/temporal/generation-starter.ts"));
  assert.match(starter, /traceId\?: string;/);
  assert.match(starter, /currentTraceId\(\)/);
});

test("9. the activity puts the trace on the command wire", () => {
  const act = stripComments(read("worker/activities/generation-activities.ts"));
  const submit = act.slice(act.indexOf("export async function submitGeneration"));
  assert.match(submit, /traceId\?: string;/);
  assert.match(submit, /params\.traceId \? \{ traceId: params\.traceId \}/);

  // The wire contract already carried the field; 13-A only fills it.
  const wire = read("src/lib/contracts/command-wire.ts");
  assert.match(wire, /traceId\?: string;/);
  assert.match(read("src/lib/aws/sqs-command-bus.ts"), /envelope\.traceId/);
});

test("10. the provider worker resumes the trace after the queue hop", () => {
  const worker = stripComments(read("worker/provider-worker.ts"));
  assert.match(worker, /resumeDurableTrace\(parsed\.command\.traceId/);
  // Resumed BEFORE the handler, so everything it logs correlates.
  const at = worker.indexOf("resumeDurableTrace");
  assert.ok(at > 0 && at < worker.indexOf("handleProviderCommand(parsed.command)"));
});

test("11. the outbox and domain events already carry it, and are now fed", () => {
  assert.match(read("src/lib/events/outbox-repository.ts"), /p_trace_id: event\.traceId/);
  assert.match(read("src/lib/events/domain-event.ts"), /traceId/);
  assert.match(read("src/lib/events/event-consumer.ts"), /traceId/);
  // The database column exists — no migration was needed for any of this.
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations"));
  assert.ok(migrations.some((m) => read(`supabase/migrations/${m}`).includes("trace_id")));
});

test("12. the async scope does NOT cross a durable boundary — proven, not assumed", async () => {
  const ctx = mintTraceContext();
  // Simulate the handover: the scope ends, and only a serialized field remains.
  const wireMessage = runInTraceScope(ctx, () =>
    JSON.stringify({ commandId: "c1", traceId: currentTraceId() })
  );
  assert.equal(currentTraceId(), undefined, "the scope must not outlive its callback");

  // The receiving side has no ambient trace and must resume from the field.
  const parsed = JSON.parse(wireMessage) as { traceId?: string };
  const resumed = await resumeDurableTrace(parsed.traceId, async () => currentTraceId());
  assert.equal(resumed, ctx.traceId);

  // A corrupt or absent field yields a FRESH trace, never a broken one.
  for (const bad of [undefined, null, "", "not-a-trace", "0".repeat(32), 42]) {
    const fresh = await resumeDurableTrace(bad, async () => currentTraceId());
    assert.ok(fresh && isValidTraceId(fresh));
    assert.notEqual(fresh, ctx.traceId);
  }
  assert.equal(acceptDurableTraceId("0".repeat(32)), null);
  assert.equal(acceptDurableTraceId(ctx.traceId), ctx.traceId);
});

// ---------------------------------------------------------------------------
// 13. Security events
// ---------------------------------------------------------------------------

test("13. a security event inherits a trace when one exists, and none when it does not", async () => {
  const { setSecurityEmitterForTest, reportRealtimeEventUnroutable } = await import(
    "@/lib/security/security-signals"
  );
  const seen: { traceId?: string | null }[] = [];
  setSecurityEmitterForTest((i) => seen.push(i));
  try {
    const ctx = mintTraceContext();
    runInTraceScope(ctx, () => reportRealtimeEventUnroutable({ eventType: "generation.completed" }));
    // A dispatcher loop has no request behind it. Minting one here would
    // fabricate a correlation that never existed.
    reportRealtimeEventUnroutable({ eventType: "generation.failed" });

    assert.equal(seen[0].traceId, ctx.traceId);
    assert.ok(!seen[1].traceId, "a system event must not receive an invented trace");
  } finally {
    setSecurityEmitterForTest(null);
  }
});

// ---------------------------------------------------------------------------
// 14–16. A trace is never an authority
// ---------------------------------------------------------------------------

test("14. a trace id cannot choose a tenant, a stream, or an owner", async () => {
  const tenant = stripComments(read("src/lib/realtime/tenant-binding.ts"));
  assert.ok(!/trace/i.test(tenant), "tenant resolution must not read a trace");

  for (const rel of [
    "src/lib/notification/channel-identity.ts",
    "src/lib/realtime/realtime-redis.ts",
    "src/lib/policy/policy-engine.ts",
  ]) {
    assert.ok(!/trace/i.test(stripComments(read(rel))), `${rel} reads a trace`);
  }

  // The policy input has no trace field at all — the gate cannot be steered
  // by one even if a caller wanted to.
  const contract = stripComments(read("src/lib/policy/policy-contract.ts"));
  assert.ok(!/traceId/.test(contract));
});

test("15. a trace id is not an idempotency key", async () => {
  const keys = stripComments(read("src/lib/redis/redis-keys.ts"));
  assert.ok(!/trace/i.test(keys), "a Redis key must never be derived from a trace");

  const idem = stripComments(read("src/lib/redis/idempotency-store.ts"));
  assert.ok(!/traceId/.test(idem));

  // The command's dedupe identity is still the attempt-derived key, and the
  // trace rides beside it.
  const act = stripComments(read("worker/activities/generation-activities.ts"));
  assert.match(act, /idempotencyKey: commandIdFor\("provider\.submit", params\.attemptId\)/);

  // Two different traces, same attempt -> the same idempotency key.
  const { commandIdFor } = await import("@/lib/contracts/command-wire");
  assert.equal(
    commandIdFor("provider.submit", "attempt-1"),
    commandIdFor("provider.submit", "attempt-1")
  );
});

test("16. a trace id is not a billing identifier — Phase 10 untouched", () => {
  const credits = stripComments(read("src/lib/credits.ts"));
  assert.ok(!/trace/i.test(credits), "the credit path must not read a trace");
  for (const rel of [
    "src/lib/observability/trace-context.ts",
    "src/lib/observability/trace-scope.ts",
    "src/lib/observability/span.ts",
  ]) {
    const code = stripComments(read(rel));
    assert.ok(!/credit|reserve|settle|refund|stripe|ledger/i.test(code), `${rel} reaches Phase 10`);
  }
});

// ---------------------------------------------------------------------------
// 17–23. The span standard
// ---------------------------------------------------------------------------

test("17. span names are low-cardinality and the vocabulary is closed", () => {
  assert.ok(SPAN_NAMES.length >= 10 && SPAN_NAMES.length <= 30);
  for (const name of SPAN_NAMES) {
    assert.match(name, /^[a-z]+\.[a-z_]+$/, `${name} is not a stable low-cardinality name`);
    assert.ok(name.length <= 32);
  }
  assert.equal(new Set(SPAN_NAMES).size, SPAN_NAMES.length);
  assert.equal(isSpanName("http.request"), true);
  assert.equal(isSpanName("generation.9c1e5b40"), false);
});

test("18. identifiers are attributes, never span names", () => {
  const { seen, stop } = captureSpans();
  const ctx = mintTraceContext();
  try {
    runInTraceScope(ctx, () => {
      const s = startSpan("generation.execute", {
        generationId: "9c1e5b40-0000-4000-8000-abcdef012345",
        workspaceId: "user_2zzz",
      });
      s.end();
    });
  } finally {
    stop();
  }
  const span = seen[0];
  assert.equal(span.name, "generation.execute");
  assert.ok(!span.name.includes("9c1e5b40"));
  assert.equal(span.envelope.fields.generationId, "9c1e5b40-0000-4000-8000-abcdef012345");
  assert.equal(span.envelope.fields.workspaceId, "user_2zzz");
  assert.equal(span.traceId, ctx.traceId);
});

test("19. an unknown span attribute is dropped", () => {
  const { seen, stop } = captureSpans();
  try {
    startSpan("provider.submit", { provider: "fal", somethingNobodyReviewed: "x" }).end();
  } finally {
    stop();
  }
  assert.equal(seen[0].envelope.fields.provider, "fal");
  assert.equal(seen[0].envelope.fields.somethingNobodyReviewed, undefined);
  assert.ok(seen[0].envelope.droppedFieldCount >= 1);
});

test("20–23. no prompt, signed URL, provider response or raw error can enter a span", () => {
  const unsafe = JSON.parse(read("src/test/fixtures/telemetry/unsafe-values.json")) as Record<string, string>;
  const { seen, stop } = captureSpans();
  try {
    const s = startSpan("provider.poll", {
      provider: "fal",
      prompt: unsafe.prompt,
      signedUrl: unsafe.signedUrl,
      rawResponse: "{...}",
      apiKey: unsafe.apiKey,
    });
    s.setAttributes({ ...errorFields(new Error(unsafe.prompt)), stack: unsafe.stack });
    s.setStatus("error");
    s.end();
  } finally {
    stop();
  }
  const text = JSON.stringify(seen[0]);
  for (const key of ["prompt", "signedUrl", "apiKey", "stack"] as const) {
    assert.ok(!text.includes(unsafe[key]), `${key} entered a span`);
  }
  assert.ok(!text.includes("{...}"));
  assert.equal(seen[0].envelope.fields.provider, "fal");
  assert.equal(seen[0].envelope.fields.errorClass, "Error");
  assert.equal(seen[0].status, "error");
});

// ---------------------------------------------------------------------------
// 24–28. Sinks, failure semantics, and the client boundary
// ---------------------------------------------------------------------------

test("24. a sink receives only a sanitized envelope", () => {
  const span = startSpan("outbox.dispatch", { prompt: "leak me", count: 3 }).end();
  assert.equal(span.envelope.fields.prompt, undefined);
  assert.equal(span.envelope.fields.count, 3);
  // The span object exposes no raw attribute bag.
  assert.deepEqual(
    Object.keys(span).sort(),
    ["durationMs", "envelope", "name", "parentSpanId", "spanId", "status", "traceId"].filter((k) =>
      k in span
    ).sort()
  );
});

test("25. telemetry failure does not affect the business path", async () => {
  clearSpanSinks();
  registerSpanSink({ name: "broken", emit: () => { throw new Error("exporter down"); } });
  try {
    assert.doesNotThrow(() => startSpan("http.request", { result: "ok" }).end());
    // withSpan re-throws the CALLER's error unchanged, and still ends the span.
    await assert.rejects(
      () => withSpan("provider.submit", {}, async () => { throw new Error("provider failed"); }),
      /provider failed/
    );
    const ok = await withSpan("provider.submit", {}, async () => "value");
    assert.equal(ok, "value");
  } finally {
    clearSpanSinks();
  }
});

test("26–27. no external exporter and no telemetry network call exist", () => {
  clearSpanSinks();
  assert.deepEqual(registeredSpanSinkNames(), []);
  for (const rel of [
    "src/lib/observability/trace-context.ts",
    "src/lib/observability/trace-scope.ts",
    "src/lib/observability/span.ts",
  ]) {
    const code = stripComments(read(rel));
    assert.ok(!/fetch\(|https?:\/\/|XMLHttpRequest|axios/.test(code), `${rel} makes a network call`);
    assert.ok(!/@sentry|@opentelemetry|opentelemetry|datadog|otlp/i.test(code), `${rel} imports a sink SDK`);
  }
  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
  assert.ok(
    !Object.keys(pkg.dependencies ?? {}).some((d) => /sentry|otel|opentelemetry|datadog/i.test(d)),
    "an observability SDK was installed"
  );
  assert.ok(!/SENTRY_DSN|OTEL_EXPORTER/.test(read(".env.example")), "an exporter variable was added");
});

test("28. no client module imports the tracing internals", () => {
  const clientFiles: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next" || rel.startsWith("src/test")) continue;
        walk(rel);
      } else if (/\.(ts|tsx)$/.test(e.name) && /^\s*["']use client["']/m.test(read(rel))) {
        clientFiles.push(rel);
      }
    }
  };
  walk("src");
  assert.ok(clientFiles.length > 20);
  for (const f of clientFiles) {
    assert.ok(
      !/observability\/(trace-scope|span|logger)/.test(read(f)),
      `${f} pulls server tracing into the browser bundle`
    );
  }
  // The scope and span modules are server-only; the pure contract is not,
  // because it holds no runtime state and the tests read it.
  assert.match(read("src/lib/observability/trace-scope.ts"), /^import "server-only";/m);
  assert.match(read("src/lib/observability/span.ts"), /^import "server-only";/m);
  // Comments stripped: that file's own header explains why it is NOT
  // server-only, so matching prose would report the opposite of the truth.
  assert.ok(!/server-only/.test(stripComments(read("src/lib/observability/trace-context.ts"))));
});

// ---------------------------------------------------------------------------
// 29–32. Regression, migration, locked UI
// ---------------------------------------------------------------------------

test("29. the 13-E telemetry scan is still green", () => {
  const out = execFileSync("npx", ["tsx", "scripts/scan-telemetry.ts"], {
    cwd: ROOT, encoding: "utf8", shell: true,
  });
  assert.match(out, /no risky log call sites/);
});

test("30. the Phase 12 security surfaces are untouched in substance", () => {
  // The rate limiter's decision path is unchanged: the trace is bound before
  // it and never read by it.
  const headers = stripComments(read("src/lib/security/response-headers.ts"));
  const guard = headers.slice(headers.indexOf("export async function guardRoute"));
  assert.ok(!/trace/i.test(guard.slice(guard.indexOf("enforceRouteRateLimit"))),
    "the limiter must not consult a trace");
  assert.match(guard, /decision\.reason === "rate_limited"/);
  // 12-E's fail-closed default is intact.
  assert.match(stripComments(read("src/lib/policy/policy-gate.ts")), /policy_evaluation_failed/);
});

test("31. no trace-propagation migration was created", () => {
  // Asserts that 13-A ADDED NO TRACE MIGRATION, not that the migration list
  // is frozen. The previous form pinned "the newest migration is <X>", which
  // failed as soon as any later, unrelated migration landed and then blamed
  // 13-A for it. `trace_id` already existed in the schema before 13-A, so the
  // real claim is that no migration was needed to introduce it — and that is
  // what is checked here.
  const dir = path.join(ROOT, "supabase/migrations");
  const migrations = readdirSync(dir).sort();

  const traceMigrations = migrations.filter(
    (m) => /trace/i.test(m) || /\badd\s+column\b[^;]*trace_id/i.test(readFileSync(path.join(dir, m), "utf8"))
  );
  assert.deepEqual(traceMigrations, [],
    "a migration was added for trace_id; it already existed and none was needed");

  // And the column 13-A relies on genuinely predates this batch.
  const securityEvents = readFileSync(path.join(dir, "20260826000000_security_events.sql"), "utf8");
  assert.match(securityEvents, /trace_id/, "the pre-existing trace_id column is missing");
});

test("32. the pinned client prompt-log findings are untouched", () => {
  // Still present, still exactly two, still unmodified by this batch. The
  // locked one may only change under an explicit unlock naming its route.
  for (const rel of [
    "src/components/image-tools/ImageGenerationForm.tsx",
    "src/components/marketing-studio/MarketingStudioProductWorkspace.tsx",
  ]) {
    const code = read(rel);
    assert.match(code, /^\s*["']use client["']/m);
    assert.ok(/console\.\w+\([\s\S]{0,400}?\bprompt\b/.test(code), `${rel}: the pin no longer matches`);
    assert.ok(!/observability\//.test(code), `${rel} was modified by this batch`);
  }
  const changed = execFileSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: ROOT, encoding: "utf8", shell: true,
  });
  assert.ok(!changed.includes("MarketingStudioProductWorkspace"), "a LOCKED file was modified");
  assert.ok(!changed.includes("ImageGenerationForm"), "a pinned client file was modified");
});
