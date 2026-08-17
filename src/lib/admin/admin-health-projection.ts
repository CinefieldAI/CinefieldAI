import type {
  Criticality,
  DependencyName,
  HealthReason,
  HealthStatus,
  ReadinessReport,
  RuntimeName,
} from "@/lib/health/health-contract";

/**
 * The Phase 16 admin health projection (Phase 16/1).
 *
 * Pure types and a pure transform only — no I/O, no clock, no Clerk. This
 * file does not redefine `HealthStatus`, does not re-derive readiness from
 * dependency reports, and does not compute a rollup itself: it reshapes
 * Phase 13's own already-computed `ReadinessReport[]` into the bounded shape
 * the admin UI renders. Every field here is a UI PROJECTION of an existing
 * field — never a new truth.
 */

export interface AdminHealthDependencyProjection {
  readonly dependency: DependencyName;
  readonly status: HealthStatus;
  readonly reasonCode: HealthReason;
  readonly criticality: Criticality;
}

export interface AdminHealthRuntimeProjection {
  readonly runtime: RuntimeName;
  readonly status: HealthStatus;
  readonly reasons: readonly HealthReason[];
  readonly dependencies: readonly AdminHealthDependencyProjection[];
}

export interface AdminHealthProjection {
  /** The single worst status across every runtime. Never invented — always one of the real per-runtime statuses. */
  readonly overallStatus: HealthStatus;
  readonly checkedAt: string;
  readonly runtimes: readonly AdminHealthRuntimeProjection[];
}

/**
 * Severity for picking the single headline `overallStatus`.
 *
 * `rollUp()` (Phase 13) only ever assigns a runtime HEALTHY, DEGRADED, or
 * UNREADY — UNKNOWN is a per-dependency status, never a per-runtime one. The
 * UNKNOWN entry below exists purely so this switch is exhaustive against the
 * full `HealthStatus` union rather than assuming that invariant holds
 * forever; if it is ever reached, "unknown" is treated as worse than merely
 * degraded, the same "UNKNOWN != healthy" rule this codebase applies
 * everywhere else.
 */
const SEVERITY: Readonly<Record<HealthStatus, number>> = {
  HEALTHY: 0,
  DEGRADED: 1,
  UNKNOWN: 2,
  UNREADY: 3,
};

function worstOf(a: HealthStatus, b: HealthStatus): HealthStatus {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

/**
 * Reshapes already-computed readiness reports. Never fetches, never probes —
 * the caller (`admin-health-service.ts`) owns every real read.
 */
export function projectAdminHealth(
  reports: readonly ReadinessReport[],
  checkedAt: string
): AdminHealthProjection {
  const runtimes: AdminHealthRuntimeProjection[] = reports.map((report) => ({
    runtime: report.runtime,
    status: report.status,
    reasons: report.reasons,
    dependencies: report.dependencies.map((dep) => ({
      dependency: dep.dependency,
      status: dep.status,
      reasonCode: dep.reason,
      criticality: dep.criticality,
    })),
  }));

  const overallStatus = runtimes.reduce<HealthStatus>((worst, rt) => worstOf(worst, rt.status), "HEALTHY");

  return { overallStatus, checkedAt, runtimes };
}
