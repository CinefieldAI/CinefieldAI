import ModelQualityPanel from "@/components/admin/ModelQualityPanel";

/**
 * /admin/model-quality — Phase 22-D Admin Model Quality dashboard.
 *
 * Read-only, mirroring /admin/slo-cost's own shape. Authorization already
 * happened in src/app/admin/layout.tsx.
 */
export default function AdminModelQualityPage() {
  return <ModelQualityPanel />;
}
