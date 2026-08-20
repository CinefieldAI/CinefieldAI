import type { AffectedComponent, RecoveryClass } from "@/lib/recovery/recovery-contract";

/**
 * Game-day scenario catalogue (Phase 26-A).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT
 * ---------------------------------------------------------------------------
 * A bounded, typed list of the failure scenarios the roadmap names (¶: Nasıl
 * yapılacak step 2 — provider outage, 429/5xx, worker loss, SQS backlog/DLQ,
 * Redis degradation, DB connection pressure, webhook loss, R2/S3 issue, bad
 * deploy). Nothing here injects a fault, measures a recovery, or owns an RTO/
 * RPO number:
 *
 *   - `recoveryClass`/`affectedComponent` are Phase 15-D/2's OWN closed
 *     vocabularies (`recovery-contract.ts`) — reused, never redefined. A
 *     scenario's measured outcome is classified by the EXISTING
 *     `measureRecovery()` engine against the EXISTING `RTO_TARGETS`/
 *     `RPO_TARGETS` registry, which still ships empty (no business-approved
 *     number exists) — this file adds no second registry.
 *   - `expectedSafeBehavior` describes a mechanism that ALREADY EXISTS
 *     elsewhere (Phase 7 routing/circuit-breaker, Phase 15-D DLQ redrive,
 *     Phase 14 rollback) — it is documentation of what should already
 *     happen, not a new control this file implements.
 *   - `productionAllowed` is `false` for every entry in this batch. No AWS
 *     FIS deployment, staging environment, or CloudWatch stop-condition
 *     wiring exists yet (26-B/26-C), so no scenario can be safely run
 *     against a live environment today — see `chaos-environment-guard.ts`.
 */

export type BlastRadius = "single_generation" | "single_runtime" | "cross_runtime" | "platform_wide";

export type InjectedFaultType =
  | "upstream_outage"
  | "upstream_error_rate"
  | "process_crash"
  | "queue_backlog"
  | "cache_degradation"
  | "connection_pressure"
  | "delivery_loss"
  | "storage_unavailable"
  | "bad_release";

export type ChaosEnvironment = "local" | "test" | "staging" | "production";

/** Never `"production"` in this batch — see the file header. */
export const ALLOWED_CHAOS_ENVIRONMENTS: readonly ChaosEnvironment[] = ["local", "test", "staging"];

export interface GameDayScenario {
  readonly id: string;
  readonly title: string;
  /** Which existing phase/mechanism owns the REAL recovery behavior being exercised. */
  readonly owner: string;
  readonly blastRadius: BlastRadius;
  /** Bounded description of what must be true before this scenario may run. */
  readonly preconditions: string;
  readonly injectedFaultType: InjectedFaultType;
  /** What the existing system should already do — never a new mechanism. */
  readonly expectedSafeBehavior: string;
  readonly recoveryClass: RecoveryClass;
  readonly affectedComponent: AffectedComponent;
  readonly productionAllowed: boolean;
}

export const GAME_DAY_SCENARIOS: readonly GameDayScenario[] = [
  {
    id: "provider_outage",
    title: "A generation provider becomes fully unreachable",
    owner: "phase-7 (routing + circuit breaker)",
    blastRadius: "cross_runtime",
    preconditions: "At least one alternate provider/model route is healthy.",
    injectedFaultType: "upstream_outage",
    expectedSafeBehavior:
      "Phase 7 routing opens a circuit breaker for the provider and fails over; no duplicate generation is submitted and no double charge occurs.",
    recoveryClass: "dependency_recovery",
    affectedComponent: "providers",
    productionAllowed: false,
  },
  {
    id: "provider_elevated_error_rate",
    title: "A provider returns a sustained 429/5xx error rate",
    owner: "phase-7 (routing + circuit breaker)",
    blastRadius: "cross_runtime",
    preconditions: "Provider error-rate tracking is live for the target provider.",
    injectedFaultType: "upstream_error_rate",
    expectedSafeBehavior:
      "Phase 7's error-rate tracking degrades the route rather than treating one failure as an outage; routing avoids the unhealthy route without opening the breaker prematurely.",
    recoveryClass: "dependency_recovery",
    affectedComponent: "providers",
    productionAllowed: false,
  },
  {
    id: "provider_worker_loss",
    title: "The provider worker process is lost",
    owner: "phase-13 (health/readiness) + phase-6r (worker foundation)",
    blastRadius: "single_runtime",
    preconditions: "A replacement worker process can be started by the same supervisor.",
    injectedFaultType: "process_crash",
    expectedSafeBehavior:
      "Readiness reports UNREADY for the lost instance; the SQS attempt-claim predicate (not this layer) prevents a duplicate submission when a replacement resumes consuming.",
    recoveryClass: "worker_recovery",
    affectedComponent: "provider-worker",
    productionAllowed: false,
  },
  {
    id: "sqs_backlog_dlq",
    title: "SQS backlog grows and messages land in the DLQ",
    owner: "phase-15d (DLQ redrive)",
    blastRadius: "cross_runtime",
    preconditions: "DLQ depth and redrive tooling (queue.dlq.redrive) are reachable.",
    injectedFaultType: "queue_backlog",
    expectedSafeBehavior:
      "Poison messages land in the DLQ rather than looping the visibility timeout forever; redrive is a deliberate, audited Tier-0 two-person action, never automatic.",
    recoveryClass: "queue_recovery",
    affectedComponent: "sqs",
    productionAllowed: false,
  },
  {
    id: "redis_degradation",
    title: "Redis A becomes slow or unreachable",
    owner: "phase-13 (health) + PRE-12 (fail-closed rate limiting)",
    blastRadius: "cross_runtime",
    preconditions: "None — this dependency is DEGRADED_ALLOWED for every runtime except the realtime dispatcher.",
    injectedFaultType: "cache_degradation",
    expectedSafeBehavior:
      "Paid routes fail closed on rate limiting rather than open; every runtime except the realtime dispatcher stays DEGRADED, not UNREADY.",
    recoveryClass: "dependency_recovery",
    affectedComponent: "redis-a",
    productionAllowed: false,
  },
  {
    id: "database_connection_pressure",
    title: "Supabase connection pool is exhausted",
    owner: "phase-13 (health)",
    blastRadius: "platform_wide",
    preconditions: "None.",
    injectedFaultType: "connection_pressure",
    expectedSafeBehavior:
      "Readiness reports UNREADY for every runtime that treats Supabase as CRITICAL; no runtime silently serves with a stale or partial read.",
    recoveryClass: "dependency_recovery",
    affectedComponent: "supabase",
    productionAllowed: false,
  },
  {
    id: "webhook_delivery_loss",
    title: "A provider webhook/callback delivery is lost",
    owner: "phase-6rh (webhook-temporal-bridge) + Temporal",
    blastRadius: "single_generation",
    preconditions: "The affected workflow is still within its Temporal activity retry policy.",
    injectedFaultType: "delivery_loss",
    expectedSafeBehavior:
      "Temporal's own activity retry/signal timeout resumes progress without a second orchestration path or a duplicate billing event.",
    recoveryClass: "dependency_recovery",
    affectedComponent: "temporal",
    productionAllowed: false,
  },
  {
    id: "r2_unavailable",
    title: "Cloudflare R2 (primary media storage) is unavailable",
    owner: "phase-9 (media pipeline)",
    blastRadius: "cross_runtime",
    preconditions: "None.",
    injectedFaultType: "storage_unavailable",
    expectedSafeBehavior:
      "Media upload/delivery degrades per the health matrix (DEGRADED_ALLOWED for web); no partial object is served as complete.",
    recoveryClass: "dependency_recovery",
    affectedComponent: "r2",
    productionAllowed: false,
  },
  {
    id: "s3_dr_unavailable",
    title: "The S3 DR bucket is unavailable",
    owner: "phase-9/phase-15 (DR + restore validation)",
    blastRadius: "single_runtime",
    preconditions: "None.",
    injectedFaultType: "storage_unavailable",
    expectedSafeBehavior:
      "Only the DR worker (for which s3-dr is CRITICAL) reports UNREADY; the rest of the platform is unaffected — a backup failure is an incident, never a customer-facing outage.",
    recoveryClass: "dependency_recovery",
    affectedComponent: "s3-dr",
    productionAllowed: false,
  },
  {
    id: "bad_deploy",
    title: "A deployment regresses readiness or a critical alert opens",
    owner: "phase-14 (deployment-guard.ts, evaluateRollback)",
    blastRadius: "platform_wide",
    preconditions: "A previous-good deployment identity is known.",
    injectedFaultType: "bad_release",
    expectedSafeBehavior:
      "evaluateRollback() (Phase 14, unmodified) recommends rollback from real current readiness and open CRITICAL alert types; this catalogue measures the resulting recovery time, it does not decide the rollback itself.",
    recoveryClass: "worker_recovery",
    affectedComponent: "web",
    productionAllowed: false,
  },
];

const SCENARIO_BY_ID = new Map(GAME_DAY_SCENARIOS.map((s) => [s.id, s]));

export function gameDayScenario(id: string): GameDayScenario | null {
  return SCENARIO_BY_ID.get(id) ?? null;
}

export function isKnownGameDayScenario(id: string): boolean {
  return SCENARIO_BY_ID.has(id);
}
