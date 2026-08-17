import "server-only";
import { readiness } from "@/lib/health/health-service";
import { RUNTIME_NAMES } from "@/lib/health/health-contract";
import { projectAdminHealth, type AdminHealthProjection } from "./admin-health-projection";

/**
 * The real, I/O boundary behind the Phase 16 admin health surface
 * (Phase 16/1).
 *
 * Calls Phase 13's own `readiness()` once per `RuntimeName` — CONCURRENTLY,
 * so the whole call stays bounded by `READINESS_BUDGET_MS` (one runtime's
 * worst case) rather than the sum across six runtimes — and hands the
 * results to the pure projector. This is the only place in the Phase 16
 * admin surface that touches Phase 13's real probes; nothing here evaluates
 * a dependency itself.
 */
export async function collectAdminHealth(): Promise<AdminHealthProjection> {
  const reports = await Promise.all(RUNTIME_NAMES.map((runtime) => readiness(runtime)));
  return projectAdminHealth(reports, new Date().toISOString());
}
