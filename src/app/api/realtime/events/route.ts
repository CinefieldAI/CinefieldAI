import { auth } from "@clerk/nextjs/server";
import { channelForTenant } from "@/lib/notification/channel-identity";
import { createRealtimeReader } from "@/lib/realtime/realtime-redis";
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

  const channel = channelForTenant(userId);
  if (!channel.ok) {
    // A signed-in principal whose id does not match the tenant shape is a
    // configuration fault, not a routing puzzle. Refuse rather than guess.
    return new Response("Forbidden", { status: 403 });
  }

  const streamKey = streamKeyFor(channel.channelId);

  const reader = createRealtimeReader();
  if (!reader) {
    // Realtime is unavailable; the product is not. The browser falls back to
    // its normal state fetch, and the outbox still holds every fact.
    return new Response("Realtime unavailable", { status: 503 });
  }

  const encoder = new TextEncoder();
  const maxAgeMs = jitteredMaxAgeMs(Math.random());
  const startedAt = Date.now();

  let closed = false;
  const release = () => {
    if (closed) return;
    closed = true;
    // Ends the outstanding XREAD BLOCK and frees the socket. Called from the
    // abort signal, from the budget expiry, and from any error path — a
    // reader that outlived its response would be a leaked connection per
    // vanished browser.
    reader.disconnect();
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

      // Open immediately so the browser's `onopen` fires and any proxy sees
      // bytes before its idle timer starts.
      send(encodeSseComment("open"));
      send(encodeSseFrame({ event: "ready", data: { channel: channel.channelId } }));

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
