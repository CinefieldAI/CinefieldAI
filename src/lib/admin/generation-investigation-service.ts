import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GENERATION_ID_PATTERN } from "@/lib/orchestration/generation-api-contract";
import {
  buildTraceChain,
  type AttemptView,
  type GenerationInvestigationResult,
  type MediaLinkView,
  type TraceEventView,
} from "./generation-investigation-contract";

/**
 * The Phase 16-A/2 admin generation investigation read service.
 *
 * ---------------------------------------------------------------------------
 * FOUR NARROW, CONCURRENT, EXPLICIT-COLUMN READS — NOTHING ELSE
 * ---------------------------------------------------------------------------
 * `generations`, `generation_attempts`, `outbox_events`
 * (`aggregate_type = 'generation'`), and `media_assets` — each filtered by
 * the one generation id, each selecting an explicit column list rather than
 * `*`, and each bounded with a `LIMIT`. No `.insert(`, `.update(`,
 * `.upsert(`, or `.delete(` exists anywhere in this file — this service can
 * only ever read.
 *
 * Deliberately excluded from every select, even though the columns exist:
 * `generations.prompt`/`negative_prompt`/`input_url`/`output_url`/
 * `thumbnail_url`/`error_message`/`metadata`; `generation_attempts.
 * cost_amount`/`cost_currency` (Phase 10 economic truth boundary — a future,
 * separately reviewed admin billing slice, not this one); `outbox_events.
 * payload`; `media_assets.object_key`/`bucket`/`declared_*`. None of these
 * reach this function's return value because none of them are ever selected
 * in the first place — the boundary is the query, not a filter afterward.
 */

/** Reasonable, deterministic caps — a real generation has few attempts, events, or assets. */
const MAX_ATTEMPTS = 50;
const MAX_TRACE_EVENTS = 50;
const MAX_MEDIA_LINKS = 50;

export async function getGenerationInvestigation(
  admin: SupabaseClient,
  generationId: string
): Promise<GenerationInvestigationResult> {
  if (!GENERATION_ID_PATTERN.test(generationId)) {
    // Malformed input never reaches the database — no wildcard/arbitrary
    // query is possible even in principle.
    return { outcome: "GENERATION_NOT_FOUND" };
  }

  let generationRow, attemptRows, traceRows, mediaRows;
  try {
    [generationRow, attemptRows, traceRows, mediaRows] = await Promise.all([
      admin
        .from("generations")
        .select("id, status, generation_type, provider, model, created_at, updated_at, completed_at, temporal_workflow_id, project_id, clerk_user_id")
        .eq("id", generationId)
        .maybeSingle(),
      admin
        .from("generation_attempts")
        .select("id, attempt_no, status, provider, provider_model, provider_job_id, submission_evidence, submission_error_code, error_code, latency_ms, started_at, submitted_at, completed_at, workflow_id, workflow_run_id")
        .eq("generation_id", generationId)
        .order("attempt_no", { ascending: true })
        .limit(MAX_ATTEMPTS),
      admin
        .from("outbox_events")
        .select("event_type, trace_id, occurred_at")
        .eq("aggregate_type", "generation")
        .eq("aggregate_id", generationId)
        .order("occurred_at", { ascending: true })
        .limit(MAX_TRACE_EVENTS),
      admin
        .from("media_assets")
        .select("id, generation_attempt_id, role, media_type, created_at")
        .eq("generation_id", generationId)
        .order("created_at", { ascending: true })
        .limit(MAX_MEDIA_LINKS),
    ]);
  } catch {
    return { outcome: "EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" };
  }

  if (generationRow.error || attemptRows.error || traceRows.error || mediaRows.error) {
    return { outcome: "EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" };
  }

  if (!generationRow.data) {
    return { outcome: "GENERATION_NOT_FOUND" };
  }

  const g = generationRow.data as {
    id: string;
    status: string;
    generation_type: string;
    provider: string;
    model: string;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
    temporal_workflow_id: string | null;
    project_id: string;
    clerk_user_id: string;
  };

  const attempts: AttemptView[] = ((attemptRows.data ?? []) as Record<string, unknown>[]).map((row) => ({
    attemptId: row.id as string,
    attemptNo: row.attempt_no as number,
    status: row.status as string,
    provider: row.provider as string,
    providerModel: row.provider_model as string,
    submissionEvidence: row.submission_evidence as string,
    providerJobId: (row.provider_job_id as string | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    submissionErrorCode: (row.submission_error_code as string | null) ?? null,
    latencyMs: (row.latency_ms as number | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    submittedAt: (row.submitted_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    workflowId: (row.workflow_id as string | null) ?? null,
    workflowRunId: (row.workflow_run_id as string | null) ?? null,
  }));

  const traceEvents: TraceEventView[] = ((traceRows.data ?? []) as Record<string, unknown>[]).map((row) => ({
    eventType: row.event_type as string,
    traceId: (row.trace_id as string | null) ?? null,
    occurredAt: row.occurred_at as string,
  }));

  const mediaLinks: MediaLinkView[] = ((mediaRows.data ?? []) as Record<string, unknown>[]).map((row) => ({
    mediaId: row.id as string,
    attemptId: (row.generation_attempt_id as string | null) ?? null,
    role: row.role as string,
    mediaType: row.media_type as string,
    createdAt: row.created_at as string,
  }));

  return {
    outcome: "FOUND",
    generation: {
      generationId: g.id,
      status: g.status,
      generationType: g.generation_type,
      provider: g.provider,
      model: g.model,
      createdAt: g.created_at,
      updatedAt: g.updated_at,
      completedAt: g.completed_at,
      temporalWorkflowId: g.temporal_workflow_id,
      projectId: g.project_id,
      clerkUserId: g.clerk_user_id,
    },
    attempts,
    traceEvents,
    mediaLinks,
    chain: buildTraceChain({ generationId, attempts, traceEvents, mediaLinks }),
  };
}
