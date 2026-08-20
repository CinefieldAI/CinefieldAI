import ProvenanceAdminPanel from "@/components/admin/ProvenanceAdminPanel";

/**
 * /admin/provenance — Phase 27-D Content Provenance & AI marking dashboard.
 *
 * Read-only, mirroring /admin/game-day's own shape. Authorization already
 * happened in src/app/admin/layout.tsx.
 */
export default function AdminProvenancePage() {
  return <ProvenanceAdminPanel />;
}
