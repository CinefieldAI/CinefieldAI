import "server-only";
import { sanitizeTelemetry } from "./telemetry-redaction";
import type { TelemetryEnvelope, TelemetryLevel } from "./telemetry-contract";

/**
 * The structured logger seam (Phase 13-E).
 *
 * ---------------------------------------------------------------------------
 * ONE WAY OUT, AND IT GOES THROUGH THE GUARD
 * ---------------------------------------------------------------------------
 * Every production log call in Cinefield routes through here, and here calls
 * `sanitizeTelemetry` before anything is written. There is no parameter that
 * skips it and no "raw" variant — a bypass would be used within a week, in
 * the one debugging session where someone really wants the whole object.
 *
 * ---------------------------------------------------------------------------
 * IT IS ALSO THE ATTACH POINT FOR EVERY FUTURE SINK
 * ---------------------------------------------------------------------------
 * Sentry, OpenTelemetry, CloudWatch and Better Stack are later packages. Each
 * will register a sink here and receive an ALREADY-SANITIZED envelope — they
 * never see the caller's original fields, so ¶1723's requirement that
 * forbidden data be absent from all four is enforced once rather than four
 * times.
 *
 * No sink is registered today, and none is written: an exporter with no
 * service behind it is the built-but-unwired defect this repository has
 * closed four times. What exists is the interface they attach to, and the
 * console output that already existed.
 *
 * ---------------------------------------------------------------------------
 * LOGGING IS NOT BUSINESS AUTHORITY
 * ---------------------------------------------------------------------------
 * Nothing here throws and nothing here is awaited. A sink that fails is
 * removed from consideration for that call and the process continues: a
 * telemetry failure must never fail a generation, retry a provider, mutate
 * billing, drop a durable security event, or crash a worker. That is the same
 * fire-and-forget contract 12-C's security logger uses, for the same reason.
 *
 * The Sensitive Data Guard fails in the opposite direction, and that
 * asymmetry is deliberate: an unsafe field is DROPPED rather than emitted.
 * Losing observability is recoverable; a prompt in a third-party system is
 * not.
 */

/** A destination for sanitized envelopes. Registered by later packages. */
export interface TelemetrySink {
  readonly name: string;
  /** Receives an already-sanitized envelope. Must not throw; must not block. */
  emit(envelope: TelemetryEnvelope): void;
}

const sinks: TelemetrySink[] = [];

/**
 * Registers a sink. Phase 13-A/13-B/13-C's single wiring point.
 *
 * Idempotent by name so a hot reload or a double import cannot double-report.
 */
export function registerTelemetrySink(sink: TelemetrySink): void {
  if (sinks.some((s) => s.name === sink.name)) return;
  sinks.push(sink);
}

/** Test seam, and the way a package removes its sink on shutdown. */
export function clearTelemetrySinks(): void {
  sinks.length = 0;
}

export function registeredSinkNames(): string[] {
  return sinks.map((s) => s.name).sort();
}

/**
 * Whether console output is produced.
 *
 * On by default because it is what the 24 existing module helpers already do
 * and removing it would be a silent observability regression. Once a real
 * sink exists, a deployment can turn it off without touching a call site.
 */
let consoleEnabled = true;
export function setConsoleOutput(enabled: boolean): void {
  consoleEnabled = enabled;
}

/**
 * Fields a caller may pass.
 *
 * `object`, not `Record<string, unknown>`. Several modules declare a typed
 * `interface LogFields { generationId: string; ... }` — an explicit per-module
 * allow-list, which is exactly the discipline this phase wants — and a
 * TypeScript interface has no index signature, so it is not assignable to a
 * Record. Narrowing the public type to Record would have forced those modules
 * to loosen their own types to satisfy the guard, which is precisely backwards.
 */
export type LogFields = object;

/** Entries of a caller-supplied bag. Values stay `unknown` until the guard runs. */
function entriesOf(fields: LogFields | undefined): Record<string, unknown> | undefined {
  return fields as Record<string, unknown> | undefined;
}

function write(level: TelemetryLevel, subsystem: string, event: string, fields?: LogFields): void {
  const envelope = sanitizeTelemetry({ level, event, subsystem, fields: entriesOf(fields) });

  if (consoleEnabled) {
    // The same shape the modules already emitted — `[cinefield:x] {json}` —
    // so existing log parsing and eyeballs keep working. The difference is
    // that the object is now an envelope that passed the guard.
    const line = `[cinefield:${envelope.subsystem}]`;
    const body = JSON.stringify(envelope);
    if (level === "error") console.error(line, body);
    else if (level === "warn") console.warn(line, body);
    else console.info(line, body);
  }

  for (const sink of sinks) {
    try {
      sink.emit(envelope);
    } catch {
      // A broken sink is not an application fault. Swallowed by design —
      // see the header. It is not removed from the list here, because
      // deciding to disable a sink is an operational decision, not one a
      // single failed emit should make.
    }
  }
}

/**
 * A logger bound to one subsystem.
 *
 * Created once per module, replacing that module's private `log()` helper.
 * Binding the subsystem means a call site cannot mislabel itself, and the
 * name lands in a validated field rather than in a string prefix nothing can
 * parse.
 */
export interface SubsystemLogger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createLogger(subsystem: string): SubsystemLogger {
  return {
    debug: (event, fields) => write("debug", subsystem, event, fields),
    info: (event, fields) => write("info", subsystem, event, fields),
    warn: (event, fields) => write("warn", subsystem, event, fields),
    error: (event, fields) => write("error", subsystem, event, fields),
  };
}

/**
 * Compatibility shim for the 24 modules whose helper takes only a field bag.
 *
 * Their existing call sites read `log({ op: "claim", result: "ok" })` with no
 * event name, and rewriting several hundred of them would be a large diff
 * across the orchestration, provider, Redis and worker paths for no security
 * gain — the guard runs either way. The event name is derived from the `op`
 * or `result` the call already carries.
 *
 * New code should use `createLogger(...)` and name its events.
 */
export function createFieldLogger(subsystem: string): (fields: LogFields) => void {
  const logger = createLogger(subsystem);
  return (fields: LogFields) => {
    const bag = entriesOf(fields) ?? {};
    const op = typeof bag.op === "string" ? bag.op : undefined;
    const result = typeof bag.result === "string" ? bag.result : undefined;
    logger.info(op ?? result ?? "event", fields);
  };
}
