import "server-only";
import type { ChannelId } from "@/lib/notification/channel-identity";

/**
 * Realtime stream contract (Phase 11-B).
 *
 * STREAMS, NOT PUB/SUB. The roadmap closed the option explicitly: "Pub/Sub
 * replay ve cursor sağlamadığı için Streams bağlayıcıdır." Pub/Sub delivers to
 * whoever happens to be listening and forgets; a reconnecting browser would
 * lose everything sent while it was away, and 11-C's replay window would have
 * nothing to read from. Nothing in this package may call PUBLISH or SUBSCRIBE.
 *
 * REDIS A, NEVER REDIS B. Redis A is application state; Redis B is BullMQ
 * queue state ONLY, per the roadmap's diagram correction. Realtime fan-out is
 * application state. Nothing here reads BULLMQ_REDIS_URL.
 *
 * THE KEY IS NOT AN INPUT. `streamKeyFor` accepts a `ChannelId` — the branded
 * type from Phase 11-A whose only constructor takes a database-captured
 * tenant. A string from a query parameter cannot be passed here, so a browser
 * cannot name a stream even if a route forgot to check. That is a compile-time
 * guarantee, not a runtime one.
 */

/**
 * `cinefield:realtime:v1:user:<clerk id>`
 *
 * The namespace is versioned like every other Redis keyspace in the
 * repository, so a future envelope change can move to `v2` without a reader
 * ever seeing a mix of shapes in one stream.
 *
 * The channel id contains the Clerk user id. That is an opaque account
 * identifier, not personal data, and it is already the tenant key on every
 * table — carrying it in the key is what makes per-tenant isolation
 * expressible at all. Nothing else about the user is encoded.
 */
export function streamKeyFor(channelId: ChannelId): string {
  return `cinefield:realtime:v${REALTIME_STREAM_VERSION}:${channelId}`;
}

export const REALTIME_STREAM_VERSION = 1;

/**
 * RETENTION — TWO LIMITS, TWO MECHANISMS, AND THEY ARE NOT THE SAME.
 *
 * The roadmap asks for "son 15 dakika veya son 200 event, hangisi önce
 * dolarsa". Redis enforces those two with different primitives and different
 * strengths, and conflating them would be a false claim:
 *
 *   MAXLEN ~ 200   APPROXIMATE. The `~` lets Redis trim only at macro-node
 *                  boundaries, which is what makes XADD O(1). A stream can
 *                  legitimately sit above 200 for a while — verified live:
 *                  twelve entries written with `MAXLEN ~ 5` left all twelve.
 *                  So this is a cheap upper bound on growth, NOT a hard cap,
 *                  and it is not described as one anywhere.
 *
 *   XTRIM MINID    EXACT. Redis stream ids are `<ms>-<seq>`, so an id built
 *                  from `now - 15min` is a real time boundary and MINID
 *                  removes everything older. This is what actually delivers
 *                  the 15-minute window.
 *
 * A key TTL would give neither: EXPIRE deletes the WHOLE stream at once, so a
 * channel that went quiet for 15 minutes would lose its entire history rather
 * than its oldest slice — and an active channel's TTL would keep being pushed
 * out, bounding nothing. Per-entry TTL does not exist in Redis streams.
 *
 * Both run on every publish. MINID is O(log N) plus the number removed, so
 * paying it per publish is cheaper than a scheduler nobody would enable.
 */
export const STREAM_MAXLEN_APPROX = 200;
export const STREAM_RETENTION_MS = 15 * 60 * 1000;

/** `<ms>-0` — the exact lower bound for XTRIM MINID. */
export function retentionMinId(nowMs: number): string {
  return `${Math.max(0, nowMs - STREAM_RETENTION_MS)}-0`;
}

/**
 * CONNECTION BUDGET.
 *
 * The gateway ends its own stream before the platform can. No `vercel.json`
 * exists, no route sets `maxDuration`, and the deployed plan cannot be read
 * from this repository — so the ceiling is unproven and the budget is chosen
 * against the most restrictive documented Vercel default rather than an
 * assumed one. 50 s sits under a 60 s floor with room for the final flush.
 *
 * Raising this is a one-line change once the plan's real ceiling is
 * confirmed; guessing high and being killed mid-frame is not recoverable by
 * anything in 11-B.
 *
 * JITTER exists because every connection opened by one deploy would otherwise
 * expire in the same second and reconnect together. The spread is ±10%.
 */
export const SSE_CONNECTION_MAX_AGE_MS = 50_000;
export const SSE_MAX_AGE_JITTER_RATIO = 0.1;

/**
 * Heartbeat. Must be comfortably under the shortest idle timeout in the path —
 * proxies and CDNs commonly cut a silent connection at 30–60 s, and a stream
 * that only speaks when a generation changes state can easily be silent for
 * minutes.
 */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * BACKPRESSURE.
 *
 * A blocking read that asked for everything would let one busy channel pull
 * an unbounded batch into memory, and a browser that stops reading would let
 * the response queue grow without limit. Both are bounded:
 *
 *   READ_BATCH   entries per XREAD. Also bounds the initial catch-up read.
 *   BLOCK_MS     how long one XREAD waits before returning to the loop, which
 *                is what makes abort and max-age checks responsive.
 *   MAX_BUFFERED_BYTES  the ceiling on bytes queued toward a slow client
 *                before the connection is closed rather than buffered
 *                further. A slow reader costs itself a reconnect, not the
 *                server's memory.
 */
export const SSE_READ_BATCH = 50;
export const SSE_BLOCK_MS = 5_000;
export const SSE_MAX_BUFFERED_BYTES = 256 * 1024;

/** Applies the jitter. Separated so tests can assert the bounds. */
export function jitteredMaxAgeMs(random: number): number {
  const spread = SSE_CONNECTION_MAX_AGE_MS * SSE_MAX_AGE_JITTER_RATIO;
  return Math.round(SSE_CONNECTION_MAX_AGE_MS - spread + random * 2 * spread);
}
