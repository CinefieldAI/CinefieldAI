import UserInvestigationPanel from "@/components/admin/UserInvestigationPanel";

/**
 * /admin/users — Phase 16-A/3 User Investigation (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin.
 */
export default function AdminUsersPage() {
  return <UserInvestigationPanel />;
}
