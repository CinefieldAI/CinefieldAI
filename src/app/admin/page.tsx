import SystemHealthPanel from "@/components/admin/SystemHealthPanel";

/**
 * /admin — Phase 16 System Health (Phase 16/1).
 *
 * Authorization already happened in `layout.tsx`; this page renders only for
 * an already-verified admin. No data-fetching here — that belongs to the
 * client panel, which calls the protected `/api/admin/health` route.
 */
export default function AdminHomePage() {
  return <SystemHealthPanel />;
}
