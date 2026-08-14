import "server-only";
import { getRedisClient } from "./redis-client";
import { modelCacheKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import type { ModelCapabilities } from "@/lib/orchestration/model-registry";
import type { GenerationType } from "@/lib/orchestration/types";
import { createFieldLogger } from "@/lib/observability/logger";

/**
 * Cinefield model metadata cache (Phase 6R.7).
 *
 * PURE CACHE — NEVER SOURCE OF TRUTH
 * `src/lib/orchestration/model-registry.ts` (an in-process `Map`) is, and
 * remains, the sole authoritative source for model metadata. This module
 * only lets a future caller store an already-resolved snapshot of a
 * registry entry's PUBLIC fields — it has no way to look one up itself, no
 * knowledge of the registry, and no fallback logic. A cache miss or a
 * total Redis outage must never be treated as "the model doesn't exist" —
 * that answer only ever comes from `findModel()`.
 *
 * HONEST NOTE ON CURRENT USEFULNESS
 * `model-registry.ts` is an in-memory `Map` today — reading it is already
 * a zero-latency, zero-I/O lookup, so caching it in Redis provides no
 * practical benefit yet. This foundation exists because Phase 7 (per
 * docs/architecture/IMPLEMENTATION_ROADMAP.md's own "Model Registry
 * Unification" note) may give the registry a database-backed counterpart,
 * at which point a cache in front of that lookup becomes genuinely useful.
 * Building the cache shape now, unwired, costs nothing and avoids
 * inventing it under time pressure later.
 *
 * VALUE CONTRACT
 * Only fields that already exist on `ModelRegistryEntry` today — id,
 * providerId, providerModelId, generationType, enabled, and optionally its
 * `capabilities` object. Never a raw provider credential, never user
 * content. `schemaVersion` lets a future incompatible shape change be
 * detected and treated as a safe cache miss instead of corrupting a reader
 * that expects the old shape.
 *
 * ATOMICITY
 * `SET key value EX ttlSeconds` is a single Redis command — inherently
 * atomic, no Lua script needed for a plain cache write (unlike the
 * counter/aggregate stores elsewhere in Phase 6R.7).
 *
 * FAILURE SEMANTICS
 * Redis disabled/unconfigured/failing returns an explicit `unavailable`
 * outcome, distinct from `hit`/`miss` — a future caller decides whether to
 * fall back to the authoritative registry (it always can; this cache is
 * disposable by design).
 */

const SCHEMA_VERSION = 1;
/** Technical ceiling for a small metadata JSON blob, not a business limit. */
const MAX_PAYLOAD_BYTES = 16_384;

export interface CachedModelEntry {
  schemaVersion: typeof SCHEMA_VERSION;
  platformModelId: string;
  provider: string;
  providerModelId: string;
  generationType: GenerationType;
  enabled: boolean;
  capabilities?: ModelCapabilities;
  cachedAt: string;
}

export type ModelCacheReadOutcome =
  | { outcome: "hit"; value: CachedModelEntry }
  | { outcome: "miss" }
  | { outcome: "unavailable" };

export type ModelCacheWriteOutcome =
  | { outcome: "stored" }
  | { outcome: "unavailable" }
  | { outcome: "rejected"; reason: "payload_too_large" };

export type ModelCacheInvalidateOutcome = { outcome: "invalidated" } | { outcome: "unavailable" };

/**
 * The narrow surface this store needs from Redis, kept independent of
 * ioredis's shapes so a zero-cost test can supply an in-memory fake with no
 * mocking framework.
 */
export interface ModelCacheRedisClient {
  get(key: string): Promise<string | null>;
  /** `SET key value EX ttlSeconds`. */
  setEx(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Exact-key delete only — never a pattern/wildcard. */
  del(key: string): Promise<void>;
}

/**
 * Phase 13-E: delegates to the Sensitive Data Guard.
 *
 * The call sites below are unchanged — the difference is that every field
 * now passes the telemetry allow-list before it reaches console or any
 * future sink. An unknown or unsafe field is dropped, not printed.
 */
const emit = createFieldLogger("model-cache");

function log(fields: Record<string, unknown>): void {
  emit(fields);
}

function parseEntry(raw: string): CachedModelEntry | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof candidate !== "object" || candidate === null) return null;
  const record = candidate as Record<string, unknown>;

  // An unrecognized schema version is a safe miss, never a crash and never
  // a best-effort attempt to read a shape this code doesn't know about.
  if (record.schemaVersion !== SCHEMA_VERSION) return null;

  if (
    typeof record.platformModelId !== "string" ||
    typeof record.provider !== "string" ||
    typeof record.providerModelId !== "string" ||
    (record.generationType !== "image" && record.generationType !== "video" && record.generationType !== "audio") ||
    typeof record.enabled !== "boolean" ||
    typeof record.cachedAt !== "string"
  ) {
    return null;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    platformModelId: record.platformModelId,
    provider: record.provider,
    providerModelId: record.providerModelId,
    generationType: record.generationType,
    enabled: record.enabled,
    cachedAt: record.cachedAt,
    ...(record.capabilities !== undefined ? { capabilities: record.capabilities as ModelCapabilities } : {}),
  };
}

function wrapRealClient(): ModelCacheRedisClient | null {
  const client = getRedisClient();
  if (!client) return null;

  return {
    async get(key) {
      return client.get(key);
    },
    async setEx(key, value, ttlSeconds) {
      await client.set(key, value, "EX", ttlSeconds);
    },
    async del(key) {
      await client.del(key);
    },
  };
}

function resolveClient(override?: ModelCacheRedisClient | null): ModelCacheRedisClient | null {
  if (override !== undefined) return override;
  return wrapRealClient();
}

/** Reads a cached model entry. `miss` covers absent, expired, and malformed/unrecognized-schema values alike. */
export async function getCachedModel(
  platformModelId: string,
  testClientOverride?: ModelCacheRedisClient | null
): Promise<ModelCacheReadOutcome> {
  const key = modelCacheKey(platformModelId);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    const raw = await client.get(key);
    if (raw === null) return { outcome: "miss" };
    const value = parseEntry(raw);
    if (!value) return { outcome: "miss" };
    return { outcome: "hit", value };
  } catch (caught) {
    log({
      platformModelId,
      op: "get",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}

/**
 * Caches an already-resolved model entry with the centralized model-cache
 * TTL. Rejects (without touching Redis) a payload beyond the technical size
 * ceiling — a defensive bound, not a product limit.
 */
export async function setCachedModel(
  platformModelId: string,
  entry: Omit<CachedModelEntry, "schemaVersion" | "cachedAt">,
  testClientOverride?: ModelCacheRedisClient | null
): Promise<ModelCacheWriteOutcome> {
  const key = modelCacheKey(platformModelId);

  const full: CachedModelEntry = { schemaVersion: SCHEMA_VERSION, cachedAt: new Date().toISOString(), ...entry };
  const serialized = JSON.stringify(full);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    return { outcome: "rejected", reason: "payload_too_large" };
  }

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    await client.setEx(key, serialized, REDIS_KEY_TTL_SECONDS["model-cache"]);
    return { outcome: "stored" };
  } catch (caught) {
    log({
      platformModelId,
      op: "set",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}

/** Exact-key invalidation only — never a wildcard/pattern delete. */
export async function invalidateCachedModel(
  platformModelId: string,
  testClientOverride?: ModelCacheRedisClient | null
): Promise<ModelCacheInvalidateOutcome> {
  const key = modelCacheKey(platformModelId);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    await client.del(key);
    return { outcome: "invalidated" };
  } catch (caught) {
    log({
      platformModelId,
      op: "del",
      result: "unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { outcome: "unavailable" };
  }
}
