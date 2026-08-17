import TemporalInvestigationPanel from "@/components/admin/TemporalInvestigationPanel";

/**
 * /admin/temporal — Phase 16-D Temporal/Workflows inspection + cancel.
 *
 * Authorization already happened in `src/app/admin/layout.tsx`. Reads the
 * durable `generations` row plus a live Temporal `describe()`
 * (`src/lib/temporal/workflow-inspection.ts`); the only mutation is a
 * guarded cancel that wraps the existing Phase 6R-H cancel-intent /
 * Temporal-signal path, unchanged.
 */
export default function AdminTemporalPage() {
  return <TemporalInvestigationPanel />;
}
