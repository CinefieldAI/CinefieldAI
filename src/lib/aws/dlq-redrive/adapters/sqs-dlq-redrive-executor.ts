import "server-only";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { DEFAULT_AWS_REGION } from "../../sqs-topology";
import { evaluateDlqRedriveDecision } from "../dlq-redrive-decision-engine";
import { isRedrivePermitted } from "../dlq-redrive-contract";
import type { DlqRedriveDecision, DlqRedriveEvidenceSource } from "../dlq-redrive-contract";

/**
 * The real, single-message-targeted DLQ redrive EXECUTOR (Phase 16-B).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A NEW FILE, NOT A REUSE OF `sqs-dlq-message-source.ts`
 * ---------------------------------------------------------------------------
 * The Phase 15-D/3 investigation adapter reads with `VisibilityTimeout: 0`
 * on purpose — it never takes ownership of a message, so it structurally
 * cannot yield a receipt handle usable for a later mutation, and it imports
 * no mutating SDK command at all. This file exists because redriving a
 * SPECIFIC message requires exactly the opposite for one short synchronous
 * window: receive it WITH a real visibility timeout (claiming it), decide,
 * then either send+delete (redrive) or release it immediately (refuse).
 * `evaluateDlqRedriveDecision` (Phase 15-D/1) is imported and called
 * UNMODIFIED, exactly once, against the body of the message THIS function
 * itself just received -- never a stale decision computed earlier by an
 * investigation call, and never a second implementation of the six-state
 * safety logic.
 *
 * ---------------------------------------------------------------------------
 * WHY THE AWS CALLS ARE SPLIT BEHIND `DlqRedriveQueueClient`
 * ---------------------------------------------------------------------------
 * Mirrors the exact split `dlq-message-source-contract.ts` already
 * established for investigation: `redriveOneProviderDlqMessageWithClient`
 * is pure orchestration over an injected interface, testable with a fake
 * client and a fake evidence source with zero AWS cost; only
 * `createSqsDlqRedriveQueueClient` touches the real SDK, and it is tested
 * only for its "returns null when unconfigured" behaviour -- the same
 * boundary `createSqsDlqMessageSource` already has.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `StartMessageMoveTaskCommand`
 * ---------------------------------------------------------------------------
 * That AWS API moves an entire DLQ->source-queue task; it has no
 * per-message target. It cannot express "redrive exactly the one message
 * an operator just reviewed and approved" -- using it here would mean
 * either moving everything in the DLQ (unbounded, unreviewed) or not using
 * it at all. This file uses only `ReceiveMessage`/`SendMessage`/
 * `DeleteMessage`/`ChangeMessageVisibility` -- commands that already exist
 * individually elsewhere in this codebase (`SendMessageCommand` in
 * `sqs-command-bus.ts`, `DeleteMessageCommand` in
 * `worker/provider-worker.ts`), composed here into one narrow sequence for
 * one narrow purpose.
 *
 * ---------------------------------------------------------------------------
 * A REFUSAL RELEASES THE MESSAGE IMMEDIATELY
 * ---------------------------------------------------------------------------
 * `REDRIVE_CLAIM_VISIBILITY_SECONDS` is deliberately short (enough time to
 * evaluate, then send+delete or release) -- but a refusal calls
 * `ChangeMessageVisibility(0)` rather than waiting out even that short
 * window, so the message becomes visible to the next reader (a real
 * operator's AWS Console check, the next investigation, a future retry) as
 * soon as the decision is made, not merely "eventually."
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT PROTECT AGAINST, AND WHY THAT IS FINE
 * ---------------------------------------------------------------------------
 * This is not a two-phase commit: it is possible, in principle, for
 * `SendMessage` to succeed and the process to die before `DeleteMessage`
 * runs, leaving the message both re-enqueued AND still parked in the DLQ
 * (to be redelivered again after the claim window lapses). This is
 * explicitly acceptable, not a bug to design around here: the existing
 * atomic attempt claim (`claimAttemptForSubmission`, inside
 * `submitAttempt`) is the real, already-proven protection against double
 * execution -- it makes ANY redelivery of a provider command safe,
 * redriven or not, by construction, which is the same guarantee the whole
 * 15-D package already rests on. Building a distributed transaction here
 * would duplicate a safety property this codebase already owns elsewhere.
 */

/** Enough time to evaluate + send + delete synchronously; short so a crash mid-flight self-heals quickly. */
const REDRIVE_CLAIM_VISIBILITY_SECONDS = 30;

export type DlqRedriveExecutionOutcome =
  | { readonly outcome: "NOT_CONFIGURED" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "NO_MESSAGE" }
  | { readonly outcome: "REFUSED"; readonly decision: DlqRedriveDecision }
  | { readonly outcome: "REDRIVEN"; readonly decision: DlqRedriveDecision; readonly messageId: string };

export interface ClaimedDlqMessage {
  readonly body: string;
  readonly messageId: string;
  readonly receiptHandle: string;
}

/**
 * The narrow, injectable boundary the pure orchestration below depends on.
 * Every method maps to exactly one SQS SDK call in the real adapter.
 */
export interface DlqRedriveQueueClient {
  /** Receives with a real visibility timeout, claiming the message. `null` when the DLQ currently has none. */
  receiveAndClaim(): Promise<ClaimedDlqMessage | null>;
  /** Best-effort. Must never throw into its caller. */
  releaseImmediately(receiptHandle: string): Promise<void>;
  sendToProviderQueue(body: string, messageGroupId: string, deduplicationId: string): Promise<void>;
  deleteFromDlq(receiptHandle: string): Promise<void>;
}

/**
 * Pure orchestration: receive, decide (fresh, every time), then either
 * redrive or release. Testable with a fake `DlqRedriveQueueClient` and a
 * fake `DlqRedriveEvidenceSource` at zero AWS/Supabase cost.
 */
export async function redriveOneProviderDlqMessageWithClient(
  client: DlqRedriveQueueClient,
  evidenceSource: DlqRedriveEvidenceSource | null
): Promise<DlqRedriveExecutionOutcome> {
  let claimed: ClaimedDlqMessage | null;
  try {
    claimed = await client.receiveAndClaim();
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "dlq_receive_failed" };
  }

  if (!claimed) {
    return { outcome: "NO_MESSAGE" };
  }

  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: claimed.body, source: evidenceSource });

  if (!isRedrivePermitted(decision.state)) {
    await client.releaseImmediately(claimed.receiptHandle);
    return { outcome: "REFUSED", decision };
  }

  // SAFE_TO_REDRIVE, and generationId/commandId are guaranteed present on
  // that branch by the decision engine's own contract -- refuse
  // defensively rather than guess if that invariant is ever violated.
  if (!decision.generationId || !decision.commandId) {
    await client.releaseImmediately(claimed.receiptHandle);
    return {
      outcome: "REFUSED",
      decision: { ...decision, state: "REFUSE_INSUFFICIENT_EVIDENCE", reasonCode: "missing_redrive_target_ids" },
    };
  }

  try {
    await client.sendToProviderQueue(claimed.body, decision.generationId, `admin-redrive-${decision.commandId}`);
    await client.deleteFromDlq(claimed.receiptHandle);
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "redrive_send_or_delete_failed" };
  }

  return { outcome: "REDRIVEN", decision, messageId: claimed.messageId };
}

interface SqsDlqRedriveConfig {
  readonly dlqUrl: string;
  readonly queueUrl: string;
  readonly region: string;
}

function readConfig(): SqsDlqRedriveConfig | null {
  const dlqRaw = process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL;
  const queueRaw = process.env.CINEFIELD_SQS_PROVIDER_QUEUE_URL;
  const dlqUrl = typeof dlqRaw === "string" && dlqRaw.trim().length > 0 ? dlqRaw.trim() : undefined;
  const queueUrl = typeof queueRaw === "string" && queueRaw.trim().length > 0 ? queueRaw.trim() : undefined;
  // Both must be configured -- a redrive with only half its addresses
  // known is not a smaller capability, it is an unsafe one.
  if (!dlqUrl || !queueUrl) return null;
  const region = process.env.AWS_REGION?.trim() || DEFAULT_AWS_REGION;
  return { dlqUrl, queueUrl, region };
}

/** Builds the real SQS-backed client, or `null` when unconfigured -- same convention `createSqsDlqMessageSource` uses. */
export function createSqsDlqRedriveQueueClient(): DlqRedriveQueueClient | null {
  const config = readConfig();
  if (!config) return null;
  const client = new SQSClient({ region: config.region });

  return {
    async receiveAndClaim() {
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: config.dlqUrl,
          MaxNumberOfMessages: 1,
          // No long poll: an operator already reviewed evidence that a
          // message is present (via the read-only investigation surface)
          // before ever reaching this action.
          WaitTimeSeconds: 0,
          VisibilityTimeout: REDRIVE_CLAIM_VISIBILITY_SECONDS,
        })
      );
      const message = response.Messages?.[0];
      if (!message?.Body || !message.MessageId || !message.ReceiptHandle) return null;
      return { body: message.Body, messageId: message.MessageId, receiptHandle: message.ReceiptHandle };
    },
    async releaseImmediately(receiptHandle: string) {
      try {
        await client.send(
          new ChangeMessageVisibilityCommand({ QueueUrl: config.dlqUrl, ReceiptHandle: receiptHandle, VisibilityTimeout: 0 })
        );
      } catch {
        // Best effort -- the claim window lapses on its own regardless, so
        // a failed release here degrades to "visible again in <=30s"
        // rather than "visible again immediately."
      }
    },
    async sendToProviderQueue(body: string, messageGroupId: string, deduplicationId: string) {
      await client.send(
        new SendMessageCommand({
          QueueUrl: config.queueUrl,
          MessageBody: body,
          // Same per-generation ordering convention `sqs-topology.ts`
          // already documents for `cinefield-provider.fifo`.
          MessageGroupId: messageGroupId,
          MessageDeduplicationId: deduplicationId,
        })
      );
    },
    async deleteFromDlq(receiptHandle: string) {
      await client.send(new DeleteMessageCommand({ QueueUrl: config.dlqUrl, ReceiptHandle: receiptHandle }));
    },
  };
}

/**
 * Attempts to redrive at most one message from `cinefield-provider-dlq.fifo`
 * back into `cinefield-provider.fifo`, using the real SQS-backed client.
 */
export async function redriveOneProviderDlqMessage(
  evidenceSource: DlqRedriveEvidenceSource | null
): Promise<DlqRedriveExecutionOutcome> {
  const client = createSqsDlqRedriveQueueClient();
  if (!client) return { outcome: "NOT_CONFIGURED" };
  return redriveOneProviderDlqMessageWithClient(client, evidenceSource);
}
