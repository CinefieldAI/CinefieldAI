import { auth } from "@clerk/nextjs/server";
import { channelForTenant } from "@/lib/notification/channel-identity";
import { createRealtimeReader } from "@/lib/realtime/realtime-redis";
import { encodeSseComment, encodeSseFrame, SSE_HEADERS } from "@/lib/realtime/sse-frame";
import {
  jitteredMaxAgeMs,
  SSE_BLOCK_MS,
  SSE_HEARTBEAT_MS,
  SSE_MAX_BUFFERED_BYTES,
  SSE_READ_BATCH,
  streamKeyFor,
} from "@/lib/realtime/stream-contract";

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

      // Open immediately so the browser's `onopen` fires and any proxy sees
      // bytes before its idle timer starts.
      send(encodeSseComment("open"));
      send(encodeSseFrame({ event: "ready", data: { channel: channel.channelId } }));

      // `$` = only entries added after this moment. 11-B is live delivery;
      // reading history belongs to 11-C's replay window, and starting from
      // the beginning here would replay up to fifteen minutes of state on
      // every reconnect with no dedupe to absorb it.
      let cursor = "$";
      let lastHeartbeat = Date.now();

      try {
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

              // Entries are written by exactly one adapter with exactly one
              // field. Anything else is not ours to interpret.
              const envelopeIndex = fields.indexOf("envelope");
              if (envelopeIndex === -1) continue;
              const raw = fields[envelopeIndex + 1];
              if (typeof raw !== "string") continue;

              let envelope: unknown;
              try {
                envelope = JSON.parse(raw);
              } catch {
                // A malformed entry is skipped, never forwarded. The cursor
                // has already advanced past it.
                continue;
              }

              if (!send(encodeSseFrame({ event: "notification", data: envelope, id: streamId }))) {
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
