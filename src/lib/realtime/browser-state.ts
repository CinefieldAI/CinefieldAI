/**
 * Browser state mapping (Phase 11-B).
 *
 * No "server-only" and no imports: this module is shared by the SSE gateway's
 * tests and by the client hook, and it must stay a pure function of an
 * envelope.
 *
 * A REALTIME EVENT IS A SIGNAL, NOT A SECOND TRUTH.
 *
 * What arrives here is a hint that something changed and what it changed to.
 * It is never the authority for a provider result, a billing amount, an asset
 * release or a credit balance — those live in PostgreSQL, and a client that
 * reconstructed them from a stream would be believing a projection over the
 * ledger that produced it. So this maps a state LABEL and carries a small
 * allowlisted detail, and anything it cannot safely apply it ignores, leaving
 * the client's normal fetch to establish truth.
 *
 * Ignoring is the safe direction and is used deliberately: an unrecognised
 * event type, a missing subject or a shape that does not match returns null
 * rather than a guess.
 */

/** Mirrors the Notification Service's projection, which is the wire contract. */
export interface RealtimeEnvelope {
  eventId: string;
  channelId: string;
  tenantId: string;
  eventType: string;
  occurredAt: string;
  traceId?: string;
  projection: {
    uiState: string;
    subject: { kind: string; id: string };
    detail: Record<string, string | number>;
  };
}

/** Exactly what a UI may transition to from a realtime signal. */
export type RealtimeGenerationState =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface RealtimeUpdate {
  generationId: string;
  state: RealtimeGenerationState;
  /** Allowlisted, already minimized server-side. Display only. */
  detail: Record<string, string | number>;
  /** Stable LOGICAL identity. The dedupe key — see client-apply.ts. */
  eventId: string;
  /**
   * The per-channel cursor this arrived on (Phase 11-C): the Redis stream id,
   * server-assigned. Used for ordering and staleness, never for dedupe, and
   * absent when a caller constructs an update outside the stream.
   */
  seq?: string;
  occurredAt: string;
}

const GENERATION_STATES: ReadonlySet<string> = new Set<RealtimeGenerationState>([
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Turns one envelope into a generation state update, or null.
 *
 * `credit.updated` maps to nothing here on purpose. Phase 10 owns the ledger,
 * no producer emits a credit event, and a client branch that displayed one
 * would be UI for a state that cannot occur — the kind of code that later
 * gets wired to a fabricated value because it already exists.
 *
 * `security.warning` is DIFFERENT as of Phase 12-C. It has a producer now, and
 * it does travel this stream — but it is not a generation state, so it still
 * maps to null here. That is a refusal, not a gap: a security warning is about
 * the ACCOUNT, and its subject is the evidence row rather than a generation.
 * Returning an update would attach a security banner to whichever unrelated
 * render happened to be on screen. The projected notification carries it; a
 * consumer that wants it reads `subject.kind === "security"`.
 */
export function toRealtimeUpdate(envelope: unknown, seq?: string): RealtimeUpdate | null {
  if (typeof envelope !== "object" || envelope === null) return null;
  const e = envelope as Partial<RealtimeEnvelope>;

  const projection = e.projection;
  if (!projection || typeof projection !== "object") return null;
  if (typeof e.eventId !== "string" || typeof e.occurredAt !== "string") return null;

  const subject = projection.subject;
  if (!subject || subject.kind !== "generation" || typeof subject.id !== "string") return null;

  if (typeof projection.uiState !== "string" || !GENERATION_STATES.has(projection.uiState)) {
    // credit.updated, security.warning, or anything a later phase adds:
    // ignored rather than guessed at. (In practice security.warning has
    // already been rejected by the subject.kind check above.)
    return null;
  }

  const detail = projection.detail;
  return {
    generationId: subject.id,
    state: projection.uiState as RealtimeGenerationState,
    // Copied only if it is already the shape the server promised. Never
    // spread from an arbitrary object.
    detail: isPlainDetail(detail) ? detail : {},
    eventId: e.eventId,
    // The cursor comes from the SSE frame's `id:`, not from the envelope
    // body: it is a transport fact, and a payload that claimed one could
    // reorder another payload.
    ...(typeof seq === "string" && seq.length > 0 ? { seq } : {}),
    occurredAt: e.occurredAt,
  };
}

function isPlainDetail(value: unknown): value is Record<string, string | number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string" || typeof v === "number");
}
