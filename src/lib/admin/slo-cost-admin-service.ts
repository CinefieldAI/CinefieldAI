import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readiness } from "@/lib/health/health-service";
import { RUNTIME_NAMES, type ReadinessReport } from "@/lib/health/health-contract";
import {
  observeAvailability,
  observeDependencyReadiness,
  observeGenerationLatency,
  observeGenerationSuccess,
  observeGenerationTimeouts,
  observeProviderReliability,
  observeRealtimeDebtAge,
  type AttemptWindowCounts,
} from "@/lib/slo/slo-adapters";
import { evaluateSlo, type SloSnapshot, type SloWindow } from "@/lib/slo/slo-snapshot";
import { readRealtimeDebt } from "@/lib/realtime/outbox-dispatcher";
import { getProviderHealth } from "@/lib/redis/provider-health-store";
import { listModels } from "@/lib/orchestration/model-registry";
import { runEstimatedSpendGuard } from "@/trigger/operational/operational-services";
import { SLO_WINDOW_HOURS, type SloCostAdminResult } from "./slo-cost-admin-contract";

/**
 * Phase 16-D SLO/Cost Guard read service.
 *
 * See `slo-cost-admin-contract.ts`'s header for the ownership boundary.
 * Nothing here is a scheduled task — this runs once, synchronously with the
 * admin request, exactly like every other Phase 16 admin read.
 */

/** Bound on one pass, mirroring the 15-B/2 scan cap discipline. */
const MAX_SCANNED_ATTEMPTS = 5_000;
const SLO_WINDOW: SloWindow = "medium";

/** Exported for direct, I/O-injected testing — see phase-16d-slo-cost.e2e.test.ts. */
export async function readGenerationAttemptWindow(
  admin: SupabaseClient,
  windowStart: string,
  windowEnd: string
): Promise<AttemptWindowCounts> {
  const unavailable: AttemptWindowCounts = { succeeded: 0, failed: 0, timedOut: 0, p95LatencyMs: null, sourceAvailable: false };

  try {
    const { data, error } = await admin
      .from("generation_attempts")
      .select("status, error_code, latency_ms")
      .gte("created_at", windowStart)
      .lt("created_at", windowEnd)
      .in("status", ["succeeded", "failed"])
      .limit(MAX_SCANNED_ATTEMPTS + 1);

    if (error) return unavailable;
    const rows = (data ?? []) as { status: string; error_code: string | null; latency_ms: number | null }[];
    if (rows.length > MAX_SCANNED_ATTEMPTS) return unavailable;

    let succeeded = 0;
    let failed = 0;
    let timedOut = 0;
    const latencies: number[] = [];

    for (const row of rows) {
      if (row.status === "succeeded") {
        succeeded += 1;
        if (typeof row.latency_ms === "number") latencies.push(row.latency_ms);
      } else if (row.status === "failed") {
        failed += 1;
      }
      if (row.error_code === "PROVIDER_TIMEOUT") timedOut += 1;
    }

    latencies.sort((a, b) => a - b);
    const p95LatencyMs =
      latencies.length === 0 ? null : latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)];

    return { succeeded, failed, timedOut, p95LatencyMs, sourceAvailable: true };
  } catch {
    return unavailable;
  }
}

/** Merges every runtime's CRITICAL dependency probes into one synthetic report — see contract header. */
function mergedCriticalDependencyReport(reports: readonly ReadinessReport[]): ReadinessReport {
  return {
    runtime: reports[0]?.runtime ?? "web",
    status: "UNKNOWN",
    reasons: [],
    dependencies: reports.flatMap((r) => r.dependencies),
    timestamp: new Date().toISOString(),
  };
}

async function computeProviderReliability(): Promise<{ healthy: number; observed: number; sourceAvailable: boolean }> {
  const providers = [...new Set(listModels().map((m) => m.providerId))];
  if (providers.length === 0) return { healthy: 0, observed: 0, sourceAvailable: true };

  let healthy = 0;
  let observed = 0;
  try {
    for (const providerId of providers) {
      const state = await getProviderHealth(providerId);
      if (!state) continue;
      observed += 1;
      if (state.status === "healthy" || state.status === "degraded") healthy += 1;
    }
    return { healthy, observed, sourceAvailable: true };
  } catch {
    return { healthy: 0, observed: 0, sourceAvailable: false };
  }
}

export async function getAdminSloCost(admin: SupabaseClient): Promise<SloCostAdminResult> {
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - SLO_WINDOW_HOURS * 3_600_000).toISOString();
  const evaluatedAt = windowEnd;

  const [attemptCounts, readinessReports, realtimeDebt, providerReliability, costGuard] = await Promise.all([
    readGenerationAttemptWindow(admin, windowStart, windowEnd),
    Promise.all(RUNTIME_NAMES.map((runtime) => readiness(runtime))),
    readRealtimeDebt(admin),
    computeProviderReliability(),
    runEstimatedSpendGuard(),
  ]);

  const mergedReport = mergedCriticalDependencyReport(readinessReports);
  const overallHealthy = readinessReports.some((r) => r.status === "HEALTHY" || r.status === "DEGRADED");

  const slo: SloSnapshot[] = [
    evaluateSlo(observeGenerationSuccess(attemptCounts, SLO_WINDOW), evaluatedAt),
    evaluateSlo(observeGenerationTimeouts(attemptCounts, SLO_WINDOW), evaluatedAt),
    evaluateSlo(observeGenerationLatency(attemptCounts, SLO_WINDOW), evaluatedAt),
    evaluateSlo(observeDependencyReadiness(mergedReport, SLO_WINDOW), evaluatedAt),
    evaluateSlo(observeRealtimeDebtAge(realtimeDebt, SLO_WINDOW), evaluatedAt),
    evaluateSlo(observeProviderReliability(providerReliability, SLO_WINDOW), evaluatedAt),
    // app_availability: honestly a single current sample, well under the
    // SLI's own minimumSamples(10) — evaluateSlo reaches INSUFFICIENT_DATA
    // on its own; see contract header.
    evaluateSlo(
      observeAvailability({ servable: overallHealthy ? 1 : 0, answered: 1, sourceAvailable: true }, SLO_WINDOW),
      evaluatedAt
    ),
  ];

  return { outcome: "FOUND", slo, costGuard };
}
