import SecurityCenterPanel from "@/components/admin/SecurityCenterPanel";

/**
 * /admin/security-center — Phase 16-D Security Center (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`. Reuses
 * Phase 12-C `security_events` and Phase 13-D's live alert state — see
 * `security-center-contract.ts`'s header. No second risk engine, no second
 * event store.
 */
export default function AdminSecurityCenterPage() {
  return <SecurityCenterPanel />;
}
