import "server-only";
import Redis from "ioredis";
import { getRedisConfig } from "@/lib/redis/redis-config";

/**
 * Realtime Redis connections (Phase 11-B).
 *
 * TWO CLIENTS, AND THE SECOND ONE IS NOT AN OPTIMISATION.
 *
 * ioredis runs commands on one connection in order. `XREAD BLOCK 5000` does
 * not return until it has data or the block expires, and while it is
 * outstanding every other command queued on that connection waits behind it.
 * Sharing the application client — the one holding idempotency reads, rate
 * limit checks, lock acquisition and provider health writes — with a blocking
 * reader would stall ordinary request traffic behind a subscriber that is, by
 * design, doing nothing. So:
 *
 *   getRealtimePublisher()  shared, non-blocking. XADD and XTRIM only.
 *   createRealtimeReader()  one per SSE connection, blocking, disposable.
 *
 * PER-CONNECTION IS BOUNDED BY CONNECTIONS, NOT BY EVENTS. A reader is created
 * when a browser opens a stream and destroyed when it closes — never per event
 * and never per read. 11-D adds the ceiling on how many connections one tenant
 * may hold; until then the bound is "one socket per open SSE response", which
 * is the same shape every SSE implementation has.
 *
 * REDIS A ONLY. Both clients read `getRedisConfig()`, which reads `REDIS_URL`.
 * `BULLMQ_REDIS_URL` is not referenced in this package and must not be: Redis B
 * holds BullMQ queue state and nothing else.
 */

let publisher: Redis | null = null;

/**
 * The shared publisher. Never issues a blocking command, so it is safe to
 * reuse across requests.
 *
 * Returns null when Redis is not configured — callers must degrade rather than
 * throw. A realtime notification that cannot be published is a delivery
 * failure, and the outbox still holds the fact.
 */
export function getRealtimePublisher(): Redis | null {
  const config = getRedisConfig();
  if (!config) return null;

  if (!publisher) {
    publisher = new Redis(config.url, {
      // Importing this module must not open a socket; the connection is made
      // when the first command runs.
      lazyConnect: true,
      // A publish that cannot reach Redis must fail as a delivery failure
      // rather than hang a request behind an indefinite retry.
      maxRetriesPerRequest: 2,
      connectTimeout: 10_000,
      // REQUIRED WITH lazyConnect, and live validation is how that was
      // learned. With the offline queue disabled, ioredis rejects any command
      // issued while the socket is not yet established — and with
      // lazyConnect that is ALWAYS true of the first command, so the first
      // publish after every cold start failed with transport_failed. The
      // queue exists to hold commands across exactly that window; failure is
      // bounded by maxRetriesPerRequest and connectTimeout, not by refusing
      // to buffer at all.
      enableOfflineQueue: true,
    });
    // ioredis emits 'error' on an EventEmitter with no listener, which crashes
    // the process. The connection state is already surfaced through command
    // rejection; this listener exists so a transport blip cannot take the
    // server down, and it deliberately logs nothing that could carry the URL.
    publisher.on("error", () => {});
  }

  return publisher;
}

/**
 * A dedicated blocking reader, owned by one SSE connection.
 *
 * `maxRetriesPerRequest: null` is required for a blocking command: ioredis's
 * default retry counter treats a long BLOCK as a stalled request and aborts
 * it. The caller is responsible for calling `disconnect()` — the SSE route
 * does it from an AbortSignal handler and from its own teardown, so a client
 * that vanishes without a clean close still releases the socket.
 */
export function createRealtimeReader(): Redis | null {
  const config = getRedisConfig();
  if (!config) return null;

  const reader = new Redis(config.url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    connectTimeout: 10_000,
    // Same reason as the publisher: the first XREAD would otherwise be
    // rejected before the socket exists.
    enableOfflineQueue: true,
  });
  reader.on("error", () => {});
  return reader;
}

/** Test seam. Drops the shared publisher so a suite can start clean. */
export function resetRealtimePublisherForTests(): void {
  publisher = null;
}
