/**
 * DLQ message source contract (Phase 15-D/3).
 *
 * Pure type only — no I/O, no AWS SDK import. Mirrors `restore-target.ts`'s
 * `RestoreEvidenceSource` split (Phase 15-C/1): the orchestration layer
 * knows this interface, never the AWS SDK directly, so the pure
 * investigation service is testable with a fake and the real adapter can be
 * swapped without touching anything that calls it.
 */

export interface DlqMessage {
  readonly body: string;
  /** SQS MessageId. Bounded, safe to report — never the body, never an attribute map. */
  readonly messageId: string;
}

/**
 * ---------------------------------------------------------------------------
 * EVERY METHOD IS A READ. THERE IS NO WRITE METHOD ON THIS INTERFACE AT ALL.
 * ---------------------------------------------------------------------------
 * There is no `deleteMessage()`, no `redrive()`, no `purge()` — not
 * disabled, not guarded, simply absent from the shape. A caller holding only
 * a `DlqMessageSource` has no method to call that could mutate the queue,
 * which is a stronger guarantee than "the real adapter chooses not to":
 * nothing implementing this interface CAN.
 */
export interface DlqMessageSource {
  /** Bounded label for logs, e.g. "sqs-provider-dlq". Never a queue URL. */
  readonly label: string;

  /**
   * A non-destructive look at the oldest available message, or `null` when
   * the DLQ currently has none to offer. Never removes the message from the
   * queue and never hides it from another reader — see the real adapter's
   * own header for how it achieves that.
   */
  peekMessage(): Promise<DlqMessage | null>;
}
