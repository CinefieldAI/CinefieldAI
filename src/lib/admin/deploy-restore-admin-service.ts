import "server-only";
import { collectAdminHealth } from "./admin-health-service";
import { evaluateRollback } from "@/lib/deployment/deployment-guard";
import { listTrackedAlerts, type TrackedAlertSnapshot } from "@/lib/alerts/alert-router";
import { runRestoreVerification } from "@/trigger/operational/operational-services";
import { RTO_TARGETS, RPO_TARGETS } from "@/lib/recovery/recovery-target-registry";
import type { HealthStatus } from "@/lib/health/health-contract";
import type { DeployRestoreAdminResult, RollbackView } from "./deploy-restore-admin-contract";

/**
 * Pure wiring: real readiness + real currently-open CRITICAL alert types ->
 * Phase 14-D's own `evaluateRollback()`, with deployment identity honestly
 * `null` (see contract header). Exported separately from the I/O so it is
 * directly, deterministically testable — see
 * `phase-16d-deploy-restore.e2e.test.ts`.
 */
export function buildRollbackView(overallStatus: HealthStatus, alerts: readonly TrackedAlertSnapshot[]): RollbackView {
  const openCriticalAlertTypes = [...new Set(alerts.filter((a) => a.severity === "CRITICAL").map((a) => a.type))];

  const verdict = evaluateRollback({
    currentReadiness: overallStatus,
    openCriticalAlerts: openCriticalAlertTypes,
    // No deployment-identity tracking exists in this repository — honestly
    // null, not invented. See contract header.
    current: null,
    previousGood: null,
  });

  return {
    decision: verdict.decision,
    reasons: verdict.reasons,
    targetDeploymentId: verdict.targetDeploymentId,
    currentReadiness: overallStatus,
    openCriticalAlertTypes,
  };
}

/**
 * Phase 16-D Deploy/Restore Health read service.
 *
 * See `deploy-restore-admin-contract.ts`'s header for exactly which parts
 * are real evidence and which are honestly reported as unavailable/
 * unconfigured, and why. Four independent reads, none of which can fail the
 * others: an admin health projection read never throws (it awaits Phase
 * 13's own `readiness()`, which does not throw), `listTrackedAlerts()` is a
 * synchronous `Map` read, and `runRestoreVerification()` catches its own
 * errors and always resolves to a bounded `OperationalTaskResult`.
 */
export async function getAdminDeployRestore(): Promise<DeployRestoreAdminResult> {
  const [health, restore] = await Promise.all([collectAdminHealth(), runRestoreVerification()]);

  const rollback = buildRollbackView(health.overallStatus, listTrackedAlerts());

  return {
    outcome: "FOUND",
    rollback,
    deployEligibility: {
      state: "DEPLOY_EVIDENCE_UNAVAILABLE",
      reasonCode: "external_ci_artifact_integration_not_wired",
    },
    // Phase 24-D. CI-side generation is real (see the contract's own
    // header) — this field's UNAVAILABLE state is about this application
    // having no live read-path into GitHub Actions run history, not about
    // the pipeline itself being fake.
    releaseProvenance: {
      state: "PROVENANCE_EVIDENCE_UNAVAILABLE",
      reasonCode: "no_live_github_actions_run_history_integration",
      ciGenerationCodeComplete: true,
    },
    restore,
    recovery: {
      state: "RTO_RPO_NOT_CONFIGURED",
      rtoTargetsConfigured: Object.keys(RTO_TARGETS).length,
      rpoTargetsConfigured: Object.keys(RPO_TARGETS).length,
    },
  };
}
