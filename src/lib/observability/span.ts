import "server-only";
import { sanitizeTelemetry } from "./telemetry-redaction";
import { currentTraceContext } from "./trace-scope";
import { newSpanId, type TraceContext } from "./trace-context";
import type { TelemetryEnvelope } from "./telemetry-contract";

/**
 * The span standard (Phase 13-A) — sink-independent.
 *
 * Roadmap ¶1731: "OpenTelemetry distributed trace/span standardı." The
 * STANDARD, not an exporter: ¶1711's criterion is a trace followed across
 * API → worker → provider, which needs naming, attributes and propagation.
 * The exporter is the account-dependent half and is deliberately absent.
 *
 * ---------------------------------------------------------------------------
 * SPAN NAMES ARE LOW-CARDINALITY, ALWAYS
 * ---------------------------------------------------------------------------
 * A span name is a dimension key in every backend that will ever consume
 * this. Putting a generation id in it produces one series per generation —
 * which is how an observability bill becomes the largest line item, and how a
 * dashboard becomes unusable. Worse here: a name containing a user id or a
 * prompt would be sensitive data in the one field no sanitizer inspects,
 * because names are structure rather than payload.
 *
 * So the vocabulary is CLOSED. `SPAN_NAMES` is the whole set, and
 * `startSpan` accepts nothing else. Identifiers go in attributes, where the
 * 13-E allow-list governs them.
 *
 * ---------------------------------------------------------------------------
 * ATTRIBUTES GO THROUGH THE SENSITIVE DATA GUARD
 * ---------------------------------------------------------------------------
 * Not a second allow-list — the same one. `sanitizeTelemetry` runs on every
 * span's attributes, so a prompt, a signed URL or a raw provider response
 * cannot enter a span any more than it can enter a log line. Four sinks with
 * four ideas of "safe" was the failure 13-E existed to prevent, and a span
 * path with its own filter would reintroduce it.
 */

/**
 * The closed span vocabulary.
 *
 * Chosen to match the chain ¶1711 names, plus the durable hops in between.
 * Adding one is a deliberate edit here, which is the point.
 */
export const SPAN_NAMES = [
  "http.request",
  "generation.create",
  "generation.execute",
  "orchestration.execute",
  "temporal.workflow",
  "temporal.activity",
  "provider.submit",
  "provider.poll",
  "media.ingest",
  "outbox.dispatch",
  "security.event",
  "policy.evaluate",
] as const;

export type SpanName = (typeof SPAN_NAMES)[number];

const SPAN_NAME_SET: ReadonlySet<string> = new Set(SPAN_NAMES);

export function isSpanName(value: string): value is SpanName {
  return SPAN_NAME_SET.has(value);
}

export type SpanStatus = "ok" | "error" | "cancelled";

/**
 * A finished span, ready for a future exporter.
 *
 * Deliberately the same envelope shape 13-E already defined, with the span
 * facts carried as allow-listed attributes. One shape means one sanitizer,
 * one sink interface, and no second serialization path to keep in step.
 */
export interface FinishedSpan {
  name: SpanName;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  status: SpanStatus;
  durationMs: number;
  envelope: TelemetryEnvelope;
}

export interface SpanHandle {
  readonly name: SpanName;
  readonly traceId: string;
  readonly spanId: string;
  /** Merges more attributes. Validated at `end`, like everything else. */
  setAttributes(attributes: Record<string, unknown>): void;
  setStatus(status: SpanStatus): void;
  end(): FinishedSpan;
}

/** Where finished spans go. Registered by 13-A's Sentry/OTLP half, later. */
export interface SpanSink {
  readonly name: string;
  emit(span: FinishedSpan): void;
}

const sinks: SpanSink[] = [];

export function registerSpanSink(sink: SpanSink): void {
  if (sinks.some((s) => s.name === sink.name)) return;
  sinks.push(sink);
}

export function clearSpanSinks(): void {
  sinks.length = 0;
}

export function registeredSpanSinkNames(): string[] {
  return sinks.map((s) => s.name).sort();
}

/**
 * A monotonic clock, so a span duration cannot go negative when the wall
 * clock is adjusted mid-request.
 */
function nowMs(): number {
  // `performance.now()` rather than `process.hrtime.bigint()`: both are
  // monotonic, but a BigInt literal needs an ES2020 target and this project
  // targets ES2017.
  return performance.now();
}

/**
 * Starts a span.
 *
 * Uses the ambient trace when there is one and mints a span id either way. A
 * span outside any request scope is still valid — a worker loop is a real
 * operation — and it simply has no parent.
 *
 * NOTHING HERE THROWS. Tracing is observational: a span that cannot be built
 * must not fail the generation it was describing.
 */
export function startSpan(
  name: SpanName,
  attributes?: Record<string, unknown>,
  explicit?: { traceId: string; parentSpanId?: string }
): SpanHandle {
  const ambient: TraceContext | undefined = currentTraceContext();
  const traceId = explicit?.traceId ?? ambient?.traceId ?? "";
  const parentSpanId = explicit?.parentSpanId ?? ambient?.spanId;
  const spanId = newSpanId();
  const startedAt = nowMs();

  let status: SpanStatus = "ok";
  const collected: Record<string, unknown> = { ...(attributes ?? {}) };

  return {
    name,
    traceId,
    spanId,
    setAttributes(next) {
      Object.assign(collected, next);
    },
    setStatus(next) {
      status = next;
    },
    end() {
      // Rounded at the source. `performance.now()` is fractional and the
      // sanitizer rounds integers-only fields anyway — rounding once here
      // keeps `FinishedSpan.durationMs` and the envelope's copy identical
      // instead of differing in the last decimal for no reason.
      const durationMs = Math.max(0, Math.round(nowMs() - startedAt));

      // The guard runs here, on the merged attribute set, immediately before
      // anything can observe it. `traceId` and `durationMs` are added as
      // allow-listed fields rather than smuggled around the sanitizer.
      const envelope = sanitizeTelemetry({
        level: status === "error" ? "error" : "info",
        event: name,
        subsystem: "span",
        fields: { ...collected, ...(traceId ? { traceId } : {}), durationMs, status },
      });

      const finished: FinishedSpan = {
        name,
        traceId,
        spanId,
        ...(parentSpanId ? { parentSpanId } : {}),
        status,
        durationMs,
        envelope,
      };

      for (const sink of sinks) {
        try {
          sink.emit(finished);
        } catch {
          // A broken exporter is not an application fault. Same contract as
          // the 13-E logger: telemetry never becomes business authority.
        }
      }
      return finished;
    },
  };
}

/**
 * Wraps an operation in a span.
 *
 * The span is ended on both paths and the error is RE-THROWN unchanged — the
 * caller's error handling is untouched, and the span records only that the
 * operation failed. The error's message never reaches the span; 13-E's
 * `errorFields` is how a caller attaches a bounded class and code.
 */
export async function withSpan<T>(
  name: SpanName,
  attributes: Record<string, unknown>,
  fn: (span: SpanHandle) => Promise<T>
): Promise<T> {
  const span = startSpan(name, attributes);
  try {
    const result = await fn(span);
    span.end();
    return result;
  } catch (error) {
    span.setStatus("error");
    span.end();
    throw error;
  }
}
