import PrivilegedActionAuditPanel from "@/components/admin/PrivilegedActionAuditPanel";

/**
 * /admin/privileged-audit — Phase 16-E durable Tier-0 audit (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`. Reads the
 * new Phase 16-E `admin_privileged_action_events` table exclusively — no
 * second event store, no re-scoring, no action reachable from this screen.
 */
export default function AdminPrivilegedAuditPage() {
  return <PrivilegedActionAuditPanel />;
}
