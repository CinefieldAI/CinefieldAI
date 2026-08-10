import "server-only";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { CommandBus, CommandEnvelope } from "@/lib/contracts/command-bus";
import { commandIdFor, serializeCommand, type WireCommandType } from "@/lib/contracts/command-wire";
import { readSqsConfig } from "./sqs-config";
import { OrchestrationError } from "@/lib/orchestration/errors";

/**
 * AWS SQS adapter for the Cinefield CommandBus (Phase 6R.4).
 *
 * The ONLY producer-side code allowed to know AWS. Domain code — the
 * orchestrator, ProviderAdapters, Temporal activities — talks to the
 * CommandBus interface and never imports this module directly; composition
 * happens at process startup (worker entry points), so swapping or adding a
 * transport stays a wiring change.
 *
 * Credentials come from the AWS SDK default provider chain (ECS task role in
 * production, external configuration locally). Nothing here reads or stores
 * an access key.
 *
 * FIFO semantics for the provider queue:
 *   MessageGroupId         = generationId — commands for one generation are
 *                            processed in order and never concurrently.
 *   MessageDeduplicationId = deterministic commandId (`type:attemptId`) — a
 *                            redispatch of the same logical command within
 *                            SQS's dedup window collapses to one delivery.
 * Both are defense-in-depth. The authoritative duplicate-submit guards
 * remain the generation_attempts claim and the DB uniqueness constraints.
 */

const SUPPORTED_QUEUES = new Set<CommandEnvelope["queue"]>(["provider"]);

export class SqsCommandBus implements CommandBus {
  private readonly client: SQSClient;
  private readonly providerQueueUrl: string;

  constructor(config: { region: string; providerQueueUrl: string }) {
    this.client = new SQSClient({ region: config.region });
    this.providerQueueUrl = config.providerQueueUrl;
  }

  async enqueue(envelope: CommandEnvelope): Promise<void> {
    if (!SUPPORTED_QUEUES.has(envelope.queue)) {
      // Only the provider queue is wired in Package B. Refusing loudly beats
      // silently dropping a command for a queue that exists on paper only.
      throw new OrchestrationError("INTERNAL_ERROR", {
        context: { reason: "queue_not_wired", queue: envelope.queue },
      });
    }

    const type = envelope.command.type as WireCommandType;
    const body = serializeCommand({
      commandId: commandIdFor(type, envelope.command.attemptId),
      type,
      generationId: envelope.command.generationId,
      attemptId: envelope.command.attemptId,
      issuedAt: new Date().toISOString(),
      ...(envelope.traceId ? { traceId: envelope.traceId } : {}),
    });

    // Provider queue is FIFO: per-message DelaySeconds is not supported by
    // SQS on FIFO queues, so a requested delay is refused rather than
    // silently dropped.
    if (envelope.delaySeconds !== undefined && envelope.delaySeconds > 0) {
      throw new OrchestrationError("INTERNAL_ERROR", {
        context: { reason: "delay_unsupported_on_fifo", queue: envelope.queue },
      });
    }

    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.providerQueueUrl,
        MessageBody: body,
        MessageGroupId: envelope.command.generationId,
        MessageDeduplicationId: envelope.idempotencyKey,
      })
    );
  }
}

/**
 * Builds the SQS bus from configuration, or returns null when SQS is not
 * configured. The caller (a worker entry point) decides whether null means
 * "fall back to noop" or "refuse to start".
 */
export function createSqsCommandBus(): SqsCommandBus | null {
  const config = readSqsConfig();
  if (!config) return null;
  return new SqsCommandBus(config);
}
