import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  compareStreamIds,
  decideResume,
  exclusiveStart,
  parseCursor,
} from "@/lib/realtime/stream-cursor";
import {
  applyUpdate,
  fromAuthoritativeFetch,
  SeenEvents,
  type AppliedState,
} from "@/lib/realtime/client-apply";
import { toRealtimeUpdate, type RealtimeUpdate } from "@/lib/realtime/browser-state";
import { REPLAY_BATCH, REPLAY_MAX_EVENTS, STREAM_MAXLEN_APPROX } from "@/lib/realtime/stream-contract";

/**
 * Phase 11-C. Resume, replay, gap detection, dedupe and ordering.
 *
 * The property everything rests on: a replay is either PROVABLY complete or
 * the client is told to reconcile. There is no third outcome in which the
 * client believes it is caught up and is not.
 */

const ROOT = process.cwd();
const GEN = "11111111-1111-4111-8111-111111111111";
const OWNER = "user_2abcdefghijklmnop";

const ROUTE = readFileSync(path.join(ROOT, "src/app/api/realtime/events/route.ts"), "utf8");
const HOOK = readFileSync(path.join(ROOT, "src/hooks/useRealtimeGenerations.ts"), "utf8");
const CURSOR = readFileSync(path.join(ROOT, "src/lib/realtime/stream-cursor.ts"), "utf8");
const APPLY = readFileSync(path.join(ROOT, "src/lib/realtime/client-apply.ts"), "utf8");

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function update(
  state: RealtimeUpdate["state"],
  over: Partial<RealtimeUpdate> = {}
): RealtimeUpdate {
  return {
    generationId: GEN,
    state,
    detail: {},
    eventId: `evt-${state}`,
    occurredAt: "2026-08-24T10:00:00.000Z",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1–3. Last-Event-ID
// ---------------------------------------------------------------------------

test("1. a valid Last-Event-ID resumes strictly after the cursor", () => {
  const decision = decideResume("1786720175057-3", "1786720000000-0");
  assert.equal(decision.mode, "replay");
  if (decision.mode !== "replay") return;
  // Exclusive: the client already has the cursor entry.
  assert.equal(exclusiveStart(decision.from), "(1786720175057-3");
});

test("2. a malformed Last-Event-ID fails safely into reconciliation", () => {
  for (const bad of [
    "not-an-id",
    "abc-def",
    "-1",
    "1786720175057",
    "1786720175057-",
    "1786720175057-3-4",
    "99999999999999999999-0",
    " ",
    "*",
    "$",
    "-",
    "+",
    "x".repeat(400),
    "1786720175057-0; FLUSHALL",
  ]) {
    const decision = decideResume(bad, "1786720000000-0");
    assert.equal(decision.mode, "reconcile", `"${bad.slice(0, 20)}" must not be accepted`);
    assert.equal(decision.mode === "reconcile" && decision.reason, "invalid_cursor");
  }
  assert.equal(parseCursor(null), null);
  assert.equal(parseCursor(undefined), null);
});

test("3. the cursor cannot select a stream", () => {
  const code = stripComments(ROUTE);
  // The key is computed from the channel BEFORE the header is ever read, and
  // the header's value is never concatenated into a key.
  const keyIndex = code.indexOf("streamKeyFor(channel.channelId)");
  const headerIndex = code.indexOf('request.headers.get("last-event-id")');
  assert.ok(keyIndex >= 0 && headerIndex > keyIndex, "the key must be fixed before resume is read");
  assert.ok(!/streamKeyFor\([^)]*(last|cursor|header)/i.test(code), "a cursor must never reach the key");
  // And every Redis call uses the one resolved key.
  for (const call of code.match(/reader\.(xrange|xread)\([^)]*\)/g) ?? []) {
    assert.ok(call.includes("streamKey"), `a read must use the resolved key: ${call.slice(0, 60)}`);
  }
});

// ---------------------------------------------------------------------------
// 4–5. Tenant, and no re-delivery of the acknowledged event
// ---------------------------------------------------------------------------

test("4. cross-tenant replay is impossible by construction", () => {
  const code = stripComments(ROUTE);
  // One key, resolved once from the session, used by both the replay read and
  // the live read. A cursor moves a position within it and nothing else.
  assert.equal((code.match(/const streamKey = /g) ?? []).length, 1);
  assert.match(code, /channelForTenant\(userId\)/);
  assert.ok(!/streamKey\s*=/.test(code.slice(code.indexOf("const stream = new ReadableStream"))),
    "the key must not be reassigned once the stream is open");
});

test("5. replay excludes the already-acknowledged cursor entry", () => {
  const cursor = parseCursor("1786720175057-3");
  assert.ok(cursor);
  if (!cursor) return;
  // Redis reads `(id` as strictly-after.
  assert.ok(exclusiveStart(cursor).startsWith("("));
  assert.match(stripComments(ROUTE), /exclusiveStart\(resume\.from\)/);
});

// ---------------------------------------------------------------------------
// 6–7. Bounded replay
// ---------------------------------------------------------------------------

test("6-7. replay batch and total are both bounded", () => {
  assert.ok(REPLAY_BATCH > 0 && REPLAY_BATCH <= 200);
  assert.ok(REPLAY_MAX_EVENTS > 0 && REPLAY_MAX_EVENTS <= STREAM_MAXLEN_APPROX);

  const code = stripComments(ROUTE);
  assert.match(code, /"COUNT", REPLAY_BATCH/, "each read must be bounded");
  assert.match(code, /replayed < REPLAY_MAX_EVENTS/, "the whole resume must be bounded");
  // And hitting the cap is announced, not silently truncated.
  assert.match(code, /replay_truncated/);
});

// ---------------------------------------------------------------------------
// 8. Gap detection
// ---------------------------------------------------------------------------

test("8. a cursor older than the retained window produces a gap, not a partial replay", () => {
  const decision = decideResume("1786720000000-0", "1786720175057-0");
  assert.equal(decision.mode, "reconcile");
  assert.equal(decision.mode === "reconcile" && decision.reason, "cursor_too_old");
});

test("an empty stream cannot prove completeness either", () => {
  const decision = decideResume("1786720175057-0", null);
  assert.equal(decision.mode, "reconcile");
  assert.equal(decision.mode === "reconcile" && decision.reason, "window_unknown");
});

test("a first connection with no cursor is live, not a gap", () => {
  for (const empty of [null, undefined, ""]) {
    assert.equal(decideResume(empty, "1786720175057-0").mode, "live");
  }
});

test("a cursor exactly at the window boundary still replays", () => {
  // The boundary entry is retained, so everything after it provably is too.
  const decision = decideResume("1786720175057-0", "1786720175057-0");
  assert.equal(decision.mode, "replay");
});

// ---------------------------------------------------------------------------
// 9–10. Duplicate vs distinct
// ---------------------------------------------------------------------------

test("9. two transport entries with one eventId apply exactly once", () => {
  const seen = new SeenEvents();
  const first = applyUpdate(undefined, update("completed", { seq: "100-0" }), seen);
  assert.equal(first.applied, true);

  // The 11-B duplicate: same eventId, DIFFERENT stream id. Seq-based dedupe
  // would let this through; eventId dedupe is why it does not.
  const second = applyUpdate(
    first.applied ? first.next : undefined,
    update("completed", { seq: "101-0" }),
    seen
  );
  assert.equal(second.applied, false);
  assert.equal(second.applied === false && second.reason, "duplicate");
});

test("10. distinct eventIds both apply", () => {
  const seen = new SeenEvents();
  const a = applyUpdate(undefined, update("queued", { eventId: "e1", seq: "100-0" }), seen);
  assert.equal(a.applied, true);
  const b = applyUpdate(
    a.applied ? a.next : undefined,
    update("processing", { eventId: "e2", seq: "101-0" }),
    seen
  );
  assert.equal(b.applied, true);
  assert.equal(b.applied && b.next.state, "processing");
});

// ---------------------------------------------------------------------------
// 11–12. Cursor monotonicity
// ---------------------------------------------------------------------------

test("11. cursors order monotonically across milliseconds and sequence", () => {
  assert.ok((compareStreamIds("100-0", "101-0") ?? 0) < 0);
  assert.ok((compareStreamIds("100-1", "100-2") ?? 0) < 0);
  assert.equal(compareStreamIds("100-5", "100-5"), 0);
  assert.ok((compareStreamIds("200-0", "100-9") ?? 0) > 0);
  // Numeric, not lexical: "9" must not sort above "10".
  assert.ok((compareStreamIds("9-0", "10-0") ?? 0) < 0);
  assert.ok((compareStreamIds("100-9", "100-10") ?? 0) < 0);
  assert.equal(compareStreamIds("bad", "100-0"), null);
});

test("12. same-millisecond entries stay distinct and ordered", () => {
  // Redis increments the sequence part when two entries share a millisecond,
  // which is what makes the cursor safe under concurrent publication.
  const ids = ["1786720175057-0", "1786720175057-1", "1786720175057-2"];
  for (let i = 1; i < ids.length; i += 1) {
    assert.ok((compareStreamIds(ids[i - 1], ids[i]) ?? 0) < 0);
  }
  // A 64-bit sequence must not lose precision.
  // BigInt("...") rather than a literal: the project targets below ES2020,
  // where the `n` suffix is a compile error. The value is what matters.
  assert.equal(parseCursor("100-18446744073709551615")?.n, BigInt("18446744073709551615"));
});

// ---------------------------------------------------------------------------
// 13–14. Control frames carry no business meaning
// ---------------------------------------------------------------------------

test("13. the heartbeat is a comment: no id, no data, no dedupe entry", () => {
  const code = stripComments(ROUTE);
  assert.match(code, /encodeSseComment\("hb"\)/);
  // A comment frame has no `id:` and no `data:`, so the client's parser
  // neither advances the cursor nor calls handleFrame for it.
  const hook = stripComments(HOOK);
  assert.match(hook, /if \(line\.startsWith\(":"\)\) continue;/);
  assert.match(hook, /if \(id\) cursorRef\.current = id;/);
  assert.match(hook, /if \(dataLines\.length > 0\) handleFrame/);
});

test("14. ready/resumed/reconnect advance no cursor and enter no dedupe set", () => {
  const code = stripComments(ROUTE);
  // Only the notification frame is written with an id.
  for (const control of ['event: "ready"', 'event: "resumed"', 'event: "reconcile"', 'event: "reconnect"']) {
    const at = code.indexOf(control);
    assert.ok(at > 0, `${control} must exist`);
    const frame = code.slice(code.lastIndexOf("encodeSseFrame", at), code.indexOf("})", at) + 2);
    assert.ok(!/\bid:/.test(frame), `${control} must not carry a cursor`);
  }
  assert.match(code, /event: "notification", data: envelope, id: streamId/);
});

// ---------------------------------------------------------------------------
// 15–17. State can never regress
// ---------------------------------------------------------------------------

test("15-17. completed, failed and cancelled never regress to processing", () => {
  for (const terminal of ["completed", "failed", "cancelled"] as const) {
    const seen = new SeenEvents();
    const settled = applyUpdate(undefined, update(terminal, { eventId: "t", seq: "200-0" }), seen);
    assert.equal(settled.applied, true);
    if (!settled.applied) continue;

    // A replayed older `processing`, with a lower cursor.
    const stale = applyUpdate(settled.next, update("processing", { eventId: "p", seq: "100-0" }), seen);
    assert.equal(stale.applied, false, `${terminal} regressed`);

    // And with NO cursor at all — the case a reconciled state creates.
    const noSeq = applyUpdate(
      fromAuthoritativeFetch(terminal, "2026-08-24T10:00:00.000Z"),
      update("processing", { eventId: "p2" }),
      new SeenEvents()
    );
    assert.equal(noSeq.applied, false, `${terminal} regressed with no seq to compare`);
    assert.equal(noSeq.applied === false && noSeq.reason, "would_regress");
  }
});

test("a newer cursor still cannot move a terminal to another terminal", () => {
  const seen = new SeenEvents();
  const done = applyUpdate(undefined, update("completed", { eventId: "a", seq: "100-0" }), seen);
  assert.ok(done.applied);
  const flip = applyUpdate(done.applied ? done.next : undefined, update("failed", { eventId: "b", seq: "300-0" }), seen);
  assert.equal(flip.applied, false, "terminals are mutually exclusive in the database");
});

test("an older cursor is ignored even between non-terminal states", () => {
  const seen = new SeenEvents();
  const now = applyUpdate(undefined, update("processing", { eventId: "a", seq: "200-0" }), seen);
  assert.ok(now.applied);
  const older = applyUpdate(now.applied ? now.next : undefined, update("processing", { eventId: "b", seq: "100-0" }), seen);
  assert.equal(older.applied, false);
  assert.equal(older.applied === false && older.reason, "stale_seq");
});

test("forward progress still applies", () => {
  const seen = new SeenEvents();
  let state: AppliedState | undefined;
  for (const [i, s] of (["queued", "processing", "completed"] as const).entries()) {
    const out = applyUpdate(state, update(s, { eventId: `e${i}`, seq: `${100 + i}-0` }), seen);
    assert.equal(out.applied, true, `${s} must apply`);
    if (out.applied) state = out.next;
  }
  assert.equal(state?.state, "completed");
});

// ---------------------------------------------------------------------------
// 18. Gap triggers an authoritative refetch
// ---------------------------------------------------------------------------

test("18. a gap instructs the client to refetch, and nothing is synthesized", () => {
  const code = stripComments(ROUTE);
  assert.match(code, /event: "reconcile"/);
  // No business event is invented to fill the hole.
  assert.ok(!/synthes|fabricat|fake.*event/i.test(code));

  const hook = stripComments(HOOK);
  assert.match(hook, /event === "reconcile"/);
  assert.match(hook, /setNeedsReconcile/);
  // And the refetched state carries no cursor, so the rank floor protects it.
  assert.match(hook, /fromAuthoritativeFetch/);
  assert.ok(!/fromAuthoritativeFetch\([^)]*seq/.test(hook));
});

// ---------------------------------------------------------------------------
// 19–21. Redis failure changes nothing else
// ---------------------------------------------------------------------------

test("19-21. a Redis outage mutates no generation, retries no provider, moves no credit", () => {
  const imports = (ROUTE + HOOK).match(/^import .*$/gm)?.join("\n") ?? "";
  for (const forbidden of ["orchestrat", "temporal", "supabase", "credits", "provider", "stripe"]) {
    assert.ok(!new RegExp(forbidden, "i").test(imports), `must not import ${forbidden}`);
  }
  const code = stripComments(ROUTE + HOOK);
  assert.ok(!/retry.*provider|resubmit|startWorkflow|reserveCredits|settle\(/i.test(code));

  // The reader failing is caught and ends only this connection.
  assert.match(stripComments(ROUTE), /catch \{[\s\S]{0,200}\} finally \{[\s\S]{0,80}release\(\)/);
});

// ---------------------------------------------------------------------------
// 22–24. Reconnect
// ---------------------------------------------------------------------------

test("22-23. reconnect backoff is bounded and jittered", () => {
  const hook = stripComments(HOOK);
  assert.match(hook, /Math\.min\(MAX_BACKOFF_MS, BASE_BACKOFF_MS \* 2 \*\* \(retryRef\.current - 1\)\)/);
  assert.match(hook, /Math\.random\(\) \* ceiling/, "full jitter, not a fixed delay");
  assert.match(hook, /const MAX_BACKOFF_MS = 30_000/);
  assert.ok(!/setTimeout\(run, 0\)|while \(true\)/.test(hook), "no tight reconnect loop");
});

test("24. a healthy connection resets the backoff", () => {
  const hook = stripComments(HOOK);
  assert.match(hook, /HEALTHY_AFTER_MS/);
  assert.equal((hook.match(/retryRef\.current = 0/g) ?? []).length, 2,
    "reset on both the clean-close and the error path");
});

test("the cursor survives a reconnect, which is the whole point of 11-C", () => {
  const hook = stripComments(HOOK);
  // Held in a ref, so the reconnect does not re-run the effect that owns it.
  assert.match(hook, /cursorRef = useRef<string \| null>\(null\)/);
  assert.match(hook, /"Last-Event-ID": cursorRef\.current/);
  // And it is a HEADER, never a query parameter.
  assert.match(hook, /const ENDPOINT = "\/api\/realtime\/events"/);
  assert.ok(!/ENDPOINT\s*\+|`\$\{ENDPOINT\}\?/.test(hook), "no cursor in the URL");
});

// ---------------------------------------------------------------------------
// 25. Bounded dedupe memory
// ---------------------------------------------------------------------------

test("25. the dedupe set is bounded and evicts oldest first", () => {
  const seen = new SeenEvents(10);
  for (let i = 0; i < 100; i += 1) assert.equal(seen.admit(`e${i}`), true);
  assert.equal(seen.size, 10, "must not grow without limit");

  // The most recent are still remembered.
  assert.equal(seen.admit("e99"), false);
  // The oldest were evicted, so they are admitted again — the honest cost of
  // a bounded window, and far cheaper than an unbounded set.
  assert.equal(seen.admit("e0"), true);
});

test("a repeatedly redelivered event stays remembered", () => {
  const seen = new SeenEvents(3);
  seen.admit("hot");
  for (const id of ["a", "b"]) seen.admit(id);
  assert.equal(seen.admit("hot"), false, "recency refresh");
  seen.admit("c");
  assert.equal(seen.admit("hot"), false, "must not have been evicted");
});

// ---------------------------------------------------------------------------
// 26–29. Boundaries preserved from 11-B
// ---------------------------------------------------------------------------

test("26-27. still Streams, still Redis A only", () => {
  const code = stripComments(ROUTE + CURSOR + APPLY + HOOK);
  assert.ok(!/\.publish\(|\.subscribe\(|psubscribe/.test(code), "Pub/Sub stays forbidden");
  assert.ok(!/BULLMQ_REDIS_URL|bullmq/i.test(code), "Redis B stays out of scope");
});

test("28-29. no raw payload and no secret reaches the client", () => {
  const code = stripComments(ROUTE + HOOK);
  assert.ok(!/\.\.\.\s*(envelope|payload|row)\b/.test(code), "no spreading");
  for (const forbidden of ["REDIS_URL", "objectKey", "signedUrl", "apiKey", "secret"]) {
    assert.ok(!new RegExp(forbidden, "i").test(code), `${forbidden} must not appear`);
  }
  // Replay reuses the SAME framing as live delivery, so nothing can be
  // enriched on the way out of the window.
  assert.equal((stripComments(ROUTE).match(/encodeSseFrame\(\{ event: "notification"/g) ?? []).length, 1);
});

// ---------------------------------------------------------------------------
// 30. 11-D is not claimed
// ---------------------------------------------------------------------------

test("30. connection limits are still not implemented or claimed", () => {
  const code = stripComments(ROUTE + HOOK);
  assert.ok(!/connectionLimit|maxConnections|evictIdle|perTenantConnections/i.test(code));
});

// ---------------------------------------------------------------------------
// The envelope-to-update seam
// ---------------------------------------------------------------------------

test("the cursor comes from the frame, never from the payload", () => {
  const envelope = {
    eventId: "e1",
    channelId: `user:${OWNER}`,
    tenantId: OWNER,
    eventType: "generation.completed",
    occurredAt: "2026-08-24T10:00:00.000Z",
    // A payload that tries to name its own position.
    seq: "999999-0",
    projection: { uiState: "completed", subject: { kind: "generation", id: GEN }, detail: {} },
  };

  const fromFrame = toRealtimeUpdate(envelope, "100-0");
  assert.equal(fromFrame?.seq, "100-0", "the frame id wins");

  const noFrameId = toRealtimeUpdate(envelope);
  assert.equal(noFrameId?.seq, undefined, "a payload cannot supply a cursor");
});
