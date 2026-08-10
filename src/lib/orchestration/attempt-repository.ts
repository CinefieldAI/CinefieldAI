import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrchestrationError } from "./errors";
import type {
  GenerationAttempt,
  GenerationAttemptEvidence,
  GenerationAttemptStatus,
} from "@/types/database";

/**
 * Cinefield generation_attempts repository (Phase 6R.6).
 *
 * The single writer for provider-submission truth. Every function here is a
 * compare-and-set against the database, because the callers are Temporal
 * activities and Temporal activities are AT-LEAST-ONCE: any of them may run
 * twice, concurrently, or after a crash. Nothing may rely on "this only runs
 * once" — the database decides who won.
 *
 * Three layers protect against a duplicate paid provider job, and this module
 * is where the top two are enforced:
 *   1. one active attempt per generation   (partial unique index)
 *   2. one attempt per external job id     (partial unique index)
 *   3. evidence check before submit        (claimAttemptForSubmission)
 */

const TABLE = "generation_attempts";

/** PostgreSQL unique_violation. A lost race, not a server fault. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

/** The attempt statuses that count as "this generation is already busy". */
export const ACTIVE_ATTEMPT_STATUSES: readonly GenerationAttemptStatus[] = [
  "pending",
  "claimed",
  "submitting",
  "submitted",
  "processing",
];

export interface CreateAttemptInput {
  generationId: string;
  provider: string;
  providerModel: string;
  workflowId?: string;
  workflowRunId?: string;
}

/**
 * Opens the next attempt for a generation.
 *
 * Attempt numbers are dense and assigned from the current maximum, so a
 * concurrent caller computing the same number loses the
 * UNIQUE(generation_id, attempt_no) race. Independently, the "one active
 * attempt" partial index rejects a second live attempt even if the numbers
 * differ. Either loss surfaces as DUPLICATE_EXECUTION rather than a second
 * row, which is the whole point: an activity retry must not be able to open a
 * parallel submission.
 *
 * Returns the created attempt. Throws DUPLICATE_EXECUTION when another
 * attempt is already active for this generation.
 */
export async function createAttempt(
  admin: SupabaseClient,
  input: CreateAttemptInput
): Promise<GenerationAttempt> {
  const { data: existing, error: readError } = await admin
    .from(TABLE)
    .select("attempt_no")
    .eq("generation_id", input.generationId)
    .order("attempt_no", { ascending: false })
    .limit(1);

  if (readError) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId: input.generationId, operation: "createAttempt.read" },
    });
  }

  const nextAttemptNo = ((existing?.[0] as { attempt_no?: number } | undefined)?.attempt_no ?? 0) + 1;

  const { data, error } = await admin
    .from(TABLE)
    .insert({
      generation_id: input.generationId,
      attempt_no: nextAttemptNo,
      provider: input.provider,
      provider_model: input.providerModel,
      status: "pending",
      submission_evidence: "none",
      workflow_id: input.workflowId ?? null,
      workflow_run_id: input.workflowRunId ?? null,
      started_at: new Date().toISOString(),
    })
    .select("*")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new OrchestrationError("DUPLICATE_EXECUTION", {
        context: {
          generationId: input.generationId,
          operation: "createAttempt",
          reason: "active_attempt_exists_or_number_taken",
        },
      });
    }
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId: input.generationId, operation: "createAttempt" },
    });
  }

  if (!data) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId: input.generationId, operation: "createAttempt.empty" },
    });
  }

  return data as GenerationAttempt;
}

/** The current active attempt for a generation, or null when none is live. */
export async function readActiveAttempt(
  admin: SupabaseClient,
  generationId: string
): Promise<GenerationAttempt | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select("*")
    .eq("generation_id", generationId)
    .in("status", ACTIVE_ATTEMPT_STATUSES as string[])
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { generationId, operation: "readActiveAttempt" },
    });
  }
  return (data as GenerationAttempt | null) ?? null;
}

export async function readAttempt(
  admin: SupabaseClient,
  attemptId: string
): Promise<GenerationAttempt | null> {
  const { data, error } = await admin.from(TABLE).select("*").eq("id", attemptId).maybeSingle();
  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { attemptId, operation: "readAttempt" },
    });
  }
  return (data as GenerationAttempt | null) ?? null;
}

/**
 * Correlates an inbound provider event to its attempt (webhook/WebSocket).
 *
 * Backed by UNIQUE(provider, provider_job_id) WHERE provider_job_id IS NOT
 * NULL, so a match is unambiguous by construction and an unknown job returns
 * null instead of a guess.
 */
export async function findAttemptByProviderJob(
  admin: SupabaseClient,
  provider: string,
  providerJobId: string
): Promise<GenerationAttempt | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select("*")
    .eq("provider", provider)
    .eq("provider_job_id", providerJobId)
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { provider, operation: "findAttemptByProviderJob" },
    });
  }
  return (data as GenerationAttempt | null) ?? null;
}

/**
 * THE B3 GATE. Atomically reserves an attempt for a provider submission.
 *
 * The predicate is the whole protection, and every clause matters:
 *   - id                          this exact attempt
 *   - status = 'pending'          not already claimed, submitting, or done
 *   - submission_evidence='none'  nothing was ever sent for this attempt
 *   - provider_job_id IS NULL     no external job is known
 *
 * A Temporal activity that retries after already claiming will fail the
 * status clause and get `false`; a caller that sees `false` must NOT submit.
 * Because this is a single conditional UPDATE, two concurrent activities
 * cannot both win — PostgreSQL serializes them and exactly one row matches.
 *
 * Returns the claimed attempt, or null when the claim was refused.
 */
export async function claimAttemptForSubmission(
  admin: SupabaseClient,
  attemptId: string
): Promise<GenerationAttempt | null> {
  const { data, error } = await admin
    .from(TABLE)
    .update({ status: "claimed" })
    .eq("id", attemptId)
    .eq("status", "pending")
    .eq("submission_evidence", "none")
    .is("provider_job_id", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { attemptId, operation: "claimAttemptForSubmission" },
    });
  }
  return (data as GenerationAttempt | null) ?? null;
}

/**
 * Marks the provider call as in flight: claimed → submitting.
 *
 * This write happens BEFORE the provider is contacted, on purpose. If the
 * process dies during the call, the attempt is left in `submitting` — a state
 * that says "a request may have reached the provider and we do not know the
 * outcome". A recovering activity sees `submitting`, cannot claim (the claim
 * requires `pending`), and must reconcile rather than resubmit. That crash
 * window is precisely what Phase 6E's ambiguous-submission rule exists for.
 */
export async function markAttemptSubmitting(
  admin: SupabaseClient,
  attemptId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from(TABLE)
    .update({ status: "submitting" })
    .eq("id", attemptId)
    .eq("status", "claimed")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { attemptId, operation: "markAttemptSubmitting" },
    });
  }
  return data !== null;
}

/**
 * Records that a provider accepted the job: submitting → submitted, with the
 * external job id and `job` evidence written in the same statement so the two
 * can never disagree (the CHECK constraint also enforces that pairing).
 *
 * A unique violation here means another attempt already claimed this external
 * job id — surfaced as DUPLICATE_EXECUTION rather than silently overwriting.
 */
export async function recordProviderJob(
  admin: SupabaseClient,
  attemptId: string,
  providerJobId: string,
  observedStatus: "submitted" | "processing" = "submitted"
): Promise<boolean> {
  const { data, error } = await admin
    .from(TABLE)
    .update({
      status: observedStatus,
      provider_job_id: providerJobId,
      submission_evidence: "job",
      submission_error_code: null,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", attemptId)
    .eq("status", "submitting")
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new OrchestrationError("DUPLICATE_EXECUTION", {
        context: { attemptId, operation: "recordProviderJob", reason: "provider_job_already_claimed" },
      });
    }
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { attemptId, operation: "recordProviderJob" },
    });
  }
  return data !== null;
}

/**
 * Records that a submission's outcome is unknown: an external job may or may
 * not exist, and may already be billable.
 *
 * The attempt ends `failed` (nothing further will drive it) but keeps
 * `ambiguous` evidence, which is what stops any automatic resubmission or
 * failover. Only reconciliation may resolve it. Stores an error CODE only —
 * never a provider message, payload, or URL.
 */
export async function recordAmbiguousSubmission(
  admin: SupabaseClient,
  attemptId: string,
  errorCode: string
): Promise<boolean> {
  const { data, error } = await admin
    .from(TABLE)
    .update({
      status: "failed",
      submission_evidence: "ambiguous",
      submission_error_code: errorCode,
      error_code: errorCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", attemptId)
    .in("status", ["claimed", "submitting"])
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { attemptId, operation: "recordAmbiguousSubmission" },
    });
  }
  return data !== null;
}

export interface AttemptTerminalInput {
  status: Extract<GenerationAttemptStatus, "succeeded" | "failed" | "cancelled">;
  errorCode?: string;
  latencyMs?: number;
  costAmount?: number;
  costCurrency?: string;
}

/**
 * Closes an attempt. Only a non-terminal attempt may be closed, so a late
 * duplicate activity cannot rewrite a finished attempt's outcome.
 *
 * Cost and latency are written only when the caller actually observed them;
 * an unknown value stays NULL rather than being estimated.
 */
export async function markAttemptTerminal(
  admin: SupabaseClient,
  attemptId: string,
  input: AttemptTerminalInput
): Promise<boolean> {
  const { data, error } = await admin
    .from(TABLE)
    .update({
      status: input.status,
      completed_at: new Date().toISOString(),
      ...(input.errorCode !== undefined ? { error_code: input.errorCode } : {}),
      ...(input.latencyMs !== undefined ? { latency_ms: input.latencyMs } : {}),
      ...(input.costAmount !== undefined ? { cost_amount: input.costAmount } : {}),
      ...(input.costCurrency !== undefined ? { cost_currency: input.costCurrency } : {}),
    })
    .eq("id", attemptId)
    .in("status", ACTIVE_ATTEMPT_STATUSES as string[])
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OrchestrationError("DATABASE_UPDATE_FAILED", {
      context: { attemptId, operation: "markAttemptTerminal" },
    });
  }
  return data !== null;
}

/**
 * Evidence summary for an attempt, in the same three-way shape the Phase 6E
 * orchestrator already reasons about. Callers use this to answer the one
 * question that gates a submit: may this generation be sent to a provider?
 */
export function attemptEvidence(attempt: GenerationAttempt): {
  evidence: GenerationAttemptEvidence;
  maySubmit: boolean;
} {
  const evidence = attempt.submission_evidence;
  return {
    evidence,
    // Only provable absence of a job permits a submit, and only from the
    // pre-claim state. Anything else — a known job, an unknown outcome, or an
    // attempt already in flight — is fail-closed.
    maySubmit: evidence === "none" && attempt.status === "pending",
  };
}
