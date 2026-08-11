import "server-only";
import { getRedisClient } from "./redis-client";
import { pricingCacheKey, REDIS_KEY_TTL_SECONDS } from "./redis-keys";
import type { PricingRecord, ProviderBillingUnit, PricingSourceType } from "@/lib/pricing/pricing-types";

/**
 * Cinefield pricing cache (Phase 6R.7).
 *
 * PURE CACHE — NEVER SOURCE OF TRUTH
 * `supabase/migrations/20260812000000_model_pricing.sql` (read through
 * `src/lib/pricing/pricing-repository.ts`) is, and remains, the sole
 * authoritative pricing source. This module never computes, derives, or
 * guesses a price — it only lets a future caller store an ALREADY-RESOLVED
 * `PricingRecord` it obtained from that authoritative source, and read it
 * back faster than a database round trip. A cache miss or a total Redis
 * outage must never be answered with a fabricated price; the caller must
 * fall back to `getActivePricing()` (pricing-repository.ts) or refuse the
 * request — that decision belongs entirely to that future caller, not here.
 *
 * NO PRODUCTION PRICES EXIST YET
 * As of this phase, `model_pricing` contains ONLY the four seeded mock
 * rows (0 cost, 0 credits — a verified fact, not a guess) — zero real
 * fal.ai/Cloudflare prices have been entered. This module is cache
 * plumbing only; it cannot and does not populate real numbers.
 *
 * VALUE CONTRACT
 * Reuses `PricingRecord` from `src/lib/pricing/pricing-types.ts` exactly —
 * no parallel/competing pricing shape is invented here. `schemaVersion` is
 * carried alongside it so a future incompatible shape change is a safe
 * cache miss, never a corrupted read.
 *
 * ATOMICITY
 * `SET key value EX ttlSeconds` is a single Redis command — inherently
 * atomic, no Lua script needed for a plain cache write.
 *
 * FAILURE SEMANTICS
 * Redis disabled/unconfigured/failing returns an explicit `unavailable`
 * outcome, distinct from `hit`/`miss`. This module never decides whether a
 * future caller should fail the request or fall back to the database on a
 * miss/unavailable result — that is Router/pricing-engine policy, not
 * cache-layer policy.
 */

const SCHEMA_VERSION = 1;
/** Technical ceiling for a small pricing-record JSON blob, not a business limit. */
const MAX_PAYLOAD_BYTES = 8_192;

const KNOWN_BILLING_UNITS: ReadonlySet<string> = new Set<ProviderBillingUnit>(["per_output", "per_request"]);
const KNOWN_SOURCE_TYPES: ReadonlySet<string> = new Set<PricingSourceType>([
  "official_docs",
  "invoice",
  "manual_verification",
  "other",
]);

interface CachedPricingEnvelope {
  schemaVersion: typeof SCHEMA_VERSION;
  record: PricingRecord;
  cachedAt: string;
}

export type PricingCacheReadOutcome =
  | { outcome: "hit"; record: PricingRecord; cachedAt: string }
  | { outcome: "miss" }
  | { outcome: "unavailable" };

export type PricingCacheWriteOutcome =
  | { outcome: "stored" }
  | { outcome: "unavailable" }
  | { outcome: "rejected"; reason: "payload_too_large" };

export type PricingCacheInvalidateOutcome = { outcome: "invalidated" } | { outcome: "unavailable" };

/**
 * The narrow surface this store needs from Redis, kept independent of
 * ioredis's shapes so a zero-cost test can supply an in-memory fake with no
 * mocking framework.
 */
export interface PricingCacheRedisClient {
  get(key: string): Promise<string | null>;
  /** `SET key value EX ttlSeconds`. */
  setEx(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Exact-key delete only — never a pattern/wildcard. */
  del(key: string): Promise<void>;
}

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:pricing-cache]", JSON.stringify(fields));
}

function isValidPricingRecord(value: unknown): value is PricingRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.platformModelId === "string" &&
    typeof r.provider === "string" &&
    typeof r.providerModelId === "string" &&
    typeof r.pricingVersion === "number" &&
    typeof r.providerBillingUnit === "string" &&
    KNOWN_BILLING_UNITS.has(r.providerBillingUnit) &&
    typeof r.providerUnitCost === "number" &&
    Number.isFinite(r.providerUnitCost) &&
    r.providerUnitCost >= 0 &&
    typeof r.providerCurrency === "string" &&
    typeof r.creditPricePerUnit === "number" &&
    Number.isFinite(r.creditPricePerUnit) &&
    r.creditPricePerUnit >= 0 &&
    typeof r.sourceType === "string" &&
    KNOWN_SOURCE_TYPES.has(r.sourceType) &&
    typeof r.sourceReference === "string" &&
    typeof r.verifiedAt === "string" &&
    typeof r.effectiveFrom === "string"
  );
}

function parseEnvelope(raw: string): CachedPricingEnvelope | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof candidate !== "object" || candidate === null) return null;
  const record = candidate as Record<string, unknown>;

  if (record.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof record.cachedAt !== "string") return null;
  if (!isValidPricingRecord(record.record)) return null;

  return { schemaVersion: SCHEMA_VERSION, record: record.record, cachedAt: record.cachedAt };
}

function wrapRealClient(): PricingCacheRedisClient | null {
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

function resolveClient(override?: PricingCacheRedisClient | null): PricingCacheRedisClient | null {
  if (override !== undefined) return override;
  return wrapRealClient();
}

/** Reads a cached pricing record. `miss` covers absent, expired, and malformed/unrecognized-schema values alike. */
export async function getCachedPricing(
  platformModelId: string,
  testClientOverride?: PricingCacheRedisClient | null
): Promise<PricingCacheReadOutcome> {
  const key = pricingCacheKey(platformModelId);

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    const raw = await client.get(key);
    if (raw === null) return { outcome: "miss" };
    const envelope = parseEnvelope(raw);
    if (!envelope) return { outcome: "miss" };
    return { outcome: "hit", record: envelope.record, cachedAt: envelope.cachedAt };
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
 * Caches an already-authoritative `PricingRecord` (obtained by the caller
 * from `pricing-repository.ts`, never computed here) with the centralized
 * pricing-cache TTL. Rejects a payload beyond the technical size ceiling.
 */
export async function setCachedPricing(
  platformModelId: string,
  record: PricingRecord,
  testClientOverride?: PricingCacheRedisClient | null
): Promise<PricingCacheWriteOutcome> {
  const key = pricingCacheKey(platformModelId);

  const envelope: CachedPricingEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    record,
    cachedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    return { outcome: "rejected", reason: "payload_too_large" };
  }

  const client = resolveClient(testClientOverride);
  if (!client) return { outcome: "unavailable" };

  try {
    await client.setEx(key, serialized, REDIS_KEY_TTL_SECONDS["pricing-cache"]);
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
export async function invalidateCachedPricing(
  platformModelId: string,
  testClientOverride?: PricingCacheRedisClient | null
): Promise<PricingCacheInvalidateOutcome> {
  const key = pricingCacheKey(platformModelId);

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
