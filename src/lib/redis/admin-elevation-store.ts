import "server-only";
import { getRedisClient } from "./redis-client";
import { REDIS_KEY_VERSION } from "./redis-keys";
import {
  ELEVATED_SESSION_TTL_SECONDS,
  type ElevatedSessionRecord,
} from "@/lib/admin/step-up-auth";

/**
 * Phase 16-E — elevated admin session storage.
 *
 * Redis A (the same generic, ephemeral application store `routing-control-
 * store.ts` uses), never Redis B. Mirrors that file's shape deliberately:
 * a minimal client interface, a test seam, and graceful degrade to "not
 * elevated" rather than a thrown error when Redis is unreachable —
 * unavailable-fail-closed is the CORRECT direction here (unlike routing
 * control's fail-open availability tradeoff), because an unreadable
 * elevation store must never be treated as "elevated".
 *
 * NOT in `redis-keys.ts`'s shared `RedisKeyNamespace` union: that module is
 * the CONTRACT other call sites build keys from directly, and admin
 * elevation has exactly one reader (this file). Keeping the key format here
 * avoids widening a shared contract for a single, narrow caller — the key
 * still carries the same `cinefield:v{N}:` prefix and passes through the
 * same identifier discipline.
 */

const KEY_PREFIX = `cinefield:v${REDIS_KEY_VERSION}:admin-elevation:`;

function elevationKey(clerkUserId: string): string {
  // Clerk user ids are already a safe, bounded, colon-free alphabet
  // (`user_...`); no separate encoder is needed, but length is still bounded
  // defensively.
  const safe = clerkUserId.slice(0, 255);
  return `${KEY_PREFIX}${safe}`;
}

export interface AdminElevationRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

let testClient: AdminElevationRedisClient | null | undefined;

/** Test seam, mirroring every other Redis A store's `__set...ForTesting`. */
export function __setAdminElevationClientForTesting(client: AdminElevationRedisClient | null): void {
  testClient = client;
}

function resolveClient(): AdminElevationRedisClient | null {
  if (testClient !== undefined) return testClient;
  return (getRedisClient() as AdminElevationRedisClient | null) ?? null;
}

function parseRecord(raw: string): ElevatedSessionRecord | null {
  try {
    const candidate = JSON.parse(raw);
    if (
      candidate &&
      typeof candidate === "object" &&
      typeof candidate.clerkUserId === "string" &&
      typeof candidate.issuedAt === "string" &&
      typeof candidate.expiresAt === "string" &&
      typeof candidate.assuranceVerifiedAt === "string"
    ) {
      return candidate as ElevatedSessionRecord;
    }
  } catch {
    // Malformed data is treated as absent, never as elevated.
  }
  return null;
}

/**
 * Stores an elevated-session record. Returns `false` (never throws) when
 * Redis is unavailable — the caller (`tier0-authorization.ts`) already
 * treats "could not issue" the same as "not elevated", so this degrades to
 * the correct fail-closed outcome automatically.
 */
export async function storeElevatedSession(
  record: ElevatedSessionRecord,
  ttlSeconds: number = ELEVATED_SESSION_TTL_SECONDS
): Promise<boolean> {
  const client = resolveClient();
  if (!client) return false;
  try {
    await client.set(elevationKey(record.clerkUserId), JSON.stringify(record), "EX", ttlSeconds);
    return true;
  } catch {
    return false;
  }
}

/** Reads the current elevation record for one actor, or `null` — never throws. */
export async function readElevatedSession(clerkUserId: string): Promise<ElevatedSessionRecord | null> {
  const client = resolveClient();
  if (!client) return null;
  try {
    const raw = await client.get(elevationKey(clerkUserId));
    return raw === null ? null : parseRecord(raw);
  } catch {
    return null;
  }
}

/** Explicit revoke — never required by the TTL alone, but available for an operator to end their own elevation early. */
export async function clearElevatedSession(clerkUserId: string): Promise<boolean> {
  const client = resolveClient();
  if (!client) return false;
  try {
    await client.del(elevationKey(clerkUserId));
    return true;
  } catch {
    return false;
  }
}
