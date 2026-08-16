import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ALERT_CATALOGUE,
  ALERT_THRESHOLDS,
  CRITICAL_REEMIT_SECONDS,
  ESCALATION_THRESHOLDS,
  channelsFor,
  dedupeKeyFor,
  type AlertEnvelope,
  type AlertType,
} from "@/lib/alerts/alert-contract";
import { raiseAlert, resetAlertRouter, resolveAlert, trackedAlertKeys } from "@/lib/alerts/alert-router";
import {
  clearAlertSinks,
  registerAlertSink,
  LoggingAlertSink,
  type AlertDeliverySink,
} from "@/lib/alerts/alert-sink";
import {
  PRODUCED_ALERT_TYPES,
  alertOnDispatcherFailure,
  alertOnProviderHealth,
  alertOnReadiness,
  alertOnRealtimeDebt,
  alertOnSecurityEvent,
  resetHealthTransitions,
} from "@/lib/alerts/alert-sources";
import type { ReadinessReport } from "@/lib/health/health-contract";

/**
 * PHASE 13-D — CENTRAL ALERT ROUTER (CODE HALF)
 *
 * Roadmap 13-D: "Merkezi Alert Router + Telegram Operations/Security +
 * status.cinefield.ai routing kur." Done-criterion: "Aynı incident dedupe
 * edilip doğru kanala tek olay olarak gidiyor."
 *
 * This suite proves the code half only. External delivery is not built, and
 * several tests below exist specifically to prove it is not built.
 */

const ROOT = process.cwd();
const ALERTS_DIR = join(ROOT, "src", "lib", "alerts");

/** Captures envelopes without a network call, for routing assertions. */
class CapturingSink implements AlertDeliverySink {
  readonly name = "capture";
  readonly seen: AlertEnvelope[] = [];
  constructor(readonly channel: AlertEnvelope["channels"][number]) {}
  deliver(envelope: AlertEnvelope): void {
    this.seen.push(envelope);
  }
}

function freshRouter(): void {
  resetAlertRouter();
  resetHealthTransitions();
  clearAlertSinks();
}

function readinessReport(overrides: Partial<ReadinessReport> = {}): ReadinessReport {
  return {
    runtime: "realtime-dispatcher",
    status: "HEALTHY",
    reasons: [],
    dependencies: [],
    timestamp: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

/** Source files only — the test file itself quotes forbidden words on purpose. */
function alertSourceFiles(): { path: string; body: string }[] {
  return readdirSync(ALERTS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ path: f, body: readFileSync(join(ALERTS_DIR, f), "utf8") }));
}

/** Strips comments so prose about a symbol never counts as a use of it. */
function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
}

// ---------------------------------------------------------------------------
// 1–3  CATALOGUE, SERVER-DERIVED SEVERITY, UNKNOWN TYPES
// ---------------------------------------------------------------------------

test("S13D-1  every alert type is catalogued with a severity, window and written reason", () => {
  const types = Object.keys(ALERT_CATALOGUE) as AlertType[];
  assert.ok(types.length >= 10, "catalogue is not a stub");
  for (const type of types) {
    const rule = ALERT_CATALOGUE[type];
    assert.ok(["INFO", "WARNING", "ERROR", "CRITICAL"].includes(rule.severity), `${type} severity`);
    assert.ok(rule.dedupeWindowSeconds > 0, `${type} window`);
    assert.equal(typeof rule.userVisible, "boolean", `${type} userVisible`);
    assert.ok(rule.why.length > 40, `${type} must state why it exists`);
  }
});

test("S13D-2  severity is server-derived — the candidate cannot carry one", () => {
  freshRouter();
  const forged = {
    type: "provider_degraded",
    resource: "fal",
    reasonCode: "intermittent_failures",
    severity: "CRITICAL",
    level: "CRITICAL",
  } as never;
  const result = raiseAlert(forged);
  assert.equal(result.outcome, "emitted");
  // The catalogue's WARNING wins over anything the caller passed.
  assert.equal(result.envelope?.severity, "WARNING");
  assert.equal(ALERT_CATALOGUE.provider_degraded.severity, "WARNING");

  // And no `severity` input field is read anywhere in the module.
  const router = stripComments(readFileSync(join(ALERTS_DIR, "alert-router.ts"), "utf8"));
  assert.ok(!/candidate\.severity/.test(router), "router must not read a caller-supplied severity");
});

test("S13D-3  an uncatalogued alert type is rejected, not routed", () => {
  freshRouter();
  const result = raiseAlert({ type: "totally_made_up" as AlertType, resource: "x", reasonCode: "nope" });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "unknown_type");
  assert.deepEqual(trackedAlertKeys(), []);
});

// ---------------------------------------------------------------------------
// 4–8  CORRELATION AND SENSITIVE DATA
// ---------------------------------------------------------------------------

test("S13D-4  safe correlation ids are preserved", () => {
  freshRouter();
  const result = raiseAlert({
    type: "dependency_degraded",
    resource: "redis-a",
    reasonCode: "degraded_upstream",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    generationId: "gen_01H8XYZ",
    providerAttemptId: "attempt-9",
    workflowId: "wf-77",
    eventId: "evt-12",
    tenantId: "ws_abc",
  });
  const c = result.envelope?.correlation;
  assert.equal(c?.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.equal(c?.generationId, "gen_01H8XYZ");
  assert.equal(c?.providerAttemptId, "attempt-9");
  assert.equal(c?.workflowId, "wf-77");
  assert.equal(c?.eventId, "evt-12");
  assert.equal(c?.tenantId, "ws_abc");
});

test("S13D-5  a prompt is dropped — the envelope is built from an allow-list", () => {
  freshRouter();
  const result = raiseAlert({
    type: "dependency_degraded",
    resource: "redis-a",
    reasonCode: "degraded_upstream",
    prompt: "a cinematic shot of a lighthouse at dusk",
    userText: "please make it moodier",
  } as never);
  const serialized = JSON.stringify(result.envelope);
  assert.ok(!serialized.includes("lighthouse"), "prompt must not survive normalization");
  assert.ok(!serialized.includes("moodier"), "user text must not survive normalization");
  assert.ok(!("prompt" in (result.envelope as object)), "no prompt key");
});

test("S13D-6  a signed URL is dropped", () => {
  freshRouter();
  const result = raiseAlert({
    type: "provider_degraded",
    resource: "fal",
    reasonCode: "intermittent_failures",
    url: "https://r2.example.com/x.mp4?X-Amz-Signature=deadbeef",
    redisUrl: "rediss://user:pw@cache.example.com:6379",
  } as never);
  const serialized = JSON.stringify(result.envelope);
  assert.ok(!/X-Amz-Signature/i.test(serialized), "signed URL must not survive");
  assert.ok(!/rediss?:\/\//i.test(serialized), "connection URL must not survive");
  assert.ok(!/https?:\/\//i.test(serialized), "no URL of any kind in an envelope");
});

test("S13D-7  a raw error object and stack trace are dropped", () => {
  freshRouter();
  const error = new Error("connect ECONNREFUSED 10.0.0.5:6379");
  const result = raiseAlert({
    type: "dependency_unavailable",
    resource: "redis-a",
    reasonCode: "unreachable",
    error,
    stack: error.stack,
    message: error.message,
  } as never);
  const serialized = JSON.stringify(result.envelope);
  assert.ok(!/ECONNREFUSED/.test(serialized), "driver message must not survive");
  assert.ok(!/10\.0\.0\.5/.test(serialized), "host address must not survive");
  assert.ok(!/at .*\(/.test(serialized), "no stack frames");
});

test("S13D-8  security evidence is projected, never copied", () => {
  freshRouter();
  const sink = new CapturingSink("TELEGRAM");
  registerAlertSink(sink);

  alertOnSecurityEvent({
    kind: "outbound_fetch_blocked",
    severity: "high",
    reasonCode: "metadata_endpoint",
    recommendedAction: "admin_review",
    eventId: "evt-5",
    traceId: "abc123",
    tenantId: "ws_1",
  });

  assert.equal(sink.seen.length, 1);
  const envelope = sink.seen[0];
  const keys = Object.keys(envelope).sort();
  assert.deepEqual(keys, [
    "alertId",
    "channels",
    "correlation",
    "dedupeKey",
    "firstSeen",
    "lastSeen",
    "occurrenceCount",
    "reasonCode",
    "resource",
    "severity",
    "source",
    "state",
    "type",
  ]);
  // No evidence-bearing field exists at all.
  for (const forbidden of ["subjectHash", "actor", "riskScore", "policyVersion", "evidence", "resourceId"]) {
    assert.ok(!(forbidden in envelope), `${forbidden} must not be on an alert envelope`);
  }
});

// ---------------------------------------------------------------------------
// 9–12  DEDUPE AND SUPPRESSION
// ---------------------------------------------------------------------------

test("S13D-9  identical signals are deduplicated into one alert", () => {
  freshRouter();
  const sink = new CapturingSink("DASHBOARD");
  registerAlertSink(sink);

  const t0 = 1_000_000;
  for (let i = 0; i < 9; i += 1) {
    raiseAlert({ type: "dependency_degraded", resource: "redis-a", reasonCode: "unreachable" }, t0 + i * 100);
  }

  assert.equal(sink.seen.length, 1, "nine identical signals deliver once");
  assert.deepEqual(trackedAlertKeys(), ["health:dependency_degraded:redis-a"]);
  assert.equal(dedupeKeyFor("dependency_degraded", "redis-a"), "health:dependency_degraded:redis-a");
});

test("S13D-10  the occurrence count increments while suppressed", () => {
  freshRouter();
  const t0 = 2_000_000;
  let last;
  for (let i = 0; i < 5; i += 1) {
    last = raiseAlert({ type: "dependency_degraded", resource: "redis-a", reasonCode: "unreachable" }, t0 + i * 100);
  }
  assert.equal(last?.outcome, "suppressed");
  assert.equal(last?.envelope?.occurrenceCount, 5);
  assert.equal(last?.envelope?.state, "SUPPRESSED");
  assert.deepEqual(last?.envelope?.channels, [], "a suppressed alert routes nowhere");
});

test("S13D-11  the dedupe window expires and the next signal alerts again", () => {
  freshRouter();
  const sink = new CapturingSink("DASHBOARD");
  registerAlertSink(sink);

  const windowMs = ALERT_CATALOGUE.dependency_degraded.dedupeWindowSeconds * 1_000;
  const t0 = 3_000_000;
  raiseAlert({ type: "dependency_degraded", resource: "redis-a", reasonCode: "unreachable" }, t0);
  raiseAlert({ type: "dependency_degraded", resource: "redis-a", reasonCode: "unreachable" }, t0 + windowMs - 1);
  assert.equal(sink.seen.length, 1, "still inside the window");

  raiseAlert({ type: "dependency_degraded", resource: "redis-a", reasonCode: "unreachable" }, t0 + windowMs);
  assert.equal(sink.seen.length, 2, "window expired, alert re-emitted");
});

test("S13D-12  a critical alert is never suppressed indefinitely", () => {
  freshRouter();
  const sink = new CapturingSink("TELEGRAM");
  registerAlertSink(sink);

  const t0 = 4_000_000;
  const critical = { type: "runtime_unready" as const, resource: "temporal-worker", reasonCode: "unreachable" };
  assert.equal(ALERT_CATALOGUE.runtime_unready.severity, "CRITICAL");

  raiseAlert(critical, t0);
  raiseAlert(critical, t0 + 1_000);
  assert.equal(sink.seen.length, 1, "immediate repeat is suppressed");

  raiseAlert(critical, t0 + CRITICAL_REEMIT_SECONDS * 1_000);
  assert.equal(sink.seen.length, 2, "a sustained critical failure re-surfaces");

  // Escalation is the other route out of suppression.
  freshRouter();
  const sink2 = new CapturingSink("DASHBOARD");
  registerAlertSink(sink2);
  const first = ESCALATION_THRESHOLDS[0];
  for (let i = 0; i < first + 1; i += 1) {
    raiseAlert({ type: "dependency_degraded", resource: "redis-a", reasonCode: "unreachable" }, 5_000_000 + i);
  }
  assert.equal(sink2.seen.length, 2, "crossing an escalation threshold re-emits once");
  assert.equal(sink2.seen[1].occurrenceCount, first);
});

test("S13D-12b  DEFERRED/OPTIONAL dependencies never alert, no matter their status", () => {
  // Regression for a real defect the live local proof caught: Kafka and
  // Redis B are DEFERRED — dependency-probes.ts does no I/O for them by
  // design, so they report UNKNOWN on every single readiness poll forever.
  // Without this guard, every worker startup paged ERROR/TELEGRAM alerts for
  // infrastructure that was never meant to be running — the exact alarm
  // fatigue 13-D exists to prevent, reintroduced one layer up from where
  // rollUp() already solved it.
  freshRouter();
  const sink = new CapturingSink("TELEGRAM");
  registerAlertSink(sink);

  alertOnReadiness(
    readinessReport({
      dependencies: [
        { dependency: "kafka", status: "UNKNOWN", reason: "deferred", criticality: "DEFERRED" },
        { dependency: "redis-b", status: "UNKNOWN", reason: "deferred", criticality: "DEFERRED" },
        { dependency: "providers", status: "UNKNOWN", reason: "disabled", criticality: "OPTIONAL" },
      ],
    })
  );
  assert.deepEqual(sink.seen, [], "OPTIONAL/DEFERRED dependencies at UNKNOWN must not alert");
  assert.deepEqual(trackedAlertKeys(), []);

  // A CRITICAL dependency in the same report still alerts normally — the
  // guard is scoped to criticality, not blanket-silencing UNKNOWN.
  alertOnReadiness(
    readinessReport({
      dependencies: [
        { dependency: "kafka", status: "UNKNOWN", reason: "deferred", criticality: "DEFERRED" },
        { dependency: "redis-a", status: "UNKNOWN", reason: "unreachable", criticality: "CRITICAL" },
      ],
    })
  );
  assert.equal(sink.seen.length, 1);
  const survivor: AlertEnvelope = sink.seen[0];
  assert.equal(survivor.resource, "redis-a");
});

// ---------------------------------------------------------------------------
// 13–18  SOURCE INTEGRATIONS
// ---------------------------------------------------------------------------

test("S13D-13  a health transition creates an alert", () => {
  freshRouter();
  const sink = new CapturingSink("DASHBOARD");
  registerAlertSink(sink);

  alertOnReadiness(
    readinessReport({
      dependencies: [
        { dependency: "redis-a", status: "HEALTHY", reason: "ok", criticality: "CRITICAL" },
      ],
    })
  );
  assert.equal(sink.seen.length, 0, "a healthy dependency alerts nothing");

  alertOnReadiness(
    readinessReport({
      dependencies: [
        { dependency: "redis-a", status: "UNKNOWN", reason: "unreachable", criticality: "CRITICAL" },
      ],
    })
  );
  assert.equal(sink.seen.length, 1, "HEALTHY → UNKNOWN alerts");
  assert.equal(sink.seen[0].type, "dependency_unavailable");
  assert.equal(sink.seen[0].resource, "redis-a");
});

test("S13D-14  a repeated identical health poll creates nothing at all", () => {
  freshRouter();
  const sink = new CapturingSink("DASHBOARD");
  registerAlertSink(sink);

  const degraded = readinessReport({
    dependencies: [
      { dependency: "supabase", status: "DEGRADED", reason: "backlog", criticality: "DEGRADED_ALLOWED" },
    ],
  });

  const first = alertOnReadiness(degraded);
  assert.equal(first.length, 1);
  for (let i = 0; i < 20; i += 1) {
    assert.deepEqual(alertOnReadiness(degraded), [], "no candidate is even constructed");
  }
  assert.equal(sink.seen.length, 1);

  // Recovery clears the entry so a relapse alerts immediately, not coalesced
  // into the window of the incident that already ended.
  alertOnReadiness(
    readinessReport({
      dependencies: [{ dependency: "supabase", status: "HEALTHY", reason: "ok", criticality: "DEGRADED_ALLOWED" }],
    })
  );
  alertOnReadiness(degraded);
  assert.equal(sink.seen.length, 2, "a relapse after recovery alerts again");
});

test("S13D-15  outbox debt over threshold creates an alert", () => {
  freshRouter();
  const raised = alertOnRealtimeDebt({
    pending: ALERT_THRESHOLDS.realtimePendingWarn,
    oldestPendingSeconds: ALERT_THRESHOLDS.realtimeOldestPendingSecondsWarn,
    maxAttempts: ALERT_THRESHOLDS.realtimeAttemptsWarn,
  });
  const types = raised.map((r) => r.envelope?.type).sort();
  assert.deepEqual(types, [
    "realtime_outbox_backlog",
    "realtime_outbox_retry_exhaustion",
    "realtime_outbox_stalled",
  ]);
});

test("S13D-16  debt below threshold does not alert", () => {
  freshRouter();
  const raised = alertOnRealtimeDebt({
    pending: ALERT_THRESHOLDS.realtimePendingWarn - 1,
    oldestPendingSeconds: ALERT_THRESHOLDS.realtimeOldestPendingSecondsWarn - 1,
    maxAttempts: ALERT_THRESHOLDS.realtimeAttemptsWarn - 1,
  });
  assert.deepEqual(raised, []);
  assert.deepEqual(trackedAlertKeys(), []);

  assert.equal(alertOnDispatcherFailure(ALERT_THRESHOLDS.dispatcherConsecutiveFailures - 1), null);
  assert.ok(alertOnDispatcherFailure(ALERT_THRESHOLDS.dispatcherConsecutiveFailures));
});

test("S13D-17  a degraded provider creates a bounded alert", () => {
  freshRouter();
  const degraded = alertOnProviderHealth("fal", "degraded", 1);
  assert.equal(degraded?.envelope?.type, "provider_degraded");
  assert.equal(degraded?.envelope?.severity, "WARNING");

  const unhealthy = alertOnProviderHealth("runware", "unhealthy", ALERT_THRESHOLDS.providerConsecutiveFailures);
  assert.equal(unhealthy?.envelope?.type, "provider_unhealthy");
  assert.equal(unhealthy?.envelope?.severity, "ERROR");
  assert.equal(unhealthy?.envelope?.resource, "runware");

  // Recovery clears both.
  assert.equal(alertOnProviderHealth("fal", "healthy", 0), null);
  assert.ok(!trackedAlertKeys().includes("provider:provider_degraded:fal"));
});

test("S13D-18  no provider is probed — provider alerts read stored state only", () => {
  const sources = stripComments(readFileSync(join(ALERTS_DIR, "alert-sources.ts"), "utf8"));
  for (const forbidden of ["fetch(", "submit", "generate", "http"]) {
    assert.ok(!sources.includes(forbidden), `alert-sources must not contain ${forbidden}`);
  }
  // Provider status arrives as an argument; the module never reads it itself.
  assert.ok(!/getProviderHealth|providerAdapter|callProvider/.test(sources));
});

// ---------------------------------------------------------------------------
// 19–22  ROUTING, DELIVERY, PRODUCTION CALLER
// ---------------------------------------------------------------------------

test("S13D-19  routing maps severity to channels correctly", () => {
  assert.deepEqual(channelsFor("INFO", false), ["DASHBOARD"]);
  assert.deepEqual(channelsFor("WARNING", false), ["DASHBOARD"]);
  assert.deepEqual(channelsFor("ERROR", false), ["DASHBOARD", "TELEGRAM"]);
  assert.deepEqual(channelsFor("CRITICAL", false), ["DASHBOARD", "TELEGRAM"]);
  // The public status page needs BOTH critical severity and user visibility.
  assert.deepEqual(channelsFor("CRITICAL", true), ["DASHBOARD", "TELEGRAM", "STATUS_PAGE"]);
  assert.deepEqual(channelsFor("ERROR", true), ["DASHBOARD", "TELEGRAM"]);

  // A security alert is CRITICAL but must never reach a public surface:
  // publishing it would confirm to whoever triggered it that the probe landed.
  assert.equal(ALERT_CATALOGUE.security_high_severity.severity, "CRITICAL");
  assert.equal(ALERT_CATALOGUE.security_high_severity.userVisible, false);
  assert.ok(!channelsFor("CRITICAL", ALERT_CATALOGUE.security_high_severity.userVisible).includes("STATUS_PAGE"));
});

test("S13D-20  nothing is delivered externally — there is no network sink", () => {
  for (const { path, body } of alertSourceFiles()) {
    const code = stripComments(body);
    for (const pattern of [
      /\bfetch\s*\(/,
      /require\(['"]https?['"]\)/,
      /from ['"]node:https?['"]/,
      /axios/i,
      /WebSocket/,
      /XMLHttpRequest/,
      /api\.telegram\.org/i,
      /webhook/i,
      /bot[0-9]+:/,
    ]) {
      assert.ok(!pattern.test(code), `${path} must contain no network call (${pattern})`);
    }
  }
});

test("S13D-21  AlertDeliverySink has zero live network implementations", () => {
  const sink = stripComments(readFileSync(join(ALERTS_DIR, "alert-sink.ts"), "utf8"));
  // Exactly one concrete sink exists, and it writes to the logger.
  const classes = sink.match(/class \w+ implements AlertDeliverySink/g) ?? [];
  assert.deepEqual(classes, ["class LoggingAlertSink implements AlertDeliverySink"]);
  assert.ok(!/Telegram|StatusPage|Datadog|Sentry/.test(sink), "no external sink is implemented");

  // And it delivers by logging, not by calling out.
  freshRouter();
  registerAlertSink(new LoggingAlertSink());
  const result = raiseAlert({ type: "dependency_degraded", resource: "redis-a", reasonCode: "unreachable" });
  assert.deepEqual(result.deliveredTo, ["logging"]);
});

test("S13D-22  the router has real production callers", () => {
  const root = process.cwd();
  const callers = [
    join(root, "src", "lib", "security", "security-event-logger.ts"),
    join(root, "worker", "realtime-dispatcher-worker.ts"),
  ];
  for (const file of callers) {
    const code = stripComments(readFileSync(file, "utf8"));
    assert.ok(/from ["'].*alerts\/alert-sources["']/.test(code), `${file} must import the alert producers`);
    assert.ok(/alertOn\w+\s*\(/.test(code), `${file} must actually call a producer`);
  }
  // Neither caller is a test or a script.
  for (const file of callers) {
    assert.ok(!file.includes("test"), "the caller is production code");
  }
});

// ---------------------------------------------------------------------------
// 23–26  FAILURE SEMANTICS, GUARDS, SCOPE
// ---------------------------------------------------------------------------

test("S13D-23  router failure cannot affect business logic", () => {
  freshRouter();
  registerAlertSink({
    name: "exploding",
    channel: "DASHBOARD",
    deliver() {
      throw new Error("sink is down");
    },
  });

  // A throwing sink is contained; the raise still reports normally.
  const result = raiseAlert({ type: "dependency_degraded", resource: "redis-a", reasonCode: "unreachable" });
  assert.equal(result.outcome, "emitted");
  assert.deepEqual(result.deliveredTo, [], "the failing sink delivered nothing");

  // The module imports nothing that could act on the system.
  const forbidden = [
    "supabase",
    "temporal",
    "credit",
    "settle",
    "quarantine",
    "orchestrat",
    "provider-adapter",
    "workflow",
  ];
  for (const { path, body } of alertSourceFiles()) {
    const imports = stripComments(body)
      .split("\n")
      .filter((line) => line.trim().startsWith("import "))
      .join("\n")
      .toLowerCase();
    for (const term of forbidden) {
      assert.ok(!imports.includes(term), `${path} must not import anything matching "${term}"`);
    }
  }
});

test("S13D-24  the sensitive-data guard is enforced on every alert field", () => {
  freshRouter();
  // A resource that is not a bounded code is refused outright — this is what
  // stops an attacker-supplied value reaching a dedupe key or a log line.
  for (const bad of [
    "https://evil.example.com",
    "user@example.com",
    "10.0.0.5",
    "Bearer sk_live_abc",
    "A".repeat(200),
    "",
  ]) {
    const result = raiseAlert({ type: "dependency_degraded", resource: bad, reasonCode: "unreachable" });
    assert.equal(result.outcome, "rejected", `resource "${bad.slice(0, 20)}" must be refused`);
    assert.equal(result.reason, "invalid_resource");
  }

  // Reason codes are short codes, never messages.
  const prose = raiseAlert({
    type: "dependency_degraded",
    resource: "redis-a",
    reasonCode: "Connection refused to rediss://user:pw@cache.example.com",
  });
  assert.equal(prose.outcome, "rejected");
  assert.equal(prose.reason, "invalid_reason_code");

  // Correlation ids that are not bounded ids are dropped, not carried.
  const loose = raiseAlert({
    type: "dependency_degraded",
    resource: "redis-a",
    reasonCode: "unreachable",
    generationId: "https://r2.example.com/private.mp4?sig=abc",
  });
  assert.equal(loose.envelope?.correlation.generationId, undefined);
});

test("S13D-25  a trace id is optional and never fabricated", () => {
  freshRouter();
  const result = raiseAlert({ type: "dependency_degraded", resource: "redis-a", reasonCode: "unreachable" });
  assert.equal(result.outcome, "emitted");
  assert.equal(result.envelope?.correlation.traceId, undefined, "no trace is better than a fake one");

  const router = stripComments(readFileSync(join(ALERTS_DIR, "alert-router.ts"), "utf8"));
  assert.ok(!/newTraceId|mintTraceContext|randomUUID/.test(router), "the router must not mint trace ids");
});

test("S13D-26  no Redis B, no BullMQ, no Phase 10 billing anywhere in the module", () => {
  for (const { path, body } of alertSourceFiles()) {
    const code = stripComments(body);
    for (const forbidden of [/REDIS_B/, /bullmq/i, /BullMQ/, /stripe/i, /ledger/i, /reserve|refund/i]) {
      assert.ok(!forbidden.test(code), `${path} must not reference ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 27–30  CATALOGUE COVERAGE AND NEIGHBOURING PHASES
// ---------------------------------------------------------------------------

test("S13D-27  every catalogued type has a producer, and every producer type is catalogued", () => {
  const catalogued = (Object.keys(ALERT_CATALOGUE) as AlertType[]).sort();
  const produced = [...PRODUCED_ALERT_TYPES].sort();
  assert.deepEqual(produced, catalogued, "catalogue and producers must match exactly, both directions");

  // And the claimed producer list is not just a hand-written duplicate: every
  // name in it appears in an actual raiseAlert call in a real producer module.
  //
  // Producers are scanned WHEREVER THEY LIVE, not only in alert-sources.ts.
  // A producer belongs to the phase that owns the signal: Phase 15-A owns the
  // SLO breach mapping, so its bridge sits in src/lib/slo/ and depends on
  // 13-D — the correct direction. Requiring the raise site to be inside the
  // alerts module would have forced 13-D to import Phase 15 types, inverting
  // that dependency. The guarantee is unchanged and the scope is wider: every
  // catalogued type must have a real raise or resolve site SOMEWHERE in
  // production code.
  const producerFiles = [
    join(ALERTS_DIR, "alert-sources.ts"),
    join(ROOT, "src", "lib", "slo", "slo-alert-bridge.ts"),
  ];
  const producerCode = producerFiles
    .filter((f) => existsSync(f))
    .map((f) => stripComments(readFileSync(f, "utf8")))
    .join("\n");

  const raised = new Set([...producerCode.matchAll(/type:\s*"([a-z_]+)"/g)].map((m) => m[1]));
  const resolved = new Set([...producerCode.matchAll(/resolveAlert\(\s*"([a-z_]+)"/g)].map((m) => m[1]));
  for (const type of catalogued) {
    assert.ok(raised.has(type) || resolved.has(type), `${type} has no raise site`);
  }
});

test("S13D-28  13-E telemetry contract is untouched and still green", async () => {
  const { TELEMETRY_FORBIDDEN_FIELDS, isForbiddenFieldName } = await import(
    "@/lib/observability/telemetry-contract"
  );
  assert.ok(TELEMETRY_FORBIDDEN_FIELDS.length > 0);
  assert.ok(isForbiddenFieldName("prompt"));
  // The alert sink logs through the guarded logger, so the sink's own field
  // names must all be allow-listed rather than merely not-forbidden.
  const { fieldRule } = await import("@/lib/observability/telemetry-contract");
  for (const field of ["subsystem", "kind", "severity", "resource", "reasonCode", "count", "result", "traceId"]) {
    assert.ok(fieldRule(field), `alert sink field "${field}" must be in the 13-E allow-list`);
  }
});

test("S13D-29  13-A trace scope is the only source of an ambient trace id", async () => {
  const { runInTraceScope } = await import("@/lib/observability/trace-scope");
  const { mintTraceContext } = await import("@/lib/observability/trace-context");
  freshRouter();

  const context = mintTraceContext();
  const inside = runInTraceScope(context, () =>
    raiseAlert({ type: "dependency_degraded", resource: "redis-a", reasonCode: "unreachable" })
  );
  assert.equal(inside.envelope?.correlation.traceId, context.traceId, "the ambient 13-A trace is adopted");
});

test("S13D-30  the health foundation is unchanged and still drives alerts", async () => {
  const { rollUp, READINESS_BUDGET_MS } = await import("@/lib/health/health-contract");
  assert.equal(READINESS_BUDGET_MS, 4_000, "13 health foundation budget unchanged");

  const rolled = rollUp("realtime-dispatcher", [
    { dependency: "redis-a", status: "UNKNOWN", reason: "unreachable", criticality: "CRITICAL" },
  ]);
  assert.equal(rolled.status, "UNREADY", "UNKNOWN on a CRITICAL dependency is still UNREADY");

  freshRouter();
  const sink = new CapturingSink("TELEGRAM");
  registerAlertSink(sink);
  alertOnReadiness(readinessReport({ status: "UNREADY", reasons: ["unreachable"] }));
  assert.equal(sink.seen.length, 1);
  assert.equal(sink.seen[0].type, "runtime_unready");
  assert.equal(sink.seen[0].severity, "CRITICAL");
  assert.ok(sink.seen[0].channels.includes("STATUS_PAGE"), "a whole runtime being down is user-visible");
});

test("S13D-31  resolveAlert clears state so a relapse alerts immediately", () => {
  freshRouter();
  const sink = new CapturingSink("DASHBOARD");
  registerAlertSink(sink);
  const candidate = { type: "dependency_degraded" as const, resource: "redis-a", reasonCode: "unreachable" };

  raiseAlert(candidate, 9_000_000);
  raiseAlert(candidate, 9_000_100);
  assert.equal(sink.seen.length, 1);

  assert.equal(resolveAlert("dependency_degraded", "redis-a"), true);
  raiseAlert(candidate, 9_000_200);
  assert.equal(sink.seen.length, 2);
});
