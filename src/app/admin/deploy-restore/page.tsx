import DeployRestorePanel from "@/components/admin/DeployRestorePanel";

/**
 * /admin/deploy-restore — Phase 16-D Deploy / Restore Health (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`. Rollback
 * reuses Phase 14-D unchanged; restore reuses Phase 15-C's own production
 * entry point verbatim; deploy eligibility and recovery RTO/RPO are
 * reported honestly rather than fabricated. See
 * `deploy-restore-admin-contract.ts`'s header.
 */
export default function AdminDeployRestorePage() {
  return <DeployRestorePanel />;
}
