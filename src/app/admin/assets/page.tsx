import AssetsStoragePanel from "@/components/admin/AssetsStoragePanel";

/**
 * /admin/assets — Phase 16-C Assets / Storage (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin.
 */
export default function AdminAssetsPage() {
  return <AssetsStoragePanel />;
}
