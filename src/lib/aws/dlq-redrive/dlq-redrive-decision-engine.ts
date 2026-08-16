import { parseCommand } from "@/lib/contracts/command-wire";
import { SQS_QUEUES } from "@/lib/aws/sqs-topology";
import type { DlqRedriveDecision, DlqRedriveEvidenceSource } from "./dlq-redrive-contract";

/**
 * The DLQ redrive decision engine (Phase 15-D/1).
 *
 * ---------------------------------------------------------------------------
 * CALL ORDER IS THE SAFETY PROPERTY
 * ---------------------------------------------------------------------------
 * Mirrors `restore-verification-engine.ts`'s own documented discipline: the
 * order below is not incidental, it IS the fail-closed guarantee.
 *
 *   1. message fails wire validation           -> REFUSE_INVALID_MESSAGE, stop
 *   2. no evidence source configured            -> UNAVAILABLE, stop (no reads happen)
 *   3. attempt read throws                      -> UNAVAILABLE, stop
 *   4. attempt not found                        -> REFUSE_INSUFFICIENT_EVIDENCE, stop
 *   5. message.generationId != attempt.generationId -> REFUSE_INVALID_MESSAGE, stop
 *   6. attempt already terminal                 -> REFUSE_TERMINAL_GENERATION, stop
 *   7. generation read throws                   -> UNAVAILABLE, stop
 *   8. generation not found                     -> REFUSE_INSUFFICIENT_EVIDENCE, stop
 *   9. generation already terminal               -> REFUSE_TERMINAL_GENERATION, stop
 *  10. submission evidence is not "none"         -> REFUSE_AMBIGUOUS_PROVIDER_STATE, stop
 *  11. attempt is claimed/submitting (in flight) -> REFUSE_AMBIGUOUS_PROVIDER_STATE, stop
 *  12. pending attempt + submittable generation  -> SAFE_TO_REDRIVE
 *  13. anything else (unmodeled)                 -> REFUSE_INSUFFICIENT_EVIDENCE
 *
 * Step 13 is unreachable given today's closed `GenerationAttemptStatus`
 * union, but the engine still refuses rather than falls through — a future
 * status added to that union without a corresponding branch here must never
 * silently become safe.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REUSES, RATHER THAN RE-DERIVES, provider-command-handler.ts
 * ---------------------------------------------------------------------------
 * `CommandClassification` (safe/ambiguous/retryable/non_retryable) answers
 * "should this SQS delivery be deleted or retained, right now, mid-flight".
 * This engine answers a different question, asked later and from outside
 * the worker: "given what is durably true today, would moving this message
 * BACK onto the source queue be safe". The two are NOT the same
 * classification and this module does not claim they are — but the
 * underlying evidence (attempt status, submission evidence, generation
 * status) is identical, sourced through the same repository shape
 * (`readAttempt`), and this engine's terminal/submittable sets are
 * cross-checked against `provider-command-handler.ts`'s own literals by a
 * structural test in `phase-15d1-dlq-redrive.e2e.test.ts` so the two can
 * never silently diverge.
 */

/** Mirrors provider-command-handler.ts's own already-terminal check (its lines checking status === "succeeded"/"failed"/"cancelled"). */
const TERMINAL_ATTEMPT_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

/** The `Generation.status` values that mean nothing further will happen to this generation. */
const TERMINAL_GENERATION_STATUSES = new Set(["completed", "failed", "cancelled"]);

/** Mirrors provider-command-handler.ts's own `SUBMITTABLE_GENERATION_STATUSES`. */
const SUBMITTABLE_GENERATION_STATUSES = new Set(["queued", "processing"]);

/** A claim not yet resolved to a durable outcome — a request may be in flight right now. */
const IN_FLIGHT_ATTEMPT_STATUSES = new Set(["claimed", "submitting"]);

export interface EvaluateDlqRedriveDecisionInput {
  /** The exact DLQ message body, as SQS would hand it back — never pre-parsed by the caller. */
  readonly rawMessageBody: string;
  /** `null` when no evidence source is wired up. Never treated as "assume safe". */
  readonly source: DlqRedriveEvidenceSource | null;
}

export async function evaluateDlqRedriveDecision(
  input: EvaluateDlqRedriveDecisionInput
): Promise<DlqRedriveDecision> {
  const finish = (
    state: DlqRedriveDecision["state"],
    reasonCode: string,
    extra: Partial<DlqRedriveDecision> = {}
  ): DlqRedriveDecision => ({
    state,
    reasonCode,
    sourceQueue: SQS_QUEUES.provider.name,
    dlqName: SQS_QUEUES.provider.dlqName,
    evaluatedAt: new Date().toISOString(),
    ...extra,
  });

  // ---- 1. The message itself must be a well-formed command --------------
  // Reuses production's own parser rather than a second schema check, so a
  // message this engine accepts is provably one the real worker would also
  // accept as well-formed.
  const parsed = parseCommand(input.rawMessageBody);
  if (!parsed.ok) {
    return finish("REFUSE_INVALID_MESSAGE", `schema_invalid:${parsed.reason}`);
  }
  const { command } = parsed;
  const ids = { commandId: command.commandId, attemptId: command.attemptId, generationId: command.generationId };

  // ---- 2. An evidence source must be configured --------------------------
  if (!input.source) {
    return finish("UNAVAILABLE", "evidence_source_not_configured", ids);
  }

  // ---- 3/4. The attempt is the only authority -----------------------------
  let attempt;
  try {
    attempt = await input.source.readAttempt(command.attemptId);
  } catch {
    return finish("UNAVAILABLE", "attempt_read_failed", ids);
  }
  if (!attempt) {
    return finish("REFUSE_INSUFFICIENT_EVIDENCE", "attempt_not_found", ids);
  }

  // ---- 5. The message's claim must agree with durable truth --------------
  // Mirrors provider-command-handler.ts's "generation_mismatch": the
  // attempt's own generation_id never changes, so a disagreement here can
  // never become valid by waiting or retrying.
  if (attempt.generationId !== command.generationId) {
    return finish("REFUSE_INVALID_MESSAGE", "generation_mismatch", ids);
  }

  // ---- 6. A terminal attempt has nothing left to redrive into -------------
  if (TERMINAL_ATTEMPT_STATUSES.has(attempt.status)) {
    return finish("REFUSE_TERMINAL_GENERATION", `attempt_already_terminal:${attempt.status}`, ids);
  }

  // ---- 7/8. The generation must still exist -------------------------------
  let generation;
  try {
    generation = await input.source.readGeneration(command.generationId);
  } catch {
    return finish("UNAVAILABLE", "generation_read_failed", ids);
  }
  if (!generation) {
    return finish("REFUSE_INSUFFICIENT_EVIDENCE", "generation_not_found", ids);
  }

  // ---- 9. A terminal generation invalidates replay ------------------------
  if (TERMINAL_GENERATION_STATUSES.has(generation.status)) {
    return finish("REFUSE_TERMINAL_GENERATION", `generation_already_terminal:${generation.status}`, ids);
  }

  // ---- 10. Any recorded submission evidence means a request may already
  // have reached the provider. Never resubmit blindly. -----------------
  if (attempt.submissionEvidence !== "none") {
    return finish(
      "REFUSE_AMBIGUOUS_PROVIDER_STATE",
      `submission_evidence_present:${attempt.submissionEvidence}`,
      ids
    );
  }

  // ---- 11. A claim not yet resolved to a durable outcome ------------------
  // This engine deliberately does NOT replicate provider-command-handler.ts's
  // stale-claim recovery (reading generations.metadata for a captured job
  // id) — that recovery is the live worker's job, run at actual redelivery
  // time with a real staleness clock. A decision made here, potentially long
  // after the message first entered the DLQ, has no comparably fresh clock
  // to reason about liveness with, so it refuses rather than guess.
  if (IN_FLIGHT_ATTEMPT_STATUSES.has(attempt.status)) {
    return finish("REFUSE_AMBIGUOUS_PROVIDER_STATE", `attempt_in_flight:${attempt.status}`, ids);
  }

  // ---- 12. The one positive path ------------------------------------------
  // No submission was ever attempted (evidence "none", status "pending"),
  // and the generation can still legally accept one. Redriving cannot cause
  // a double submission: the SAME atomic claim (claimAttemptForSubmission)
  // that already protects direct dispatch and duplicate SQS delivery
  // protects a redriven message identically, because a redrive re-enters
  // through the same worker path rather than bypassing it.
  if (attempt.status === "pending" && SUBMITTABLE_GENERATION_STATUSES.has(generation.status)) {
    return finish("SAFE_TO_REDRIVE", "pending_attempt_no_evidence_submittable_generation", ids);
  }

  // ---- 13. Fail closed on anything unmodeled ------------------------------
  return finish("REFUSE_INSUFFICIENT_EVIDENCE", `unmodeled_attempt_status:${attempt.status}`, ids);
}
