import ModelsProvidersPanel from "@/components/admin/ModelsProvidersPanel";

/**
 * /admin/models-providers — Phase 16-B Models / Providers (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin.
 */
export default function AdminModelsProvidersPage() {
  return <ModelsProvidersPanel />;
}
