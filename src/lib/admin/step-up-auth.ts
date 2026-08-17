/**
 * Phase 16-E — step-up assurance evidence + the elevated-session contract.
 *
 * ---------------------------------------------------------------------------
 * CLERK REMAINS THE IDENTITY AND ASSURANCE AUTHORITY. THIS FILE CONSUMES IT.
 * ---------------------------------------------------------------------------
 * Section 8 of the 16-E spec is explicit: do NOT build a custom MFA
 * authenticator. This module never asks for a password, a TOTP code, or any
 * other credential — the "Prohibited" action category in this session's own
 * operating rules forbids entering credentials on a user's behalf, and this
 * file has no UI and performs no I/O to a credential provider at all. It
 * only INTERPRETS assurance evidence Clerk itself would produce (a recent
 * multi-factor/passkey re-verification, surfaced as a session claim) and
 * refuses to invent evidence that is not there.
 *
 * `resolveAssuranceEvidence` is PURE and Clerk-SDK-free (same reason
 * `admin-auth.ts`'s `decideAdminAccess` is): it takes whatever session-claims
 * shape a caller resolved and returns a verdict. `require-step-up.ts` is the
 * thin, Clerk-importing real caller, mirroring the
 * `admin-auth.ts`/`require-admin-access.ts` split exactly.
 *
 * ---------------------------------------------------------------------------
 * HONEST TODAY: NOT_CONFIGURED, NEVER A FABRICATED VERIFIED
 * ---------------------------------------------------------------------------
 * This repository has no Clerk organization, custom session-token claim, or
 * MFA/passkey configuration anywhere (verified by grep across the codebase;
 * the Phase 16-A closure tests assert the OPPOSITE — that no
 * `sessionClaims`/`publicMetadata`/`privateMetadata` read exists). Standing
 * one up is external Clerk dashboard configuration, which this phase is not
 * permitted to provision (Section 25). So `resolveAssuranceEvidence` reads
 * for a specific, documented claim shape (`cinefieldStepUp`) and — finding it
 * absent from every real session today — honestly returns `NOT_CONFIGURED`
 * every time it is called against a real request. That is not a stub: the
 * seam is real and the code path is exercised by every Tier-0 authorization
 * decision; the day Clerk is configured to emit that claim, this function
 * starts returning `VERIFIED` for a genuinely re-authenticated session with
 * ZERO other code changing.
 *
 * ---------------------------------------------------------------------------
 * THE ELEVATED SESSION: EVIDENCE OF A PAST VERIFICATION, NOT A NEW SESSION
 * ---------------------------------------------------------------------------
 * `ElevatedSessionRecord` is short-TTL (`ELEVATED_SESSION_TTL_SECONDS`),
 * bound to one Clerk actor id, and stored server-side only
 * (`src/lib/redis/admin-elevation-store.ts`) — never a client-settable
 * cookie or query flag ("no client Boolean such as isElevated=true", per
 * Section 7). It can only ever be ISSUED from a `VERIFIED` assurance
 * evidence (`issueElevatedSession` refuses otherwise), so while assurance
 * stays `NOT_CONFIGURED` in this environment, no elevated session can ever
 * be created outside a test that injects evidence directly — which is the
 * fail-closed behaviour Section 7 requires, not a gap in this file.
 */

export type AssuranceState = "VERIFIED" | "NOT_CONFIGURED";

export interface AssuranceEvidence {
  readonly state: AssuranceState;
  /** ISO timestamp of the underlying Clerk re-verification, when VERIFIED. */
  readonly verifiedAt: string | null;
}

const NOT_CONFIGURED: AssuranceEvidence = { state: "NOT_CONFIGURED", verifiedAt: null };

/**
 * The documented claim shape this module looks for. Not a real Clerk
 * feature name — a placeholder this repository's own future Clerk
 * configuration would populate, named so a reviewer can grep for exactly
 * what would need to change externally.
 */
interface CinefieldStepUpClaim {
  verifiedAt?: unknown;
}

function isRecentIso(value: unknown, maxAgeSeconds: number): string | null {
  if (typeof value !== "string") return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  const ageSeconds = (Date.now() - ts) / 1000;
  if (ageSeconds < 0 || ageSeconds > maxAgeSeconds) return null;
  return value;
}

/** How recent a Clerk re-verification must be to still count as fresh assurance. */
export const ASSURANCE_MAX_AGE_SECONDS = 300;

/**
 * Pure decision core. `claims` is whatever `auth().sessionClaims` resolved
 * to in the real caller — never trusted beyond structural shape-checking,
 * exactly like `policy-engine.ts`'s `isPolicyInputShape`.
 */
export function resolveAssuranceEvidence(claims: unknown): AssuranceEvidence {
  if (typeof claims !== "object" || claims === null) return NOT_CONFIGURED;
  const stepUp = (claims as Record<string, unknown>).cinefieldStepUp as CinefieldStepUpClaim | undefined;
  if (!stepUp || typeof stepUp !== "object") return NOT_CONFIGURED;

  const verifiedAt = isRecentIso(stepUp.verifiedAt, ASSURANCE_MAX_AGE_SECONDS);
  if (!verifiedAt) return NOT_CONFIGURED;

  return { state: "VERIFIED", verifiedAt };
}

/* ---------------------------------------------------------------------- */
/* Elevated session record shape (storage-agnostic; Redis-backed in       */
/* src/lib/redis/admin-elevation-store.ts)                                */
/* ---------------------------------------------------------------------- */

export const ELEVATED_SESSION_TTL_SECONDS = 900; // 15 minutes — short, bounded, re-earned per Section 9.

export interface ElevatedSessionRecord {
  readonly clerkUserId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** The assurance evidence this elevation was issued from — for audit, never re-derived. */
  readonly assuranceVerifiedAt: string;
}

/**
 * Builds the record to store. Refuses to build one from anything but
 * `VERIFIED` evidence — the only place in this file that could fabricate an
 * elevation, and it structurally cannot.
 */
export function buildElevatedSession(
  clerkUserId: string,
  evidence: AssuranceEvidence,
  nowMs: number = Date.now(),
  ttlSeconds: number = ELEVATED_SESSION_TTL_SECONDS
): ElevatedSessionRecord | null {
  if (evidence.state !== "VERIFIED" || !evidence.verifiedAt) return null;
  if (typeof clerkUserId !== "string" || clerkUserId.length === 0) return null;

  const issuedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlSeconds * 1000).toISOString();
  return { clerkUserId, issuedAt, expiresAt, assuranceVerifiedAt: evidence.verifiedAt };
}

export type ElevationVerifyReasonCode =
  | "verified"
  | "no_elevation"
  | "expired"
  | "actor_mismatch"
  | "malformed_record";

export interface ElevationVerdict {
  readonly elevated: boolean;
  readonly reasonCode: ElevationVerifyReasonCode;
}

/**
 * Verifies a STORED record against the CURRENT actor and clock. Fails
 * closed on every branch: absent, expired, or bound to a different actor
 * are all `elevated: false` — there is no path here that returns `true`
 * without a fresh, actor-matched, unexpired record.
 */
export function verifyElevatedSession(
  record: ElevatedSessionRecord | null,
  clerkUserId: string,
  nowMs: number = Date.now()
): ElevationVerdict {
  if (!record) return { elevated: false, reasonCode: "no_elevation" };
  if (
    typeof record.clerkUserId !== "string" ||
    typeof record.expiresAt !== "string" ||
    typeof record.issuedAt !== "string"
  ) {
    return { elevated: false, reasonCode: "malformed_record" };
  }
  if (record.clerkUserId !== clerkUserId) return { elevated: false, reasonCode: "actor_mismatch" };

  const expiresAtMs = Date.parse(record.expiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs) return { elevated: false, reasonCode: "expired" };

  return { elevated: true, reasonCode: "verified" };
}
