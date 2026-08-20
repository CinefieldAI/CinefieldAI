/**
 * The secret rotation contract (Phase 25-C).
 *
 * Roadmap 25-C done-criterion: "Rotation kesintisiz test ediliyor" —
 * rotation is tested without interruption. This module is the bounded,
 * value-free record of ONE secret's rotation lifecycle — never the secret
 * itself, never a value, never a provider credential.
 *
 * ---------------------------------------------------------------------------
 * NAMES AND STATE ONLY. NO VALUE FIELD EXISTS OR EVER WILL.
 * ---------------------------------------------------------------------------
 * Same discipline `secret-registry.ts` already states for itself: "THIS FILE
 * CONTAINS NO VALUES AND CAN CONTAIN NONE." `currentVersionRef`/
 * `previousVersionRef` are AWS Secrets Manager version ids (opaque UUIDs
 * Secrets Manager assigns) or a provider's own rotation-generation label —
 * never the secret value, never even shaped like one.
 *
 * ---------------------------------------------------------------------------
 * SECRET ID, NOT SECRET NAME
 * ---------------------------------------------------------------------------
 * `secretName` must be a name already registered in `SECRET_REGISTRY`
 * (`secret-registry.ts`) — the same "cannot rotate an undocumented
 * credential" gate `getServerSecret` already enforces for READING one.
 */

import type { RotationClass } from "@/lib/config/secret-registry";
import type { CinefieldEnvironment } from "@/lib/config/environment";

/**
 * Bounded lifecycle states, matching the corrective batch's own enumeration.
 *
 *   NOT_CONFIGURED      no rotation has ever been attempted for this secret.
 *                       The honest default for all 63 registry entries today.
 *   ROTATION_REQUIRED   due per its RotationClass's own schedule, or flagged
 *                       by a leak-runbook run — not yet started.
 *   ROTATING            a new version was requested from the provider/KMS;
 *                       not yet confirmed live anywhere that reads it.
 *   VERIFYING           the new version exists; dependent services have not
 *                       all confirmed they can authenticate with it yet.
 *   ACTIVE              verification passed. The new version is the one in
 *                       use; this is the terminal SUCCESS state.
 *   ROLLBACK_AVAILABLE  verification failed after rotation, but the previous
 *                       version is still valid (DUAL_KEY_OVERLAP providers
 *                       only) — a real, safe way back, not a promise every
 *                       provider can keep.
 *   FAILED              rotation or verification failed and no safe rollback
 *                       exists (CUT_OVER providers, or overlap window
 *                       expired). Requires a human, not a retry.
 *   EXPIRED              the previous version's overlap window elapsed
 *                       without a completed rotation — the credential this
 *                       describes may already be stale.
 */
export type RotationState =
  | "NOT_CONFIGURED"
  | "ROTATION_REQUIRED"
  | "ROTATING"
  | "VERIFYING"
  | "ACTIVE"
  | "ROLLBACK_AVAILABLE"
  | "FAILED"
  | "EXPIRED";

/** States a caller may legally move FROM a given state TO. Enforced by `nextRotationState`. */
const ALLOWED_TRANSITIONS: Readonly<Record<RotationState, readonly RotationState[]>> = {
  NOT_CONFIGURED: ["ROTATION_REQUIRED"],
  ROTATION_REQUIRED: ["ROTATING", "FAILED"],
  ROTATING: ["VERIFYING", "FAILED"],
  VERIFYING: ["ACTIVE", "ROLLBACK_AVAILABLE", "FAILED"],
  ACTIVE: ["ROTATION_REQUIRED", "EXPIRED"],
  ROLLBACK_AVAILABLE: ["ROTATION_REQUIRED", "FAILED", "EXPIRED"],
  FAILED: ["ROTATION_REQUIRED"],
  EXPIRED: ["ROTATION_REQUIRED"],
};

export interface RotationRecord {
  readonly secretName: string;
  readonly owner: string;
  readonly environment: CinefieldEnvironment;
  readonly rotationClass: RotationClass;
  readonly state: RotationState;
  /** Opaque provider-assigned version id/label. Never a value. */
  readonly currentVersionRef: string | null;
  readonly previousVersionRef: string | null;
  readonly rotatedAt: string | null;
  /** When `previousVersionRef`'s overlap window elapses, for DUAL_KEY_OVERLAP secrets only. */
  readonly expiresAt: string | null;
  /** Bounded reason code, matching `security-event-contract.ts`'s REASON_CODE shape — never free text. */
  readonly reasonCode: string;
  readonly verifiedAt: string | null;
}

export type RotationTransitionRefusal = "unknown_from_state" | "illegal_transition";

export interface RotationTransitionResult {
  readonly allowed: boolean;
  readonly refusal: RotationTransitionRefusal | null;
}

/**
 * Pure guard: may a rotation record move from `from` to `to`?
 *
 * The state machine's only enforcement point — a caller cannot jump straight
 * from `NOT_CONFIGURED` to `ACTIVE`, or resurrect a `FAILED` rotation
 * directly into `ACTIVE` without going through `ROTATION_REQUIRED` again.
 * `rotation-execution-service.ts` calls this before every durable write; it
 * never trusts a caller-supplied target state on its own.
 */
export function canTransition(from: RotationState, to: RotationState): RotationTransitionResult {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return { allowed: false, refusal: "unknown_from_state" };
  if (!allowed.includes(to)) return { allowed: false, refusal: "illegal_transition" };
  return { allowed: true, refusal: null };
}

const REASON_CODE = /^[a-z][a-z0-9_]{1,64}$/;

export function isValidReasonCode(reasonCode: string): boolean {
  return REASON_CODE.test(reasonCode);
}
