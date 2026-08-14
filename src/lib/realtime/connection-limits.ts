import "server-only";
import { createHash } from "node:crypto";
import type { EffectiveTenant } from "./tenant-binding";

/**
 * Connection-limit configuration and scope derivation (Phase 11-D).
 *
 * Roadmap 11.11: "Connection limiti olmayan SSE ayrı bir DoS yüzeyidir.
 * Kullanıcı/workspace/IP başına eşzamanlı connection tavanı, idle eviction ve
 * edge seviyesinde bağlantı sayacı uygulanır."
 *
 * An SSE connection is not a request that ends — it is a socket, a Redis
 * reader and a function invocation held open. Without a ceiling, one signed-in
 * account can exhaust the gateway by opening tabs, and no rate limiter that
 * counts REQUESTS will notice, because there is only ever one request per
 * connection.
 */

/**
 * The ceilings, in one place.
 *
 * Values are conservative and reasoned, not copied from anywhere — the
 * roadmap names the dimensions and leaves the numbers to implementation.
 *
 *   USER_MAX 4        a person legitimately works in a few tabs. Four covers
 *                     a workspace tab, a preview tab, a second monitor and
 *                     one stale tab the browser has not yet reaped, and
 *                     nothing beyond that is a usage pattern worth serving.
 *   WORKSPACE_MAX 24  a team's shared ceiling. Inert today — see the note on
 *                     `scopesFor` — and sized so it never binds before
 *                     USER_MAX does for a single person.
 *   IP_MAX 12         one household or office NAT may hold several accounts.
 *                     Higher than USER_MAX so a shared address does not
 *                     penalise legitimate co-located users, low enough that
 *                     one host cannot open hundreds.
 *
 * LEASE_TTL_MS must exceed the refresh interval by a comfortable margin and
 * stay well under the connection's own max age, so a dead function's slot is
 * reclaimed long before the connection would have ended anyway.
 */
export const CONNECTION_LIMITS = {
  USER_MAX: 4,
  WORKSPACE_MAX: 24,
  IP_MAX: 12,
} as const;

export const LEASE_TTL_MS = 30_000;
export const LEASE_REFRESH_MS = 10_000;

export type ScopeKind = "user" | "workspace" | "ip";

export interface LimitScope {
  kind: ScopeKind;
  /** The Redis key. Derived server-side; never contains a raw client value. */
  key: string;
  limit: number;
}

const KEY_PREFIX = "cinefield:sse:conn:v1";

/**
 * Which ceilings this connection is counted against.
 *
 * THE WORKSPACE SCOPE IS ABSENT, NOT FORGOTTEN. `workspaceId` is null while
 * the concept does not exist (see tenant-binding.ts). Emitting a workspace
 * scope keyed by the user id would create a second counter measuring exactly
 * what the user counter already measures, and a test asserting it "works"
 * would be asserting nothing. The scope machinery is generic, so the day a
 * workspace id exists this returns a third scope and every limit below
 * applies to it unchanged.
 *
 * The IP scope is absent when the platform did not give us a trustworthy
 * address — see `trustedClientIp`. A missing IP must not become a shared
 * bucket that every unknown client contends for.
 */
export function scopesFor(tenant: EffectiveTenant, ipHash: string | null): LimitScope[] {
  const scopes: LimitScope[] = [
    { kind: "user", key: `${KEY_PREFIX}:user:${tenant.tenantId}`, limit: CONNECTION_LIMITS.USER_MAX },
  ];

  if (tenant.workspaceId) {
    scopes.push({
      kind: "workspace",
      key: `${KEY_PREFIX}:ws:${tenant.workspaceId}`,
      limit: CONNECTION_LIMITS.WORKSPACE_MAX,
    });
  }

  if (ipHash) {
    scopes.push({ kind: "ip", key: `${KEY_PREFIX}:ip:${ipHash}`, limit: CONNECTION_LIMITS.IP_MAX });
  }

  return scopes;
}

/**
 * The client address, from a source the platform controls.
 *
 * `x-forwarded-for` IS CLIENT-WRITABLE. A browser can send its own, and a
 * proxy appends rather than replaces — so the FIRST entry is whatever the
 * client claimed and trusting it hands anyone an unlimited supply of IP
 * buckets, which defeats the limit entirely.
 *
 * Preference order, most trustworthy first:
 *   x-vercel-forwarded-for  set by Vercel's edge, overwritten on every
 *                           request, not forgeable from outside.
 *   x-real-ip               set by the platform proxy.
 *   x-forwarded-for LAST    the hop nearest to us is the one our own
 *                           infrastructure appended; earlier entries are
 *                           upstream claims. Never the first.
 *
 * Returns null when none is present — locally, and in any environment we
 * cannot vouch for. Null means the IP ceiling does not apply to that
 * connection rather than that everyone shares one bucket.
 */
export function trustedClientIp(headers: Headers): string | null {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return normalizeIp(firstOf(vercel));

  const real = headers.get("x-real-ip");
  if (real) return normalizeIp(real);

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    // The closest hop, never the client's own claim.
    const nearest = hops[hops.length - 1];
    if (nearest) return normalizeIp(nearest);
  }

  return null;
}

function firstOf(value: string): string {
  return value.split(",")[0]?.trim() ?? value.trim();
}

/**
 * Normalizes so one address cannot occupy several buckets.
 *
 * IPv6 is lowercased and stripped of a zone id and a bracketed port; an
 * IPv4-mapped IPv6 address collapses to its IPv4 form, because `::ffff:1.2.3.4`
 * and `1.2.3.4` are the same host and must share one counter.
 */
export function normalizeIp(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > 60) return null;

  // [2001:db8::1]:443 -> 2001:db8::1
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];

  // Zone index: fe80::1%eth0
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);

  // IPv4-mapped IPv6.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) value = mapped[1];

  // Trailing port on a bare IPv4: 1.2.3.4:5678
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (v4WithPort) value = v4WithPort[1];

  return /^[0-9a-f:.]{3,45}$/.test(value) ? value : null;
}

/**
 * A stable bucket key for an address.
 *
 * The counter needs to tell addresses apart; it does not need to know them.
 * Hashing means the full address is never written into a Redis key, never
 * appears in a log line, and never leaves this process. It is a bucketing
 * key, NOT anonymisation — an IPv4 space is small enough to enumerate — so
 * the real protection is that the address is not stored or logged anywhere in
 * the first place.
 */
export function ipBucket(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip, "utf8").digest("hex").slice(0, 20);
}

/**
 * What a rejected connection is told.
 *
 * A product-safe reason and nothing else. No count, no limit value, no scope
 * key, no other tenant's usage, no user id — a client learning that the IP
 * ceiling rather than the user ceiling was hit learns something about the
 * other people behind its NAT.
 *
 * `retryAfterSeconds` is the one useful fact, and it exists so the browser
 * backs off instead of reconnecting into the same refusal every 500 ms.
 */
export const CONNECTION_LIMIT_STATUS = 429;
export const CONNECTION_LIMIT_RETRY_SECONDS = 30;
