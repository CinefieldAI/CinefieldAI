import "server-only";
import { ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { DEFAULT_AWS_REGION, SQS_QUEUES } from "../../sqs-topology";
import type { DlqMessage, DlqMessageSource } from "../dlq-message-source-contract";

/**
 * The real `cinefield-provider-dlq.fifo` message source (Phase 15-D/3).
 *
 * ---------------------------------------------------------------------------
 * SCOPE: THE PROVIDER DLQ ONLY
 * ---------------------------------------------------------------------------
 * `DLQ_INVESTIGATION_QUEUE` is read from `SQS_QUEUES.provider.dlqName` — the
 * existing topology contract — never a second, hand-typed queue name. This
 * file has no branch, parameter, or config key that could point it at any
 * other queue.
 *
 * ---------------------------------------------------------------------------
 * NON-DESTRUCTIVE BY CONSTRUCTION, NOT BY DISCIPLINE
 * ---------------------------------------------------------------------------
 * `VisibilityTimeout: 0` on every receive: the message is immediately
 * visible again to any other reader (a real operator's own AWS Console
 * check, a future redrive, anything) the instant this call returns. There is
 * no visibility window opened here to later restore — the read simply never
 * takes exclusive ownership of the message in the first place. Combined
 * with there being no `DeleteMessageCommand`, no
 * `ChangeMessageVisibilityCommand`, no `StartMessageMoveTaskCommand`, no
 * `SendMessageCommand`, no `PurgeQueueCommand` and no `SetQueueAttributes`
 * import anywhere in this file, an investigation cannot mutate the queue —
 * not "chooses not to", structurally cannot, because the SDK command needed
 * to do so is never imported.
 *
 * Credentials: the AWS SDK default provider chain, the same as every other
 * SQS client in this codebase (`sqs-command-bus.ts`, `worker/provider-worker.ts`).
 * Nothing here reads or stores an access key.
 */

export const DLQ_INVESTIGATION_QUEUE = SQS_QUEUES.provider.dlqName;

interface SqsDlqConfig {
  readonly dlqUrl: string;
  readonly region: string;
}

function readConfig(): SqsDlqConfig | null {
  const raw = process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL;
  const dlqUrl = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
  if (!dlqUrl) return null;
  const region = process.env.AWS_REGION?.trim() || DEFAULT_AWS_REGION;
  return { dlqUrl, region };
}

/**
 * Builds the real source, or returns `null` when
 * `CINEFIELD_SQS_PROVIDER_DLQ_URL` is not configured — the same
 * null-when-unconfigured convention `createSqsCommandBus()` already uses,
 * so an unmodified deployment fails honestly rather than guessing a URL.
 */
export function createSqsDlqMessageSource(): DlqMessageSource | null {
  const config = readConfig();
  if (!config) return null;
  const client = new SQSClient({ region: config.region });

  return {
    label: "sqs-provider-dlq",
    async peekMessage(): Promise<DlqMessage | null> {
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: config.dlqUrl,
          MaxNumberOfMessages: 1,
          // A one-shot investigation, not the provider worker's long-poll
          // consumer loop: an operator already knows a message likely
          // exists (e.g. the CloudWatch DLQ-depth alarm fired) and wants a
          // fast answer, not to sit inside a 20s WaitTimeSeconds.
          WaitTimeSeconds: 5,
          VisibilityTimeout: 0,
        })
      );
      const message = response.Messages?.[0];
      if (!message?.Body || !message.MessageId) return null;
      return { body: message.Body, messageId: message.MessageId };
    },
  };
}
