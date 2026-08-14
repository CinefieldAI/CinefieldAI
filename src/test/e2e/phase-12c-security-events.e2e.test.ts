import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  KIND_DEDUPE_INCLUDES_RESOURCE,
  KIND_SEVERITY,
  KIND_SUBJECT_IS_ACTOR,
  KIND_WINDOW_SECONDS,
  OPERATIONAL_NOT_SECURITY,
  REASON_CODE,
  dedupeKeyFor,
  validateSecurityEvent,
  type SecurityEventInput,
  type SecurityEventKind,
} from "@/lib/security/security-event-contract";
import {
  TEMPORARY_BLOCK_TTL_SECONDS,
  assessRisk,
  enforceability,
} from "@/lib/security/risk-engine";
import {
  installSecuritySignals,
  reportMediaSafetyDecision,
  reportOutboundFetchBlocked,
  reportRealtimeConnectionDenied,
  reportRealtimeEventUnroutable,
  resetSecuritySignalsForTest,
  setSecurityEmitterForTest,
} from "@/lib/security/security-signals";
import { enforceRouteRateLimit, ROUTE_POLICIES } from "@/lib/security/route-rate-limit";
import { EVENT_SCHEMAS, schemaKey } from "@/lib/events/event-schemas";
import { projectEvent } from "@/lib/notification/event-projection";
import { toRealtimeUpdate } from "@/lib/realtime/browser-state";
import type { RateLimitRedisClient } from "@/lib/redis/rate-limit-store";

/**
 * Phase 12-C — Security Event Logger + Risk Engine.
 *
 * The roadmap asks for a chain: a signal becomes evidence, evidence becomes a
 * score, a score becomes a CONTROLLED action. Two properties decide whether
 * that chain is worth having, and most of what follows is about them.
 *
 * FIRST: it must never punish the wrong person, and never punish anyone more
 * than the evidence supports. A high score on a provider's bad URL is correct;
 * blocking the account that owns the generation for it is a bug with a human
 * on the other end.
 *
 * SECOND: it must be CONNECTED. An empty security table reads as "no
 * incidents", which is the most convincing lie a dashboard can tell. This
 * project has shipped a built-but-unwired control twice (D-11-1, D-12-1), so
 * several tests here exist purely to fail if a producer is ever disconnected.
 *
 * The PostgreSQL half — append-only, storm control, routable warnings, grants
 * — is proven separately in supabase/tests/test_security_events.sql (S12C-1
 * through S12C-10), against real migrations in a throwaway container.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SIGNALS = read("src/lib/security/security-signals.ts");
const LOGGER = read("src/lib/security/security-event-logger.ts");
const ENGINE = read("src/lib/security/risk-engine.ts");
const HEADERS = read("src/lib/security/response-headers.ts");
const SSE_ROUTE = read("src/app/api/realtime/events/route.ts");
const NORMALIZER = read("src/lib/orchestration/output-normalizer.ts");
const DISPATCHER = read("src/lib/realtime/outbox-dispatcher.ts");

const ALL_KINDS = Object.keys(KIND_SEVERITY) as SecurityEventKind[];

function capture(run: () => void): SecurityEventInput[] {
  const seen: SecurityEventInput[] = [];
  setSecurityEmitterForTest((i) => seen.push(i));
  try {
    run();
  } finally {
    setSecurityEmitterForTest(null);
  }
  return seen;
}

/** Minimal in-memory Redis for the limiter. Mirrors the PRE-12 suite's fake. */
function fakeRedis(): RateLimitRedisClient {
  const counts = new Map<string, number>();
  return {
    async incrementWindow(key: string): Promise<[number, number]> {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return [next, 60];
    },
  };
}

// ---------------------------------------------------------------------------
// 1–6. The Risk Engine is arithmetic a person can check
// ---------------------------------------------------------------------------

test("1. the same input always produces the same decision", () => {
  const input = { kind: "rate_limit_denied" as const, recurrenceWindows: 5, authenticated: true };
  const first = assessRisk(input);
  for (let i = 0; i < 50; i += 1) {
    assert.deepEqual(assessRisk(input), first, "a security decision may not vary between calls");
  }
  // No clock and no randomness anywhere in the module — the property above
  // could otherwise hold by luck on a fast machine.
  const code = stripComments(ENGINE);
  assert.ok(!/Date\.now|Math\.random|new Date/.test(code));
});

test("2. severity orders the base score, and every kind has one", () => {
  const scored = ALL_KINDS.map((kind) => ({
    kind,
    score: assessRisk({ kind, recurrenceWindows: 1, authenticated: false }).score,
  }));

  const info = scored.find((s) => KIND_SEVERITY[s.kind] === "info")!;
  const high = scored.find((s) => KIND_SEVERITY[s.kind] === "high")!;
  assert.ok(high.score > info.score, "a blocked SSRF probe must outscore a rejected asset");

  // An unscored kind would silently sit at zero forever.
  for (const { kind } of scored) assert.ok(KIND_SEVERITY[kind], `${kind} has no severity`);
});

test("3. recurrence flattens — patience must not outrank severity", () => {
  const low = (w: number) => assessRisk({ kind: "rate_limit_denied", recurrenceWindows: w, authenticated: false }).score;
  const high1 = assessRisk({ kind: "outbound_fetch_blocked", recurrenceWindows: 1, authenticated: false }).score;

  // Monotone, but bounded: a nuisance repeating forever never overtakes a
  // single genuine high-severity signal.
  assert.ok(low(2) > low(1));
  assert.ok(low(100) >= low(20));
  assert.ok(low(100_000) < high1, "a linear term here would invert the ranking");

  // And the curve really does flatten rather than step evenly.
  assert.ok(low(2) - low(1) >= low(100) - low(16));
});

test("4. an authenticated subject scores lower for identical behaviour", () => {
  for (const kind of ALL_KINDS) {
    const anon = assessRisk({ kind, recurrenceWindows: 4, authenticated: false }).score;
    const known = assessRisk({ kind, recurrenceWindows: 4, authenticated: true }).score;
    assert.ok(known <= anon, `${kind}: an attributable subject must not score higher`);
  }
  // Small: an authenticated attacker is still an attacker.
  const delta =
    assessRisk({ kind: "outbound_fetch_blocked", recurrenceWindows: 4, authenticated: false }).score -
    assessRisk({ kind: "outbound_fetch_blocked", recurrenceWindows: 4, authenticated: true }).score;
  assert.ok(delta > 0 && delta <= 10);
});

test("5. the score is bounded 0..100, matching the column", () => {
  for (const kind of ALL_KINDS) {
    for (const windows of [0, 1, 2, 9, 1_000, Number.MAX_SAFE_INTEGER]) {
      for (const authenticated of [true, false]) {
        const { score } = assessRisk({ kind, recurrenceWindows: windows, authenticated });
        assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `${kind}/${windows}: ${score}`);
      }
    }
  }
});

test("6. every decision explains itself", () => {
  const { factors } = assessRisk({ kind: "outbound_fetch_blocked", recurrenceWindows: 6, authenticated: true });
  assert.ok(factors.includes("severity_high"));
  assert.ok(factors.includes("windows_6"));
  assert.ok(factors.includes("authenticated_subject"));
  // A blocked user is owed a reason, and an operator is owed a way to check it.
  assert.ok(factors.length >= 3);
});

// ---------------------------------------------------------------------------
// 7–11. What may actually be DONE to someone
// ---------------------------------------------------------------------------

test("7. rate limiting alone can never challenge or block anyone", () => {
  for (const windows of [1, 3, 10, 500, 100_000]) {
    for (const authenticated of [true, false]) {
      const { action } = assessRisk({ kind: "rate_limit_denied", recurrenceWindows: windows, authenticated });
      assert.ok(
        action === "none" || action === "warning",
        `being impatient reached "${action}" after ${windows} windows`
      );
    }
  }
});

test("8. a subject who did not cause the event is never challenged or blocked", () => {
  const passive = ALL_KINDS.filter((k) => !KIND_SUBJECT_IS_ACTOR[k]);
  assert.ok(passive.length > 0, "the attribution map must actually mark something passive");

  for (const kind of passive) {
    for (const windows of [1, 5, 50, 100_000]) {
      const { action, score } = assessRisk({ kind, recurrenceWindows: windows, authenticated: true });
      assert.ok(
        action !== "challenge" && action !== "temporary_block",
        `${kind} reached "${action}" against a subject who did not cause it`
      );
      // The score is NOT suppressed — the signal is still recorded as
      // alarming. Only the response is capped.
      if (KIND_SEVERITY[kind] === "high" && windows >= 5) {
        assert.ok(score >= 70, "capping the action must not hide the severity");
      }
    }
  }
});

test("9. the cap escalates to a human rather than silently doing nothing", () => {
  const decision = assessRisk({ kind: "outbound_fetch_blocked", recurrenceWindows: 8, authenticated: true });
  assert.equal(decision.action, "admin_review");
  assert.ok(decision.factors.includes("capped_subject_not_actor"));
  assert.ok(decision.factors.includes("needs_admin_review"));
});

test("10. a challenge is recommended but cannot be enforced yet, and says so", () => {
  const verdict = enforceability("challenge");
  assert.equal(verdict.enforceable, false);
  assert.equal(verdict.enforceable === false && verdict.degradedTo, "warning");
  assert.equal(
    verdict.enforceable === false && verdict.reason,
    "challenge_infrastructure_unavailable",
    "CHALLENGE_ENFORCEMENT: BLOCKED_UNTIL_12A_EDGE — nothing may pretend a challenge was served"
  );

  for (const action of ["none", "warning", "temporary_block", "admin_review"] as const) {
    assert.equal(enforceability(action).enforceable, true);
  }
});

test("11. a block is bounded, expires by itself, and has no permanent form", () => {
  assert.ok(TEMPORARY_BLOCK_TTL_SECONDS > 0 && TEMPORARY_BLOCK_TTL_SECONDS <= 3_600);

  const logger = stripComments(LOGGER);
  // Redis enforces the expiry itself. No unblock call, no ban list, no
  // persistent flag — the block ends because time passed.
  assert.match(logger, /"EX", TEMPORARY_BLOCK_TTL_SECONDS/);
  assert.ok(!/PERSIST|permanent|banned|del\(/i.test(logger), "no permanent or manually-cleared state");

  // And a block is enforcement state only: the durable record lives in Postgres.
  assert.match(logger, /admin\.rpc\("record_security_event"/);
});

// ---------------------------------------------------------------------------
// 12–17. The taxonomy is complete and cannot hold what it must not
// ---------------------------------------------------------------------------

test("12. every kind is fully specified — no half-registered category", () => {
  for (const kind of ALL_KINDS) {
    assert.ok(KIND_SEVERITY[kind], `${kind}: no severity`);
    assert.ok(KIND_WINDOW_SECONDS[kind] >= 1, `${kind}: no coalescing window`);
    assert.equal(typeof KIND_SUBJECT_IS_ACTOR[kind], "boolean", `${kind}: no attribution`);
    assert.equal(typeof KIND_DEDUPE_INCLUDES_RESOURCE[kind], "boolean", `${kind}: no dedupe rule`);
  }
  // The maps are exhaustive in both directions.
  for (const map of [KIND_WINDOW_SECONDS, KIND_SUBJECT_IS_ACTOR, KIND_DEDUPE_INCLUDES_RESOURCE]) {
    assert.deepEqual(Object.keys(map).sort(), [...ALL_KINDS].sort());
  }
});

test("13. operational noise is refused, not quietly filed as a security event", () => {
  assert.ok(OPERATIONAL_NOT_SECURITY.includes("provider_timeout"));
  assert.ok(OPERATIONAL_NOT_SECURITY.includes("provider_rate_limited"));

  for (const reasonCode of OPERATIONAL_NOT_SECURITY) {
    const result = validateSecurityEvent({ kind: "rate_limit_denied", source: "route_rate_limit", reasonCode });
    assert.equal(result.ok, false, `${reasonCode} was accepted as a security event`);
    assert.equal(result.ok === false && result.reason, "operational_not_security");
  }
});

test("14. a reason code cannot carry a message, a URL, or a prompt", () => {
  const forbidden = [
    "https://provider.example/out.mp4?X-Amz-Signature=deadbeef",
    "Provider said: your prompt contained something",
    "Rate Limited",
    "../../etc/passwd",
    "",
    "A".repeat(200),
  ];
  for (const reasonCode of forbidden) {
    assert.ok(!REASON_CODE.test(reasonCode), `pattern admitted: ${reasonCode.slice(0, 40)}`);
    const result = validateSecurityEvent({ kind: "auth_failure", source: "auth", reasonCode });
    assert.equal(result.ok, false);
  }
  assert.ok(REASON_CODE.test("route_class_paid_compute"));
});

test("15. long identifiers are refused before they reach a bounded column", () => {
  const base = { kind: "rate_limit_denied" as const, source: "route_rate_limit" as const, reasonCode: "x_code" };
  assert.equal(validateSecurityEvent({ ...base, subjectHash: "a".repeat(65) }).ok, false);
  assert.equal(validateSecurityEvent({ ...base, resourceId: "a".repeat(201) }).ok, false);
  assert.equal(validateSecurityEvent({ ...base, actorClerkUserId: "a".repeat(256) }).ok, false);
  assert.equal(validateSecurityEvent({ ...base, subjectHash: "a".repeat(64) }).ok, true);
});

test("16. storm control keys separate subjects and never merge them", () => {
  const base = { kind: "rate_limit_denied" as const, source: "route_rate_limit" as const, reasonCode: "route_class_paid_compute" };
  const alice = dedupeKeyFor({ ...base, actorClerkUserId: "user_alice" });
  const bob = dedupeKeyFor({ ...base, actorClerkUserId: "user_bob" });
  assert.notEqual(alice, bob, "one noisy subject must not suppress another's evidence");
  assert.equal(alice, dedupeKeyFor({ ...base, actorClerkUserId: "user_alice" }), "and it is stable");

  // A different signal from the same subject is a different key too.
  assert.notEqual(alice, dedupeKeyFor({ ...base, actorClerkUserId: "user_alice", reasonCode: "route_class_durable_write" }));
});

test("17. only rare privileged actions widen the key with a resource id", () => {
  const release = (assetId: string) =>
    dedupeKeyFor({
      kind: "media_release_approved",
      source: "media_safety",
      reasonCode: "quarantine_released",
      resourceType: "media_asset",
      resourceId: assetId,
    });
  // Two releases in the same second must be two audit rows, not one.
  assert.notEqual(release("asset-a"), release("asset-b"));

  // An attacker-controllable resource must NOT widen the key, or storm
  // control becomes a suggestion.
  const ssrf = (generationId: string) =>
    dedupeKeyFor({
      kind: "outbound_fetch_blocked",
      source: "outbound_fetch_gateway",
      reasonCode: "ip_blocked_loopback",
      resourceType: "generation",
      resourceId: generationId,
    });
  assert.equal(ssrf("gen-1"), ssrf("gen-2"), "minting generations must not mint evidence rows");
});

// ---------------------------------------------------------------------------
// 18–22. The producers, and what they are physically able to leak
// ---------------------------------------------------------------------------

test("18. a rate-limit denial is reported, attributably, with no address", async () => {
  resetSecuritySignalsForTest();
  installSecuritySignals();
  try {
    const seen: SecurityEventInput[] = [];
    setSecurityEmitterForTest((i) => seen.push(i));
    const redis = fakeRedis();
    for (let i = 0; i <= ROUTE_POLICIES.paid_compute.limit; i += 1) {
      await enforceRouteRateLimit({ routeClass: "paid_compute", userId: "user_x", redisOverride: redis });
    }
    setSecurityEmitterForTest(null);

    assert.equal(seen.length, 1, "one denial, one signal");
    const event = seen[0];
    assert.equal(event.kind, "rate_limit_denied");
    assert.equal(event.source, "route_rate_limit");
    assert.equal(event.actorClerkUserId, "user_x");
    assert.ok(REASON_CODE.test(event.reasonCode));
    assert.equal(validateSecurityEvent(event).ok, true, "a producer must emit a valid event");

    // The route CLASS, never the path — an evidence table should not double
    // as an endpoint inventory.
    assert.ok(!/\/api\//.test(JSON.stringify(event)));
  } finally {
    setSecurityEmitterForTest(null);
    resetSecuritySignalsForTest();
  }
});

test("19. an SSRF refusal cannot carry the URL — there is no parameter for one", () => {
  const seen = capture(() =>
    reportOutboundFetchBlocked({
      failure: "ip_blocked",
      detail: "loopback",
      tenantId: "user_x",
      generationId: "11111111-1111-4111-8111-111111111111",
    })
  );
  assert.equal(seen.length, 1);
  const event = seen[0];
  assert.equal(event.kind, "outbound_fetch_blocked");
  assert.equal(validateSecurityEvent(event).ok, true);
  assert.match(event.reasonCode, /^ip_blocked_loopback$/);

  // The strongest form of the guarantee: the signature has no field a URL
  // could arrive in, so this is enforced by the type system rather than by
  // everyone remembering.
  const declarations = stripComments(SIGNALS);
  const start = declarations.indexOf("export function reportOutboundFetchBlocked");
  const signature = declarations.slice(start, declarations.indexOf("}): void {", start));
  assert.ok(!/url|href|host|endpoint|location/i.test(signature), `a URL-shaped parameter exists: ${signature}`);
});

test("20. provider unreliability is not filed as a security event", () => {
  const operational = ["timeout", "http_error", "response_too_large", "network_error", "dns_failed"];
  for (const failure of operational) {
    const seen = capture(() => reportOutboundFetchBlocked({ failure, tenantId: "user_x" }));
    assert.equal(seen.length, 0, `${failure} was recorded as a security event`);
  }
  // Destination policy refusals still are.
  for (const failure of ["scheme_blocked", "ip_blocked", "redirect_blocked", "url_credentials"]) {
    assert.equal(capture(() => reportOutboundFetchBlocked({ failure, tenantId: "user_x" })).length, 1);
  }
});

test("21. a connection refusal reports which ceiling fired, and nothing countable", () => {
  const seen = capture(() =>
    reportRealtimeConnectionDenied({ scope: "ip", userId: "user_x", tenantId: "user_x" })
  );
  assert.equal(seen.length, 1);
  const event = seen[0];
  assert.equal(event.kind, "realtime_connection_denied");
  assert.equal(event.reasonCode, "connection_limit_ip");
  assert.equal(validateSecurityEvent(event).ok, true);

  // No count, no limit, no lease key — the same three facts the client is not
  // told, withheld here for a different reason: they are not evidence.
  const serialized = JSON.stringify(event);
  assert.ok(!/\d{2,}/.test(serialized), `a count or limit leaked: ${serialized}`);
  assert.ok(!/lease|ZCARD|cinefield:v1/.test(serialized));
});

test("22. an unroutable event and a media decision are both recorded", () => {
  const unroutable = capture(() =>
    reportRealtimeEventUnroutable({ eventType: "generation.completed", eventId: "e1" })
  );
  assert.equal(unroutable.length, 1);
  assert.equal(unroutable[0].kind, "realtime_event_unroutable");
  assert.equal(unroutable[0].tenantId ?? null, null, "the tenant is precisely what could not be proven");
  assert.equal(validateSecurityEvent(unroutable[0]).ok, true);

  const released = capture(() =>
    reportMediaSafetyDecision({ decision: "released", assetId: "22222222-2222-4222-8222-222222222222" })
  );
  assert.equal(released[0].kind, "media_release_approved");
  assert.equal(released[0].resourceId, "22222222-2222-4222-8222-222222222222");
  // The approvers stay in media_safety_audit. Copying an identity into a
  // second table doubles the places it can leak from and adds no capability.
  assert.ok(!/approver|actor/i.test(JSON.stringify(released[0])));
});

// ---------------------------------------------------------------------------
// 23–25. Connected, and connected to the RIGHT thing
// ---------------------------------------------------------------------------

test("23. every producer is reached from real code — the anti-D-11-1 test", () => {
  // An unwired security logger is worse than none: an empty table reads as
  // "no incidents". Each assertion below fails if a producer is disconnected.
  assert.match(stripComments(HEADERS), /installSecuritySignals\(\);/,
    "the rate-limit observer must be installed by the module every guarded route imports");
  assert.match(stripComments(NORMALIZER), /reportOutboundFetchBlocked\(/);
  assert.match(stripComments(SSE_ROUTE), /reportRealtimeConnectionDenied\(/);
  assert.match(stripComments(DISPATCHER), /reportRealtimeEventUnroutable\(/);
  assert.match(stripComments(read("src/lib/media/quarantine-release.ts")), /reportMediaSafetyDecision\(/);

  // And the installer is a real call, not a side-effect import a tidy-up
  // could delete without breaking a build.
  assert.ok(!/^import "\.\/security-signals"/m.test(HEADERS));

  // `auth_failure` is the one kind with no producer, and that is DECLARED
  // rather than accidental. If someone wires it, this reminder must be
  // removed deliberately.
  assert.match(SIGNALS, /AUTH_SECURITY_SIGNAL: PARTIAL_UNTIL_CLERK_PRODUCTION/);
  assert.ok(!/kind: "auth_failure"/.test(SIGNALS));
});

test("24. logging can fail without reopening anything it refused", () => {
  const logger = stripComments(LOGGER);
  const signals = stripComments(SIGNALS);

  // Every reporter returns void, so no caller can await one or branch on it.
  const returnTypes = [...signals.matchAll(/export function report\w+\([\s\S]*?\): (\w+)/g)].map((m) => m[1]);
  assert.ok(returnTypes.length >= 4);
  assert.ok(returnTypes.every((t) => t === "void"), `a reporter returns ${returnTypes.join(", ")}`);

  // The detached path swallows its own failure, and the async path never
  // throws — an unreachable database costs a log line, never a refusal.
  assert.match(logger, /export function recordSecurityEventDetached/);
  assert.match(logger, /void recordSecurityEvent\(admin, input\)\.catch\(/);
  assert.match(logger, /catch \{[\s\S]*?return \{ recorded: false, reason: "unavailable" \}/);

  // Structural: on the SSE path, the report happens before the refusal is
  // built, and the refusal does not depend on it.
  const denial = stripComments(SSE_ROUTE).slice(
    stripComments(SSE_ROUTE).indexOf("if (!acquired.granted)"),
    stripComments(SSE_ROUTE).indexOf("const lease:")
  );
  assert.ok(!/await reportRealtimeConnectionDenied/.test(denial), "a refusal must not wait on logging");
});

test("25. the warning reaches the browser through Phase 11, carrying almost nothing", () => {
  // Registered, so the dispatcher validates it rather than dropping it.
  const registered = EVENT_SCHEMAS.get(schemaKey("security.warning", 1));
  assert.ok(registered, "security.warning must be a registered schema");
  assert.equal(registered.payload.additionalProperties, false);
  assert.deepEqual(Object.keys(registered.payload.properties ?? {}).sort(), ["reasonCode", "severity"]);

  // Projected, field by name — never spread.
  const projected = projectEvent({
    eventId: "e1",
    eventType: "security.warning",
    eventVersion: 1,
    aggregateType: "security_event",
    aggregateId: "33333333-3333-4333-8333-333333333333",
    tenantId: "user_x",
    occurredAt: new Date(0).toISOString(),
    payload: {
      reasonCode: "route_class_paid_compute",
      severity: "low",
      // Everything below must be dropped: it is either detection detail or
      // something the schema would have rejected anyway.
      riskScore: 44,
      dedupeKey: "rate_limit_denied:user_x:route_class_paid_compute",
      subjectHash: "ab12cd34",
    },
  } as never);

  assert.ok(projected.ok);
  assert.equal(projected.ok && projected.projection.uiState, "security.warning");
  assert.equal(projected.ok && projected.projection.subject.kind, "security");
  assert.deepEqual(
    projected.ok && Object.keys(projected.projection.detail).sort(),
    ["reasonCode", "severity"]
  );

  // Still not a generation state. A security banner must not attach itself to
  // whichever unrelated render happened to be on screen.
  assert.equal(
    toRealtimeUpdate({
      eventId: "e1",
      occurredAt: new Date(0).toISOString(),
      projection: projected.ok ? projected.projection : null,
    }),
    null
  );
});

// ---------------------------------------------------------------------------
// 26. The blast radius of this whole subsystem
// ---------------------------------------------------------------------------

test("26. nothing in 12-C can touch a generation, a credit, or a provider", () => {
  const forbidden =
    /generations|credit_|reserve_credits|settle|refund|submitAttempt|providers?\/|quarantine_release|approve_media_release|temporal|workflow/i;

  for (const [name, source] of [
    ["risk-engine", ENGINE],
    ["security-event-logger", LOGGER],
    ["security-event-contract", read("src/lib/security/security-event-contract.ts")],
  ] as const) {
    const code = stripComments(source);
    assert.ok(!forbidden.test(code), `${name} reaches outside its blast radius`);
  }

  // The Risk Engine imports nothing at all beyond its own contract — the
  // strongest available statement that it cannot act.
  const imports = [...ENGINE.matchAll(/from "([^"]+)";/g)].map((m) => m[1]);
  assert.deepEqual(imports, ["./security-event-contract"]);

  // And the logger publishes to no stream: warnings travel the outbox, so the
  // dispatcher stays the only thing that writes to Redis Streams.
  assert.ok(!/XADD|publishNotification|realtime-redis/.test(stripComments(LOGGER)));
});
