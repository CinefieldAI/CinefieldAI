import "server-only";
import {
  PROBE_TIMEOUT_MS,
  bucketLatency,
  dependencyRule,
  type DependencyName,
  type DependencyReport,
  type HealthReason,
  type HealthStatus,
  type RuntimeName,
} from "./health-contract";
import { configurationHealth } from "@/lib/config/startup-validation";
import { isSupabaseAdminConfigured, getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import { getRedisClient } from "@/lib/redis/redis-client";
import { isRedisConfigured, isRedisEnabled } from "@/lib/redis/redis-config";
import { isBullmqRedisEnabled } from "@/lib/bullmq/bullmq-config";
import { isTemporalConfigured } from "@/lib/temporal/config";
import { isSqsCommandBusEnabled, describeSqsConfig } from "@/lib/aws/sqs-config";
import { isR2Configured } from "@/lib/media/r2-config";
import { isDrConfigured } from "@/lib/media/dr-config";
import { isKafkaEnabled } from "@/lib/kafka/kafka-config";

/**
 * Dependency probes (Phase 13 health foundation).
 *
 * ---------------------------------------------------------------------------
 * EVERY PROBE IS CHEAP, BOUNDED, AND CHANGES NOTHING
 * ---------------------------------------------------------------------------
 * A health check is called repeatedly, by an orchestrator and later by an
 * external monitor, forever. So no probe here starts a workflow, enqueues a
 * command, calls a provider, writes a user object or spends anything. Several
 * do not perform I/O at all: for an activation-flagged subsystem, "is it
 * configured and enabled" is the whole truth, and opening a connection to
 * prove it would cost more than it tells.
 *
 * ---------------------------------------------------------------------------
 * UNKNOWN IS NOT HEALTHY
 * ---------------------------------------------------------------------------
 * A probe that cannot answer says UNKNOWN, and the roll-up treats UNKNOWN on a
 * critical dependency as UNREADY. Reporting "we could not reach it" as green
 * is precisely how a health check stays green through an outage.
 *
 * ---------------------------------------------------------------------------
 * NOTHING LEAVES BUT A CODE
 * ---------------------------------------------------------------------------
 * A `DependencyReport` has no field that can hold a host, a URL, a driver
 * message or an error. Health output is broadcast to whoever can reach the
 * probe, so the shape is the enforcement.
 */

/** Wraps a probe in its budget. A hung dependency must never hang the check. */
async function withTimeout<T>(
  dependency: DependencyName,
  run: (signal: AbortSignal) => Promise<T>
): Promise<{ value?: T; timedOut: boolean; elapsedMs: number }> {
  const budget = PROBE_TIMEOUT_MS[dependency];
  const controller = new AbortController();
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;

  try {
    const value = await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("probe_timeout"));
        }, budget);
      }),
    ]);
    return { value, timedOut: false, elapsedMs: performance.now() - started };
  } catch {
    // Class only, and not even that: a probe failure is a code, never a
    // message. The caller decides between `timeout` and `unreachable`.
    return { timedOut: true, elapsedMs: performance.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function report(
  runtime: RuntimeName,
  dependency: DependencyName,
  status: HealthStatus,
  reason: HealthReason,
  elapsedMs?: number
): DependencyReport {
  const rule = dependencyRule(runtime, dependency);
  return {
    dependency,
    status,
    reason,
    criticality: rule?.criticality ?? "OPTIONAL",
    ...(elapsedMs === undefined
      ? {}
      : { latency: bucketLatency(elapsedMs, PROBE_TIMEOUT_MS[dependency]) }),
  };
}

/* -------------------------------------------------------------------------- */
/* config — reuses Phase 12-D, never a second validator                       */
/* -------------------------------------------------------------------------- */

export function probeConfig(runtime: RuntimeName): DependencyReport {
  // `configurationHealth()` already exists and is presence-only. Building a
  // second validator here would create two answers to one question, and the
  // first production disagreement between them would be unresolvable.
  const health = configurationHealth();
  return health.configuration === "valid"
    ? report(runtime, "config", "HEALTHY", "ok")
    : report(runtime, "config", "UNREADY", "config_invalid");
}

/* -------------------------------------------------------------------------- */
/* Supabase                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The lightest query that proves the connection AND the credential.
 *
 * `realtime_outbox_debt()` is an existing aggregate over an indexed column,
 * granted to service_role only. It reads no user row, scans no table and
 * returns counts — so a probe that succeeds proves the network path, the key
 * and RPC execution in one call, without touching anyone's data.
 */
export async function probeSupabase(runtime: RuntimeName): Promise<DependencyReport> {
  if (!isSupabaseAdminConfigured()) {
    return report(runtime, "supabase", "UNKNOWN", "not_configured");
  }
  const { value, timedOut, elapsedMs } = await withTimeout("supabase", async () => {
    const admin = getSupabaseAdminClient();
    const { error } = await admin.rpc("realtime_outbox_debt");
    return !error;
  });

  if (timedOut) return report(runtime, "supabase", "UNKNOWN", "timeout", elapsedMs);
  return value
    ? report(runtime, "supabase", "HEALTHY", "ok", elapsedMs)
    : report(runtime, "supabase", "UNREADY", "invalid_response", elapsedMs);
}

/* -------------------------------------------------------------------------- */
/* Redis A                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Connectivity plus the eviction policy.
 *
 * `PING` proves the socket and the credential and writes nothing. The policy
 * read is the interesting half: Redis A still runs `volatile-lru`, and an
 * eviction there silently drops a rate-limit counter, a connection lease or an
 * idempotency record — a correctness failure that surfaces as an unrelated
 * bug. `noeviction` is a deferred operator action, so this REPORTS the risk
 * rather than hiding it, and never changes the setting.
 */
export async function probeRedisA(runtime: RuntimeName): Promise<DependencyReport> {
  if (!isRedisEnabled() || !isRedisConfigured()) {
    return report(runtime, "redis-a", "UNKNOWN", "not_configured");
  }
  const { value, timedOut, elapsedMs } = await withTimeout("redis-a", async () => {
    const redis = getRedisClient();
    if (!redis) return { alive: false, policy: undefined as string | undefined };
    await redis.ping();
    let policy: string | undefined;
    try {
      const raw = (await redis.config("GET", "maxmemory-policy")) as unknown;
      if (Array.isArray(raw) && typeof raw[1] === "string") policy = raw[1];
    } catch {
      // Managed Redis often forbids CONFIG GET. Not knowing the policy is not
      // a fault — it is simply unobservable from here.
      policy = undefined;
    }
    return { alive: true, policy };
  });

  if (timedOut) return report(runtime, "redis-a", "UNKNOWN", "timeout", elapsedMs);
  if (!value?.alive) return report(runtime, "redis-a", "UNREADY", "unreachable", elapsedMs);

  if (value.policy !== undefined && value.policy !== "noeviction") {
    // DEGRADED, not UNREADY: eviction is a durability risk, not an outage, and
    // refusing to serve because of it would be a self-inflicted incident.
    return report(runtime, "redis-a", "DEGRADED", "eviction_policy_unsafe", elapsedMs);
  }
  return report(runtime, "redis-a", "HEALTHY", "ok", elapsedMs);
}

/* -------------------------------------------------------------------------- */
/* Deferred and flag-gated subsystems — no I/O                                */
/* -------------------------------------------------------------------------- */

export function probeRedisB(runtime: RuntimeName): DependencyReport {
  // Redis B is not provisioned. Opening a connection to confirm what the flag
  // already states would be a network call to prove a known fact.
  return isBullmqRedisEnabled()
    ? report(runtime, "redis-b", "UNKNOWN", "not_configured")
    : report(runtime, "redis-b", "UNKNOWN", "deferred");
}

export function probeKafka(runtime: RuntimeName): DependencyReport {
  return isKafkaEnabled()
    ? report(runtime, "kafka", "UNKNOWN", "not_configured")
    : report(runtime, "kafka", "UNKNOWN", "deferred");
}

/* -------------------------------------------------------------------------- */
/* Temporal                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Configuration presence only — deliberately.
 *
 * Two things must not be confused: whether the Temporal SERVICE is reachable,
 * and whether a worker is polling. This answers neither by connecting,
 * because the honest options for doing so are both wrong here: starting a
 * workflow to prove reachability would create real work, and a describe call
 * needs the SDK's native connection, which the web tier deliberately does not
 * carry (it is why the worker lives outside `src/`).
 *
 * So this reports configuration, and the WORKER answers the polling question
 * for itself — it is the process that is actually connected. Overstating this
 * as a reachability check would be the more damaging error.
 */
export function probeTemporal(runtime: RuntimeName): DependencyReport {
  return isTemporalConfigured()
    ? report(runtime, "temporal", "HEALTHY", "ok")
    : report(runtime, "temporal", "UNKNOWN", "not_configured");
}

/* -------------------------------------------------------------------------- */
/* SQS                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Configuration only — it must never enqueue.
 *
 * A message sent to prove connectivity is a real command on a real queue that
 * a real worker will consume. `describeSqsConfig()` already reports presence
 * as booleans, which is the whole safe answer.
 */
export function probeSqs(runtime: RuntimeName): DependencyReport {
  if (!isSqsCommandBusEnabled()) return report(runtime, "sqs", "UNKNOWN", "disabled");
  const described = describeSqsConfig();
  const configured = Boolean(described && Object.values(described).every((v) => v !== false));
  return configured
    ? report(runtime, "sqs", "HEALTHY", "ok")
    : report(runtime, "sqs", "UNKNOWN", "not_configured");
}

/* -------------------------------------------------------------------------- */
/* R2 / DR S3                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Configuration only, for both buckets.
 *
 * A HEAD against a bucket would be a better signal, and it is deliberately not
 * done here: it costs a request on every probe, and the failure it would catch
 * — a revoked credential — is caught by the first real upload anyway, loudly.
 * No probe writes an object, and none touches the DR bucket, which holds
 * customer backups and has no DeleteObject grant by design.
 */
export function probeR2(runtime: RuntimeName): DependencyReport {
  return isR2Configured()
    ? report(runtime, "r2", "HEALTHY", "ok")
    : report(runtime, "r2", "UNKNOWN", "not_configured");
}

export function probeDrS3(runtime: RuntimeName): DependencyReport {
  return isDrConfigured()
    ? report(runtime, "s3-dr", "HEALTHY", "ok")
    : report(runtime, "s3-dr", "UNKNOWN", "not_configured");
}

/* -------------------------------------------------------------------------- */
/* Clerk                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Key presence, not a network call.
 *
 * Calling Clerk to prove Clerk works would make our readiness depend on their
 * rate limit, on every probe, forever. The failure that matters — a missing or
 * wrong-instance key — is a configuration fault, and 12-D's validator already
 * catches the wrong-instance half.
 */
export function probeClerk(runtime: RuntimeName): DependencyReport {
  const secret = process.env.CLERK_SECRET_KEY;
  const publishable = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const present = typeof secret === "string" && secret.length > 0 && typeof publishable === "string" && publishable.length > 0;
  return present
    ? report(runtime, "clerk", "HEALTHY", "ok")
    : report(runtime, "clerk", "UNKNOWN", "not_configured");
}

/* -------------------------------------------------------------------------- */
/* Providers — from Redis A state, NEVER from a provider call                  */
/* -------------------------------------------------------------------------- */

/**
 * Reads the health signal Phase 7/8 already maintain.
 *
 * Roadmap ¶1423: each adapter normalizes provider responses into a
 * health/error/latency signal in Redis A, and ¶1325 keeps the routing decision
 * in Phase 7. So provider health is ALREADY a stored fact, and a probe's job
 * is to read it — never to call a provider, which would cost money on a health
 * check that runs forever.
 *
 * With no stored signal the answer is UNKNOWN, not healthy. It is
 * DEGRADED_ALLOWED everywhere, so UNKNOWN never blocks a runtime; it just
 * never lies either.
 */
export async function probeProviders(runtime: RuntimeName): Promise<DependencyReport> {
  if (!isRedisEnabled() || !isRedisConfigured()) {
    return report(runtime, "providers", "UNKNOWN", "not_configured");
  }
  const { value, timedOut, elapsedMs } = await withTimeout("providers", async () => {
    const redis = getRedisClient();
    if (!redis) return null;

    // SCAN, one bounded batch — NEVER `KEYS`.
    //
    // The first version used `KEYS cinefield:v1:provider-health:*`. It
    // returned in 22ms against a nearly empty keyspace, which is exactly how
    // that mistake survives review: `KEYS` is O(N) over the ENTIRE keyspace
    // and blocks the Redis event loop while it runs. On a production instance
    // holding rate-limit counters, idempotency records and connection leases
    // that is a stall for every other caller — and a health probe runs
    // forever, on a schedule, by design.
    //
    // One SCAN iteration with a small COUNT is bounded work and cannot block.
    // It answers the only question being asked: does ANY provider health
    // signal exist? Whether the first batch happens to be empty while a later
    // one is not is immaterial — the answer is already DEGRADED_ALLOWED
    // everywhere, so a false UNKNOWN costs nothing and never blocks a runtime.
    const [, keys] = await redis.scan(0, "MATCH", "cinefield:v1:provider-health:*", "COUNT", 25);
    return Array.isArray(keys) ? keys.length : 0;
  });

  if (timedOut) return report(runtime, "providers", "UNKNOWN", "timeout", elapsedMs);
  if (value === null || value === undefined) {
    return report(runtime, "providers", "UNKNOWN", "not_configured", elapsedMs);
  }
  return value > 0
    ? report(runtime, "providers", "HEALTHY", "ok", elapsedMs)
    : report(runtime, "providers", "UNKNOWN", "degraded_upstream", elapsedMs);
}

/* -------------------------------------------------------------------------- */
/* Realtime outbox debt                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Backlog thresholds, defined centrally so a dashboard and an alert cannot
 * disagree about what "behind" means.
 *
 * These are the dispatcher's own numbers: a batch is 100 rows and an idle pass
 * sleeps 750ms, so a healthy system drains far faster than these bounds. They
 * describe a backlog worth looking at, not one that is already an incident.
 */
export const DEBT_THRESHOLDS = {
  pendingWarn: 500,
  oldestPendingSecondsWarn: 300,
  attemptsWarn: 5,
} as const;

export async function probeRealtimeDebt(runtime: RuntimeName): Promise<DependencyReport> {
  if (!isSupabaseAdminConfigured()) {
    return report(runtime, "realtime-debt", "UNKNOWN", "not_configured");
  }
  const { value, timedOut, elapsedMs } = await withTimeout("realtime-debt", async () => {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.rpc("realtime_outbox_debt");
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as Record<string, number>;
    return {
      pending: Number(row.pending ?? 0),
      oldest: Number(row.oldest_pending_seconds ?? 0),
      attempts: Number(row.max_attempts ?? 0),
    };
  });

  if (timedOut) return report(runtime, "realtime-debt", "UNKNOWN", "timeout", elapsedMs);
  if (!value) return report(runtime, "realtime-debt", "UNKNOWN", "invalid_response", elapsedMs);

  const behind =
    value.pending > DEBT_THRESHOLDS.pendingWarn ||
    value.oldest > DEBT_THRESHOLDS.oldestPendingSecondsWarn ||
    value.attempts > DEBT_THRESHOLDS.attemptsWarn;

  // The COUNTS never leave. A backlog size is operational detail that belongs
  // in a metric, not in a health response that anyone reachable can read.
  return behind
    ? report(runtime, "realtime-debt", "DEGRADED", "backlog", elapsedMs)
    : report(runtime, "realtime-debt", "HEALTHY", "ok", elapsedMs);
}
