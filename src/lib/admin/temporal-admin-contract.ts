import type { WorkflowInspectionView } from "@/lib/temporal/workflow-inspection";

/**
 * Phase 16-D Temporal/Workflows admin contract.
 *
 * ---------------------------------------------------------------------------
 * INSPECT: THE OWNER IS TEMPORAL + THE `generations` ROW, NOT A NEW STORE
 * ---------------------------------------------------------------------------
 * Answers "what is the state of this generation's workflow, right now?" by
 * combining three ALREADY-CANONICAL reads: the durable `generations` row
 * (status — the Cinefield user-facing truth), the durable cancel intent
 * recorded on that row's `metadata.orchestration.cancelRequested`
 * (`src/lib/orchestration/cancel-intent.ts`, Phase 6R-H, read via
 * `readCancelIntent` — never the full `metadata` column), and Temporal's own
 * live `describe()` (`src/lib/temporal/workflow-inspection.ts`, new in
 * 16-D). No second workflow engine, no re-derived lifecycle state.
 *
 * ---------------------------------------------------------------------------
 * CANCEL: THE EXISTING CANCEL-INTENT / TEMPORAL-COORDINATION OWNER, WRAPPED
 * ---------------------------------------------------------------------------
 * `performAdminTemporalCancel` (the service) wraps `recordCancelIntent`
 * (Phase 6R-H, UNCHANGED authority — same non-terminal guard, same
 * compare-and-set, same idempotent-first-requestedAt semantics) and
 * `requestGenerationCancellation` (Phase 6R.3, the same Temporal signal the
 * user-facing `/api/generations/[generationId]/cancel` route already sends)
 * — the same pattern Phase 9-E's quarantine release uses to wrap an existing
 * canonical mutation: fresh server auth, explicit reason, a current-state
 * re-read immediately before acting, fail closed. This file adds NO new
 * cancellation model and NO direct provider cancel — see that module's own
 * header for why a hard Temporal cancel is deliberately never used.
 */

/** Short reason codes only — never operator prose, matching every other 16-D/9-E action. */
export const ADMIN_CANCEL_REASON_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;

export interface CancelIntentView {
  readonly requestedAt: string;
  readonly reason: string;
  /** Present only when an admin recorded this intent — see `cancel-intent.ts`. */
  readonly recordedByAdmin: string | null;
}

export interface GenerationLifecycleSummary {
  readonly generationId: string;
  readonly status: string;
  readonly cancelIntent: CancelIntentView | null;
}

export type WorkflowInspectionState =
  | { readonly state: "TEMPORAL_NOT_CONFIGURED" }
  | { readonly state: "WORKFLOW_NOT_FOUND" }
  | { readonly state: "UNAVAILABLE"; readonly reasonCode: string }
  | { readonly state: "FOUND"; readonly view: WorkflowInspectionView };

export type TemporalInspectionResult =
  | { readonly outcome: "INVALID_GENERATION_ID" }
  | { readonly outcome: "GENERATION_NOT_FOUND" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "FOUND";
      readonly generation: GenerationLifecycleSummary;
      readonly workflow: WorkflowInspectionState;
    };

/** Non-terminal Cinefield generation states — the only ones a cancel may act on. */
export const CANCELLABLE_GENERATION_STATES: readonly string[] = ["queued", "processing"];

export type TemporalAdminCancelResult =
  | { readonly outcome: "INVALID_INPUT" }
  | { readonly outcome: "GENERATION_NOT_FOUND" }
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "CANCEL_NOT_ALLOWED"; readonly status: string }
  | {
      readonly outcome: "CANCEL_REQUESTED";
      readonly generationId: string;
      readonly alreadyRequested: boolean;
      readonly workflowSignalled: boolean;
    }
  /** Phase 16-E. Only reachable under `CINEFIELD_TIER0_ENFORCEMENT_MODE=enforce` — see `tier0-authorization.ts`. */
  | { readonly outcome: "TIER0_AUTHORIZATION_REQUIRED"; readonly reasonCode: string };
