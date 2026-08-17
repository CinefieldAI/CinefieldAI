import RouterControlsPanel from "@/components/admin/RouterControlsPanel";

/**
 * /admin/router — Phase 16-B Router Controls (read + authorized disable).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin. The route mutation itself
 * still requires the separate Phase 7-B route-authority allowlist.
 */
export default function AdminRouterPage() {
  return <RouterControlsPanel />;
}
