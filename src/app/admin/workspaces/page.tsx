import WorkspaceInvestigationPanel from "@/components/admin/WorkspaceInvestigationPanel";

/**
 * /admin/workspaces — Phase 16-A/4 Workspace / Project Investigation (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin. "Workspace" here means
 * `public.projects` — see `workspace-investigation-contract.ts`'s header for
 * the reconciliation.
 */
export default function AdminWorkspacesPage() {
  return <WorkspaceInvestigationPanel />;
}
