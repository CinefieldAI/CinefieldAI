/**
 * The health contract (Phase 13 health foundation).
 *
 * Roadmap ¶649 / ¶1698 give Better Stack "harici uptime, synthetic, heartbeat
 * ve public status" in 13-C, and ¶413 requires the core production path to be
 * visible 24/7. This package builds what those will consume — the contracts —
 * without any external service.
 *
 * ---------------------------------------------------------------------------
 * THREE DIFFERENT QUESTIONS, NOT THREE NAMES FOR ONE
 * ---------------------------------------------------------------------------
 * The reason to separate them is that conflating them produces the two worst
 * operational failures, one in each direction:
 *
 *   LIVENESS    Is this process running?
 *               If liveness touched a dependency, a Redis blip would make an
 *               orchestrator KILL AND RESTART every healthy container — a
 *               dependency outage amplified into an application outage.
 *
 *   READINESS   Can this process safely do ITS OWN job?
 *               If readiness ignored a critical dependency, traffic would be
 *               routed to a container that accepts work and then loses it.
 *
 *   DEPENDENCY  What is the state of each thing we depend on?
 *   HEALTH      Diagnostic. It informs the other two; it is not either.
 *
 * So liveness never calls anything, readiness is decided PER RUNTIME, and a
 * degraded optional dependency never makes a runtime unready.
 *
 * ---------------------------------------------------------------------------
 * NO "server-only" HERE
 * ---------------------------------------------------------------------------
 * This file is a data contract: names, classifications and budgets. It reads
 * no environment variable, opens no connection and holds no value, and the
 * test suite needs it. The probes that DO touch things are server-only.
 */

/**
 * The bounded status vocabulary. Arbitrary strings are not representable.
 *
 * `UNKNOWN` exists and is deliberately NOT a synonym for healthy. A probe that
 * could not answer — no client configured, a timeout, a refused connection —
 * reports UNKNOWN, and a critical dependency at UNKNOWN makes a runtime
 * unready. Treating "we could not tell" as "fine" is how a health check
 * reports green through an outage.
 */
export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNREADY" | "UNKNOWN";

/** Every long-lived runtime that has its own readiness rule. */
export type RuntimeName =
  | "web"
  | "temporal-worker"
  | "provider-worker"
  | "realtime-dispatcher"
  | "media-worker"
  | "dr-worker";

export const RUNTIME_NAMES: readonly RuntimeName[] = [
  "web",
  "temporal-worker",
  "provider-worker",
  "realtime-dispatcher",
  "media-worker",
  "dr-worker",
];

/** Everything a runtime can depend on. Bounded — adding one is an edit here. */
export type DependencyName =
  | "config"
  | "supabase"
  | "redis-a"
  | "redis-b"
  | "temporal"
  | "sqs"
  | "r2"
  | "s3-dr"
  | "clerk"
  | "providers"
  | "realtime-debt"
  | "kafka";

/**
 * How much a runtime cares about a dependency.
 *
 *   CRITICAL          unavailable or UNKNOWN => the runtime is UNREADY
 *   DEGRADED_ALLOWED  the runtime still works, less well => DEGRADED, ready
 *   OPTIONAL          off by design; absence is not a fault at all
 *   DEFERRED          a later phase owns it; it does not exist yet
 */
export type Criticality = "CRITICAL" | "DEGRADED_ALLOWED" | "OPTIONAL" | "DEFERRED";

export interface DependencyRule {
  criticality: Criticality;
  /** Why this runtime cares this much. Required — see the matrix below. */
  why: string;
}

/**
 * THE DEPENDENCY MATRIX.
 *
 * One dependency is deliberately NOT critical everywhere. Two examples carry
 * most of the reasoning:
 *
 *   S3 DR is CRITICAL to the DR worker and OPTIONAL to everything else. The
 *   backup lane is asynchronous by architecture: a failed backup is a real
 *   incident, and it is not a reason to stop serving generations. Making it
 *   critical to the web tier would turn a recoverable backup problem into a
 *   customer-facing outage.
 *
 *   The media worker deliberately has NO Supabase and NO provider dependency.
 *   Red notes ¶327 and ¶1458 require it to run as a sandbox holding neither
 *   credential, so a readiness rule that demanded them would contradict the
 *   security contract it exists to satisfy.
 */
export const DEPENDENCY_MATRIX: Readonly<
  Record<RuntimeName, Partial<Record<DependencyName, DependencyRule>>>
> = {
  web: {
    config: { criticality: "CRITICAL", why: "An invalid production configuration must not serve traffic." },
    supabase: { criticality: "CRITICAL", why: "Every route reads or writes the database; without it a request can only fail." },
    clerk: { criticality: "CRITICAL", why: "Twelve of fourteen API routes call auth(); without identity they can only 401." },
    "redis-a": { criticality: "DEGRADED_ALLOWED", why: "Rate limiting fails CLOSED on paid paths without it — refusing spend is a degraded product, not a dead one. PRE-12 already decided this per route class." },
    temporal: { criticality: "DEGRADED_ALLOWED", why: "Generation submission stops; browsing, media and history still work. The execution boundary already answers 503 rather than starting anything." },
    r2: { criticality: "DEGRADED_ALLOWED", why: "Media upload and delivery degrade; the rest of the product does not." },
    providers: { criticality: "DEGRADED_ALLOWED", why: "Phase 7 routing already fails over and opens a circuit breaker; one unhealthy provider is a routing input, not an outage." },
    sqs: { criticality: "OPTIONAL", why: "The web tier never enqueues a command; the Temporal worker does." },
    "s3-dr": { criticality: "OPTIONAL", why: "Backup is asynchronous by architecture. A DR failure is an incident, never a reason to stop serving." },
    "redis-b": { criticality: "DEFERRED", why: "BullMQ is not provisioned and the web tier would not use it if it were." },
    kafka: { criticality: "DEFERRED", why: "Activation-ready downstream distribution; KAFKA_ENABLED is unset." },
  },

  "temporal-worker": {
    config: { criticality: "CRITICAL", why: "Startup already refuses an invalid production configuration." },
    temporal: { criticality: "CRITICAL", why: "Its whole job is polling a task queue. Unreachable Temporal means it cannot work at all." },
    supabase: { criticality: "CRITICAL", why: "Activities read and write generation state; without it every activity fails." },
    sqs: { criticality: "CRITICAL", why: "It dispatches provider commands. A worker that cannot enqueue accepts workflows it cannot progress." },
    "redis-a": { criticality: "DEGRADED_ALLOWED", why: "Idempotency and locks degrade; the SQL claim predicates remain the real guard." },
    providers: { criticality: "DEGRADED_ALLOWED", why: "It never calls a provider itself — it dispatches to the worker that does." },
    r2: { criticality: "OPTIONAL", why: "Object storage belongs to the provider and media workers; this runtime moves state, not bytes." },
    "s3-dr": { criticality: "OPTIONAL", why: "The backup lane is asynchronous by architecture; a DR failure is an incident for the DR worker, never a reason for this runtime to stop." },
    clerk: { criticality: "OPTIONAL", why: "Identity was captured server-side at start time and travels in workflow history." },
    "redis-b": { criticality: "DEFERRED", why: "Redis B is not provisioned, and this runtime would not use BullMQ if it were." },
    kafka: { criticality: "DEFERRED", why: "Kafka is activation-ready downstream distribution and KAFKA_ENABLED is unset." },
  },

  "provider-worker": {
    config: { criticality: "CRITICAL", why: "Startup already refuses an invalid production configuration." },
    sqs: { criticality: "CRITICAL", why: "It is an SQS consumer. No queue, no work." },
    supabase: { criticality: "CRITICAL", why: "It records attempts and outcomes; a submission it cannot record is a provider job nobody owns." },
    providers: { criticality: "DEGRADED_ALLOWED", why: "One unhealthy provider is what routing and the circuit breaker exist for. UNKNOWN here must never be reported as healthy, but it also must not stop the consumer." },
    "redis-a": { criticality: "DEGRADED_ALLOWED", why: "Health and latency signals degrade; the attempt claim in SQL still prevents duplicate submission." },
    r2: { criticality: "DEGRADED_ALLOWED", why: "Output storage; a failure fails that generation, not the worker." },
    temporal: { criticality: "OPTIONAL", why: "It is signalled BY Temporal and does not poll it." },
    clerk: { criticality: "OPTIONAL", why: "No user session is involved; the identity travelled in durable workflow history." },
    "s3-dr": { criticality: "OPTIONAL", why: "The backup lane is asynchronous by architecture; a DR failure is an incident for the DR worker, never a reason for this runtime to stop." },
    "redis-b": { criticality: "DEFERRED", why: "Redis B is not provisioned, and this runtime would not use BullMQ if it were." },
    kafka: { criticality: "DEFERRED", why: "Kafka is activation-ready downstream distribution and KAFKA_ENABLED is unset." },
  },

  "realtime-dispatcher": {
    config: { criticality: "CRITICAL", why: "Startup already refuses an invalid production configuration." },
    supabase: { criticality: "CRITICAL", why: "It claims outbox rows. Without the database there is nothing to dispatch." },
    "redis-a": { criticality: "CRITICAL", why: "Redis Streams IS the delivery destination — unlike everywhere else, here Redis A is the job rather than an accelerator." },
    "realtime-debt": { criticality: "DEGRADED_ALLOWED", why: "A backlog means it is behind, not broken. Reporting UNREADY would stop the only process that can drain it." },
    temporal: { criticality: "OPTIONAL", why: "It owns delivery and nothing else." },
    sqs: { criticality: "OPTIONAL", why: "It sends no command — it claims outbox rows and writes a Redis stream." },
    clerk: { criticality: "OPTIONAL", why: "Tenancy comes from the outbox row, not a session." },
    r2: { criticality: "OPTIONAL", why: "It touches no media object; it moves notification rows, not bytes." },
    "s3-dr": { criticality: "OPTIONAL", why: "The backup lane is asynchronous by architecture; a DR failure is an incident for the DR worker, never a reason for this runtime to stop." },
    "redis-b": { criticality: "DEFERRED", why: "Redis B is not provisioned, and this runtime would not use BullMQ if it were." },
    kafka: { criticality: "DEFERRED", why: "Kafka is activation-ready downstream distribution and KAFKA_ENABLED is unset." },
  },

  "media-worker": {
    config: { criticality: "CRITICAL", why: "Startup validation applies to every runtime." },
    r2: { criticality: "CRITICAL", why: "Its one write path. Without storage it has no way to finish a job." },
    // Deliberately absent as dependencies: supabase, providers, clerk.
    supabase: { criticality: "OPTIONAL", why: "Red notes ¶327/¶1458 forbid a database credential in this sandbox. Depending on it would contradict the security contract." },
    providers: { criticality: "OPTIONAL", why: "The same red notes forbid a provider secret here. It processes bytes it was handed and calls nobody." },
    "redis-a": { criticality: "OPTIONAL", why: "It holds no shared application state — everything it needs arrives with the job." },
    temporal: { criticality: "OPTIONAL", why: "It is invoked with a job rather than polling a task queue, so Temporal reachability is not its concern." },
    sqs: { criticality: "OPTIONAL", why: "6R.22: it has no SendMessage right to the command queue." },
    clerk: { criticality: "OPTIONAL", why: "It runs without a user session; identity was resolved before the job existed." },
    "s3-dr": { criticality: "OPTIONAL", why: "The backup lane is asynchronous by architecture; a DR failure is an incident for the DR worker, never a reason for this runtime to stop." },
    "redis-b": { criticality: "DEFERRED", why: "Redis B is not provisioned, and this runtime would not use BullMQ if it were." },
    kafka: { criticality: "DEFERRED", why: "Kafka is activation-ready downstream distribution and KAFKA_ENABLED is unset." },
  },

  "dr-worker": {
    config: { criticality: "CRITICAL", why: "Startup validation applies to every runtime." },
    "s3-dr": { criticality: "CRITICAL", why: "The one runtime for which the DR bucket IS the job." },
    r2: { criticality: "CRITICAL", why: "It copies FROM R2; without the source there is nothing to back up." },
    supabase: { criticality: "DEGRADED_ALLOWED", why: "It records backup metadata. Losing that loses the record, not the copy." },
    "redis-a": { criticality: "OPTIONAL", why: "It holds no shared application state; its inputs arrive with the scheduled run." },
    temporal: { criticality: "OPTIONAL", why: "It runs on a schedule rather than from a workflow, so Temporal is not in its path." },
    sqs: { criticality: "OPTIONAL", why: "It enqueues no command, so queue availability cannot affect its work." },
    clerk: { criticality: "OPTIONAL", why: "It runs without a user session; identity was resolved before the job existed." },
    providers: { criticality: "OPTIONAL", why: "It never calls a provider; it copies bytes that already exist." },
    "redis-b": { criticality: "DEFERRED", why: "Redis B is not provisioned, and this runtime would not use BullMQ if it were." },
    kafka: { criticality: "DEFERRED", why: "Kafka is activation-ready downstream distribution and KAFKA_ENABLED is unset." },
  },
};

/**
 * Probe timeout budgets, in milliseconds.
 *
 * Every probe is bounded and the total is bounded too. A health check that can
 * hang is worse than none: an orchestrator waiting on it reads the timeout as
 * a failure and restarts a process that was fine, which is the dependency
 * outage amplified into an application outage all over again.
 *
 * Deliberately short. A dependency that needs more than a second to say hello
 * is already degraded for the purposes of this question.
 */
export const PROBE_TIMEOUT_MS: Readonly<Record<DependencyName, number>> = {
  config: 50, // pure computation, no I/O
  supabase: 1_500,
  "redis-a": 1_000,
  "redis-b": 1_000,
  temporal: 1_000,
  sqs: 1_000,
  r2: 1_500,
  "s3-dr": 1_500,
  clerk: 500,
  providers: 500, // Redis A read, never a provider call
  "realtime-debt": 1_500,
  kafka: 1_000,
};

/** Ceiling for a whole readiness evaluation, however many probes it runs. */
export const READINESS_BUDGET_MS = 4_000;

/**
 * Reason codes a probe may report.
 *
 * Short codes, the same discipline 12-C and 12-E use. A probe never reports a
 * driver message, a host, a URL or an error string — those are exactly what a
 * health endpoint would broadcast to whoever can reach it.
 */
export type HealthReason =
  | "ok"
  | "not_configured"
  | "disabled"
  | "deferred"
  | "unreachable"
  | "timeout"
  | "refused"
  | "invalid_response"
  | "config_invalid"
  | "backlog"
  | "memory_pressure"
  | "eviction_policy_unsafe"
  | "degraded_upstream";

export interface DependencyReport {
  dependency: DependencyName;
  status: HealthStatus;
  reason: HealthReason;
  criticality: Criticality;
  /**
   * Latency BUCKET, never a precise millisecond figure.
   *
   * A precise number is a side channel: repeated probing of a timing-sensitive
   * backend can reveal more than intended, and nothing operational needs more
   * resolution than this.
   */
  latency?: LatencyBucket;
}

export type LatencyBucket = "fast" | "normal" | "slow" | "timeout";

export function bucketLatency(ms: number, budgetMs: number): LatencyBucket {
  if (ms >= budgetMs) return "timeout";
  if (ms < budgetMs * 0.25) return "fast";
  if (ms < budgetMs * 0.6) return "normal";
  return "slow";
}

export interface ReadinessReport {
  runtime: RuntimeName;
  status: HealthStatus;
  /** Bounded reason codes only; never a dependency's message. */
  reasons: HealthReason[];
  dependencies: DependencyReport[];
  timestamp: string;
}

export interface LivenessReport {
  status: "HEALTHY";
  timestamp: string;
}

export function dependencyRule(runtime: RuntimeName, dependency: DependencyName): DependencyRule | undefined {
  return DEPENDENCY_MATRIX[runtime][dependency];
}

/**
 * Rolls dependency reports into one runtime status.
 *
 * The rules, in order, and each of them is a decision rather than a default:
 *
 *   a CRITICAL dependency that is not HEALTHY   -> UNREADY
 *     including UNKNOWN. "We could not tell" is not "fine".
 *   any DEGRADED_ALLOWED dependency not HEALTHY -> DEGRADED, still ready
 *   OPTIONAL or DEFERRED                        -> ignored entirely
 *   otherwise                                   -> HEALTHY
 */
export function rollUp(runtime: RuntimeName, reports: readonly DependencyReport[]): {
  status: HealthStatus;
  reasons: HealthReason[];
} {
  const reasons = new Set<HealthReason>();
  let degraded = false;
  let unready = false;

  for (const report of reports) {
    if (report.criticality === "OPTIONAL" || report.criticality === "DEFERRED") continue;
    if (report.status === "HEALTHY") continue;

    reasons.add(report.reason);
    if (report.criticality === "CRITICAL") unready = true;
    else degraded = true;
  }

  const status: HealthStatus = unready ? "UNREADY" : degraded ? "DEGRADED" : "HEALTHY";
  return { status, reasons: [...reasons].sort() };
}
