"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toRealtimeUpdate } from "@/lib/realtime/browser-state";
import {
  applyUpdate,
  fromAuthoritativeFetch,
  SeenEvents,
  type AppliedState,
} from "@/lib/realtime/client-apply";
import type { RealtimeGenerationState } from "@/lib/realtime/browser-state";

/**
 * The browser realtime client (Phase 11-B, resume added in 11-C).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS `fetch` AND NOT `EventSource`
 * ---------------------------------------------------------------------------
 * `EventSource` sends `Last-Event-ID` automatically — but only on ITS OWN
 * reconnects, from state private to that instance. Phase 11-B's gateway
 * deliberately ends every connection at ~50 s, and 11-B's hook responded by
 * closing the source and constructing a NEW one. A fresh `EventSource` has no
 * `lastEventId`, so every planned reconnect silently resumed from live and
 * dropped whatever happened in between. That was a real defect, and it is
 * exactly the loss 11-C exists to close.
 *
 * The two requirements are also in tension: 11-C needs `Last-Event-ID`, and
 * §12 needs bounded exponential backoff with jitter. `EventSource` offers no
 * API for either — it cannot set a header, and its only backoff control is the
 * server's `retry:` field. `fetch` + a stream reader gives both: the cursor
 * travels in the header the roadmap names, and reconnect timing is ours.
 *
 * The cost is parsing SSE frames by hand, which is about thirty lines and is
 * the same format `sse-frame.ts` writes.
 *
 * ---------------------------------------------------------------------------
 * REALTIME IS A SIGNAL, NOT TRUTH
 * ---------------------------------------------------------------------------
 * The server sends `reconcile` when it cannot PROVE a replay was complete. The
 * hook then reports which generations need an authoritative refetch; it never
 * invents the missing events, never guesses a state, and never calls a
 * provider or mutates anything. A caller applies `updates` to what it already
 * holds and refetches when told to.
 */

const ENDPOINT = "/api/realtime/events";
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
/** After this long connected, the connection counts as healthy. */
const HEALTHY_AFTER_MS = 10_000;
/** No frame and no heartbeat for this long means the path died silently. */
const IDLE_TIMEOUT_MS = 45_000;

export type RealtimeStatus = "idle" | "connecting" | "open" | "reconnecting" | "unavailable";

export interface UseRealtimeGenerations {
  status: RealtimeStatus;
  /** Latest applied state per generation id. */
  states: Readonly<Record<string, AppliedState>>;
  /**
   * Set when the server could not prove replay completeness. A caller must
   * refetch authoritative generation state and call `reconciled`.
   */
  needsReconcile: { reason: string; at: number } | null;
  /** Records authoritative state a caller fetched, and clears the flag. */
  reconciled: (fetched: Record<string, RealtimeGenerationState>) => void;
}

export function useRealtimeGenerations(enabled = true): UseRealtimeGenerations {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [states, setStates] = useState<Record<string, AppliedState>>({});
  const [needsReconcile, setNeedsReconcile] = useState<{ reason: string; at: number } | null>(null);

  // Refs, not state: these must survive a reconnect without re-running the
  // effect that owns the connection.
  const cursorRef = useRef<string | null>(null);
  const seenRef = useRef(new SeenEvents());
  const statesRef = useRef<Record<string, AppliedState>>({});
  const retryRef = useRef(0);
  const stoppedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reconciled = useCallback((fetched: Record<string, RealtimeGenerationState>) => {
    const now = new Date().toISOString();
    setStates((prev) => {
      const next = { ...prev };
      for (const [generationId, state] of Object.entries(fetched)) {
        // No seq: this came from a query, not from the stream. The rank floor
        // in client-apply.ts is what protects it from a stale replay.
        next[generationId] = fromAuthoritativeFetch(state, now);
      }
      statesRef.current = next;
      return next;
    });
    setNeedsReconcile(null);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof fetch === "undefined") return;

    stoppedRef.current = false;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (stoppedRef.current) return;
      retryRef.current += 1;
      // Full jitter over a capped exponential ceiling. A deploy that dropped
      // every connection at once must not have them all return together, and
      // an unreachable server must not be hammered.
      const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (retryRef.current - 1));
      const delay = Math.round(Math.random() * ceiling);
      setStatus(retryRef.current > 6 ? "unavailable" : "reconnecting");
      clearTimer();
      timerRef.current = setTimeout(run, delay);
    };

    const handleFrame = (event: string, data: string, id: string | null) => {
      if (event === "notification") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return; // Unreadable frame: dropped, never guessed at.
        }
        // The cursor comes from the FRAME, not the payload.
        const update = toRealtimeUpdate(parsed, id ?? undefined);
        if (!update) return; // Unsupported type or a shape we will not invent.

        const outcome = applyUpdate(statesRef.current[update.generationId], update, seenRef.current);
        if (!outcome.applied) return;

        statesRef.current = { ...statesRef.current, [update.generationId]: outcome.next };
        setStates(statesRef.current);
        return;
      }

      if (event === "reconcile") {
        let reason = "unknown";
        try {
          reason = String((JSON.parse(data) as { reason?: unknown }).reason ?? "unknown");
        } catch {
          /* keep "unknown" */
        }
        setNeedsReconcile({ reason, at: Date.now() });
        return;
      }

      // "ready", "resumed" and "reconnect" are transport control. They carry
      // no business meaning, advance no cursor, and enter no dedupe set —
      // only `notification` frames do, and only they have an `id:`.
    };

    async function run() {
      if (stoppedRef.current) return;
      setStatus(retryRef.current === 0 ? "connecting" : "reconnecting");

      const controller = new AbortController();
      abortRef.current = controller;
      const openedAt = Date.now();

      // A silent proxy drop leaves the read hanging forever. The gateway
      // heartbeats every 15 s, so nothing for 45 s means the path is gone.
      let idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
      const bumpIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
      };

      try {
        const response = await fetch(ENDPOINT, {
          signal: controller.signal,
          headers: {
            Accept: "text/event-stream",
            // THE RESUME CURSOR. A header, never a query parameter: the
            // roadmap forbids a client-controlled subscription target, and a
            // cursor in the URL reads like one. The server treats it as a
            // position within the stream it already resolved, never as
            // authority over which stream that is.
            ...(cursorRef.current ? { "Last-Event-ID": cursorRef.current } : {}),
          },
          cache: "no-store",
        });

        if (!response.ok || !response.body) {
          throw new Error(`sse_${response.status}`);
        }

        setStatus("open");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bumpIdle();

          buffer += decoder.decode(value, { stream: true });

          // Frames are separated by a blank line. Anything after the last one
          // is a partial frame and stays buffered.
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            let event = "message";
            let id: string | null = null;
            const dataLines: string[] = [];

            for (const line of raw.split("\n")) {
              // A comment — the heartbeat. Kept the connection alive and
              // nothing more.
              if (line.startsWith(":")) continue;
              if (line.startsWith("event: ")) event = line.slice(7);
              else if (line.startsWith("id: ")) id = line.slice(4);
              else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
            }

            // Advance the cursor ONLY for frames that carry one. Control
            // frames and heartbeats must not move a resume position.
            if (id) cursorRef.current = id;
            if (dataLines.length > 0) handleFrame(event, dataLines.join("\n"), id);
          }
        }

        // The server closed: either its deliberate max-age, or the path died.
        // Both mean reconnect, and the cursor is already held.
        if (Date.now() - openedAt >= HEALTHY_AFTER_MS) retryRef.current = 0;
        clearTimeout(idleTimer);
        scheduleReconnect();
      } catch {
        clearTimeout(idleTimer);
        if (stoppedRef.current) return;
        // A connection that lived long enough to be healthy resets the
        // backoff, so one long-lived stream followed by a blip does not
        // inherit an hour of accumulated delay.
        if (Date.now() - openedAt >= HEALTHY_AFTER_MS) retryRef.current = 0;
        scheduleReconnect();
      }
    }

    void run();

    return () => {
      stoppedRef.current = true;
      clearTimer();
      abortRef.current?.abort();
      abortRef.current = null;
      setStatus("idle");
    };
  }, [enabled]);

  return { status, states, needsReconcile, reconciled };
}
