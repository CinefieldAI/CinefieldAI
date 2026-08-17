import SystemHealthPanel from "@/components/admin/SystemHealthPanel";
import AdminInvestigationEntryPoints from "@/components/admin/AdminInvestigationEntryPoints";
import AdminOperationalEntryPoints from "@/components/admin/AdminOperationalEntryPoints";

/**
 * /admin — Phase 16 dashboard: System Health (Phase 16/1) plus real entry
 * points into every 16-A investigation surface (Users, Workspace/Project,
 * Risk, Generations) and every 16-B operational surface (Failed Jobs/DLQ,
 * Queue Health, Models/Providers, Router Controls).
 *
 * Authorization already happened in `layout.tsx`; this page renders only for
 * an already-verified admin. Both entry-point components are static server
 * components (real links, no fetch); `SystemHealthPanel` remains the only
 * data-fetching piece, calling the protected `/api/admin/health` route.
 */
export default function AdminHomePage() {
  return (
    <>
      <AdminInvestigationEntryPoints />
      <AdminOperationalEntryPoints />
      <SystemHealthPanel />
    </>
  );
}
