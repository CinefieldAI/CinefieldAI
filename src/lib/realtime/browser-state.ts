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
  eventId: string;
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
 * `security.warning` likewise: Phase 12 owns the taxonomy and the Risk Engine.
 * Nothing emits it and nothing here consumes it.
 */
export function toRealtimeUpdate(envelope: unknown): RealtimeUpdate | null {
  if (typeof envelope !== "object" || envelope === null) return null;
  const e = envelope as Partial<RealtimeEnvelope>;

  const projection = e.projection;
  if (!projection || typeof projection !== "object") return null;
  if (typeof e.eventId !== "string" || typeof e.occurredAt !== "string") return null;

  const subject = projection.subject;
  if (!subject || subject.kind !== "generation" || typeof subject.id !== "string") return null;

  if (typeof projection.uiState !== "string" || !GENERATION_STATES.has(projection.uiState)) {
    // credit.updated, security.warning, or anything a later phase adds:
    // ignored rather than guessed at.
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
    occurredAt: e.occurredAt,
  };
}

function isPlainDetail(value: unknown): value is Record<string, string | number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string" || typeof v === "number");
}
