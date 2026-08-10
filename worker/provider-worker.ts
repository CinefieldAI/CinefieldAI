/**
 * Cinefield SQS provider worker entry point (Phase 6R.5).
 *
 * Long-lived process for AWS ECS Fargate — the consumer side of the locked
 * chain: Temporal activity → CommandBus → SQS → THIS WORKER →
 * ProviderAdapter → provider. Lives outside src/ for the same reason the
 * Temporal worker does: nothing under the Next.js graph may reach it.
 *
 * RECEIVE DISCIPLINE
 *   - long polling (WaitTimeSeconds from the central topology policy) — no
 *     hot empty-receive loop
 *   - one message at a time: provider submission is the money path, and
 *     per-message accounting beats batch throughput here
 *   - the message is deleted ONLY when the handler reports a safe durable
 *     outcome; otherwise it stays for redelivery and, after the queue's
 *     maxReceiveCount, the DLQ
 *   - visibility is NOT extended into provider execution: submission is
 *     bounded (the fal adapter's own 90s timeout) and long-running work is
 *     tracked by providerJobId after the message is already gone
 *
 * Credentials: AWS SDK default provider chain (ECS task role in production,
 * external configuration locally). Nothing here reads an access key, and no
 * message ever contains one.
 *
 * Run:  npm run provider:worker
 */

import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from "@aws-sdk/client-sqs";
import { parseCommand } from "../src/lib/contracts/command-wire";
import { SQS_QUEUES } from "../src/lib/aws/sqs-topology";
import { handleProviderCommand } from "./provider-command-handler";

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:provider-worker]", JSON.stringify(fields));
}

function readConfig() {
  const value = (name: string): string | undefined => {
    const raw = process.env[name];
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
  };
  const queueUrl = value("CINEFIELD_SQS_PROVIDER_QUEUE_URL");
  if (!queueUrl) return null;
  return {
    queueUrl,
    region: value("AWS_REGION") ?? "eu-central-1",
  };
}

let shuttingDown = false;

async function main(): Promise<void> {
  const config = readConfig();
  if (!config) {
    console.error(
      "[cinefield:provider-worker]",
      JSON.stringify({ result: "not_configured", required: "CINEFIELD_SQS_PROVIDER_QUEUE_URL" })
    );
    process.exit(1);
  }

  const client = new SQSClient({ region: config.region });

  const stop = () => {
    // Finish the in-flight message, then exit — ECS sends SIGTERM before
    // killing the task, and an abandoned in-flight message would only
    // reappear after its visibility timeout anyway.
    shuttingDown = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  log({ result: "started", queue: SQS_QUEUES.provider.name, region: config.region });

  while (!shuttingDown) {
    let messages: Message[] | undefined;
    try {
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: config.queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: SQS_QUEUES.provider.receiveWaitTimeSeconds,
        })
      );
      messages = response.Messages;
    } catch (caught) {
      // Receive failures are transport noise (network, throttle, IAM churn).
      // Log the class and keep polling — crashing the loop would take the
      // whole worker down over a transient.
      log({
        result: "receive_failed",
        error: caught instanceof Error ? caught.name : "UnknownError",
      });
      continue;
    }

    if (!messages || messages.length === 0) continue;

    for (const message of messages) {
      if (!message.Body || !message.ReceiptHandle) continue;

      const parsed = parseCommand(message.Body);

      if (!parsed.ok) {
        // Poison: schema-invalid. Never call a provider from it; leave it
        // for the redelivery budget and the DLQ. The reason is logged so the
        // DLQ investigation starts with a classification, not a payload dump.
        log({ result: "poison_message", reason: parsed.reason });
        continue;
      }

      let outcome;
      try {
        outcome = await handleProviderCommand(parsed.command);
      } catch (caught) {
        // The handler could not reach a durable decision (DB down, etc).
        // Retain: redelivery will retry, and the attempt claim keeps a
        // retried submission from ever duplicating a provider job.
        log({
          result: "handler_failed",
          attemptId: parsed.command.attemptId,
          error: caught instanceof Error ? caught.name : "UnknownError",
        });
        continue;
      }

      log({
        result: "handled",
        attemptId: parsed.command.attemptId,
        action: outcome.action,
        reason: outcome.reason,
      });

      if (outcome.action === "delete") {
        try {
          await client.send(
            new DeleteMessageCommand({
              QueueUrl: config.queueUrl,
              ReceiptHandle: message.ReceiptHandle,
            })
          );
        } catch (caught) {
          // Delete failed after a durable outcome: the message WILL be
          // redelivered, and the handler will classify it as an
          // already-decided duplicate and delete it then. Safe by design.
          log({
            result: "delete_failed",
            attemptId: parsed.command.attemptId,
            error: caught instanceof Error ? caught.name : "UnknownError",
          });
        }
      }
    }
  }

  log({ result: "stopped" });
}

main().catch((error: unknown) => {
  console.error(
    "[cinefield:provider-worker]",
    JSON.stringify({ result: "fatal", error: error instanceof Error ? error.name : "UnknownError" })
  );
  process.exit(1);
});
