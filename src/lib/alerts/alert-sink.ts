import type { AlertChannel, AlertEnvelope } from "./alert-contract";
import { createLogger } from "@/lib/observability/logger";

/**
 * Alert delivery contract (Phase 13-D, code half).
 *
 * ---------------------------------------------------------------------------
 * NO SINK IN THIS FILE TOUCHES THE NETWORK
 * ---------------------------------------------------------------------------
 * There is no fetch, no HTTP client, no socket, no token, no webhook URL and
 * no bot id anywhere in `src/lib/alerts/`. A test asserts that by scanning the
 * directory, so a future network call cannot be added quietly.
 *
 * `TelegramAlertSink`, `StatusPageSink` and any Sentry/Datadog bridge are the
 * external half of 13-D and are NOT built. They plug in here when they exist.
 */

/**
 * What a delivery sink must implement.
 *
 * `deliver` returns void, not a result. A sink is the end of the line: nothing
 * upstream may branch on whether an alert was delivered, because that would
 * make an alerting outage capable of changing behaviour — see the failure
 * semantics in `alert-router.ts`.
 */
export interface AlertDeliverySink {
  /** Stable, bounded name. Appears in telemetry. */
  readonly name: string;
  /** Which symbolic channel this sink serves. */
  readonly channel: AlertChannel;
  deliver(envelope: AlertEnvelope): void;
}

const log = createLogger("alerts");

const registry = new Map<string, AlertDeliverySink>();

export function registerAlertSink(sink: AlertDeliverySink): void {
  registry.set(sink.name, sink);
}

export function clearAlertSinks(): void {
  registry.clear();
}

export function registeredAlertSinks(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Hands an envelope to every sink registered for its routed channels.
 *
 * A sink that throws is contained here. Delivery failures must not propagate:
 * the caller of the router is a security logger or a worker loop, and an
 * alerting fault that broke either of those would be a monitoring system
 * causing the outage it exists to report.
 */
export function dispatchToSinks(envelope: AlertEnvelope): string[] {
  const delivered: string[] = [];
  for (const sink of registry.values()) {
    if (!envelope.channels.includes(sink.channel)) continue;
    try {
      sink.deliver(envelope);
      delivered.push(sink.name);
    } catch {
      // Class only, and not even that — a sink name plus a failure flag is all
      // that is safe to say about a sink that misbehaved.
      log.warn("alert_sink_failed", { subsystem: "alerts", resource: sink.name, result: "error" });
    }
  }
  return delivered;
}

/**
 * The only sink that exists today: it writes the envelope to the structured
 * logger and stops.
 *
 * This is what makes the router observable without giving it reach. The
 * envelope is already a bounded projection, and the logger applies the 13-E
 * allow-list on top, so the alert path cannot leak even if a producer were
 * changed to pass something it should not.
 *
 * It serves DASHBOARD because that is the internal pull surface. Nothing here
 * is a Telegram or status-page stand-in — an unrouted channel simply has no
 * sink, and `dispatchToSinks` delivers nothing for it.
 */
export class LoggingAlertSink implements AlertDeliverySink {
  readonly name = "logging";
  readonly channel: AlertChannel = "DASHBOARD";

  deliver(envelope: AlertEnvelope): void {
    log.warn("alert_raised", {
      subsystem: "alerts",
      // Every field name below is in the 13-E allow-list, and every VALUE is
      // an enum label or a count. `severity` is lowercased because the
      // allow-list types it as a code, and a code is lowercase by definition.
      kind: envelope.type,
      severity: envelope.severity.toLowerCase(),
      resource: envelope.resource,
      reasonCode: envelope.reasonCode,
      count: envelope.occurrenceCount,
      result: envelope.state.toLowerCase(),
      ...(envelope.correlation.traceId ? { traceId: envelope.correlation.traceId } : {}),
      ...(envelope.correlation.generationId ? { generationId: envelope.correlation.generationId } : {}),
    });
  }
}
