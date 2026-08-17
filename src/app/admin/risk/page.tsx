import RiskInvestigationPanel from "@/components/admin/RiskInvestigationPanel";

/**
 * /admin/risk — Phase 16-A Risk Investigation (read-only, observational only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin. Reads the canonical
 * `security_events` evidence (Phase 12-C) plus `media_assets` safety
 * columns — see `risk-investigation-contract.ts`'s header. No second risk
 * model, no second event store.
 */
export default function AdminRiskPage() {
  return <RiskInvestigationPanel />;
}
