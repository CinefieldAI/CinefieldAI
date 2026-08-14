"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toRealtimeUpdate, type RealtimeUpdate } from "@/lib/realtime/browser-state";

/**
 * The browser realtime client (Phase 11-B).
 *
 * THE SMALLEST THING THAT WORKS. It opens the SSE connection, maps envelopes
 * into generation state updates, and reconnects when the server ends the
 * stream. It does not own UI, does not fetch, and does not decide what a
 * generation IS — a caller reads `updates` and applies them to whatever state
 * it already holds, falling back to its own fetch whenever it wants truth.
 *
 * NO SUBSCRIPTION TARGET. The URL is a constant. There is no user, workspace
 * or channel parameter to pass, because the server derives the channel from
 * the session — a client that could name a channel would be the vulnerability
 * the roadmap forbids, and the absence of the argument is what prevents it.
 *
 * RECONNECT IS EXPECTED, NOT EXCEPTIONAL. The gateway deliberately ends every
 * connection before the platform's ceiling, so a close is the normal case and
 * not an error. `EventSource` already reconnects on its own; the backoff here
 * exists for the case it cannot recover from — a 401 or a 503 — where retrying
 * immediately in a tight loop would be the actual harm.
 *
 * LOSSLESS RESUME IS 11-C. Events that occur between connections are missed
 * today. That is why every consumer must treat this as a signal and keep its
 * own fetch: `Last-Event-ID`, `event_seq`, the replay window and client dedupe
 * are 11-C's contract, and pretending they exist now would let a UI depend on
 * a guarantee nothing provides.
 */

const ENDPOINT = "/api/realtime/events";
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export type RealtimeStatus = "idle" | "connecting" | "open" | "reconnecting" | "unavailable";

export interface UseRealtimeGenerations {
  status: RealtimeStatus;
  /** The most recent update per generation id. */
  updates: Readonly<Record<string, RealtimeUpdate>>;
  /** Clears one generation's entry once a caller has applied it. */
  acknowledge: (generationId: string) => void;
}

export function useRealtimeGenerations(enabled = true): UseRealtimeGenerations {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [updates, setUpdates] = useState<Record<string, RealtimeUpdate>>({});

  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const acknowledge = useCallback((generationId: string) => {
    setUpdates((prev) => {
      if (!(generationId in prev)) return prev;
      const next = { ...prev };
      delete next[generationId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    stoppedRef.current = false;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const connect = () => {
      if (stoppedRef.current) return;
      setStatus(retryRef.current === 0 ? "connecting" : "reconnecting");

      // No query string. The server knows who is asking.
      const source = new EventSource(ENDPOINT);
      sourceRef.current = source;

      source.addEventListener("open", () => {
        retryRef.current = 0;
        setStatus("open");
      });

      source.addEventListener("notification", (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse((event as MessageEvent<string>).data);
        } catch {
          return; // A frame we cannot read is dropped, never guessed at.
        }

        const update = toRealtimeUpdate(parsed);
        if (!update) return; // Unsupported type, or a shape we will not invent.

        setUpdates((prev) => {
          const existing = prev[update.generationId];
          // Same event twice changes nothing — the identity 11-A preserves is
          // what makes this cheap check correct even before 11-C's dedupe.
          if (existing && existing.eventId === update.eventId) return prev;
          return { ...prev, [update.generationId]: update };
        });
      });

      // The gateway's deliberate end-of-life. Close cleanly and reopen at
      // once rather than waiting out a backoff for a healthy server.
      source.addEventListener("reconnect", () => {
        source.close();
        sourceRef.current = null;
        if (stoppedRef.current) return;
        setStatus("reconnecting");
        clearTimer();
        timerRef.current = setTimeout(connect, 50);
      });

      source.addEventListener("error", () => {
        source.close();
        sourceRef.current = null;
        if (stoppedRef.current) return;

        retryRef.current += 1;
        // Full jitter: a deploy that dropped every connection at once must not
        // have them all return in the same instant.
        const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (retryRef.current - 1));
        const delay = Math.round(Math.random() * ceiling);

        setStatus(retryRef.current > 5 ? "unavailable" : "reconnecting");
        clearTimer();
        timerRef.current = setTimeout(connect, delay);
      });
    };

    connect();

    return () => {
      stoppedRef.current = true;
      clearTimer();
      sourceRef.current?.close();
      sourceRef.current = null;
      setStatus("idle");
    };
  }, [enabled]);

  return { status, updates, acknowledge };
}
