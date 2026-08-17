import DlqInvestigationPanel from "@/components/admin/DlqInvestigationPanel";

/**
 * /admin/dlq — Phase 16-B Failed Jobs / DLQ (read + authorized redrive).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin.
 */
export default function AdminDlqPage() {
  return <DlqInvestigationPanel />;
}
