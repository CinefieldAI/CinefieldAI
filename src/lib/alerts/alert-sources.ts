import { ALERT_THRESHOLDS, type AlertCandidate, type AlertType } from "./alert-contract";
import { raiseAlert, resolveAlert, type RaiseResult } from "./alert-router";
import type { DependencyName, HealthStatus, ReadinessReport, RuntimeName } from "@/lib/health/health-contract";
import type { RiskAction, SecurityEventKind, SecuritySeverity } from "@/lib/security/security-event-contract";
import type { ProviderHealthStatus } from "@/lib/redis/provider-health-store";

/**
 * Alert producers (Phase 13-D, code half).
 *
 * Each function turns state that ALREADY EXISTS somewhere in the system into a
 * bounded alert candidate. Every alert type in the catalogue has a producer
 * here, and a test asserts the two sets match in both directions — a
 * catalogued type nothing can produce would make the alert surface look wider
 * than it is, which is the "built but never wired" defect one level up.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE, AND WHY
 * ---------------------------------------------------------------------------
 * The roadmap's alert inventory also names workflow-start outbox debt, DR
 * backup debt, SQS/DLQ depth, Kafka lag and replay-gap spikes. None of those
 * has a reader in this repository today: `workflow_start_outbox` has no debt
 * aggregate, no DR backup job runs, SQS is configured but has no metrics
 * client, and Kafka is activation-ready only. They are documented as deferred
 * rather than given producers, because an alert type for a subsystem that
 * cannot report is a fake alert — it would sit permanently silent and read as
 * "healthy" to whoever checked.
 */

/**
 * A security event, reduced to what an alert may know.
 *
 * This is a PROJECTION of a row that is already durable in `security_events`.
 * The evidence — subject hash, actor, resource id, policy version, risk inputs
 * — stays in the table. 12-C owns that storage and an alert must not become a
 * second copy of it on a path whose purpose is to leave the building.
 */
export interface SecurityAlertProjection {
  readonly kind: SecurityEventKind;
  readonly severity: SecuritySeverity;
  readonly reasonCode: string;
  readonly recommendedAction: RiskAction;
  readonly eventId?: string;
  readonly traceId?: string;
  readonly tenantId?: string;
}

/**
 * Security events worth waking someone for.
 *
 * `high` severity is the escalation line, matching 12-C's own `KIND_SEVERITY`
 * rather than a second opinion about which kinds matter. A Risk Engine
 * recommendation of `admin_review` or `temporary_block` alerts at any severity
 * for a different reason: the recommendation is durable in the row and
 * queryable the moment Phase 16 exists, but until then nobody is watching the
 * table, and a request for human review that no human sees is not a control.
 */
export function alertOnSecurityEvent(projection: SecurityAlertProjection): RaiseResult | null {
  const shared = {
    resource: projection.kind,
    reasonCode: projection.reasonCode,
    eventId: projection.eventId,
    traceId: projection.traceId,
    tenantId: projection.tenantId,
  };

  if (projection.severity === "high") {
    return raiseAlert({ type: "security_high_severity", ...shared });
  }
  if (projection.recommendedAction === "admin_review" || projection.recommendedAction === "temporary_block") {
    return raiseAlert({ type: "security_action_recommended", ...shared });
  }
  // Everything else is evidence, not an alert. A rate-limit denial is a normal
  // event in a healthy system; alerting on each one is how a channel becomes
  // noise nobody reads.
  return null;
}

/**
 * Last observed status per runtime+dependency, for transition detection.
 *
 * Transition-based, not poll-based, and this map is the whole reason. A health
 * loop that alerted on every unhealthy poll would emit once per interval
 * forever; dedupe would coalesce it, but the router would be doing the work of
 * a comparison that costs nothing here. Alerting on the EDGE also gives the
 * signal an operator actually wants: not "Redis is down" repeated, but "Redis
 * just went down".
 */
const lastStatus = new Map<string, HealthStatus>();

function statusKey(runtime: RuntimeName, dependency: DependencyName): string {
  return `${runtime}:${dependency}`;
}

export function resetHealthTransitions(): void {
  lastStatus.clear();
}

/**
 * Turns a readiness report into alerts for whatever CHANGED.
 *
 * A repeated identical report produces nothing at all — not a suppressed
 * alert, not a counted occurrence, nothing. Recovery clears the dedupe entry
 * so that if the dependency fails again it alerts immediately instead of
 * being coalesced into the window of the incident that already ended.
 */
export function alertOnReadiness(report: ReadinessReport): RaiseResult[] {
  const raised: RaiseResult[] = [];

  for (const dep of report.dependencies) {
    // OPTIONAL and DEFERRED dependencies are skipped, matching `rollUp()`
    // exactly. `dependencyHealth()` deliberately still probes them for the
    // diagnostic view, so Kafka and Redis B report UNKNOWN on every single
    // poll of every runtime — that is their PERMANENT, EXPECTED state until
    // those subsystems are built, not an incident. The live proof caught this:
    // without this guard, every worker startup paged three ERROR/TELEGRAM
    // alerts for infrastructure that was never supposed to be running yet,
    // which is precisely the alarm fatigue 13-D exists to prevent. Alerting
    // here must not know more than the health contract already decided.
    if (dep.criticality === "OPTIONAL" || dep.criticality === "DEFERRED") continue;

    const key = statusKey(report.runtime, dep.dependency);
    const previous = lastStatus.get(key);
    lastStatus.set(key, dep.status);

    if (previous === dep.status) continue;

    if (dep.status === "HEALTHY") {
      // Recovered. The alert is cleared, not "resolved" with a record: the
      // durable history of the incident is the log line that reported it.
      resolveAlert("dependency_degraded", dep.dependency);
      resolveAlert("dependency_unavailable", dep.dependency);
      continue;
    }

    // UNKNOWN is not healthy and not merely degraded — under the health
    // contract a CRITICAL dependency that cannot answer makes its runtime
    // unready, so it alerts at the same level as an outright failure.
    const type: AlertType =
      dep.status === "UNKNOWN" || dep.criticality === "CRITICAL"
        ? "dependency_unavailable"
        : "dependency_degraded";

    raised.push(
      raiseAlert({ type, resource: dep.dependency, reasonCode: dep.reason, traceId: undefined })
    );
  }

  const previousRuntime = lastStatus.get(`runtime:${report.runtime}`);
  lastStatus.set(`runtime:${report.runtime}`, report.status);
  if (previousRuntime !== report.status) {
    if (report.status === "UNREADY") {
      raised.push(
        raiseAlert({
          type: "runtime_unready",
          resource: report.runtime,
          reasonCode: report.reasons[0] ?? "unreachable",
        })
      );
    } else if (report.status === "HEALTHY") {
      resolveAlert("runtime_unready", report.runtime);
    }
  }

  return raised;
}

/** The debt shape the realtime dispatcher already reads every minute. */
export interface RealtimeDebtSnapshot {
  readonly pending: number;
  readonly oldestPendingSeconds: number;
  readonly maxAttempts: number;
}

/**
 * Operational debt alerts.
 *
 * Thresholds come from `ALERT_THRESHOLDS`, never from a literal here. One
 * number in one place is what stops "what counts as a backlog" from drifting
 * between the health probe and the alert path and quietly disagreeing.
 *
 * No event payload is read or forwarded — only the three aggregate counts the
 * `realtime_outbox_debt()` RPC already returns.
 */
export function alertOnRealtimeDebt(debt: RealtimeDebtSnapshot): RaiseResult[] {
  const raised: RaiseResult[] = [];

  if (debt.pending >= ALERT_THRESHOLDS.realtimePendingWarn) {
    raised.push(
      raiseAlert({ type: "realtime_outbox_backlog", resource: "realtime-outbox", reasonCode: "pending_over_threshold" })
    );
  }
  if (debt.oldestPendingSeconds >= ALERT_THRESHOLDS.realtimeOldestPendingSecondsWarn) {
    raised.push(
      raiseAlert({ type: "realtime_outbox_stalled", resource: "realtime-outbox", reasonCode: "oldest_pending_exceeded" })
    );
  }
  if (debt.maxAttempts >= ALERT_THRESHOLDS.realtimeAttemptsWarn) {
    raised.push(
      raiseAlert({
        type: "realtime_outbox_retry_exhaustion",
        resource: "realtime-outbox",
        reasonCode: "attempts_near_limit",
      })
    );
  }

  return raised;
}

/**
 * The dispatcher loop reporting on itself.
 *
 * Debt alerts assume something is draining the queue. This one says nothing
 * is, which is why it is a separate type rather than a louder backlog: a
 * healthy-looking queue with a dead dispatcher produces no debt alert at all
 * until the backlog accumulates.
 */
export function alertOnDispatcherFailure(consecutiveFailures: number): RaiseResult | null {
  if (consecutiveFailures < ALERT_THRESHOLDS.dispatcherConsecutiveFailures) return null;
  return raiseAlert({
    type: "dispatcher_pass_failing",
    resource: "realtime-dispatcher",
    reasonCode: "consecutive_pass_failures",
    observed: 1,
  });
}

/**
 * Provider health, read from the state Redis A already holds.
 *
 * NO PROVIDER IS CALLED. This reads `provider-health-store` state written by
 * the normal generation path; probing a provider to find out whether it is
 * healthy would be a paid call made by the monitoring system, which is both a
 * cost and a way to make an outage worse.
 *
 * The provider's own error text is never carried — only its categorised
 * status. Provider messages are unbounded text from an external system, which
 * is the definition of what must not enter telemetry.
 */
export function alertOnProviderHealth(
  providerId: string,
  status: ProviderHealthStatus,
  consecutiveFailures: number
): RaiseResult | null {
  const resource = providerId.toLowerCase();

  if (status === "healthy") {
    resolveAlert("provider_degraded", resource);
    resolveAlert("provider_unhealthy", resource);
    return null;
  }

  if (status === "unhealthy" && consecutiveFailures >= ALERT_THRESHOLDS.providerConsecutiveFailures) {
    return raiseAlert({ type: "provider_unhealthy", resource, reasonCode: "consecutive_failures" });
  }

  return raiseAlert({ type: "provider_degraded", resource, reasonCode: "intermittent_failures" });
}

/** Every producer's alert types, for the catalogue-coverage assertion. */
export const PRODUCED_ALERT_TYPES: readonly AlertType[] = [
  "security_high_severity",
  "security_action_recommended",
  "dependency_degraded",
  "dependency_unavailable",
  "runtime_unready",
  "realtime_outbox_backlog",
  "realtime_outbox_stalled",
  "realtime_outbox_retry_exhaustion",
  "dispatcher_pass_failing",
  "provider_degraded",
  "provider_unhealthy",
  "slo_budget_low",
  "slo_budget_exhausted",
  // Raised by src/lib/finops/cost-alert-bridge.ts (Phase 15-B), which owns the
  // signal and depends on 13-D rather than the other way round.
  "cost_budget_at_risk",
  "cost_budget_exhausted",
];

export type { AlertCandidate };
