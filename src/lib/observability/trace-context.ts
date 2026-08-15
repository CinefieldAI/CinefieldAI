import { randomBytes } from "node:crypto";

/**
 * Trace context — the one trace-id authority (Phase 13-A, code half).
 *
 * Roadmap ¶1710 pairs Sentry and OpenTelemetry in one package; ¶1711 is the
 * criterion and it names only one thing:
 *
 *   "Tek generation trace_id ile API→worker→provider zincirinde izleniyor."
 *
 * One generation, one trace_id, followed across API → worker → provider. That
 * is achievable with no exporter, no DSN and no account, which is why this
 * half ships first.
 *
 * ¶1157 already required the same shape at the 6R foundation — "DB/state/outbox
 * aynı generation_id/trace_id ile izleniyor" — and the database, the command
 * wire, the domain event and the outbox all carry `trace_id` today. Nothing
 * ever put a value in. This file mints it.
 *
 * ---------------------------------------------------------------------------
 * ONE GENERATOR, DELIBERATELY
 * ---------------------------------------------------------------------------
 * There is exactly one function in the codebase that creates a trace id. Two
 * generators means two id formats, and the first time they meet in a log
 * query the correlation silently produces nothing — which looks like "no
 * activity" rather than like a bug.
 *
 * ---------------------------------------------------------------------------
 * A TRACE ID IS AN OBSERVATION, NEVER AN AUTHORITY
 * ---------------------------------------------------------------------------
 * It arrives, in part, from a header a client controls. So it may never
 * choose a tenant, select a Redis stream, authorize a generation, act as an
 * idempotency key or become a billing identifier. It is a label for
 * correlating records that were authorized by something else. Tests assert
 * each of those separately, because "we would never do that" is not a
 * control.
 *
 * No `server-only`: the contract and its validators are pure and the test
 * suite reads them. Nothing here touches the environment or a request.
 */

/** W3C: 32 lowercase hex characters, not all zeroes. */
const TRACE_ID = /^[0-9a-f]{32}$/;
/** W3C: 16 lowercase hex characters, not all zeroes. */
const SPAN_ID = /^[0-9a-f]{16}$/;
const ALL_ZERO_TRACE = "0".repeat(32);
const ALL_ZERO_SPAN = "0".repeat(16);

/**
 * A resolved trace context.
 *
 * `sampled` is carried because W3C defines it and a future exporter will need
 * it. Nothing in this batch reads it to make a decision — it is transported,
 * not obeyed.
 */
export interface TraceContext {
  /** 32 lowercase hex. The identity ¶1711 follows end to end. */
  traceId: string;
  /** 16 lowercase hex. This hop's id; a child span's parent. */
  spanId: string;
  sampled: boolean;
  /**
   * How this context came to exist. Recorded so an operator can tell an
   * inherited trace from one this server minted — which is the difference
   * between "the caller is instrumented" and "the caller sent nothing".
   */
  origin: TraceOrigin;
}

export type TraceOrigin =
  | "inherited" //  a valid W3C traceparent was accepted
  | "minted" //     no usable inbound context; the server created one
  | "rejected"; //  a traceparent was present and malformed, so it was discarded

/** Cryptographically random, matching W3C's 16-byte trace / 8-byte span. */
export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Parses a W3C `traceparent`.
 *
 * STRICT, and it returns null rather than repairing anything. A malformed
 * header is a client error or an attack probe; the safe response to both is
 * to discard it and mint a fresh server-side trace, never to salvage half of
 * it. Salvaging would let a caller control part of an identifier that appears
 * in operator dashboards.
 *
 * Only version `00` is accepted. The spec says a future version may append
 * fields, but accepting an unknown version means guessing at a layout, and a
 * wrong guess produces ids that look valid and correlate nothing.
 */
export function parseTraceparent(raw: string | null | undefined): TraceContext | null {
  if (typeof raw !== "string") return null;
  // Bounded before any work: an unbounded header is a cheap way to make a
  // regex expensive.
  if (raw.length !== 55) return null;

  const parts = raw.split("-");
  if (parts.length !== 4) return null;
  const [version, traceId, parentId, flags] = parts;

  if (version !== "00") return null;
  if (!TRACE_ID.test(traceId) || traceId === ALL_ZERO_TRACE) return null;
  if (!SPAN_ID.test(parentId) || parentId === ALL_ZERO_SPAN) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;

  return {
    traceId,
    // This server is a new hop: it gets its own span id, and the inbound
    // parent id is the caller's span. Reusing the caller's id would make two
    // different operations indistinguishable.
    spanId: newSpanId(),
    sampled: (parseInt(flags, 16) & 0x01) === 1,
    origin: "inherited",
  };
}

/** Serializes for an outbound hop. */
export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

/** A fresh server-side trace. */
export function mintTraceContext(): TraceContext {
  return { traceId: newTraceId(), spanId: newSpanId(), sampled: true, origin: "minted" };
}

/**
 * Resolves the context for an inbound request.
 *
 * Inherit when the header is valid; otherwise mint. The distinction between
 * `minted` and `rejected` is kept because they mean different things
 * operationally — nobody sent a trace, versus somebody sent a broken one.
 *
 * WHETHER TO INHERIT AT ALL IS A DEPLOYMENT QUESTION, and `trustInbound`
 * exists so it can be answered per boundary rather than assumed. Cinefield
 * has no upstream service today: every request arrives from a browser, and a
 * browser-supplied trace id is attacker-controlled text that would land in
 * operator dashboards. So the HTTP edge passes `trustInbound: false` and this
 * mints. When 12-A's Cloudflare edge or an internal service mesh exists,
 * flipping one call site inherits their traces.
 */
export function resolveTraceContext(
  headerValue: string | null | undefined,
  options?: { trustInbound?: boolean }
): TraceContext {
  const trust = options?.trustInbound === true;
  if (!trust) return mintTraceContext();

  if (headerValue === null || headerValue === undefined || headerValue === "") {
    return mintTraceContext();
  }
  const parsed = parseTraceparent(headerValue);
  if (parsed) return parsed;
  return { ...mintTraceContext(), origin: "rejected" };
}

/**
 * Accepts a trace id that crossed a DURABLE boundary.
 *
 * A queue message, a workflow argument, an outbox row. Validated on the way
 * back in exactly as strictly as a header would be: durable data is written
 * by our own code today, but a queue message is not an authority (6R.22), and
 * a corrupted or hand-edited row must not put a malformed id into a
 * dashboard.
 *
 * Returns null when unusable, and the caller mints — continuity is preferred
 * but never at the cost of accepting an unvalidated identifier.
 */
export function acceptDurableTraceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return TRACE_ID.test(v) && v !== ALL_ZERO_TRACE ? v : null;
}

/** Continues an existing trace on a new hop, with a fresh span id. */
export function continueTrace(traceId: string): TraceContext {
  return { traceId, spanId: newSpanId(), sampled: true, origin: "inherited" };
}

export function isValidTraceId(value: string): boolean {
  return TRACE_ID.test(value) && value !== ALL_ZERO_TRACE;
}
