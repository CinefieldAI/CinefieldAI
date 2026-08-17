import SloCostPanel from "@/components/admin/SloCostPanel";

/**
 * /admin/slo-cost — Phase 16-D SLO / Cost Guard (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`. SLO
 * snapshots reuse Phase 15-A's `evaluateSlo()` unchanged; Cost Guard calls
 * Phase 15-B's own `runEstimatedSpendGuard()` verbatim. See
 * `slo-cost-admin-contract.ts`'s header.
 */
export default function AdminSloCostPage() {
  return <SloCostPanel />;
}
