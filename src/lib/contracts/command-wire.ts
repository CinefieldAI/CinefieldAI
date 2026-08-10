/**
 * Cinefield command wire format v1 (Phase 6R.4).
 *
 * The serialized shape of one command as it travels through a queue. Shared
 * by the SQS CommandBus adapter (serialize) and the workers (parse), so the
 * producer and the consumer can never drift apart silently.
 *
 * WHY A VERSIONED WIRE FORMAT EXISTS AT ALL
 * A queue message outlives deployments: a message enqueued by yesterday's
 * code is consumed by today's. The explicit `v` field is what lets a future
 * format change coexist with in-flight messages instead of poisoning them.
 *
 * WHAT IS ALLOWED ON THE WIRE
 * Identifiers and safe execution facts only — the consumer reloads
 * everything else from the database. Never: API keys, tokens, signed URLs,
 * temporary provider URLs, raw provider payloads, prompts, or media. That
 * rule is enforced structurally: parsing REJECTS unknown fields, so a secret
 * cannot even ride along accidentally.
 *
 * No imports and no secrets — safe for both the Next.js server graph and the
 * standalone workers.
 */

export const COMMAND_WIRE_VERSION = 1;

/** Command types carried over the queue today. Extend the union, never fork it. */
export type WireCommandType = "provider.submit";

export interface CommandWireV1 {
  v: typeof COMMAND_WIRE_VERSION;
  /**
   * Deterministic command identity: `<type>:<attemptId>`. Doubles as the
   * FIFO deduplication id, so a redispatch of the same logical command (a
   * Temporal activity retry, a double-enqueue) collapses inside SQS instead
   * of reaching the worker twice. Never random — a random id would defeat
   * exactly that.
   */
  commandId: string;
  type: WireCommandType;
  generationId: string;
  attemptId: string;
  /** Producer timestamp (ISO). Observability and staleness checks only. */
  issuedAt: string;
  /** Correlation id for tracing. Optional, never secret. */
  traceId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN_TYPES: ReadonlySet<string> = new Set<WireCommandType>(["provider.submit"]);
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "v",
  "commandId",
  "type",
  "generationId",
  "attemptId",
  "issuedAt",
  "traceId",
]);

/** Deterministic command id for one logical command. */
export function commandIdFor(type: WireCommandType, attemptId: string): string {
  return `${type}:${attemptId}`;
}

export function serializeCommand(command: Omit<CommandWireV1, "v">): string {
  return JSON.stringify({ v: COMMAND_WIRE_VERSION, ...command });
}

export type ParseResult =
  | { ok: true; command: CommandWireV1 }
  | { ok: false; reason: string };

/**
 * Strict parse of a queue message body. Anything unexpected — wrong version,
 * unknown type, malformed ids, extra fields — is rejected with a reason and
 * WITHOUT throwing, so the worker can classify poison messages calmly
 * instead of crashing its receive loop.
 */
export function parseCommand(body: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, reason: "not_json" };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not_object" };
  }
  const record = raw as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, reason: `unknown_field:${key}` };
  }

  if (record.v !== COMMAND_WIRE_VERSION) return { ok: false, reason: "unsupported_version" };
  if (typeof record.type !== "string" || !KNOWN_TYPES.has(record.type)) {
    return { ok: false, reason: "unknown_type" };
  }
  if (typeof record.generationId !== "string" || !UUID_PATTERN.test(record.generationId)) {
    return { ok: false, reason: "invalid_generation_id" };
  }
  if (typeof record.attemptId !== "string" || !UUID_PATTERN.test(record.attemptId)) {
    return { ok: false, reason: "invalid_attempt_id" };
  }
  if (
    typeof record.commandId !== "string" ||
    record.commandId !== commandIdFor(record.type as WireCommandType, record.attemptId)
  ) {
    return { ok: false, reason: "command_id_mismatch" };
  }
  if (typeof record.issuedAt !== "string" || Number.isNaN(Date.parse(record.issuedAt))) {
    return { ok: false, reason: "invalid_issued_at" };
  }
  if (record.traceId !== undefined && typeof record.traceId !== "string") {
    return { ok: false, reason: "invalid_trace_id" };
  }

  return {
    ok: true,
    command: {
      v: COMMAND_WIRE_VERSION,
      commandId: record.commandId,
      type: record.type as WireCommandType,
      generationId: record.generationId,
      attemptId: record.attemptId,
      issuedAt: record.issuedAt,
      ...(record.traceId !== undefined ? { traceId: record.traceId as string } : {}),
    },
  };
}
