import { auth } from "@clerk/nextjs/server";
import { createRealtimeReader } from "@/lib/realtime/realtime-redis";
import { resolveEffectiveTenant } from "@/lib/realtime/tenant-binding";
import {
  CONNECTION_LIMIT_RETRY_SECONDS,
  CONNECTION_LIMIT_STATUS,
  ipBucket,
  LEASE_REFRESH_MS,
  scopesFor,
  trustedClientIp,
} from "@/lib/realtime/connection-limits";
import {
  acquireConnectionLease,
  refreshConnectionLease,
  releaseConnectionLease,
  type ConnectionLease,
} from "@/lib/realtime/connection-lease";
import { encodeSseComment, encodeSseFrame, SSE_HEADERS } from "@/lib/realtime/sse-frame";
import {
  jitteredMaxAgeMs,
  REPLAY_BATCH,
  REPLAY_MAX_EVENTS,
  SSE_BLOCK_MS,
  SSE_HEARTBEAT_MS,
  SSE_MAX_BUFFERED_BYTES,
  SSE_READ_BATCH,
  streamKeyFor,
} from "@/lib/realtime/stream-contract";
import { decideResume, exclusiveStart } from "@/lib/realtime/stream-cursor";

/**
 * GET /api/realtime/events — the SSE Gateway (Phase 11-B).
 *
 * THE SUBSCRIPTION TARGET IS NOT A PARAMETER.
 *
 * The roadmap forbids the shape outright: "`/events?workspace=...` gibi
 * istemci-kontrollü subscription hedefi KULLANILMAZ." This handler reads NO
 * query string, NO body and NO header for identity. The channel comes from
 * `auth()` and from `channelForTenant`, whose branded return type is the only
 * thing `streamKeyFor` accepts — so a client-supplied string cannot reach the
 * Redis key even if a future edit tried to pass one. `?user=`, `?workspace=`,
 * `?channel=` and `?stream=` are not rejected by a validator; they are simply
 * never read.
 *
 * Authorization happens once, at connection open, and the resolved channel is
 * captured in a const for the connection's life. 11-D adds membership and
 * effective-workspace rules on top of this and the per-tenant connection
 * ceiling; the boundary it strengthens already exists here.
 *
 * THE BINDING IS IMMUTABLE (Phase 11-D). Principal, membership and effective
 * tenant are resolved ONCE, before the response body exists, and captured in
 * a const. There is no code path that re-resolves them, and no parameter
 * through which a later request could try.
 *
 * EVERY CONNECTION HOLDS A LEASE (Phase 11-D). Slots are counted in Redis A —
 * not in process memory, which on serverless would mean the ceiling applies
 * per instance and resets on every cold start. Acquire, refresh and release
 * are single Lua scripts, so N simultaneous opens admit exactly the limit.
 * The counter being unreachable REFUSES the connection: a DoS control that
 * disables itself during an outage is not a control.
 *
 * RESUME IS A CURSOR, NOT AN AUTHORITY (Phase 11-C). `Last-Event-ID` can move
 * a reader forwards or backwards WITHIN the one stream the session already
 * resolved. It is parsed by shape, it never selects a key, and a value that
 * cannot be trusted to produce a complete replay is answered with a
 * reconciliation instruction rather than a partial one.
 *
 * IT ENDS ITSELF. No `vercel.json` exists and no route in this repository sets
 * `maxDuration`, so the deployed ceiling cannot be proven from the source. The
 * connection therefore closes on its own budget, under the most restrictive
 * documented Vercel default, rather than waiting to be killed mid-frame at an
 * unknown moment. The browser reconnects; 11-C makes that reconnect lossless.
 */

// ioredis needs a TCP socket, which the Edge runtime does not provide.
export const runtime = "nodejs";
// Never prerendered, never cached: it is a per-user stream.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  // PRINCIPAL -> MEMBERSHIP -> EFFECTIVE TENANT, once.
  const binding = resolveEffectiveTenant(userId);
  if (!binding.ok) {
    // A signed-in principal whose id does not match the tenant shape is a
    // configuration fault, not a routing puzzle. Refuse rather than guess.
    return new Response("Forbidden", { status: 403 });
  }
  const tenant = binding.tenant;
  const streamKey = streamKeyFor(tenant.channelId);

  // ---- CONNECTION CEILING (11-D) -----------------------------------------
  // Taken before a reader is opened, so a refused connection costs no socket.
  const scopes = scopesFor(tenant, ipBucket(trustedClientIp(request.headers)));
  const acquired = await acquireConnectionLease(scopes);

  if (!acquired.granted) {
    // A product-safe refusal. No count, no limit, no scope, no other
    // tenant's usage — only how long to wait, so the client backs off
    // instead of reconnecting into the same answer every 500 ms.
    const status = acquired.reason === "limit_exceeded" ? CONNECTION_LIMIT_STATUS : 503;
    return new Response(
      acquired.reason === "limit_exceeded" ? "Too many realtime connections" : "Realtime unavailable",
      { status, headers: { "Retry-After": String(CONNECTION_LIMIT_RETRY_SECONDS) } }
    );
  }

  const lease: ConnectionLease = { leaseId: acquired.leaseId, scopes };

  const reader = createRealtimeReader();
  if (!reader) {
    // Realtime is unavailable; the product is not. Return the slot first.
    await releaseConnectionLease(lease);
    return new Response("Realtime unavailable", { status: 503 });
  }

  const encoder = new TextEncoder();
  const maxAgeMs = jitteredMaxAgeMs(Math.random());
  const startedAt = Date.now();

  let closed = false;
  let leaseTimer: ReturnType<typeof setInterval> | null = null;

  const release = () => {
    if (closed) return;
    closed = true;
    // Stop refreshing FIRST: an interval that outlived the connection would
    // hold a slot open for a browser that has gone.
    if (leaseTimer !== null) {
      clearInterval(leaseTimer);
      leaseTimer = null;
    }
    // Ends the outstanding XREAD BLOCK and frees the socket. Called from the
    // abort signal, from the budget expiry, and from any error path — a
    // reader that outlived its response would be a leaked connection per
    // vanished browser.
    reader.disconnect();
    // Best effort. The lease's own expiry is the backstop that makes a
    // crashed instance recover without this ever running.
    void releaseConnectionLease(lease);
  };

  request.signal.addEventListener("abort", release, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffered = 0;

      const send = (chunk: string): boolean => {
        if (closed) return false;
        const bytes = encoder.encode(chunk);

        // BACKPRESSURE. `desiredSize` goes negative once the consumer stops
        // reading. A browser that has stopped is not worth buffering for:
        // closing costs it a reconnect, while buffering costs the server
        // memory it cannot bound.
        buffered += bytes.byteLength;
        if (buffered > SSE_MAX_BUFFERED_BYTES || (controller.desiredSize ?? 0) < -SSE_MAX_BUFFERED_BYTES) {
          return false;
        }

        try {
          controller.enqueue(bytes);
          // Enqueued successfully means it left our accounting.
          buffered = 0;
          return true;
        } catch {
          return false;
        }
      };

      /**
       * Frames one stream entry. Shared by replay and live delivery so both
       * paths carry the SAME `id:` cursor and the same parse rules — a
       * replayed event that framed differently from a live one would make the
       * client's ordering comparison meaningless.
       *
       * Returns false when the consumer can take no more.
       */
      const forwardEntry = (streamId: string, fields: string[]): boolean => {
        // Entries are written by exactly one adapter with exactly one field.
        // Anything else is not ours to interpret.
        const at = fields.indexOf("envelope");
        if (at === -1) return true;
        const raw = fields[at + 1];
        if (typeof raw !== "string") return true;

        let envelope: unknown;
        try {
          envelope = JSON.parse(raw);
        } catch {
          // Skipped, never forwarded. The cursor still advances past it.
          return true;
        }

        return send(encodeSseFrame({ event: "notification", data: envelope, id: streamId }));
      };

      // IDLE EVICTION. The lease is extended only while this loop is alive
      // and the abort signal has not fired. A connection whose client
      // vanished stops refreshing and falls out of the sorted set on its own;
      // a lease that has already gone (expired, or evicted) cannot be
      // resurrected, so the connection closes rather than exceeding a ceiling
      // it no longer holds a slot in.
      leaseTimer = setInterval(() => {
        if (closed) return;
        void refreshConnectionLease(lease).then((alive) => {
          if (!alive) release();
        });
      }, LEASE_REFRESH_MS);

      // Open immediately so the browser's `onopen` fires and any proxy sees
      // bytes before its idle timer starts.
      send(encodeSseComment("open"));
      send(encodeSseFrame({ event: "ready", data: { channel: tenant.channelId } }));

      // ---- RESUME (11-C) ---------------------------------------------------
      // The oldest retained entry is what decides whether a replay can be
      // PROVEN complete. Reading one entry is cheap and is the only way to
      // distinguish "your cursor is still in the window" from "everything you
      // missed has been trimmed".
      let cursor = "$";
      let lastHeartbeat = Date.now();

      try {
        let oldestRetained: string | null = null;
        try {
          const head = (await reader.xrange(streamKey, "-", "+", "COUNT", 1)) as
            | [string, string[]][]
            | null;
          oldestRetained = head?.[0]?.[0] ?? null;
        } catch {
          // Treated as "window unknown" below, which reconciles rather than
          // silently promising a complete replay.
          oldestRetained = null;
        }

        const resume = decideResume(request.headers.get("last-event-id"), oldestRetained);

        if (resume.mode === "reconcile") {
          // REALTIME IS NOT THE SOURCE OF TRUTH. The client refetches
          // authoritative state; no business event is synthesized to paper
          // over the gap, and live delivery continues from here.
          send(encodeSseFrame({ event: "reconcile", data: { reason: resume.reason } }));
        } else if (resume.mode === "replay") {
          let start = exclusiveStart(resume.from);
          let replayed = 0;
          let truncated = false;

          while (replayed < REPLAY_MAX_EVENTS) {
            const batch = (await reader.xrange(streamKey, start, "+", "COUNT", REPLAY_BATCH)) as
              | [string, string[]][]
              | null;
            if (!batch || batch.length === 0) break;

            for (const [streamId, fields] of batch) {
              if (replayed >= REPLAY_MAX_EVENTS) {
                truncated = true;
                break;
              }
              // Replayed entries come from the SAME key the session resolved,
              // so they pass the same tenant filter by construction — roadmap
              // 11.10. Nothing here re-reads a channel from the cursor.
              if (!forwardEntry(streamId, fields)) {
                closed = true;
                break;
              }
              cursor = streamId;
              replayed += 1;
            }

            if (closed) break;
            if (batch.length < REPLAY_BATCH) break;
            start = `(${batch[batch.length - 1][0]}`;
          }

          if (truncated) {
            // The cap was reached. A partial replay the client believes is
            // complete is exactly the failure this package exists to avoid.
            send(encodeSseFrame({ event: "reconcile", data: { reason: "replay_truncated" } }));
          }
          send(encodeSseFrame({ event: "resumed", data: { replayed } }));
        }

        if (closed) throw new Error("client_gone");

        while (!closed) {
          if (Date.now() - startedAt >= maxAgeMs) {
            // Deliberate, announced end-of-life. The client treats this as a
            // normal close and reconnects.
            send(encodeSseFrame({ event: "reconnect", data: { reason: "max_age" } }));
            break;
          }

          const result = (await reader.xread(
            "COUNT",
            SSE_READ_BATCH,
            "BLOCK",
            SSE_BLOCK_MS,
            "STREAMS",
            streamKey,
            cursor
          )) as [string, [string, string[]][]][] | null;

          if (closed) break;

          if (!result) {
            // Block expired with nothing new. Heartbeat if it is due; the
            // short block is what keeps abort and budget checks responsive.
            if (Date.now() - lastHeartbeat >= SSE_HEARTBEAT_MS) {
              if (!send(encodeSseComment("hb"))) break;
              lastHeartbeat = Date.now();
            }
            continue;
          }

          for (const [, entries] of result) {
            for (const [streamId, fields] of entries) {
              cursor = streamId;
              if (!forwardEntry(streamId, fields)) {
                closed = true;
                break;
              }
            }
            if (closed) break;
          }

          lastHeartbeat = Date.now();
        }
      } catch {
        // A transport fault ends this connection and nothing else. No
        // generation is touched, no provider retried, no credit moved.
      } finally {
        release();
        try {
          controller.close();
        } catch {
          /* already closed by the consumer */
        }
      }
    },

    cancel() {
      release();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
