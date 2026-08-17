import BillingCreditsPanel from "@/components/admin/BillingCreditsPanel";

/**
 * /admin/billing — Phase 16-C Billing / Credits (read-only).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin.
 */
export default function AdminBillingPage() {
  return <BillingCreditsPanel />;
}
