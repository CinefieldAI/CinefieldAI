import SystemHealthPanel from "@/components/admin/SystemHealthPanel";
import AdminInvestigationEntryPoints from "@/components/admin/AdminInvestigationEntryPoints";

/**
 * /admin — Phase 16 dashboard: System Health (Phase 16/1) plus, as of the
 * Phase 16-A closure batch, real entry points into every 16-A investigation
 * surface (Users, Workspace/Project, Risk, Generations).
 *
 * Authorization already happened in `layout.tsx`; this page renders only for
 * an already-verified admin. `AdminInvestigationEntryPoints` is a static
 * server component (real links, no fetch); `SystemHealthPanel` remains the
 * only data-fetching piece, calling the protected `/api/admin/health` route.
 */
export default function AdminHomePage() {
  return (
    <>
      <AdminInvestigationEntryPoints />
      <SystemHealthPanel />
    </>
  );
}
