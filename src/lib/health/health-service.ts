import "server-only";
import {
  DEPENDENCY_MATRIX,
  READINESS_BUDGET_MS,
  rollUp,
  type DependencyName,
  type DependencyReport,
  type LivenessReport,
  type ReadinessReport,
  type RuntimeName,
} from "./health-contract";
import {
  probeClerk,
  probeConfig,
  probeDrS3,
  probeKafka,
  probeProviders,
  probeR2,
  probeRealtimeDebt,
  probeRedisA,
  probeRedisB,
  probeSqs,
  probeSupabase,
  probeTemporal,
} from "./dependency-probes";
import { createLogger } from "@/lib/observability/logger";

/**
 * The health service (Phase 13 health foundation).
 *
 * Liveness, readiness and dependency health, kept apart on purpose — see the
 * reasoning in `health-contract.ts`.
 *
 * ---------------------------------------------------------------------------
 * HEALTH IS OBSERVATIONAL
 * ---------------------------------------------------------------------------
 * Nothing in this file can restart a generation, retry a provider, settle a
 * credit, release quarantine or change a security decision. It imports the
 * probes, the contract and the logger, and nothing that could. A failing probe
 * changes a status string; it never changes business state.
 */

const log = createLogger("health");

/**
 * Liveness: can this process execute?
 *
 * ZERO I/O, BY CONSTRUCTION. It reads no environment variable, opens no
 * connection and awaits nothing. If it can return, the answer is yes.
 *
 * That austerity is the entire point. An orchestrator restarts a container
 * whose liveness fails, so a liveness probe that touched Redis would turn a
 * Redis blip into a cluster-wide restart storm — the dependency outage
 * amplified into an application outage. Readiness is where dependencies
 * belong: it removes a container from rotation instead of killing it.
 */
export function liveness(): LivenessReport {
  return { status: "HEALTHY", timestamp: new Date().toISOString() };
}

/** Which probe answers each dependency. */
async function probe(runtime: RuntimeName, dependency: DependencyName): Promise<DependencyReport> {
  switch (dependency) {
    case "config":
      return probeConfig(runtime);
    case "supabase":
      return probeSupabase(runtime);
    case "redis-a":
      return probeRedisA(runtime);
    case "redis-b":
      return probeRedisB(runtime);
    case "temporal":
      return probeTemporal(runtime);
    case "sqs":
      return probeSqs(runtime);
    case "r2":
      return probeR2(runtime);
    case "s3-dr":
      return probeDrS3(runtime);
    case "clerk":
      return probeClerk(runtime);
    case "providers":
      return probeProviders(runtime);
    case "realtime-debt":
      return probeRealtimeDebt(runtime);
    case "kafka":
      return probeKafka(runtime);
  }
}

/**
 * Dependency health for one runtime.
 *
 * Probes run CONCURRENTLY and each carries its own timeout, so the whole
 * evaluation is bounded by the slowest single probe rather than their sum.
 * `OPTIONAL` and `DEFERRED` dependencies are still probed — the answer is
 * diagnostic even when it cannot affect readiness, and skipping them would
 * make the diagnostic view lie by omission about what exists.
 */
export async function dependencyHealth(runtime: RuntimeName): Promise<DependencyReport[]> {
  const names = Object.keys(DEPENDENCY_MATRIX[runtime]) as DependencyName[];

  const settled = await Promise.all(
    names.map(async (name) => {
      try {
        return await probe(runtime, name);
      } catch {
        // A probe that threw is a probe that could not answer. UNKNOWN, never
        // healthy — and the exception is swallowed here rather than
        // propagating, because a health check must not fail the caller.
        return {
          dependency: name,
          status: "UNKNOWN" as const,
          reason: "unreachable" as const,
          criticality: DEPENDENCY_MATRIX[runtime][name]?.criticality ?? "OPTIONAL",
        };
      }
    })
  );

  return settled.sort((a, b) => a.dependency.localeCompare(b.dependency));
}

/**
 * Readiness: can this runtime safely do its own job?
 *
 * There is no global rule. The matrix decides per runtime, because the same
 * dependency means different things in different processes — Redis A is an
 * accelerator for the web tier and the actual delivery destination for the
 * realtime dispatcher.
 *
 * The whole evaluation is bounded by `READINESS_BUDGET_MS`. A readiness check
 * that hangs reads to an orchestrator as a failure, so exceeding the budget
 * answers UNREADY with a `timeout` reason rather than waiting — an honest
 * "I could not tell in time", which for readiness is the safe direction.
 */
export async function readiness(runtime: RuntimeName): Promise<ReadinessReport> {
  const timestamp = new Date().toISOString();

  // The budget timer is cleared on BOTH paths. Left dangling it holds the
  // event loop for the full budget after readiness has already answered —
  // harmless in a long-lived server, but it delays process exit everywhere
  // else, and a timer nobody clears is the kind of thing that later gets
  // blamed on the dependency it was waiting for.
  let budgetTimer: NodeJS.Timeout | undefined;
  const dependencies = await Promise.race([
    dependencyHealth(runtime),
    new Promise<null>((resolve) => {
      budgetTimer = setTimeout(() => resolve(null), READINESS_BUDGET_MS);
    }),
  ]).finally(() => {
    if (budgetTimer) clearTimeout(budgetTimer);
  });

  if (dependencies === null) {
    log.warn("readiness_budget_exceeded", { subsystem: "health", result: "timeout" });
    return { runtime, status: "UNREADY", reasons: ["timeout"], dependencies: [], timestamp };
  }

  const { status, reasons } = rollUp(runtime, dependencies);

  // Safe telemetry only: the runtime, the status and bounded reason codes.
  // The 13-E guard drops anything else even if this changed.
  log.info("readiness_evaluated", { subsystem: "health", result: status.toLowerCase() });

  return { runtime, status, reasons, dependencies, timestamp };
}

/**
 * Whether a runtime is safe to receive work.
 *
 * `DEGRADED` counts as ready, deliberately. A degraded runtime is one whose
 * optional or fallback-covered dependencies are unwell — refusing traffic
 * there would take the product down to protect it from a partial loss of
 * function, which is the wrong trade in every case the matrix describes.
 */
export function isReady(report: ReadinessReport): boolean {
  return report.status === "HEALTHY" || report.status === "DEGRADED";
}
