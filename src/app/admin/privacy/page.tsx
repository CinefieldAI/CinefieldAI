import PrivacyAdminPanel from "@/components/admin/PrivacyAdminPanel";

/**
 * /admin/privacy — Phase 23-D Admin Privacy dashboard.
 *
 * Read-only, mirroring /admin/model-quality's own shape. Authorization
 * already happened in src/app/admin/layout.tsx.
 */
export default function AdminPrivacyPage() {
  return <PrivacyAdminPanel />;
}
