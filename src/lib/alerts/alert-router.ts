import {
  ALERT_CATALOGUE,
  CORRELATION_PATTERN,
  CRITICAL_REEMIT_SECONDS,
  ESCALATION_THRESHOLDS,
  MAX_TRACKED_KEYS,
  REASON_CODE_PATTERN,
  RESOURCE_PATTERN,
  channelsFor,
  dedupeKeyFor,
  type AlertCandidate,
  type AlertCorrelation,
  type AlertEnvelope,
  type AlertType,
} from "./alert-contract";
import { dispatchToSinks } from "./alert-sink";
import { currentTraceId } from "@/lib/observability/trace-scope";

/**
 * The central alert router (Phase 13-D, code half).
 *
 * normalize → correlate → deduplicate → suppress → route → sinks.
 *
 * ---------------------------------------------------------------------------
 * IT CANNOT AFFECT ANYTHING IT WATCHES
 * ---------------------------------------------------------------------------
 * `raiseAlert` never throws and never rejects. It returns a result object that
 * every current caller ignores. Nothing here can fail a generation, retry a
 * provider, cancel a workflow, move a credit, change a security decision or
 * release a quarantine — this module imports the contract, the sinks and the
 * trace scope, and nothing that could do any of those things.
 *
 * That is not politeness. The callers are a security event logger and a worker
 * loop; an alerting fault that propagated into either would be a monitoring
 * system causing the incident it exists to report.
 */

interface DedupeEntry {
  alertId: string;
  /** Phase 16-D. Recorded at creation so a bounded read view (below) does not
   *  have to parse `type`/`resource` back out of the dedupe key string. */
  type: AlertType;
  resource: string;
  firstSeenMs: number;
  lastSeenMs: number;
  windowStartMs: number;
  occurrenceCount: number;
  /** Count at the last emission, so escalation crossings can be detected. */
  lastEmittedCount: number;
  lastEmittedMs: number;
  correlation: AlertCorrelation;
}

const entries = new Map<string, DedupeEntry>();

let sequence = 0;

/**
 * Alert ids are local and sequential, not random.
 *
 * `Math.random()` and `crypto.randomUUID()` are both avoidable here, and an id
 * that is stable within a process makes a repeated alert traceable to its
 * first occurrence. Correlation across processes is the job of the trace id,
 * which is a real distributed identifier; inventing a second one would be a
 * weaker duplicate of it.
 */
function nextAlertId(dedupeKey: string): string {
  sequence += 1;
  return `alert-${sequence}-${hashKey(dedupeKey)}`;
}

function hashKey(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export type RaiseOutcome =
  /** A new alert, or a re-emission after the window or an escalation. */
  | "emitted"
  /** Inside the window, no escalation crossed: counted, not delivered. */
  | "suppressed"
  /** The candidate was not a valid alert and was refused. */
  | "rejected";

export interface RaiseResult {
  readonly outcome: RaiseOutcome;
  readonly envelope?: AlertEnvelope;
  readonly reason?: "unknown_type" | "invalid_resource" | "invalid_reason_code" | "internal";
  readonly deliveredTo?: readonly string[];
}

/**
 * Normalization: what a producer supplies is not what gets routed.
 *
 * Unknown fields are DROPPED — the envelope is built field by field from an
 * allow-list rather than spread from the candidate, so a producer that later
 * starts passing a prompt, a signed URL, a raw error or an evidence row cannot
 * push it through. This is the same shape as the 13-E telemetry guard and for
 * the same reason: a deny-list only stops what someone remembered to name.
 *
 * Correlation ids are pattern-checked, not merely truthy. A correlation field
 * holding arbitrary text would be a free-text field in an envelope that has
 * none by design.
 */
function normalizeCorrelation(candidate: AlertCandidate): AlertCorrelation {
  const out: {
    traceId?: string;
    generationId?: string;
    providerAttemptId?: string;
    workflowId?: string;
    eventId?: string;
    tenantId?: string;
  } = {};

  // 13-A: if the producer did not pass a trace id, adopt the ambient one.
  // If there is none, the alert simply has no trace. A fabricated trace id
  // would corrupt every timeline it appeared in, which is worse than a gap.
  const trace = candidate.traceId ?? currentTraceId();
  if (typeof trace === "string" && CORRELATION_PATTERN.test(trace)) out.traceId = trace;

  const pairs: [keyof AlertCorrelation, string | undefined][] = [
    ["generationId", candidate.generationId],
    ["providerAttemptId", candidate.providerAttemptId],
    ["workflowId", candidate.workflowId],
    ["eventId", candidate.eventId],
    ["tenantId", candidate.tenantId],
  ];
  for (const [field, value] of pairs) {
    if (typeof value === "string" && CORRELATION_PATTERN.test(value)) {
      (out as Record<string, string>)[field] = value;
    }
  }

  return out;
}

/**
 * Correlation ids carry NO authority.
 *
 * A tenant id on an alert says which workspace the signal came from. It does
 * not grant, check or imply access to anything, and no code reads it back to
 * make an authorization decision. Alerts are an output of the system, never an
 * input to it.
 */

/** Removes the oldest tracked keys once the map is full. */
function evictIfNeeded(): void {
  if (entries.size <= MAX_TRACKED_KEYS) return;
  const oldest = [...entries.entries()].sort((a, b) => a[1].lastSeenMs - b[1].lastSeenMs);
  const drop = entries.size - MAX_TRACKED_KEYS;
  for (let i = 0; i < drop; i += 1) entries.delete(oldest[i][0]);
}

/**
 * Whether a suppressed alert must nonetheless be re-emitted.
 *
 * Two independent reasons, and either is enough:
 *
 *   1. The occurrence count crossed an escalation threshold. Three identical
 *      Redis failures and three thousand are not the same incident, and a
 *      router that reported them identically would be hiding the difference.
 *
 *   2. It is CRITICAL and has been silent for CRITICAL_REEMIT_SECONDS. A
 *      sustained critical failure that alerts once and then goes quiet is
 *      indistinguishable from one that recovered.
 */
function mustReemit(entry: DedupeEntry, type: AlertType, nowMs: number): boolean {
  const crossed = ESCALATION_THRESHOLDS.some(
    (threshold) => entry.lastEmittedCount < threshold && entry.occurrenceCount >= threshold
  );
  if (crossed) return true;

  const severity = ALERT_CATALOGUE[type].severity;
  return severity === "CRITICAL" && nowMs - entry.lastEmittedMs >= CRITICAL_REEMIT_SECONDS * 1_000;
}

/**
 * Raises one alert candidate.
 *
 * `nowMs` is injectable so window expiry can be tested without waiting and
 * without a clock stub that would also move every other timestamp in the
 * process.
 */
export function raiseAlert(candidate: AlertCandidate, nowMs: number = Date.now()): RaiseResult {
  try {
    const rule = ALERT_CATALOGUE[candidate.type];
    // An uncatalogued type is a programming error in the producer, refused
    // rather than routed. Accepting it would mean severity had to come from
    // somewhere other than this file — which is where severity is decided.
    if (!rule) return { outcome: "rejected", reason: "unknown_type" };
    if (typeof candidate.resource !== "string" || !RESOURCE_PATTERN.test(candidate.resource)) {
      return { outcome: "rejected", reason: "invalid_resource" };
    }
    if (typeof candidate.reasonCode !== "string" || !REASON_CODE_PATTERN.test(candidate.reasonCode)) {
      return { outcome: "rejected", reason: "invalid_reason_code" };
    }

    const observed = Number.isFinite(candidate.observed) && (candidate.observed as number) > 0
      ? Math.floor(candidate.observed as number)
      : 1;

    const dedupeKey = dedupeKeyFor(candidate.type, candidate.resource);
    const correlation = normalizeCorrelation(candidate);
    const windowMs = rule.dedupeWindowSeconds * 1_000;

    let entry = entries.get(dedupeKey);
    let emitted: boolean;

    if (!entry || nowMs - entry.windowStartMs >= windowMs) {
      // First occurrence, or the window expired. A new window always emits —
      // this is what stops suppression from becoming permanent silence.
      entry = {
        alertId: nextAlertId(dedupeKey),
        type: candidate.type,
        resource: candidate.resource,
        firstSeenMs: entry?.firstSeenMs ?? nowMs,
        lastSeenMs: nowMs,
        windowStartMs: nowMs,
        occurrenceCount: observed,
        lastEmittedCount: observed,
        lastEmittedMs: nowMs,
        correlation,
      };
      emitted = true;
    } else {
      entry.occurrenceCount += observed;
      entry.lastSeenMs = nowMs;
      // The FIRST correlation is kept, not the latest. An incident's timeline
      // should point at where it started; overwriting with each repeat would
      // leave a trace id from occurrence 4,000 and no way back to the first.
      emitted = mustReemit(entry, candidate.type, nowMs);
      if (emitted) {
        entry.lastEmittedCount = entry.occurrenceCount;
        entry.lastEmittedMs = nowMs;
      }
    }

    entries.set(dedupeKey, entry);
    evictIfNeeded();

    const envelope: AlertEnvelope = {
      alertId: entry.alertId,
      type: candidate.type,
      source: rule.source,
      severity: rule.severity,
      resource: candidate.resource,
      reasonCode: candidate.reasonCode,
      dedupeKey,
      state: emitted ? "OPEN" : "SUPPRESSED",
      firstSeen: new Date(entry.firstSeenMs).toISOString(),
      lastSeen: new Date(entry.lastSeenMs).toISOString(),
      occurrenceCount: entry.occurrenceCount,
      channels: emitted ? channelsFor(rule.severity, rule.userVisible) : [],
      correlation: entry.correlation,
    };

    if (!emitted) return { outcome: "suppressed", envelope };

    const deliveredTo = dispatchToSinks(envelope);
    return { outcome: "emitted", envelope, deliveredTo };
  } catch {
    // Nothing here is worth breaking a caller over, and the caught value is
    // not inspected: an alerting bug must not become an error message on a
    // path that was already reporting a different problem.
    return { outcome: "rejected", reason: "internal" };
  }
}

/**
 * Marks a problem resolved.
 *
 * Clearing the dedupe entry is the whole implementation: the next occurrence
 * opens a new window and alerts immediately, which is exactly what "resolved,
 * then it came back" should do. There is no resolution record, because the
 * durable timeline lives in the source evidence — not in a router that holds
 * its state in memory.
 */
export function resolveAlert(type: AlertType, resource: string): boolean {
  return entries.delete(dedupeKeyFor(type, resource));
}

/** Test and diagnostic access. Never used to make a decision. */
export function trackedAlertKeys(): string[] {
  return [...entries.keys()].sort();
}

/**
 * Bounded read view of every currently-tracked (not yet resolved) dedupe
 * entry — Phase 16-D's Incidents/Audit admin surface.
 *
 * ---------------------------------------------------------------------------
 * THE SAME STORE, NOT A SECOND ONE
 * ---------------------------------------------------------------------------
 * This reads the exact in-memory `entries` map `raiseAlert`/`resolveAlert`
 * already maintain — it adds no persistence, no new field beyond `type` and
 * `resource` (both already known at entry-creation time, now just kept
 * instead of only living inside the dedupe key string), and no second
 * router. Section 8 of the Phase 16-D spec is explicit that alert history
 * here is honestly EPHEMERAL: this process's memory only, cleared on every
 * restart/redeploy and never shared across instances — an admin reading
 * this list is seeing "what this one process currently knows," not a durable
 * incident timeline. `severity` is looked up from `ALERT_CATALOGUE` fresh
 * rather than stored, so it can never drift from the one place severity is
 * decided.
 *
 * `state` is inferred, not stored: every entry still in the map is
 * un-resolved by definition (`resolveAlert` deletes the row), so every
 * returned row reports `"OPEN"` — a resolved problem simply is not in this
 * list anymore, which is the whole implementation of resolution here (see
 * `resolveAlert`'s own doc comment). This is presentation only; it grants no
 * new capability and mutates nothing.
 */
export interface TrackedAlertSnapshot {
  readonly type: AlertType;
  readonly source: AlertEnvelope["source"];
  readonly severity: AlertEnvelope["severity"];
  readonly resource: string;
  readonly dedupeKey: string;
  readonly state: "OPEN";
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly occurrenceCount: number;
  readonly correlation: AlertCorrelation;
}

export function listTrackedAlerts(): TrackedAlertSnapshot[] {
  return [...entries.entries()]
    .map(([dedupeKey, entry]) => {
      const rule = ALERT_CATALOGUE[entry.type];
      return {
        type: entry.type,
        source: rule.source,
        severity: rule.severity,
        resource: entry.resource,
        dedupeKey,
        state: "OPEN" as const,
        firstSeen: new Date(entry.firstSeenMs).toISOString(),
        lastSeen: new Date(entry.lastSeenMs).toISOString(),
        occurrenceCount: entry.occurrenceCount,
        correlation: entry.correlation,
      };
    })
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function resetAlertRouter(): void {
  entries.clear();
  sequence = 0;
}
