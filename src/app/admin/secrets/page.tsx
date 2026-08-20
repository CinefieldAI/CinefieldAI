import SecretsAdminPanel from "@/components/admin/SecretsAdminPanel";

/**
 * /admin/secrets — Phase 25-D Admin Secrets Lifecycle dashboard.
 *
 * Read-only, mirroring /admin/privacy's own shape. Authorization already
 * happened in src/app/admin/layout.tsx.
 */
export default function AdminSecretsPage() {
  return <SecretsAdminPanel />;
}
