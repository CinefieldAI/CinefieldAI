import { task } from "@trigger.dev/sdk";
import {
  runCreditAudit,
  runGenerationReconcile,
  runProviderCostReconcile,
  runEstimatedSpendGuard,
  type SpendGuardTaskInput,
  runProviderHealthAudit,
  runRestoreVerification,
  runSecurityAnalyze,
  runStorageCleanupPlan,
} from "./operational-services";
import type { OperationalTaskInput, OperationalTaskResult } from "./operational-task-contract";

/**
 * Cinefield Trigger.dev OPERATIONAL tasks (Phase 6R.11).
 *
 * Thin wrappers only — every task delegates immediately to a service in
 * operational-services.ts, mirroring how generation-task.ts delegates to
 * executeGeneration rather than reimplementing it. Keeping the logic out of
 * the `task()` bodies is what lets the whole operational surface be
 * unit-tested with injected fakes and no Trigger.dev SDK involvement.
 *
 * ===========================================================================
 * NONE OF THESE IS A GENERATION OWNER
 * ===========================================================================
 * No task here imports executeGeneration, submitAttempt, a ProviderAdapter,
 * the Temporal client, or the SQS command bus. None can submit a provider
 * generation, finalize one, or create a second provider job. That is
 * enforced by architectural regression tests in
 * operational-tasks.test.ts, not merely by intent.
 *
 * ===========================================================================
 * NO SCHEDULES — DELIBERATELY
 * ===========================================================================
 * These are `task()`, not `schedules.task()`. Cinefield has not defined a
 * production cadence for any of them, and silently enabling recurring jobs
 * that scan production tables (and, in one case, can call an existing
 * credit-repair function) would be a real operational change nobody
 * reviewed. They are manually invokable and testable now; choosing and
 * enabling cadences is a deliberate later step, and Phase 21 owns the
 * runtime flag machinery for gating them.
 */

const OPERATIONAL_MAX_DURATION_SECONDS = 300;

export const providerHealthAuditTask = task({
  id: "cinefield-op-provider-health-audit",
  maxDuration: OPERATIONAL_MAX_DURATION_SECONDS,
  run: async (payload: OperationalTaskInput = {}): Promise<OperationalTaskResult> =>
    runProviderHealthAudit(payload),
});

export const generationReconcileTask = task({
  id: "cinefield-op-generation-reconcile",
  maxDuration: OPERATIONAL_MAX_DURATION_SECONDS,
  run: async (payload: OperationalTaskInput = {}): Promise<OperationalTaskResult> =>
    runGenerationReconcile(payload),
});

export const creditAuditTask = task({
  id: "cinefield-op-credit-audit",
  maxDuration: OPERATIONAL_MAX_DURATION_SECONDS,
  run: async (payload: OperationalTaskInput = {}): Promise<OperationalTaskResult> => runCreditAudit(payload),
});

export const providerCostReconcileTask = task({
  id: "cinefield-op-provider-cost-reconcile",
  maxDuration: OPERATIONAL_MAX_DURATION_SECONDS,
  run: async (payload: OperationalTaskInput = {}): Promise<OperationalTaskResult> =>
    runProviderCostReconcile(payload),
});

/**
 * Phase 15-B/2. Also `task()`, not `schedules.task()` — for the same reason as
 * every task above, and one more: this one evaluates money. Choosing how often
 * a budget is checked is a policy decision, and the budget registry is still
 * deliberately empty, so a cadence would currently schedule a pass with
 * nothing to compare against.
 */
export const estimatedSpendGuardTask = task({
  id: "cinefield-op-estimated-spend-guard",
  maxDuration: OPERATIONAL_MAX_DURATION_SECONDS,
  run: async (payload: SpendGuardTaskInput = {}): Promise<OperationalTaskResult> =>
    runEstimatedSpendGuard(payload),
});

export const storageCleanupPlanTask = task({
  id: "cinefield-op-storage-cleanup-plan",
  maxDuration: OPERATIONAL_MAX_DURATION_SECONDS,
  run: async (payload: OperationalTaskInput = {}): Promise<OperationalTaskResult> =>
    runStorageCleanupPlan(payload),
});

export const restoreVerificationTask = task({
  id: "cinefield-op-restore-verification",
  maxDuration: OPERATIONAL_MAX_DURATION_SECONDS,
  run: async (payload: OperationalTaskInput = {}): Promise<OperationalTaskResult> =>
    runRestoreVerification(payload),
});

export const securityAnalyzeTask = task({
  id: "cinefield-op-security-analyze",
  maxDuration: OPERATIONAL_MAX_DURATION_SECONDS,
  run: async (payload: OperationalTaskInput = {}): Promise<OperationalTaskResult> =>
    runSecurityAnalyze(payload),
});
