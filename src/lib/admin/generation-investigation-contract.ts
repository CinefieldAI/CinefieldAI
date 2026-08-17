/**
 * Phase 16-A/2 generation investigation contract.
 *
 * Pure types only — no I/O. This is the bounded, UI-facing shape the admin
 * "what happened to this generation?" surface renders. Every field is an id,
 * an enum, a timestamp, or a bounded code — there is no field capable of
 * holding a prompt, a raw provider payload, or a signed URL.
 *
 * ---------------------------------------------------------------------------
 * THE REAL TRACE CHAIN, VERIFIED AGAINST SCHEMA REALITY — NOT INVENTED
 * ---------------------------------------------------------------------------
 * `generations` and `generation_attempts` have NO `trace_id` column. Trace
 * correlation for a generation exists only through `outbox_events` rows
 * where `aggregate_type = 'generation'` and `aggregate_id` is the generation
 * id — and even there, `trace_id` is nullable: `claim_generation_tx` writes
 * `p_trace_id: null` unconditionally, while `complete_generation_tx` and the
 * cancel/failure paths pass a real trace id only when one was available at
 * that moment. So a generation's trace evidence is real when present, and
 * genuinely absent for others — never fabricated either way.
 *
 * "provider_request_id" in the roadmap's chain maps to the real
 * `generation_attempts.provider_job_id` column. "media_id" maps to
 * `media_assets.id`, joinable by both `generation_id` and the narrower
 * `generation_attempt_id`. No distinct "artifact" concept exists anywhere in
 * this schema — `media_assets` already IS the artifact record, so
 * "artifact_id" is `NOT_APPLICABLE` rather than a fabricated second id.
 */

export type TraceChainLinkStatus = "AVAILABLE" | "OPTIONAL" | "NOT_PERSISTED" | "EXTERNAL" | "NOT_APPLICABLE";

export interface TraceChainLink {
  readonly name: "trace_id" | "generation_id" | "attempt_id" | "provider_request_id" | "media_id" | "artifact_id";
  readonly status: TraceChainLinkStatus;
  /** The real value found for THIS generation, or `null` when not present. Never inferred. */
  readonly value: string | null;
}

export interface GenerationSummaryView {
  readonly generationId: string;
  readonly status: string;
  readonly generationType: string;
  readonly provider: string;
  readonly model: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly temporalWorkflowId: string | null;
  /** Reference only, per the 16-A/2 Users/Workspaces boundary — not a profile lookup. */
  readonly projectId: string;
  readonly clerkUserId: string;
}

export interface AttemptView {
  readonly attemptId: string;
  readonly attemptNo: number;
  readonly status: string;
  readonly provider: string;
  readonly providerModel: string;
  readonly submissionEvidence: string;
  readonly providerJobId: string | null;
  readonly errorCode: string | null;
  readonly submissionErrorCode: string | null;
  readonly latencyMs: number | null;
  readonly startedAt: string | null;
  readonly submittedAt: string | null;
  readonly completedAt: string | null;
  readonly workflowId: string | null;
  readonly workflowRunId: string | null;
}

export interface TraceEventView {
  /** e.g. "generation.completed". Bounded, from the existing event-type contract. */
  readonly eventType: string;
  readonly traceId: string | null;
  readonly occurredAt: string;
}

export interface MediaLinkView {
  readonly mediaId: string;
  readonly attemptId: string | null;
  readonly role: string;
  readonly mediaType: string;
  readonly createdAt: string;
}

export type GenerationInvestigationResult =
  | { readonly outcome: "GENERATION_NOT_FOUND" }
  | { readonly outcome: "EVIDENCE_UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "FOUND";
      readonly generation: GenerationSummaryView;
      readonly attempts: readonly AttemptView[];
      readonly traceEvents: readonly TraceEventView[];
      readonly mediaLinks: readonly MediaLinkView[];
      readonly chain: readonly TraceChainLink[];
    };

/**
 * Builds the honest trace chain from already-fetched evidence. Pure — no I/O.
 * Every link's status is derived from what was actually found for this
 * generation; nothing here guesses a relationship that wasn't queried.
 */
export function buildTraceChain(input: {
  readonly generationId: string;
  readonly attempts: readonly AttemptView[];
  readonly traceEvents: readonly TraceEventView[];
  readonly mediaLinks: readonly MediaLinkView[];
}): readonly TraceChainLink[] {
  const firstAttempt = input.attempts[0];
  const traceEventWithId = input.traceEvents.find((e) => e.traceId !== null);
  const attemptWithJob = input.attempts.find((a) => a.providerJobId !== null);
  const firstMedia = input.mediaLinks[0];

  return [
    {
      name: "trace_id",
      status: traceEventWithId ? "AVAILABLE" : "NOT_PERSISTED",
      value: traceEventWithId?.traceId ?? null,
    },
    { name: "generation_id", status: "AVAILABLE", value: input.generationId },
    {
      name: "attempt_id",
      status: firstAttempt ? "AVAILABLE" : "NOT_PERSISTED",
      value: firstAttempt?.attemptId ?? null,
    },
    {
      name: "provider_request_id",
      status: attemptWithJob ? "AVAILABLE" : "NOT_PERSISTED",
      value: attemptWithJob?.providerJobId ?? null,
    },
    {
      name: "media_id",
      status: firstMedia ? "AVAILABLE" : "NOT_PERSISTED",
      value: firstMedia?.mediaId ?? null,
    },
    { name: "artifact_id", status: "NOT_APPLICABLE", value: null },
  ];
}
