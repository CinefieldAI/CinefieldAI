import IncidentsPanel from "@/components/admin/IncidentsPanel";

/**
 * /admin/incidents — Phase 16-D Incidents/Audit (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`. Combines
 * Phase 13-D's live (ephemeral) alert state with the Phase 12-E and Phase
 * 9-E durable audit trails — see `incidents-admin-contract.ts`'s header. No
 * new alert-history store, no new admin_actions table.
 */
export default function AdminIncidentsPage() {
  return <IncidentsPanel />;
}
