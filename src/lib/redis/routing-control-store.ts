import { getRedisClient } from "./redis-client";
import { routingControlKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import { createFieldLogger } from "@/lib/observability/logger";
import {
  controlKeyFor,
  emptySnapshot,
  type ControlReason,
  type FlagTarget,
  type RuntimeControl,
  type RuntimeControlSnapshot,
  type RuntimeFlagSource,
} from "@/lib/routing/runtime-flags";

/**
 * Runtime routing controls in Redis A (Phase 7-E).
 *
 * WHY REDIS AND NOT A FLAG SaaS. No OpenFeature or LaunchDarkly package is
 * installed in this repository and no credentials exist, so the choice was
 * between a real mechanism an operator can actually use today and a fake
 * provider that returns whatever the tests want. Redis A is already the
 * platform's ephemeral operational state, already server-only, already has a
 * versioned keyspace with TTLs, and is already how the circuit breaker works.
 * `RuntimeFlagSource` is an interface precisely so a real SDK can be attached
 * later without the router changing.
 *
 * REDIS B IS NOT INVOLVED.
 *
 * THE AVAILABILITY POLICY, STATED PLAINLY
 * When Redis cannot be read, this returns `source: "unavailable"` with NO
 * controls, and the durable PostgreSQL configuration governs alone. That is a
 * deliberate choice with a real trade-off, so both sides are worth writing
 * down:
 *
 *   Failing OPEN here means an emergency kill set two minutes ago stops being
 *   enforced while Redis is down. That is a genuine gap.
 *
 *   Failing CLOSED — treating an unreachable Redis as "everything is killed" —
 *   would take the ENTIRE generation platform offline every time an optional
 *   cache blipped. A routing override layer must never be able to cause a
 *   larger outage than the thing it protects against.
 *
 * The gap is bounded by design rather than tolerated: an emergency kill is the
 * FAST path, and the durable path is an operator disabling the route, provider
 * model or provider in PostgreSQL through the admin route service. That write
 * survives a Redis outage because eligibility reads it from the database on
 * every routing decision. Anything that must hold while Redis is down belongs
 * in PostgreSQL, and the documentation says so.
 */

export interface RoutingControlRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * Phase 13-E: delegates to the Sensitive Data Guard.
 *
 * The call sites below are unchanged — the difference is that every field
 * now passes the telemetry allow-list before it reaches console or any
 * future sink. An unknown or unsafe field is dropped, not printed.
 */
const emit = createFieldLogger("routing-control");

function log(fields: Record<string, unknown>): void {
  emit(fields);
}

let testClient: RoutingControlRedisClient | null | undefined;

/** Test seam, mirroring the other Redis A stores. */
export function __setRoutingControlClientForTesting(
  client: RoutingControlRedisClient | null
): void {
  testClient = client;
}

function resolveClient(
  override?: RoutingControlRedisClient | null
): RoutingControlRedisClient | null {
  if (override !== undefined) return override;
  if (testClient !== undefined) return testClient;
  return (getRedisClient() as RoutingControlRedisClient | null) ?? null;
}

const REASONS: ReadonlySet<string> = new Set<ControlReason>(["disabled", "emergency_kill"]);

/**
 * Defensive parse.
 *
 * Malformed data is treated as ABSENT, so a corrupt write cannot silently take
 * a route out of rotation with no operator behind it. Note the direction is
 * opposite to a security control: this is availability state, and the failure
 * mode worth preventing is an unexplained outage.
 */
export function parseRuntimeControl(raw: string): RuntimeControl | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;

  const value = candidate as Record<string, unknown>;
  if (typeof value.kind !== "string" || typeof value.targetId !== "string") return null;
  if (typeof value.reason !== "string" || !REASONS.has(value.reason)) return null;
  if (typeof value.setAt !== "string") return null;

  return {
    kind: value.kind as RuntimeControl["kind"],
    targetId: value.targetId,
    reason: value.reason as ControlReason,
    setAt: value.setAt,
    note: typeof value.note === "string" ? value.note.slice(0, 200) : undefined,
  };
}

/**
 * Sets a control.
 *
 * TTL-bounded, deliberately. An emergency kill that outlives the incident is
 * a silent capacity loss nobody remembers to undo; expiry forces a decision to
 * be re-made or moved into PostgreSQL where it belongs permanently.
 */
export async function setRoutingControl(
  control: RuntimeControl,
  ttlSeconds: number = REDIS_KEY_TTL_SECONDS["routing-control"],
  override?: RoutingControlRedisClient | null
): Promise<boolean> {
  const key = routingControlKey(control.kind, control.targetId);
  const client = resolveClient(override);
  if (!client) return false;

  try {
    await client.set(key, JSON.stringify(control), "EX", ttlSeconds);
    log({ kind: control.kind, targetId: control.targetId, reason: control.reason, op: "set" });
    return true;
  } catch (caught) {
    log({
      kind: control.kind,
      targetId: control.targetId,
      op: "set",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return false;
  }
}

export async function clearRoutingControl(
  kind: RuntimeControl["kind"],
  targetId: string,
  override?: RoutingControlRedisClient | null
): Promise<boolean> {
  const client = resolveClient(override);
  if (!client) return false;
  try {
    await client.del(routingControlKey(kind, targetId));
    log({ kind, targetId, op: "clear" });
    return true;
  } catch {
    return false;
  }
}

/**
 * The Redis-backed runtime flag source.
 *
 * Reads only the targets the router asked about — never a KEYS or SCAN sweep,
 * which the keyspace contract forbids and which would turn an O(1) lookup on
 * the request path into an O(n) scan.
 */
export const redisRuntimeFlagSource: RuntimeFlagSource = {
  async read(targets: readonly FlagTarget[]): Promise<RuntimeControlSnapshot> {
    if (targets.length === 0) return emptySnapshot("database_baseline");

    const client = resolveClient();
    if (!client) return emptySnapshot("database_baseline");

    const controls = new Map<string, RuntimeControl>();
    let reachable = true;

    await Promise.all(
      targets.map(async (target) => {
        try {
          const raw = await client.get(routingControlKey(target.kind, target.id));
          if (raw === null) return;
          const control = parseRuntimeControl(raw);
          if (control) controls.set(controlKeyFor(target.kind, target.id), control);
        } catch {
          reachable = false;
        }
      })
    );

    if (!reachable) {
      log({ op: "read", result: "unavailable", targets: targets.length });
      // Whatever WAS read is discarded: a partial view is worse than a known
      // absence, because it looks authoritative while missing controls.
      return emptySnapshot("unavailable");
    }

    return { controls, source: controls.size > 0 ? "runtime_flag" : "database_baseline" };
  },
};

/**
 * The source this deployment uses.
 *
 * Redis when it is configured, the no-op baseline otherwise. Resolved per call
 * rather than at import so a test can install a client without reloading the
 * module graph.
 */
export function resolveRuntimeFlagSource(): RuntimeFlagSource {
  return resolveClient() ? redisRuntimeFlagSource : { async read() { return emptySnapshot("database_baseline"); } };
}
