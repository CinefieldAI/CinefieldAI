import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  MAX_FIELDS,
  TELEMETRY_ALLOWLIST,
  TELEMETRY_FORBIDDEN_FIELDS,
  TELEMETRY_REDUCED_ONLY,
  fieldRule,
  isForbiddenFieldName,
} from "@/lib/observability/telemetry-contract";
import { looksSecret, sanitizeTelemetry } from "@/lib/observability/telemetry-redaction";
import { errorFields, projectError } from "@/lib/observability/error-projection";
import {
  clearTelemetrySinks,
  createFieldLogger,
  createLogger,
  registerTelemetrySink,
  registeredSinkNames,
  setConsoleOutput,
} from "@/lib/observability/logger";
import { scanTelemetryFile, scanTelemetryText, stripNonCode } from "../../../scripts/scan-telemetry";
import type { TelemetryEnvelope } from "@/lib/observability/telemetry-contract";

/**
 * Phase 13-E — Sensitive Data Guard.
 *
 * Roadmap ¶1753: "Telemetry = İkinci Veri Kopyası … Yaklaşım deny-list değil
 * ALLOW-LIST olmalıdır." ¶1722 names the forbidden data; ¶1723 is the
 * acceptance test — forbidden fields provably absent from every sink, with
 * trace_id / generation_id / provider_attempt_id preserved.
 *
 * This suite lands BEFORE any sink exists, which is the only order in which
 * ¶1723 can be satisfied: telemetry already sent to a third party cannot be
 * recalled, so the guard has to predate Sentry rather than follow it.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const FIXTURES = "src/test/fixtures/telemetry";

/** Real-shaped unsafe values, assembled in a fixture rather than typed here. */
const UNSAFE = JSON.parse(read(`${FIXTURES}/unsafe-values.json`)) as Record<string, string>;

function capture(): { seen: TelemetryEnvelope[]; stop: () => void } {
  const seen: TelemetryEnvelope[] = [];
  setConsoleOutput(false);
  clearTelemetrySinks();
  registerTelemetrySink({ name: "test", emit: (e) => seen.push(e) });
  return {
    seen,
    stop: () => {
      clearTelemetrySinks();
      setConsoleOutput(true);
    },
  };
}

const base = { level: "info" as const, event: "unit_test", subsystem: "test" };

// ---------------------------------------------------------------------------
// 1–2. Allow-list, and what happens to everything else
// ---------------------------------------------------------------------------

test("1. an allow-listed field is preserved", () => {
  const out = sanitizeTelemetry({
    ...base,
    fields: { generationId: "11111111-1111-4111-8111-111111111111", result: "completed", durationMs: 1234 },
  });
  assert.equal(out.fields.generationId, "11111111-1111-4111-8111-111111111111");
  assert.equal(out.fields.result, "completed");
  assert.equal(out.fields.durationMs, 1234);
  assert.equal(out.droppedFieldCount, 0);
});

test("2. an unknown field is DROPPED, not kept", () => {
  const out = sanitizeTelemetry({
    ...base,
    fields: { generationId: "gen-1", somethingNobodyReviewed: "value", anotherOne: 42 },
  });
  assert.deepEqual(Object.keys(out.fields), ["generationId"]);
  assert.equal(out.droppedFieldCount, 2);
  // The count travels; the NAMES do not. A dropped name is itself a hint.
  assert.ok(!JSON.stringify(out).includes("somethingNobodyReviewed"));
});

// ---------------------------------------------------------------------------
// 3–11. Every forbidden class from ¶1722 / ¶1753
// ---------------------------------------------------------------------------

test("3. a raw prompt is dropped", () => {
  const out = sanitizeTelemetry({ ...base, fields: { prompt: UNSAFE.prompt } });
  assert.deepEqual(out.fields, {});
  // And it cannot sneak in under an allow-listed name either: prose is
  // rejected by shape, not only by field name.
  const disguised = sanitizeTelemetry({ ...base, fields: { reason: UNSAFE.prompt } });
  assert.deepEqual(disguised.fields, {});
});

test("4. a signed URL is dropped, under any field name", () => {
  for (const field of ["signedUrl", "routeId", "modelId", "traceId"]) {
    const out = sanitizeTelemetry({ ...base, fields: { [field]: UNSAFE.signedUrl } });
    assert.deepEqual(out.fields, {}, `${field} admitted a signed URL`);
  }
  assert.ok(looksSecret(UNSAFE.signedUrl));
});

test("5. an API key is dropped", () => {
  for (const field of ["apiKey", "provider", "modelId", "reason"]) {
    assert.deepEqual(sanitizeTelemetry({ ...base, fields: { [field]: UNSAFE.apiKey } }).fields, {}, field);
  }
});

test("6. an Authorization header value is dropped", () => {
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { authorization: UNSAFE.authorization } }).fields, {});
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { traceId: UNSAFE.authorization } }).fields, {});
});

test("7. a cookie is dropped", () => {
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { cookie: UNSAFE.cookie } }).fields, {});
});

test("8. a Redis URL with credentials is dropped", () => {
  for (const field of ["redisUrl", "routeId", "queue"]) {
    assert.deepEqual(sanitizeTelemetry({ ...base, fields: { [field]: UNSAFE.redisUrl } }).fields, {}, field);
  }
});

test("9. a raw request body is dropped", () => {
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { requestBody: UNSAFE.requestBody } }).fields, {});
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { body: UNSAFE.requestBody } }).fields, {});
});

test("10. a raw provider response is dropped", () => {
  for (const field of ["providerResponse", "rawResponse", "payload", "response"]) {
    assert.equal(isForbiddenFieldName(field), true, `${field} must be a forbidden name`);
    assert.deepEqual(sanitizeTelemetry({ ...base, fields: { [field]: "{...}" } }).fields, {}, field);
  }
});

test("11. a stack trace is dropped", () => {
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { stack: UNSAFE.stack } }).fields, {});
  assert.equal(isForbiddenFieldName("stackTrace"), true);
  assert.equal(isForbiddenFieldName("cause"), true);
  assert.equal(isForbiddenFieldName("message"), true);
});

// ---------------------------------------------------------------------------
// 12–14. People, networks, tenants
// ---------------------------------------------------------------------------

test("12. an email is dropped, by name and by shape", () => {
  assert.equal(isForbiddenFieldName("email"), true);
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { email: UNSAFE.email } }).fields, {});
  // Shape too: an address arriving in an allow-listed field is still refused.
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { reason: UNSAFE.email } }).fields, {});
  assert.equal(TELEMETRY_REDUCED_ONLY.email, "not carried in any form");
});

test("13. a full IP is refused; only the hashed bucket may travel", () => {
  for (const field of ["ip", "ipAddress", "clientIp", "xForwardedFor"]) {
    assert.equal(isForbiddenFieldName(field), true, field);
    assert.deepEqual(sanitizeTelemetry({ ...base, fields: { [field]: "203.0.113.7" } }).fields, {}, field);
  }
  // The reduced twin — the sha256 bucket 11-D and 12-C already compute.
  const out = sanitizeTelemetry({ ...base, fields: { subjectHash: "ab12cd34ef56ab12cd34" } });
  assert.equal(out.fields.subjectHash, "ab12cd34ef56ab12cd34");
  assert.match(TELEMETRY_REDUCED_ONLY.clientIp, /never the address/);
});

test("14. the tenant travels as workspaceId; a raw clerkUserId does not", () => {
  const out = sanitizeTelemetry({ ...base, fields: { workspaceId: "user_2abcdefghijklmnop" } });
  assert.equal(out.fields.workspaceId, "user_2abcdefghijklmnop");

  // The field NAME clerkUserId is refused, so the acting principal cannot be
  // logged in contexts that are not tenant-scoped. The contract states
  // plainly that today the two values coincide — see the note there.
  assert.equal(isForbiddenFieldName("clerkUserId"), true);
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { clerkUserId: UNSAFE.clerkUserId } }).fields, {});
  assert.match(TELEMETRY_ALLOWLIST.workspaceId.why, /workspaces do not exist yet/);
});

// ---------------------------------------------------------------------------
// 15–17. Correlation ids survive — ¶1723's other half
// ---------------------------------------------------------------------------

test("15. generation_id is preserved", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  assert.equal(sanitizeTelemetry({ ...base, fields: { generationId: id } }).fields.generationId, id);
});

test("16. provider_attempt_id is preserved, under both spellings", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  assert.equal(sanitizeTelemetry({ ...base, fields: { providerAttemptId: id } }).fields.providerAttemptId, id);
  // `attemptId` is what 179 existing call sites use for the same value.
  assert.equal(sanitizeTelemetry({ ...base, fields: { attemptId: id } }).fields.attemptId, id);
});

test("17. trace_id is preserved, and the whole ¶1753 set survives together", () => {
  const fields = {
    traceId: "trace-abc-123",
    generationId: "44444444-4444-4444-8444-444444444444",
    providerAttemptId: "attempt-9",
    workspaceId: "user_2zzz",
  };
  const out = sanitizeTelemetry({ ...base, fields });
  assert.deepEqual(out.fields, fields);
  assert.equal(out.droppedFieldCount, 0);
});

// ---------------------------------------------------------------------------
// 18–20. Errors, and failure semantics
// ---------------------------------------------------------------------------

test("18. an error is projected to bounded facts, never a message or stack", () => {
  class OrchestrationError extends Error {
    code = "PROVIDER_TIMEOUT";
    retryable = true;
  }
  const err = new OrchestrationError("provider said: your prompt about a cat was rejected");
  err.stack = UNSAFE.stack;

  const projected = projectError(err);
  assert.equal(projected.errorClass, "Error"); // `name` is inherited unless set
  assert.equal(projected.errorCode, "PROVIDER_TIMEOUT");
  assert.equal(projected.retryable, true);

  const text = JSON.stringify(errorFields(err));
  assert.ok(!text.includes("prompt about a cat"), "the message leaked");
  assert.ok(!text.includes("at handler"), "the stack leaked");
  assert.deepEqual(Object.keys(errorFields(err)).sort(), ["errorClass", "errorCode", "retryable"]);

  // A thrown string carries its TYPE, never its text.
  assert.equal(projectError("secret user text").errorClass, "ThrownString");
  assert.equal(projectError(null).errorClass, "UnknownError");
});

test("19. a telemetry failure does not break the business path", () => {
  const { stop } = capture();
  try {
    registerTelemetrySink({
      name: "broken",
      emit: () => {
        throw new Error("sink is down");
      },
    });
    const log = createLogger("test");
    // The whole point: this must not throw into the caller.
    assert.doesNotThrow(() => log.info("still_works", { result: "ok" }));
  } finally {
    stop();
  }
});

test("20. unsafe telemetry fails SAFE — dropped, never emitted raw", () => {
  const { seen, stop } = capture();
  try {
    const log = createLogger("test");
    log.error("boom", {
      prompt: UNSAFE.prompt,
      apiKey: UNSAFE.apiKey,
      redisUrl: UNSAFE.redisUrl,
      generationId: "55555555-5555-4555-8555-555555555555",
    });
  } finally {
    stop();
  }
  assert.equal(seen.length, 1);
  const text = JSON.stringify(seen[0]);
  for (const [name, value] of Object.entries(UNSAFE)) {
    if (name === "clerkUserId") continue; // asserted separately in test 14
    assert.ok(!text.includes(value), `${name} reached the sink`);
  }
  assert.equal(seen[0].fields.generationId, "55555555-5555-4555-8555-555555555555");
  assert.equal(seen[0].droppedFieldCount, 3);
});

// ---------------------------------------------------------------------------
// 21–23. The CI scan
// ---------------------------------------------------------------------------

test("21. a production console bypass is detected", () => {
  const risky = `const log = (f: object) => console.info("x", f);\nexport function go(error: unknown) { log(error); }`;
  const findings = scanTelemetryText("src/lib/fake.ts", risky);
  assert.ok(findings.some((f) => f.rule === "raw_error_object"), "a raw error passed to log was not caught");

  // Comments and strings never trip a rule, and line numbers survive
  // comment stripping — the first version of the scanner failed both.
  const commented = `/**\n * Never log the prompt or the request body.\n */\nconst log = (f: object) => console.info("x", f);\nexport function ok() { log({ result: "fine" }); }`;
  assert.deepEqual(scanTelemetryText("src/lib/fake.ts", commented), []);
  assert.equal(stripNonCode(commented).split("\n").length, commented.split("\n").length);
});

test("22. every synthetic positive control is detected; the negative one is not", () => {
  const expected: Record<string, string> = {
    "positive-raw-error.ts": "raw_error_object",
    "positive-process-env.ts": "process_env",
    "positive-request-body.ts": "request_body",
    "positive-headers.ts": "headers",
    "positive-prompt.ts": "prompt",
    "positive-provider-response.ts": "provider_response",
    "positive-stack.ts": "stack",
  };
  const present = readdirSync(path.join(ROOT, FIXTURES)).filter((f) => f.startsWith("positive-"));
  assert.deepEqual(present.sort(), Object.keys(expected).sort(), "fixture set drifted");

  for (const [file, rule] of Object.entries(expected)) {
    const findings = scanTelemetryFile(path.join(ROOT, FIXTURES, file));
    assert.ok(findings.length > 0, `${file} was not detected`);
    assert.ok(findings.some((f) => f.rule === rule), `${file}: expected rule ${rule}`);
  }

  assert.deepEqual(scanTelemetryFile(path.join(ROOT, FIXTURES, "negative-control-safe.ts")), []);
});

test("23. the tracked-tree telemetry scan is green", () => {
  const out = execFileSync("npx", ["tsx", "scripts/scan-telemetry.ts"], {
    cwd: ROOT, encoding: "utf8", shell: true,
  });
  assert.match(out, /no risky log call sites/);
  // It must not oversell itself: a call-site scan cannot prove a runtime
  // value is safe, and saying so is the difference between a control and a
  // reassurance.
  assert.match(out, /cannot prove a runtime value is safe/);
});

// ---------------------------------------------------------------------------
// 24. Client boundary
// ---------------------------------------------------------------------------

test("24. no client module imports the server logger, and client prompt logs are pinned", () => {
  const clientFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(rel);
      } else if (/\.(ts|tsx)$/.test(entry.name) && /^\s*["']use client["']/m.test(read(rel))) {
        clientFiles.push(rel);
      }
    }
  };
  walk("src");
  assert.ok(clientFiles.length > 20, "the client scan must actually find modules");

  for (const file of clientFiles) {
    assert.ok(
      !/@\/lib\/observability\/logger|observability\/logger/.test(read(file)),
      `${file} imports the server logger into a browser bundle`
    );
  }

  /**
   * KNOWN, PINNED, NOT FIXED HERE.
   *
   * Two client components log the user's raw prompt to the browser console.
   * They are genuine ¶1722 findings — and they are NOT fixed in this batch,
   * for two separate reasons that both need to hold before anyone touches
   * them:
   *
   *   MarketingStudioProductWorkspace is rendered by /marketing-studio/product,
   *   which is a LOCKED route. A lock is not waived by the change being small.
   *
   *   Client telemetry is a different contract (¶ §20 of the batch brief) —
   *   a browser console write copies nothing to a third party, and the
   *   restricted client contract that would govern it has not been written.
   *
   * Pinning them here means a THIRD cannot appear unnoticed, and the day the
   * lock lifts this test names exactly what to fix.
   */
  // [\s\S] rather than the `s` flag: this project targets ES2017.
  const promptLoggers = clientFiles.filter((f) =>
    /console\.\w+\([\s\S]{0,400}?\bprompt\b/.test(read(f))
  );
  assert.deepEqual(
    promptLoggers.sort(),
    [
      "src/components/image-tools/ImageGenerationForm.tsx",
      "src/components/marketing-studio/MarketingStudioProductWorkspace.tsx",
    ],
    "a new client prompt log appeared, or a pinned one was fixed — update this pin deliberately"
  );
});

// ---------------------------------------------------------------------------
// 25–27. The envelope, bounds, and no sink
// ---------------------------------------------------------------------------

test("25. the envelope is bounded and carries no arbitrary object", () => {
  const out = sanitizeTelemetry({ ...base, fields: { result: "ok" }, now: "2026-08-15T00:00:00.000Z" });
  assert.deepEqual(Object.keys(out).sort(), [
    "droppedFieldCount", "event", "fields", "level", "subsystem", "timestamp",
  ]);
  assert.equal(out.timestamp, "2026-08-15T00:00:00.000Z");

  // Field count is capped, so a caller cannot flood a record.
  const many: Record<string, unknown> = {};
  for (let i = 0; i < 60; i += 1) many[`count`] = i;
  many.result = "ok";
  const flood = sanitizeTelemetry({ ...base, fields: { ...many, ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`unknown${i}`, i])) } });
  assert.ok(Object.keys(flood.fields).length <= MAX_FIELDS);
});

test("26. long values are bounded, and secret-looking ones are dropped whole", () => {
  // A long-but-safe id is truncated to its rule's max.
  const long = "a".repeat(300);
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { traceId: long } }).fields, {},
    "free-text-length values are dropped, not truncated into something meaningless");

  const justOver = "b".repeat(80);
  const out = sanitizeTelemetry({ ...base, fields: { reason: justOver } });
  assert.equal((out.fields.reason as string).length, 64, "bounded to the rule's max");

  // Never truncate a secret and then log the remainder.
  const truncatable = `${UNSAFE.apiKey}${"x".repeat(10)}`;
  assert.deepEqual(sanitizeTelemetry({ ...base, fields: { reason: truncatable } }).fields, {});
});

test("27. no telemetry sink exists, and nothing makes a network call", () => {
  clearTelemetrySinks();
  assert.deepEqual(registeredSinkNames(), [], "a sink was registered by default");

  for (const rel of [
    "src/lib/observability/telemetry-contract.ts",
    "src/lib/observability/telemetry-redaction.ts",
    "src/lib/observability/error-projection.ts",
    "src/lib/observability/logger.ts",
  ]) {
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/fetch\(|https?:\/\/|XMLHttpRequest|axios/.test(code), `${rel} makes a network call`);
    assert.ok(!/@sentry|opentelemetry|datadog|aws-sdk/.test(code), `${rel} imports a sink SDK`);
  }
  // No dependency was added.
  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
  const deps = Object.keys(pkg.dependencies ?? {});
  assert.ok(!deps.some((d) => /sentry|otel|opentelemetry|datadog/i.test(d)), "an observability SDK was installed");
});

// ---------------------------------------------------------------------------
// 28–30. The guard is unavoidable, and the migration is real
// ---------------------------------------------------------------------------

test("28. every log path runs through the guard — there is no raw variant", () => {
  const logger = read("src/lib/observability/logger.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(logger, /sanitizeTelemetry\(/);
  // Exactly one call, in `write`, which every level funnels into.
  assert.equal((logger.match(/sanitizeTelemetry\(/g) ?? []).length, 1);
  assert.ok(!/raw|unsafe|skipSanit|bypass/i.test(logger), "a bypass exists");
  // Sinks receive the envelope, never the caller's fields.
  assert.match(logger, /sink\.emit\(envelope\)/);
});

test("29. the module log helpers were migrated to the guarded logger", () => {
  const migrated = execFileSync("git", ["grep", "-l", "createFieldLogger", "--", "src/lib", "worker"], {
    cwd: ROOT, encoding: "utf8", shell: true,
  }).split(/\r?\n/).filter(Boolean);
  assert.ok(migrated.length >= 20, `only ${migrated.length} modules migrated`);

  // None of them still writes to console directly — except the three worker
  // entry points, whose remaining console lines are PROCESS LIFECYCLE
  // (started / stopped / refusing to start / fatal). Those must survive a
  // broken logger: "the logger threw" is exactly when you need to know why a
  // process died. Named individually, never by directory.
  const lifecycle = new Set([
    "worker/temporal-worker.ts",
    "worker/provider-worker.ts",
    "worker/realtime-dispatcher-worker.ts",
  ]);
  // The logger itself is the ONE module that writes to console — that is its
  // job, and it does so only with an envelope the guard has already returned.
  const consoleOwner = "src/lib/observability/logger.ts";
  for (const file of migrated) {
    if (lifecycle.has(file) || file === consoleOwner) continue;
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/console\.(log|info|warn|error|debug)\(/.test(code), `${file} still calls console directly`);
  }

  // And those lifecycle lines carry no payload — fixed strings or a sanitized
  // summary object, never a caught value spread into the output.
  for (const file of lifecycle) {
    assert.deepEqual(scanTelemetryFile(path.join(ROOT, file)), [], `${file} trips the telemetry scan`);
  }
});

test("30. the generate-video raw-error defect is fixed", () => {
  for (const rel of ["src/app/api/generate-video/route.ts", "src/app/api/generate-video/[jobId]/route.ts"]) {
    // Comments stripped: the fix's own comment QUOTES the line it replaced,
    // and matching prose rather than code is how an assertion ends up
    // reporting a defect that was already fixed.
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/console\.error\([^)]*\berror\b[^)]*\)/.test(code), `${rel} still logs a raw error`);
    assert.match(code, /errorFields\(error\)/, `${rel} does not use the bounded projection`);
    assert.deepEqual(scanTelemetryFile(path.join(ROOT, rel)), [], `${rel} still trips the scan`);
  }
  // And no allow-listed field name is also a forbidden one.
  for (const name of Object.keys(TELEMETRY_ALLOWLIST)) {
    assert.equal(isForbiddenFieldName(name), false, `${name} is both allowed and forbidden`);
    assert.ok((fieldRule(name)?.why.length ?? 0) > 20, `${name} has no justification`);
  }
  assert.ok(TELEMETRY_FORBIDDEN_FIELDS.length > 50);
});
