import ModerationPanel from "@/components/admin/ModerationPanel";

/**
 * /admin/moderation — Phase 16-C Moderation (read + canonical release action).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin. The release action itself
 * still requires the separate Phase 7-B/9-E route-authority allowlist.
 */
export default function AdminModerationPage() {
  return <ModerationPanel />;
}
