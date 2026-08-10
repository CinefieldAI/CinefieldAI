import "server-only";

/**
 * Cinefield CommandBus — the transport boundary for durable, cross-service
 * commands (Phase 6R.2).
 *
 * A command is an INSTRUCTION to do work that has not happened yet
 * ("submit this attempt to a provider", "download this output"). It is the
 * counterpart to an event, which reports something that already happened
 * (see event-publisher.ts).
 *
 * WHY THIS EXISTS
 * The locked Phase 6R architecture puts AWS SQS + DLQ under heavy and
 * cross-service work. Nothing in the generation domain, the orchestrator, or
 * any ProviderAdapter may import an AWS (or BullMQ, or Kafka) SDK — the
 * moment domain code knows its transport, replacing or adding a transport
 * becomes a rewrite instead of a configuration change. Domain code depends on
 * this interface; the transport lives behind an adapter.
 *
 * WHAT MAY TRAVEL IN A COMMAND
 * Identifiers only. A command must be safe to sit in a queue, be logged, be
 * redelivered, and be read by an operator. Never put a secret, an
 * authorization header, a signed URL, a temporary provider URL, a raw
 * provider payload, or a user prompt in one — the receiving worker re-reads
 * everything it needs from the database using these ids.
 *
 * DELIVERY SEMANTICS
 * Every adapter is assumed to be AT-LEAST-ONCE. A command may arrive twice,
 * out of order, or after a long delay. Handlers must be idempotent; for
 * provider submission that idempotency is the Phase 6E/B3 attempt-evidence
 * check, never the transport's own deduplication.
 */

/** Logical destinations. One queue per kind; names are resolved by the adapter. */
export type CommandQueue =
  | "provider"
  | "media"
  | "moderation"
  | "callback"
  | "backup"
  | "generation-control";

/**
 * Commands the platform can issue. Each carries only identifiers.
 *
 * `attemptId` refers to a row in the generation_attempts table introduced in
 * Phase 6R.6 — the unit that owns one provider submission and its evidence.
 */
export type Command =
  | { type: "provider.submit"; generationId: string; attemptId: string }
  | { type: "provider.check-status"; generationId: string; attemptId: string }
  | { type: "provider.cancel"; generationId: string; attemptId: string }
  | { type: "media.ingest-output"; generationId: string; attemptId: string }
  | { type: "moderation.review-output"; generationId: string; attemptId: string };

/**
 * A command with its delivery metadata.
 *
 * `idempotencyKey` is the DEDUPLICATION hint given to the transport (an SQS
 * FIFO MessageDeduplicationId, for example). It reduces duplicate delivery;
 * it does NOT replace handler-side idempotency, because no transport
 * guarantees exactly-once end to end.
 *
 * `traceId` carries the correlation id through the queue so a command can be
 * tied back to the request and the generation that produced it.
 */
export interface CommandEnvelope {
  queue: CommandQueue;
  command: Command;
  idempotencyKey: string;
  traceId?: string;
  /** Requested delay before the command becomes visible, in seconds. */
  delaySeconds?: number;
}

export interface CommandBus {
  /** Resolves once the command is durably accepted by the transport. */
  enqueue(envelope: CommandEnvelope): Promise<void>;
}

/**
 * The only adapter that exists in Phase 6R.2.
 *
 * It does not deliver anything — it records the intent and returns, so the
 * contract can be wired, type-checked, and unit-tested before AWS exists.
 * Nothing in production may depend on it: the SQS adapter (Phase 6R.4) is
 * what actually delivers. Kept deliberately dumb so it can never be mistaken
 * for a working queue.
 */
export class NoopCommandBus implements CommandBus {
  readonly accepted: CommandEnvelope[] = [];

  async enqueue(envelope: CommandEnvelope): Promise<void> {
    this.accepted.push(envelope);
    console.info(
      "[cinefield:command]",
      JSON.stringify({
        queue: envelope.queue,
        type: envelope.command.type,
        generationId: envelope.command.generationId,
        attemptId: envelope.command.attemptId,
        adapter: "noop",
      })
    );
  }
}

let bus: CommandBus | null = null;

/**
 * Process-wide CommandBus. Phase 6R.4 replaces the default with the SQS
 * adapter through `setCommandBus` at composition time — callers keep using
 * this function and never learn which transport answered.
 */
export function getCommandBus(): CommandBus {
  if (!bus) bus = new NoopCommandBus();
  return bus;
}

export function setCommandBus(next: CommandBus): void {
  bus = next;
}
