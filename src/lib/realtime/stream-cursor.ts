/**
 * The cursor contract (Phase 11-C).
 *
 * No "server-only": the comparison rules are shared by the gateway and by the
 * browser's staleness check, and a rule implemented twice is a rule that will
 * eventually disagree with itself.
 *
 * ---------------------------------------------------------------------------
 * THE DECISION: THE REDIS STREAM ID *IS* THE PER-CHANNEL event_seq
 * ---------------------------------------------------------------------------
 * Roadmap 11.6 asks for "kanal başına monotonic artan event_seq" carried on
 * every event and echoed back as `Last-Event-ID`. Two shapes were possible:
 *
 *   A. a separate counter, with the stream id kept as a private transport cursor
 *   B. the stream id itself serving as the sequence
 *
 * B was chosen, and the reasoning is recorded because it is not obvious:
 *
 *   monotonicity      Redis assigns `<ms>-<n>` strictly increasing per stream,
 *                     and increments `n` when two entries land in the same
 *                     millisecond. Nothing weaker than that is needed.
 *   channel scope     one stream per channel, so "per stream" IS "per channel".
 *                     A separate counter would need its own per-channel key.
 *   concurrency       assignment happens inside XADD. A counter would need an
 *                     INCR made atomic with the append by a Lua script.
 *   replay            `XRANGE key (cursor +` is exactly "strictly after". A
 *                     separate counter would need its own index to answer the
 *                     same question.
 *   trimming          the retained window's own boundary is a stream id, so
 *                     "is this cursor still inside the window" is one
 *                     comparison. A counter cannot answer it at all without
 *                     storing a mapping that is itself trimmed.
 *   failure modes     a counter can be lost or double-incremented on retry,
 *                     producing a phantom gap the client would reconcile for
 *                     no reason. The stream id cannot desynchronise from the
 *                     stream, because it is the stream's own ordering.
 *
 * WHAT THE DECISION DOES *NOT* DO — and this is the important half. A stream
 * id is NOT a logical identity. Phase 11-B established that an at-least-once
 * outbox retry appends a SECOND entry carrying the SAME `eventId`; those two
 * entries have different ids. So:
 *
 *     eventId   logical identity     -> DEDUPE
 *     stream id transport cursor/seq -> ORDER, RESUME, STALENESS
 *
 * Roadmap 11.8 says the client "event_seq ile dedupe eder". Deduping by seq
 * alone would miss exactly the duplicate 11-B proved can happen, because the
 * two copies carry different seqs. Deduping by `eventId` catches it and also
 * satisfies 11.8's actual requirement — "aynı event iki kez gelirse UI state'i
 * değişmez". Both are used, for the two different jobs they are good at.
 *
 * THE COUPLING IS ACKNOWLEDGED. A cursor in this format is Redis-shaped. If
 * the transport is ever replaced, the cursor format changes with it — but so
 * does the replay window, which lives in Redis by design. The alternative
 * would be a transport-independent counter that still could not be replayed
 * without Redis, which buys a format and no capability.
 */

/** `<milliseconds>-<sequence>`, exactly as Redis assigns it. */
const STREAM_ID = /^(\d{1,13})-(\d{1,20})$/;

export interface ParsedCursor {
  ms: number;
  n: bigint;
  raw: string;
}

/**
 * Parses a client-supplied `Last-Event-ID`.
 *
 * EVERYTHING ABOUT THIS INPUT IS UNTRUSTED. It arrives in a header the browser
 * controls, so it is validated by shape before it is allowed anywhere near a
 * Redis command, and it is never used to choose a key — the key comes from the
 * authenticated channel and nothing else. A cursor can move a reader forwards
 * and backwards within ONE stream; it cannot name a different one.
 *
 * `n` is a bigint because Redis' sequence part is a 64-bit counter and
 * `Number` would silently lose precision on a stream that received more than
 * 2^53 entries in one millisecond. That will not happen; parsing it correctly
 * costs nothing and means the comparison below is total rather than
 * approximately total.
 */
export function parseCursor(raw: string | null | undefined): ParsedCursor | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // A hard length bound before the regex: a header is attacker-controlled and
  // a pathological input should be rejected by size, not by backtracking.
  if (trimmed.length === 0 || trimmed.length > 40) return null;

  const match = STREAM_ID.exec(trimmed);
  if (!match) return null;

  const ms = Number(match[1]);
  if (!Number.isSafeInteger(ms)) return null;

  return { ms, n: BigInt(match[2]), raw: trimmed };
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareCursors(a: ParsedCursor, b: ParsedCursor): number {
  if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1;
  if (a.n !== b.n) return a.n < b.n ? -1 : 1;
  return 0;
}

/** String form, for callers holding raw ids (the browser's staleness check). */
export function compareStreamIds(a: string, b: string): number | null {
  const pa = parseCursor(a);
  const pb = parseCursor(b);
  if (!pa || !pb) return null;
  return compareCursors(pa, pb);
}

/**
 * What the gateway should do with a resume request.
 *
 * `replay`      the cursor is still inside the retained window, so everything
 *               after it is provably present. Replay is complete.
 * `reconcile`   completeness CANNOT be proven. The client is told to refetch
 *               authoritative state; realtime resumes live afterwards.
 * `live`        no usable cursor was supplied — a first connection.
 */
export type ResumeDecision =
  | { mode: "live" }
  | { mode: "replay"; from: ParsedCursor }
  | { mode: "reconcile"; reason: "invalid_cursor" | "cursor_too_old" | "window_unknown" };

/**
 * THE COMPLETENESS RULE, AND IT IS DELIBERATELY CONSERVATIVE.
 *
 * Replay is provably complete if and only if the cursor entry itself is still
 * within the retained window. If the oldest retained entry is NEWER than the
 * cursor, then whatever sat between them has been trimmed — and there is no
 * way to distinguish "the cursor's entry was trimmed and nothing else" from
 * "fifty events were trimmed". Both are reported as a gap.
 *
 * That means a client returning after a quiet fifteen minutes will reconcile
 * rather than replay. That is the correct trade: a refetch costs one query,
 * while a silently incomplete replay costs a UI that is wrong and does not
 * know it. Roadmap 11.7 asks for exactly this — "pencere dışında reconnect
 * olan client replay yerine tam state resync yapar".
 *
 * `oldestRetained` is null when the stream holds nothing. A client with a
 * cursor and an empty stream cannot be served a proven-complete replay
 * either: the entries it is missing may have existed and been trimmed. It
 * reconciles.
 */
export function decideResume(
  lastEventId: string | null | undefined,
  oldestRetained: string | null
): ResumeDecision {
  if (lastEventId === null || lastEventId === undefined || lastEventId === "") {
    return { mode: "live" };
  }

  const cursor = parseCursor(lastEventId);
  if (!cursor) return { mode: "reconcile", reason: "invalid_cursor" };

  if (oldestRetained === null) {
    return { mode: "reconcile", reason: "window_unknown" };
  }

  const oldest = parseCursor(oldestRetained);
  // The stream's own id failed to parse: something is wrong with the stream,
  // not with the client. Refuse to guess.
  if (!oldest) return { mode: "reconcile", reason: "window_unknown" };

  if (compareCursors(cursor, oldest) < 0) {
    return { mode: "reconcile", reason: "cursor_too_old" };
  }

  return { mode: "replay", from: cursor };
}

/**
 * The exclusive lower bound for `XRANGE`. Redis reads `(id` as "strictly
 * after", which is what resume means: the client already has the cursor
 * entry, and re-sending it would be a duplicate the dedupe layer then has to
 * absorb for no reason.
 */
export function exclusiveStart(cursor: ParsedCursor): string {
  return `(${cursor.raw}`;
}
