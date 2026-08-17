import type { HealthStatus } from "@/lib/health/health-contract";
import type { RollbackDecision, RollbackReason } from "@/lib/deployment/deployment-guard";
import type { OperationalTaskResult } from "@/trigger/operational/operational-task-contract";

/**
 * Phase 16-D Deploy/Restore Health admin contract — read-only.
 *
 * ---------------------------------------------------------------------------
 * DEPLOY: ROLLBACK SIGNAL IS REAL; FULL ELIGIBILITY IS HONESTLY UNAVAILABLE
 * ---------------------------------------------------------------------------
 * `rollback` calls Phase 14-D's own `evaluateRollback()` UNCHANGED, fed REAL
 * signals: Phase 13's current readiness and Phase 13-D's currently-open
 * CRITICAL alert types. `current`/`previousGood` deployment identity are
 * honestly `null` — this repository has no deployment-identity tracking
 * (no GitHub/Vercel integration persists one), which `evaluateRollback`
 * itself already treats as a real, first-class input (`deployment_identity_
 * missing`/`unknown_previous_good` REVIEW_REQUIRED reasons) rather than
 * something this file has to fake.
 *
 * `evaluateDeployment()` (full PROD_CANDIDATE / artifact / CI eligibility)
 * is DELIBERATELY NOT CALLED. Its `DeploymentCandidate` needs a specific
 * change under review — a risk class derived from a changed-file list, CI
 * check outcomes, an artifact digest, a preview state — and none of that
 * exists anywhere at runtime: this repository has no live GitHub
 * Actions/CI, Vercel, or artifact-provenance integration (Phase 14's own
 * doc: "No external integration is active"). Constructing a candidate from
 * absent evidence just to get a verdict would be exactly the "no fake
 * unified truth" failure the 16-D spec forbids — see section 3's
 * `EXTERNAL_INFRA_REQUIRED` classification. `deployEligibility` reports
 * that honestly instead of calling the engine with invented inputs.
 *
 * ---------------------------------------------------------------------------
 * RESTORE: PHASE 15-C'S OWN PRODUCTION ENTRY POINT, CALLED VERBATIM
 * ---------------------------------------------------------------------------
 * `restore` is `runRestoreVerification()`
 * (`src/trigger/operational/operational-services.ts`) called with default
 * deps — the SAME function `restoreVerificationTask` calls. Its restore
 * target defaults to `() => null` (Phase 15-C/1's own documented default:
 * no live adapter ships in this repository), so an unmodified deployment
 * honestly reports `unavailable` / `restore_target_not_configured` — never a
 * fabricated pass. This never proves live Supabase PITR — see Phase 15-C/2's
 * own "local proof vs. live PITR" boundary, restated in the UI below.
 *
 * ---------------------------------------------------------------------------
 * RECOVERY / RTO-RPO: EMPTY REGISTRIES, REPORTED HONESTLY
 * ---------------------------------------------------------------------------
 * `RTO_TARGETS`/`RPO_TARGETS` (Phase 15-D/2) ship empty — no business
 * approval for a recovery-time or data-loss commitment exists in this
 * repository. This surface reports the registries' real size (always 0
 * today) rather than inventing a target or calling `measureRecovery` with
 * fabricated incident timestamps (no live incident-evidence source exists
 * to feed it — see 15-D/2's own "not in this slice" list).
 */

export interface RollbackView {
  readonly decision: RollbackDecision;
  readonly reasons: readonly RollbackReason[];
  readonly targetDeploymentId: string | null;
  readonly currentReadiness: HealthStatus;
  readonly openCriticalAlertTypes: readonly string[];
}

export interface DeployEligibilityView {
  readonly state: "DEPLOY_EVIDENCE_UNAVAILABLE";
  readonly reasonCode: "external_ci_artifact_integration_not_wired";
}

export interface RecoveryTargetsView {
  readonly state: "RTO_RPO_NOT_CONFIGURED";
  readonly rtoTargetsConfigured: number;
  readonly rpoTargetsConfigured: number;
}

export type DeployRestoreAdminResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "FOUND";
      readonly rollback: RollbackView;
      readonly deployEligibility: DeployEligibilityView;
      readonly restore: OperationalTaskResult;
      readonly recovery: RecoveryTargetsView;
    };
