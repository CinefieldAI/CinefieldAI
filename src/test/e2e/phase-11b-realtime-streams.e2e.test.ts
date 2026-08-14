import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { channelForTenant } from "@/lib/notification/channel-identity";
import {
  jitteredMaxAgeMs,
  retentionMinId,
  streamKeyFor,
  SSE_BLOCK_MS,
  SSE_CONNECTION_MAX_AGE_MS,
  SSE_HEARTBEAT_MS,
  SSE_MAX_BUFFERED_BYTES,
  SSE_READ_BATCH,
  STREAM_MAXLEN_APPROX,
  STREAM_RETENTION_MS,
} from "@/lib/realtime/stream-contract";
import { encodeSseComment, encodeSseFrame, SSE_HEADERS } from "@/lib/realtime/sse-frame";
import { toRealtimeUpdate } from "@/lib/realtime/browser-state";
import { publishNotification } from "@/lib/realtime/notification-stream-adapter";
import type { OutboxRow } from "@/lib/notification/notification-service";

/**
 * Phase 11-B. Redis Streams fan-out, the SSE gateway, and the browser mapping.
 *
 * The property the whole package rests on: a stream key can only be produced
 * from a channel the database captured, and only one module may write to one.
 */

const ROOT = process.cwd();
const OWNER = "user_2abcdefghijklmnop";
const OTHER = "user_2zyxwvutsrqponml";
const GEN = "11111111-1111-4111-8111-111111111111";

const ADAPTER = readFileSync(path.join(ROOT, "src/lib/realtime/notification-stream-adapter.ts"), "utf8");
const CONTRACT = readFileSync(path.join(ROOT, "src/lib/realtime/stream-contract.ts"), "utf8");
const REDIS_MOD = readFileSync(path.join(ROOT, "src/lib/realtime/realtime-redis.ts"), "utf8");
const ROUTE = readFileSync(path.join(ROOT, "src/app/api/realtime/events/route.ts"), "utf8");
const HOOK = readFileSync(path.join(ROOT, "src/hooks/useRealtimeGenerations.ts"), "utf8");
const FRAME = readFileSync(path.join(ROOT, "src/lib/realtime/sse-frame.ts"), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(full)) out.push(full);
  }
  return out;
}

const SOURCE_FILES = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "worker"))];

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    eventId: "33333333-3333-4333-8333-333333333333",
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: GEN,
    occurredAt: "2026-08-24T10:00:00.000Z",
    tenantId: OWNER,
    payload: { generationId: GEN, provider: "fal" },
    ...over,
  };
}

/**
 * Records every Redis call without opening a socket. Injected through the
 * adapter's publisher parameter rather than by patching a module, which ESM
 * does not permit and which would hide the seam from the type checker.
 */
function fakeRedis(behaviour: { failXadd?: boolean } = {}) {
  const calls: { cmd: string; args: (string | number)[] }[] = [];
  return {
    calls,
    publisher: {
      async xadd(...args: (string | number)[]) {
        calls.push({ cmd: "xadd", args });
        if (behaviour.failXadd) throw new Error("ECONNREFUSED");
        return "1756032000000-0";
      },
      async xtrim(...args: (string | number)[]) {
        calls.push({ cmd: "xtrim", args });
        return 0;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 1–2. Streams only, Redis A only
// ---------------------------------------------------------------------------

test("1. Redis Streams are used and Pub/Sub is absent from the realtime package", () => {
  const pkg = stripComments(ADAPTER + CONTRACT + REDIS_MOD + ROUTE);
  assert.match(pkg, /xadd/i, "the adapter must append to a stream");
  assert.match(pkg, /xread/i, "the gateway must read a stream");
  // The forbidden transport, in every spelling ioredis accepts.
  assert.ok(!/\.publish\(|\.subscribe\(|psubscribe|SUBSCRIBE|PUBLISH/.test(pkg), "Pub/Sub is forbidden");
});

test("2. Phase 11-B reads Redis A only; Redis B is never referenced", () => {
  // Code only: the headers EXPLAIN that Redis B is out of scope, which is
  // documentation of the boundary rather than a use of it.
  const pkg = stripComments(ADAPTER + CONTRACT + REDIS_MOD + ROUTE + HOOK);
  assert.ok(!/BULLMQ_REDIS_URL|bullmq/i.test(pkg), "Redis B is BullMQ-only and out of scope");
  assert.match(stripComments(REDIS_MOD), /getRedisConfig\(\)/, "must resolve Redis A through the shared config");
});

// ---------------------------------------------------------------------------
// 3–4. The key is derived, never supplied
// ---------------------------------------------------------------------------

test("3. the stream key is canonical and derives from the ChannelId", () => {
  const channel = channelForTenant(OWNER);
  assert.ok(channel.ok);
  if (!channel.ok) return;
  assert.equal(streamKeyFor(channel.channelId), `cinefield:realtime:v1:user:${OWNER}`);
});

test("4. an arbitrary client-chosen stream target is impossible", () => {
  // Compile-time: streamKeyFor takes ChannelId, whose only constructor is
  // channelForTenant. Runtime: the route reads no request-supplied identity.
  const code = stripComments(ROUTE);
  for (const param of ["searchParams", "URL(request.url)", "?user=", "?workspace=", "?channel=", "?stream="]) {
    assert.ok(!code.includes(param), `the gateway must not read ${param}`);
  }
  assert.match(code, /const \{ userId \} = await auth\(\)/, "identity comes from the session");
  assert.match(code, /channelForTenant\(userId\)/, "the channel derives from that identity");

  // And the hook cannot ask for one either.
  assert.ok(!/\?|&/.test(/const ENDPOINT = "([^"]+)"/.exec(HOOK)?.[1] ?? ""), "the client URL carries no parameters");
});

// ---------------------------------------------------------------------------
// 5–6. Bounded retention, described honestly
// ---------------------------------------------------------------------------

test("5. every XADD is bounded by an approximate MAXLEN", async () => {
  const fake = fakeRedis();
  const outcome = await publishNotification(row(), fake.publisher);
  assert.equal(outcome.published, true);
  const xadd = fake.calls.find((c) => c.cmd === "xadd");
  assert.ok(xadd, "XADD must be issued");
  assert.deepEqual(xadd.args.slice(1, 4), ["MAXLEN", "~", STREAM_MAXLEN_APPROX]);
});

test("6. the 15-minute limit is enforced by MINID, and MAXLEN is not claimed to be exact", async () => {
  assert.equal(STREAM_RETENTION_MS, 15 * 60 * 1000);

  // MINID is derived from wall-clock, because stream ids are `<ms>-<seq>`.
  const now = 1_756_032_000_000;
  assert.equal(retentionMinId(now), `${now - STREAM_RETENTION_MS}-0`);
  assert.equal(retentionMinId(0), "0-0", "must not produce a negative id");

  const fake = fakeRedis();
  await publishNotification(row(), fake.publisher);
  const xtrim = fake.calls.find((c) => c.cmd === "xtrim");
  assert.ok(xtrim, "a time trim must run on publish");
  assert.equal(xtrim.args[1], "MINID");

  // The honesty requirement: the source must state that MAXLEN ~ is
  // approximate rather than presenting it as a hard cap.
  assert.match(CONTRACT, /APPROXIMATE/, "the approximate nature of MAXLEN ~ must be documented");
  assert.match(CONTRACT, /EXACT/, "the exact mechanism must be identified");
});

// ---------------------------------------------------------------------------
// 7–8. Identity survives at-least-once delivery
// ---------------------------------------------------------------------------

test("7. eventId is preserved onto the stream", async () => {
  const fake = fakeRedis();
  const outcome = await publishNotification(
    row({ eventId: "44444444-4444-4444-8444-444444444444" }),
    fake.publisher
  );
  assert.equal(outcome.published, true);
  const xadd = fake.calls.find((c) => c.cmd === "xadd");
  const envelope = JSON.parse(String(xadd?.args.at(-1)));
  assert.equal(envelope.eventId, "44444444-4444-4444-8444-444444444444");
});

test("8. a duplicate outbox delivery keeps ONE logical identity", async () => {
  const fake = fakeRedis();
  const duplicate = row();
  await publishNotification(duplicate, fake.publisher);
  await publishNotification(duplicate, fake.publisher);

  const envelopes = fake.calls
    .filter((c) => c.cmd === "xadd")
    .map((c) => JSON.parse(String(c.args.at(-1))) as { eventId: string });

  assert.equal(envelopes.length, 2, "XADD is not idempotent; two entries are expected");
  assert.equal(envelopes[0].eventId, envelopes[1].eventId, "but the logical identity must be identical");
  // No second DOMAIN event was invented.
  assert.equal(new Set(envelopes.map((e) => e.eventId)).size, 1);
});

// ---------------------------------------------------------------------------
// 9–12. One publisher, structurally
// ---------------------------------------------------------------------------

test("9-12. only the canonical adapter may XADD — no worker, provider or media path", () => {
  const CANONICAL = path.join(ROOT, "src", "lib", "realtime", "notification-stream-adapter.ts");
  const offenders: string[] = [];

  for (const file of SOURCE_FILES) {
    if (file === CANONICAL) continue;
    if (file.includes(`${path.sep}test${path.sep}`) || /\.test\.tsx?$/.test(file)) continue;
    const code = stripComments(readFileSync(file, "utf8"));
    if (/\.xadd\s*\(/.test(code)) offenders.push(path.relative(ROOT, file));
  }

  assert.deepEqual(offenders, [], "XADD outside the canonical adapter");

  // And the specific lanes the roadmap names, checked by name so a failure
  // says which boundary broke.
  for (const lane of ["worker", "src/lib/orchestration", "src/lib/media", "src/trigger"]) {
    const files = SOURCE_FILES.filter((f) => path.relative(ROOT, f).replace(/\\/g, "/").startsWith(lane));
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      assert.ok(!/xadd|realtime-redis|notification-stream-adapter/i.test(code),
        `${lane} must not publish realtime directly: ${path.relative(ROOT, file)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 13–15. SSE wire contract
// ---------------------------------------------------------------------------

test("13. Content-Type is text/event-stream", () => {
  assert.match(SSE_HEADERS["Content-Type"], /^text\/event-stream/);
});

test("14. the response is private and uncacheable", () => {
  const cc = SSE_HEADERS["Cache-Control"];
  assert.match(cc, /private/);
  assert.match(cc, /no-cache/);
  assert.match(cc, /no-store/);
  assert.equal(SSE_HEADERS["X-Accel-Buffering"], "no", "a buffering proxy would hold the stream");
});

test("15. an unauthenticated connection is refused before any Redis work", () => {
  const code = stripComments(ROUTE);
  const authIndex = code.indexOf("await auth()");
  const readerIndex = code.indexOf("createRealtimeReader()");
  assert.ok(authIndex >= 0 && readerIndex > authIndex, "auth must precede the reader");
  assert.match(code, /if \(!userId\)[\s\S]{0,80}status: 401/);
});

test("frames are well formed and newline-safe", () => {
  const frame = encodeSseFrame({ event: "notification", data: { text: "line1\nline2" }, id: "1-0" });
  assert.ok(frame.startsWith("id: 1-0\nevent: notification\ndata: "));
  assert.ok(frame.endsWith("\n\n"), "a frame must be terminated by a blank line");
  // The embedded newline must be escaped, not split across two data lines.
  assert.equal(frame.split("\n").filter((l) => l.startsWith("data: ")).length, 1);
  assert.ok(encodeSseComment("hb").startsWith(":"));
});

// ---------------------------------------------------------------------------
// 16. Tenant isolation
// ---------------------------------------------------------------------------

test("16. one tenant cannot reach another tenant's stream", async () => {
  const mine = channelForTenant(OWNER);
  const theirs = channelForTenant(OTHER);
  assert.ok(mine.ok && theirs.ok);
  if (!mine.ok || !theirs.ok) return;
  assert.notEqual(streamKeyFor(mine.channelId), streamKeyFor(theirs.channelId));

  // An event published for one owner lands only on that owner's key.
  const fake = fakeRedis();
  await publishNotification(row({ tenantId: OTHER }), fake.publisher);
  const key = String(fake.calls.find((c) => c.cmd === "xadd")?.args[0]);
  assert.equal(key, streamKeyFor(theirs.channelId));
  assert.ok(!key.includes(OWNER));
});

test("a historical row with no captured tenant is never broadcast", async () => {
  const fake = fakeRedis();
  const outcome = await publishNotification(row({ tenantId: null }), fake.publisher);
  assert.equal(outcome.published, false);
  assert.equal(outcome.published === false && outcome.reason, "unroutable");
  assert.equal(fake.calls.length, 0, "nothing may be written for an unroutable event");
});

// ---------------------------------------------------------------------------
// 17–19. Heartbeat, budget, cleanup
// ---------------------------------------------------------------------------

test("17. a heartbeat is emitted, well under any proxy idle timeout", () => {
  assert.ok(SSE_HEARTBEAT_MS <= 20_000, "must be comfortably under a 30s idle cut");
  assert.ok(SSE_BLOCK_MS <= SSE_HEARTBEAT_MS, "the block must be short enough to heartbeat on time");
  assert.match(stripComments(ROUTE), /encodeSseComment\("hb"\)/);
});

test("18. the connection ends on its own budget, before the platform ceiling", () => {
  assert.ok(SSE_CONNECTION_MAX_AGE_MS <= 55_000, "must sit under the most restrictive documented default");
  const code = stripComments(ROUTE);
  assert.match(code, /Date\.now\(\) - startedAt >= maxAgeMs/);
  assert.match(code, /event: "reconnect"/, "the client must be told this was deliberate");

  // Jitter spreads reconnects across a ±10% window.
  const low = jitteredMaxAgeMs(0);
  const high = jitteredMaxAgeMs(1);
  assert.ok(low < SSE_CONNECTION_MAX_AGE_MS && high > SSE_CONNECTION_MAX_AGE_MS);
  assert.equal(low, Math.round(SSE_CONNECTION_MAX_AGE_MS * 0.9));
  assert.equal(high, Math.round(SSE_CONNECTION_MAX_AGE_MS * 1.1));
});

test("19. abort releases the Redis reader on every path", () => {
  const code = stripComments(ROUTE);
  assert.match(code, /request\.signal\.addEventListener\("abort", release/);
  assert.match(code, /cancel\(\)\s*\{\s*release\(\);/, "stream cancel must release too");
  assert.match(code, /finally\s*\{\s*release\(\)/, "the loop must release on exit");
  assert.match(code, /reader\.disconnect\(\)/);
});

test("a dedicated reader is used so blocking cannot starve request traffic", () => {
  const code = stripComments(REDIS_MOD);
  assert.match(code, /export function createRealtimeReader/);
  assert.match(code, /maxRetriesPerRequest: null/, "a blocking command needs the retry counter disabled");
  // The publisher must never block.
  const publisherBody = code.slice(code.indexOf("getRealtimePublisher"), code.indexOf("createRealtimeReader"));
  assert.ok(!/xread|BLOCK/i.test(publisherBody), "the shared publisher must not block");
});

// ---------------------------------------------------------------------------
// 20–21. Backpressure
// ---------------------------------------------------------------------------

test("20. reads are batched, never unbounded", () => {
  assert.ok(SSE_READ_BATCH > 0 && SSE_READ_BATCH <= 100);
  const code = stripComments(ROUTE);
  assert.match(code, /"COUNT",\s*SSE_READ_BATCH/);
  assert.match(code, /cursor = "\$"/, "11-B starts live; history is 11-C's replay window");
});

test("21. a slow browser is closed rather than buffered without limit", () => {
  assert.ok(SSE_MAX_BUFFERED_BYTES > 0 && SSE_MAX_BUFFERED_BYTES <= 1024 * 1024);
  const code = stripComments(ROUTE);
  assert.match(code, /buffered > SSE_MAX_BUFFERED_BYTES/);
  assert.match(code, /desiredSize/, "the stream's own backpressure signal must be consulted");
});

// ---------------------------------------------------------------------------
// 22–26. Browser state mapping
// ---------------------------------------------------------------------------

function envelope(uiState: string, detail: Record<string, string | number> = {}) {
  return {
    eventId: "77777777-7777-4777-8777-777777777777",
    channelId: `user:${OWNER}`,
    tenantId: OWNER,
    eventType: "generation.x",
    occurredAt: "2026-08-24T10:00:00.000Z",
    projection: { uiState, subject: { kind: "generation", id: GEN }, detail },
  };
}

test("22-26. queued, processing, completed, failed and cancelled all map", () => {
  for (const state of ["queued", "processing", "completed", "failed", "cancelled"]) {
    const update = toRealtimeUpdate(envelope(state));
    assert.ok(update, `${state} must map`);
    assert.equal(update?.state, state);
    assert.equal(update?.generationId, GEN);
  }
});

test("an unsupported or malformed envelope is ignored, never guessed at", () => {
  assert.equal(toRealtimeUpdate(null), null);
  assert.equal(toRealtimeUpdate({}), null);
  assert.equal(toRealtimeUpdate(envelope("credit.updated")), null, "Phase 10 owns credit");
  assert.equal(toRealtimeUpdate(envelope("security.warning")), null, "Phase 12 owns security");
  assert.equal(toRealtimeUpdate(envelope("something_new")), null);
  // A non-generation subject is not a generation update.
  const assetish = envelope("completed");
  assetish.projection.subject.kind = "asset";
  assert.equal(toRealtimeUpdate(assetish), null);
});

test("detail is copied only when it is already the promised shape", () => {
  const ok = toRealtimeUpdate(envelope("failed", { errorCode: "PROVIDER_TIMEOUT" }));
  assert.deepEqual(ok?.detail, { errorCode: "PROVIDER_TIMEOUT" });

  const hostile = envelope("completed");
  (hostile.projection as { detail: unknown }).detail = { nested: { secret: "x" } };
  assert.deepEqual(toRealtimeUpdate(hostile)?.detail, {}, "a non-scalar detail is dropped whole");
});

// ---------------------------------------------------------------------------
// 27–28. No Phase 10 or Phase 12 fabrication
// ---------------------------------------------------------------------------

test("27. no credit producer exists anywhere in this package", () => {
  const pkg = stripComments(ADAPTER + CONTRACT + REDIS_MOD + ROUTE + HOOK);
  assert.ok(!/credit\.(reserved|settled|refunded|updated)/.test(pkg), "11-B emits no credit event");
  assert.ok(!/stripe/i.test(pkg));
});

test("28. no security verdict is fabricated", () => {
  const pkg = stripComments(ADAPTER + CONTRACT + REDIS_MOD + ROUTE + HOOK);
  assert.ok(!/security\.warning|riskScore|risk_engine/i.test(pkg), "Phase 12 owns the taxonomy");
});

// ---------------------------------------------------------------------------
// 29–30. Redis failure semantics
// ---------------------------------------------------------------------------

test("29. Redis being unavailable leaves the outbox row recoverable", async () => {
  // No client at all, then a client that throws.
  const noClient = await publishNotification(row(), null);
  assert.equal(noClient.published, false);
  assert.equal(noClient.published === false && noClient.reason, "transport_unavailable");

  const failing = await publishNotification(row(), fakeRedis({ failXadd: true }).publisher);
  assert.equal(failing.published, false);
  assert.equal(failing.published === false && failing.reason, "transport_failed");

  // Nothing in the adapter marks a row published or delivered.
  const code = stripComments(ADAPTER);
  assert.ok(!/markPublished|published_at|update\(/i.test(code), "the adapter must not resolve outbox state");
});

test("30. a realtime failure cannot retry a provider or mutate a generation", () => {
  const imports = ADAPTER.match(/^import .*$/gm)?.join("\n") ?? "";
  for (const forbidden of ["orchestrat", "provider", "temporal", "supabase", "credits", "media/"]) {
    assert.ok(!new RegExp(forbidden, "i").test(imports), `the adapter must not import ${forbidden}`);
  }
  const code = stripComments(ADAPTER + ROUTE);
  assert.ok(!/retry|resubmit|startWorkflow|reserveCredits|settle/i.test(code));
});

// ---------------------------------------------------------------------------
// 31–32. Payload minimization on the wire
// ---------------------------------------------------------------------------

test("31. the stream entry carries the envelope only — no raw payload spread", async () => {
  const fake = fakeRedis();
  await publishNotification(row(), fake.publisher);
  const xadd = fake.calls.find((c) => c.cmd === "xadd");
  // id-spec, field-name, field-value — exactly one field pair.
  const tail = xadd?.args.slice(4) ?? [];
  assert.deepEqual(tail.slice(0, 2), ["*", "envelope"]);
  assert.equal(tail.length, 3, "one field only");
  assert.ok(!/\.\.\.\s*(row|payload|event)\b/.test(stripComments(ADAPTER)), "no spreading");
});

test("32. secrets, storage keys and signed URLs cannot reach the wire", async () => {
  const fake = fakeRedis();
  // A hostile payload. The 11-A schema refuses it outright, so nothing is
  // published at all — the strongest possible answer.
  const outcome = await publishNotification(
    row({ payload: { generationId: GEN, provider: "fal", objectKey: "r2/secret.png", signedUrl: "https://x" } }),
    fake.publisher
  );
  assert.equal(outcome.published, false);
  assert.equal(outcome.published === false && outcome.reason, "invalid");

  // And a legitimate event carries only allowlisted fields.
  await publishNotification(
    row({ payload: { generationId: GEN, provider: "fal", durationMs: 10 } }),
    fake.publisher
  );
  const serialized = String(fake.calls.find((c) => c.cmd === "xadd")?.args.at(-1) ?? "");
  for (const forbidden of ["objectKey", "signedUrl", "bucket", "secret", "apiKey", "prompt", "stack", "approver"]) {
    assert.ok(!new RegExp(forbidden, "i").test(serialized), `${forbidden} must not reach the stream`);
  }
});

// ---------------------------------------------------------------------------
// Boundary: 11-C and 11-D are not started
// ---------------------------------------------------------------------------

test("the cursor 11-B put on the wire is what 11-C resumes from", () => {
  // 11-B emitted the stream id as the SSE `id:` and deliberately did not read
  // it back, because honouring resume halfway would let a client believe it
  // had resumed when it had not. 11-C landed, so this now asserts the pair is
  // COMPLETE rather than absent: the id is still written, the header is read,
  // and completeness is decided rather than assumed.
  assert.match(stripComments(FRAME), /id: \$\{id\}/, "the cursor must still be written");

  const code = stripComments(ROUTE);
  assert.match(code, /request\.headers\.get\("last-event-id"\)/, "resume must read the header");
  assert.match(code, /decideResume\(/, "completeness must be decided, not assumed");
  assert.match(code, /event: "reconcile"/, "an unprovable replay must instruct a refetch");
});

test("11-D's connection limits are not claimed", () => {
  const code = stripComments(ROUTE);
  assert.ok(!/connectionLimit|maxConnections|evictIdle/i.test(code), "11-D owns connection limits");
});
