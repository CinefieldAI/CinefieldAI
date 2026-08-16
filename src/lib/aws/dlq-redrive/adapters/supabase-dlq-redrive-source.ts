import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAttempt } from "@/lib/orchestration/attempt-repository";
import type {
  AttemptRedriveEvidence,
  DlqRedriveEvidenceSource,
  GenerationRedriveEvidence,
} from "../dlq-redrive-contract";

/**
 * The real `DlqRedriveEvidenceSource` (Phase 15-D/1).
 *
 * ---------------------------------------------------------------------------
 * ATTEMPT EVIDENCE IS REUSED, NOT RE-QUERIED
 * ---------------------------------------------------------------------------
 * `readAttempt` is the exact function `provider-command-handler.ts` and
 * `attempt-submission-service.ts` already read attempt truth through. This
 * adapter does not open a second, parallel query path against
 * `generation_attempts` — it is the same read, reduced to the four fields
 * the decision engine needs.
 *
 * ---------------------------------------------------------------------------
 * THE GENERATION READ IS NARROWER THAN ANY OTHER IN THE CODEBASE ON PURPOSE
 * ---------------------------------------------------------------------------
 * `select("status")` only. A DLQ redrive decision has no legitimate use for
 * the prompt, the output URL, or any other generation field, so the query
 * itself — not just the TypeScript return shape — makes it structurally
 * impossible for a sensitive field to reach this evidence, even if a future
 * edit here got careless.
 */
export function createSupabaseDlqRedriveSource(admin: SupabaseClient): DlqRedriveEvidenceSource {
  return {
    label: "supabase-generation-attempts",

    async readAttempt(attemptId: string): Promise<AttemptRedriveEvidence | null> {
      const attempt = await readAttempt(admin, attemptId);
      if (!attempt) return null;
      return {
        attemptId: attempt.id,
        generationId: attempt.generation_id,
        status: attempt.status,
        submissionEvidence: attempt.submission_evidence,
      };
    },

    async readGeneration(generationId: string): Promise<GenerationRedriveEvidence | null> {
      const { data, error } = await admin
        .from("generations")
        .select("status")
        .eq("id", generationId)
        .maybeSingle();

      if (error) {
        throw new Error("dlq_redrive_generation_read_failed");
      }
      if (!data) return null;

      return {
        generationId,
        status: (data as { status: GenerationRedriveEvidence["status"] }).status,
      };
    },
  };
}
