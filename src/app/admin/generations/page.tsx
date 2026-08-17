import GenerationInvestigationPanel from "@/components/admin/GenerationInvestigationPanel";

/**
 * /admin/generations — Phase 16-A/2 Generation Investigation (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin.
 */
export default function AdminGenerationsPage() {
  return <GenerationInvestigationPanel />;
}
