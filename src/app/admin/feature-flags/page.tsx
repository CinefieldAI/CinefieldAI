import FeatureFlagsPanel from "@/components/admin/FeatureFlagsPanel";

/**
 * /admin/feature-flags — Phase 21-B Feature Flags (read + authorized set).
 *
 * Authorization already happened in `src/app/admin/layout.tsx`; this page
 * renders only for an already-verified admin. The mutation itself still
 * requires `route_admin` policy authorization and, for HIGH_RISK_TIER0
 * flags, Tier-0 step-up (and for `release_stage` -> "public", two-person).
 */
export default function AdminFeatureFlagsPage() {
  return <FeatureFlagsPanel />;
}
