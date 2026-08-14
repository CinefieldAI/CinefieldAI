import { compareStreamIds } from "./stream-cursor";
import type { RealtimeGenerationState, RealtimeUpdate } from "./browser-state";

/**
 * Idempotent apply (Phase 11-C).
 *
 * Pure and framework-free so every rule below is testable without a browser or
 * a socket. The hook owns connections; this owns what a delivered event is
 * allowed to do to state.
 *
 * Roadmap 11.8: "Teslim at-least-once kabul edilir. Client event_seq ile
 * dedupe eder ve state geçişlerini idempotent uygular; aynı event iki kez
 * gelirse UI state'i değişmez. Geriye dönük (eski seq) event yok sayılır."
 *
 * THREE INDEPENDENT DEFENCES, BECAUSE THEY CATCH DIFFERENT THINGS.
 *
 *   1. eventId dedupe   The same LOGICAL event delivered twice. This is the
 *                       one the roadmap's "aynı event iki kez" describes, and
 *                       seq cannot catch it: 11-B proved an outbox retry
 *                       appends a second entry with a NEW stream id and the
 *                       SAME eventId. Deduping by seq would let that through.
 *
 *   2. seq staleness    An OLDER event arriving after a newer one — the
 *                       "geriye dönük event yok sayılır" rule. Happens on
 *                       replay, where the window is re-read after the client
 *                       has already seen later events live.
 *
 *   3. rank floor       A state that must never go backwards, even when the
 *                       sequence cannot decide. After a reconcile the client
 *                       holds authoritative state with NO seq attached, so
 *                       comparison 2 has nothing to compare against; the rank
 *                       is what stops a stale `processing` replay from
 *                       overwriting a fetched `completed`.
 *
 * Any one of them alone leaves a hole. All three are cheap.
 */

/**
 * Monotone progress. A generation moves forward through these and never back.
 * The three terminals share a rank because they are mutually exclusive in the
 * database — a generation that is `completed` cannot later be `failed` — so
 * the first terminal to arrive is the one that stands.
 */
const STATE_RANK: Readonly<Record<RealtimeGenerationState, number>> = {
  queued: 1,
  processing: 2,
  completed: 3,
  failed: 3,
  cancelled: 3,
};

export interface AppliedState {
  state: RealtimeGenerationState;
  detail: Readonly<Record<string, string | number>>;
  /** The cursor the state came from. Absent when it came from a refetch. */
  seq?: string;
  occurredAt: string;
}

export type ApplyOutcome =
  | { applied: true; next: AppliedState }
  | { applied: false; reason: "duplicate" | "stale_seq" | "would_regress" };

/**
 * A bounded set of seen event ids.
 *
 * AN UNBOUNDED `Set` IS A LEAK. A tab left open for a day on a busy account
 * would accumulate every id it ever saw. The insertion-ordered ring keeps the
 * most recent `capacity` and forgets the rest, which is exactly the window
 * duplicates can plausibly arrive in — a retry lands seconds after the
 * original, not hours.
 *
 * `Set` preserves insertion order in JavaScript, so the oldest key is the
 * first one the iterator yields, and eviction needs no second structure.
 */
export class SeenEvents {
  private readonly ids = new Set<string>();

  constructor(private readonly capacity = 500) {}

  /** True when this id has not been seen before. Records it either way. */
  admit(eventId: string): boolean {
    if (this.ids.has(eventId)) {
      // Refresh recency so a repeatedly-redelivered event is not evicted and
      // then admitted again.
      this.ids.delete(eventId);
      this.ids.add(eventId);
      return false;
    }

    this.ids.add(eventId);
    while (this.ids.size > this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest === undefined) break;
      this.ids.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.ids.size;
  }
}

/**
 * Decides whether one update may replace the current state.
 *
 * Order matters: dedupe first, because a duplicate should not even be
 * considered for ordering; then staleness; then the rank floor.
 */
export function applyUpdate(
  current: AppliedState | undefined,
  update: RealtimeUpdate,
  seen: SeenEvents
): ApplyOutcome {
  if (!seen.admit(update.eventId)) {
    return { applied: false, reason: "duplicate" };
  }

  if (!current) {
    return { applied: true, next: toState(update) };
  }

  // 2. Older cursor than the one already applied. Only decidable when both
  //    sides carry one — a reconciled state does not.
  if (current.seq && update.seq) {
    const order = compareStreamIds(update.seq, current.seq);
    if (order !== null && order <= 0) {
      return { applied: false, reason: "stale_seq" };
    }
  }

  // 3. The floor. `completed` never becomes `processing`, whatever the cursor
  //    says and whether or not there is one to say it.
  if (STATE_RANK[update.state] < STATE_RANK[current.state]) {
    return { applied: false, reason: "would_regress" };
  }

  // Equal rank and not stale: a terminal that arrives twice by different
  // event ids (completed then cancelled, say) keeps the first. Terminals are
  // mutually exclusive in the database, so the second is a reordering
  // artefact rather than a new fact.
  if (
    STATE_RANK[update.state] === STATE_RANK[current.state] &&
    STATE_RANK[update.state] === 3 &&
    update.state !== current.state
  ) {
    return { applied: false, reason: "would_regress" };
  }

  return { applied: true, next: toState(update) };
}

function toState(update: RealtimeUpdate): AppliedState {
  return {
    state: update.state,
    detail: update.detail,
    ...(update.seq ? { seq: update.seq } : {}),
    occurredAt: update.occurredAt,
  };
}

/**
 * State established by an authoritative refetch after a replay gap.
 *
 * It deliberately carries NO seq. The fetch answered "what is true now", not
 * "what happened at cursor X", and inventing a cursor for it would let a
 * later comparison believe the two are on the same timeline. Without one, the
 * rank floor is what protects it — which is precisely why defence 3 exists.
 */
export function fromAuthoritativeFetch(
  state: RealtimeGenerationState,
  occurredAt: string
): AppliedState {
  return { state, detail: {}, occurredAt };
}
